-- =============================================================================
-- ARLUC SIG · Migración 7: Retenciones de IVA y libros fiscales
-- -----------------------------------------------------------------------------
-- Régimen de retenciones de IVA para contribuyentes especiales (SENIAT):
--   * EMITIDAS: ARLUC, como agente de retención, retiene a sus proveedores el
--     75 % del IVA (100 % en los supuestos de la norma) al registrar la factura
--     de compra; emite comprobante AAAAMM + 8 dígitos y entera quincenalmente.
--   * RECIBIDAS: los clientes contribuyentes especiales retienen el 75 % del IVA
--     de nuestras ventas; la retención es un "medio de cobro" contra la cuenta
--     IVA retenido por clientes y se descuenta en la declaración al recibir el
--     comprobante.
--   * Las retenciones son obligaciones en Bs: al enterarlas a otra tasa, la
--     variación en USD se registra como diferencial cambiario.
-- Libros (Reglamento de la Ley del IVA): ventas y compras del mes en Bs a la
-- tasa de cada documento, y resumen de IVA para la declaración.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Parámetros por tercero
-- -----------------------------------------------------------------------------
alter table public.clientes
  add column contribuyente_especial boolean not null default false,
  add column porcentaje_retencion_iva numeric(5, 2) not null default 75
    check (porcentaje_retencion_iva in (75, 100));
comment on column public.clientes.contribuyente_especial is
  'Si es true, el cliente retiene IVA a ARLUC al pagar (agente de retención).';

alter table public.proveedores
  add column porcentaje_retencion_iva numeric(5, 2) not null default 75
    check (porcentaje_retencion_iva in (0, 75, 100));
comment on column public.proveedores.porcentaje_retencion_iva is
  '75 % general; 100 % si el proveedor no está inscrito en el RIF o la factura no cumple requisitos; 0 % si no aplica.';

alter table public.facturas
  add column iva_retenido_usd numeric(14, 2) not null default 0;

alter table public.ordenes_compra
  add column iva_retenido_usd numeric(14, 2) not null default 0;

-- Medio de cobro "retención de IVA" (no entra dinero: nace un crédito fiscal).
insert into public.metodos_pago_contables (metodo_id, cuenta_id, es_divisa, descripcion)
select 'retencion_iva', id, false, 'IVA retenido por cliente contribuyente especial'
  from public.plan_cuentas where codigo = '1.1.04.02';

insert into public.configuracion_contable (clave, cuenta_id, descripcion)
select 'CTA_IVA_RETENIDO_POR_ENTERAR', id, 'Retenciones de IVA practicadas a proveedores, por enterar al SENIAT'
  from public.plan_cuentas where codigo = '2.1.02.03';

-- -----------------------------------------------------------------------------
-- Comprobantes de retención
-- -----------------------------------------------------------------------------
create table public.retenciones_iva (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null check (tipo in ('EMITIDA', 'RECIBIDA')),
  numero_comprobante  text unique check (numero_comprobante ~ '^[0-9]{14}$'),
  fecha               date not null,
  anio                smallint generated always as (extract(year from fecha)::smallint) stored,
  mes                 smallint generated always as (extract(month from fecha)::smallint) stored,
  quincena            smallint generated always as (case when extract(day from fecha) <= 15 then 1 else 2 end) stored,
  factura_id          uuid references public.facturas (id) on delete restrict,
  orden_id            uuid references public.ordenes_compra (id) on delete restrict,
  tercero_rif         text,
  tercero_nombre      text,
  numero_factura      text,
  numero_control      text,
  base_usd            numeric(14, 2) not null,
  iva_usd             numeric(14, 2) not null,
  porcentaje          numeric(5, 2) not null,
  monto_retenido_usd  numeric(14, 2) not null check (monto_retenido_usd > 0),
  tasa                numeric(18, 4) not null,
  monto_retenido_bs   numeric(18, 2) generated always as (round(monto_retenido_usd * tasa, 2)) stored,
  estado              text not null check (estado in ('PENDIENTE', 'REGISTRADA', 'ENTERADA', 'ANULADA')),
  enterada_en         date,
  asiento_entero_id   uuid references public.asientos_contables (id),
  created_at          timestamptz not null default now(),
  check ((tipo = 'EMITIDA') = (orden_id is not null)),
  check ((tipo = 'RECIBIDA') = (factura_id is not null))
);
comment on column public.retenciones_iva.estado is
  'RECIBIDA: PENDIENTE hasta que el cliente entrega el comprobante. EMITIDA: REGISTRADA hasta enterarse al SENIAT.';
create index on public.retenciones_iva (tipo, anio, mes, quincena);
create index on public.retenciones_iva (factura_id);
create index on public.retenciones_iva (orden_id);

alter table public.retenciones_iva enable row level security;
create policy retenciones_select on public.retenciones_iva for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));
create trigger trg_retenciones_iva_auditoria after insert or update or delete on public.retenciones_iva
for each row execute function interno.registrar_auditoria();

create or replace function interno.numero_comprobante_retencion(p_fecha date)
returns text
language sql
set search_path = ''
as $$
  select to_char(p_fecha, 'YYYYMM')
         || lpad(interno.siguiente_valor('retencion_iva_' || to_char(p_fecha, 'YYYYMM'))::text, 8, '0')
$$;

-- -----------------------------------------------------------------------------
-- Ventas: emitir_factura con retención del cliente contribuyente especial
-- -----------------------------------------------------------------------------
create or replace function interno.emitir_factura(
  p_vendedor_id uuid,
  p_cliente_id uuid,
  p_items jsonb,
  p_pagos jsonb,
  p_autorizar_sobregiro boolean default false,
  p_fecha timestamptz default null
)
returns public.facturas
language plpgsql security definer
set search_path = ''
as $$
declare
  v_empresa public.configuracion_empresa%rowtype;
  v_cliente public.clientes%rowtype;
  v_tasa public.tasas_cambio%rowtype;
  v_factura public.facturas%rowtype;
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_item jsonb;
  v_prod public.productos%rowtype;
  v_cant integer;
  v_lineas jsonb := '[]'::jsonb;
  v_base numeric(14, 2) := 0;
  v_exento numeric(14, 2) := 0;
  v_costo numeric(14, 2) := 0;
  v_iva numeric(14, 2);
  v_total_sin_igtf numeric(14, 2);
  v_pago jsonb;
  v_pagos jsonb := '[]'::jsonb;
  v_metodo_cobro text;
  v_es_divisa boolean;
  v_cuenta_cobro uuid;
  v_monto numeric(14, 2);
  v_igtf_pago numeric(14, 2);
  v_aplicado numeric(14, 2) := 0;
  v_en_tienda numeric(14, 2) := 0;
  v_base_igtf numeric(14, 2) := 0;
  v_igtf numeric(14, 2) := 0;
  v_financiado numeric(14, 2) := 0;
  v_credito numeric(14, 2) := 0;
  v_hay_cashea boolean := false;
  v_idx_mayor int;
  v_mayor numeric := -1;
  v_dif numeric(14, 2);
  v_limite_usd numeric(14, 2);
  v_saldo_actual numeric(14, 2);
  v_asiento jsonb := '[]'::jsonb;
  v_detalle record;
  v_retencion numeric(14, 2) := 0;
  v_retencion_indicada numeric(14, 2) := 0;
  i int := 0;
begin
  select * into v_empresa from public.configuracion_empresa where id = 'default';
  select * into v_tasa from public.tasas_cambio
   where fecha_registro <= v_dia order by fecha_registro desc limit 1;
  if v_tasa.id is null then
    raise exception 'No hay tasa BCV registrada. Cargue la tasa del día antes de facturar.';
  end if;
  if v_tasa.fecha_registro < v_dia and p_fecha is null then
    raise exception 'La última tasa BCV es del %. Registre la tasa de hoy antes de facturar.',
      to_char(v_tasa.fecha_registro, 'DD/MM/YYYY');
  end if;

  if p_cliente_id is not null then
    select * into v_cliente from public.clientes where id = p_cliente_id;
    if not found or not v_cliente.activo then
      raise exception 'El cliente no existe o está inactivo.';
    end if;
  end if;

  -- 1) Líneas: precio, exención y costo SIEMPRE desde el maestro.
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura no tiene productos.';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item ->> 'cantidad')::integer;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida en la factura.';
    end if;
    select * into v_prod from public.productos where id = (v_item ->> 'producto_id')::uuid;
    if not found or not v_prod.activo then
      raise exception 'Producto inexistente o inactivo en la factura.';
    end if;
    v_lineas := v_lineas || jsonb_build_object(
      'producto_id', v_prod.id, 'cantidad', v_cant, 'precio', v_prod.precio_usd, 'exento', v_prod.exento_iva);
    if v_prod.exento_iva then
      v_exento := v_exento + round(v_cant * v_prod.precio_usd, 2);
    else
      v_base := v_base + round(v_cant * v_prod.precio_usd, 2);
    end if;
  end loop;

  v_iva := round(v_base * v_empresa.alicuota_iva / 100, 2);
  v_total_sin_igtf := v_base + v_exento + v_iva;

  -- Cliente contribuyente especial: retiene el % de su línea sobre el IVA.
  if p_cliente_id is not null and v_cliente.contribuyente_especial and v_iva > 0 then
    v_retencion := round(v_iva * v_cliente.porcentaje_retencion_iva / 100, 2);
  end if;

  -- 2) Pagos.
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Indique al menos un método de pago.';
  end if;
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    if not exists (select 1 from public.metodos_pago_contables where metodo_id = v_pago ->> 'metodo_id') then
      raise exception 'Método de pago "%" no reconocido.', v_pago ->> 'metodo_id';
    end if;
    v_monto := round(coalesce((v_pago ->> 'monto_usd')::numeric, 0), 2);
    if v_pago ->> 'metodo_id' = 'retencion_iva' then
      v_retencion_indicada := v_retencion_indicada + v_monto;
    end if;
    if v_pago ->> 'metodo_id' = 'cashea' then
      if v_hay_cashea then
        raise exception 'Solo puede haber un pago Cashea por factura.';
      end if;
      v_hay_cashea := true;
      if v_monto <= 0 then
        raise exception 'Indique el monto de la inicial pagada en Cashea.';
      end if;
      if coalesce(v_pago ->> 'cashea_metodo_inicial', 'punto_venta') in ('cashea', 'credito') then
        raise exception 'Método inválido para la inicial de Cashea.';
      end if;
    elsif v_monto <= 0 then
      raise exception 'Los montos de pago deben ser mayores a cero.';
    end if;
    if v_pago ->> 'metodo_id' = 'credito' then
      v_credito := v_credito + v_monto;
    else
      v_en_tienda := v_en_tienda + v_monto;
    end if;
    v_aplicado := v_aplicado + v_monto;
    if v_monto > v_mayor and v_pago ->> 'metodo_id' not in ('credito', 'retencion_iva') then
      v_mayor := v_monto; v_idx_mayor := i;
    end if;
    i := i + 1;
  end loop;

  if v_retencion_indicada <> v_retencion then
    if v_retencion = 0 then
      raise exception 'El cliente no es contribuyente especial: no corresponde retención de IVA.';
    end if;
    raise exception 'El cliente es contribuyente especial: la retención de IVA debe ser % USD (% %% de % USD de IVA).',
      v_retencion, v_cliente.porcentaje_retencion_iva, v_iva;
  end if;

  if v_hay_cashea then
    v_financiado := v_total_sin_igtf - v_aplicado;
    if v_financiado < 0 then
      raise exception 'Los pagos superan el total de la factura.';
    end if;
  else
    v_dif := v_total_sin_igtf - v_aplicado;
    if abs(v_dif) > 0.01 then
      if v_dif > 0 then
        raise exception 'Faltan % USD por pagar.', v_dif;
      end if;
      raise exception 'Los pagos superan el total por % USD. Registre el monto exacto (el vuelto no se factura).', -v_dif;
    end if;
    -- Diferencia de 1 céntimo por conversión Bs/USD: se absorbe en el mayor pago.
    if v_dif <> 0 and v_idx_mayor is not null then
      p_pagos := jsonb_set(p_pagos, array[v_idx_mayor::text, 'monto_usd'],
        to_jsonb(round((p_pagos -> v_idx_mayor ->> 'monto_usd')::numeric, 2) + v_dif));
    end if;
  end if;

  -- 3) Crédito directo: cliente obligatorio y límite contra el saldo REAL.
  if v_credito > 0 then
    if p_cliente_id is null then
      raise exception 'Para ventas a crédito debe seleccionar un cliente.';
    end if;
    if not v_cliente.credito_activo then
      raise exception 'El cliente "%" no tiene crédito activo.', v_cliente.nombre;
    end if;
    v_limite_usd := case when v_cliente.moneda_credito = 'bs'
                         then round(v_cliente.linea_credito / v_tasa.tasa_usd_bs, 2)
                         else v_cliente.linea_credito end;
    select coalesce(sum(saldo_usd), 0) into v_saldo_actual from public.cuentas_por_cobrar
     where cliente_id = p_cliente_id and tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE';
    if v_saldo_actual + v_credito > v_limite_usd then
      if not (p_autorizar_sobregiro and public.tiene_rol('admin', 'gerente')) then
        raise exception 'Límite de crédito excedido: línea % USD, saldo pendiente % USD, disponible % USD, solicitado % USD.',
          v_limite_usd, v_saldo_actual, greatest(v_limite_usd - v_saldo_actual, 0), v_credito
          using hint = 'SOBREGIRO_CREDITO';
      end if;
    end if;
  end if;

  -- 4) IGTF por pago en divisas y detalle de pagos a guardar.
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_monto := round(coalesce((v_pago ->> 'monto_usd')::numeric, 0), 2);
    v_metodo_cobro := case when v_pago ->> 'metodo_id' = 'cashea'
                           then coalesce(v_pago ->> 'cashea_metodo_inicial', 'punto_venta')
                           else v_pago ->> 'metodo_id' end;
    select es_divisa, cuenta_id into v_es_divisa, v_cuenta_cobro
      from public.metodos_pago_contables where metodo_id = v_metodo_cobro;

    v_igtf_pago := case when v_empresa.contribuyente_especial and v_es_divisa
                        then round(v_monto * v_empresa.alicuota_igtf / 100, 2) else 0 end;
    if v_igtf_pago > 0 then
      v_base_igtf := v_base_igtf + v_monto;
      v_igtf := v_igtf + v_igtf_pago;
    end if;

    v_pagos := v_pagos || (
      (v_pago - array['monto_usd', 'monto_bs', 'aplicado_usd', 'igtf_usd', 'metodo',
                      'inicial_usd', 'inicial_bs', 'credito_cashea_usd', 'credito_cashea_bs'])
      || jsonb_build_object(
           'metodo', (select case v_pago ->> 'metodo_id'
                        when 'efectivo_usd' then 'Efectivo USD' when 'efectivo_bs' then 'Efectivo Bs'
                        when 'zelle' then 'Zelle' when 'pago_movil' then 'Pago Móvil'
                        when 'punto_venta' then 'Punto de Venta' when 'transferencia' then 'Transferencia'
                        when 'cashea' then 'Cashea' when 'credito' then 'Crédito'
                        when 'retencion_iva' then 'Retención IVA' end),
           'aplicado_usd', v_monto,
           'igtf_usd', v_igtf_pago,
           'monto_usd', v_monto + v_igtf_pago,
           'monto_bs', case when v_es_divisa then round((v_monto + v_igtf_pago) * v_tasa.tasa_usd_bs, 2)
                            else coalesce(round((v_pago ->> 'monto_bs')::numeric, 2),
                                          round(v_monto * v_tasa.tasa_usd_bs, 2)) end)
      || case when v_pago ->> 'metodo_id' = 'cashea' then jsonb_build_object(
           'cashea_metodo_inicial', v_metodo_cobro,
           'inicial_usd', v_monto + v_igtf_pago,
           'inicial_bs', round((v_monto + v_igtf_pago) * v_tasa.tasa_usd_bs, 2),
           'credito_cashea_usd', v_financiado,
           'credito_cashea_bs', round(v_financiado * v_tasa.tasa_usd_bs, 2))
         else '{}'::jsonb end);

    -- Asiento: débito a la cuenta del medio de cobro (incluye su IGTF).
    if v_pago ->> 'metodo_id' <> 'credito' then
      v_asiento := v_asiento || jsonb_build_object(
        'cuenta_id', v_cuenta_cobro, 'debe', v_monto + v_igtf_pago,
        'descripcion', 'Cobro ' || coalesce(v_pago ->> 'metodo_id', ''));
    end if;
  end loop;

  -- 5) Cabecera de la factura.
  perform set_config('arluc.fecha_operacion', v_fecha::text, true);

  insert into public.facturas (
    numero_factura, numero_control, cliente_id, cliente_nombre, cliente_documento,
    vendedor_id, tasa_id, subtotal_usd, descuento_usd,
    base_imponible_usd, exento_usd, alicuota_iva, iva_usd,
    alicuota_igtf, base_igtf_usd, igtf_usd,
    total_usd, total_bs, metodos_pago, fecha_emision, iva_retenido_usd
  ) values (
    'ARLUC-' || lpad(interno.siguiente_valor('factura')::text, 8, '0'),
    '00-' || lpad(interno.siguiente_valor('control_fiscal')::text, 8, '0'),
    p_cliente_id, v_cliente.nombre, v_cliente.documento_identidad,
    p_vendedor_id, v_tasa.id, v_base + v_exento, 0,
    v_base, v_exento, v_empresa.alicuota_iva, v_iva,
    case when v_igtf > 0 then v_empresa.alicuota_igtf else 0 end, v_base_igtf, v_igtf,
    v_total_sin_igtf + v_igtf, round((v_total_sin_igtf + v_igtf) * v_tasa.tasa_usd_bs, 2),
    v_pagos, v_fecha, v_retencion
  ) returning * into v_factura;

  -- 6) Líneas (el trigger descuenta stock y fija el costo).
  insert into public.detalles_factura (factura_id, producto_id, producto_nombre, cantidad, precio_unitario_usd, exento_iva)
  select v_factura.id, p.id, p.nombre, (l ->> 'cantidad')::integer, p.precio_usd, p.exento_iva
    from jsonb_array_elements(v_lineas) l
    join public.productos p on p.id = (l ->> 'producto_id')::uuid;

  select coalesce(sum(round(cantidad * costo_unitario_usd, 2)), 0) into v_costo
    from public.detalles_factura where factura_id = v_factura.id;

  -- 7) Retención recibida y cuentas por cobrar.
  if v_retencion > 0 then
    insert into public.retenciones_iva (
      tipo, fecha, factura_id, tercero_rif, tercero_nombre, numero_factura, numero_control,
      base_usd, iva_usd, porcentaje, monto_retenido_usd, tasa, estado
    ) values (
      'RECIBIDA', v_dia, v_factura.id, v_cliente.documento_identidad, v_cliente.nombre,
      v_factura.numero_factura, v_factura.numero_control,
      v_base, v_iva, v_cliente.porcentaje_retencion_iva, v_retencion, v_tasa.tasa_usd_bs, 'PENDIENTE'
    );
  end if;

  if v_credito > 0 then
    insert into public.cuentas_por_cobrar (factura_id, cliente_id, tipo, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento)
    values (v_factura.id, p_cliente_id, 'CREDITO_DIRECTO', v_credito, v_credito, v_dia, v_dia + v_empresa.dias_credito);
    v_asiento := v_asiento || jsonb_build_object(
      'cuenta_clave', 'CTA_CXC_CLIENTES', 'debe', v_credito, 'descripcion', 'Venta a crédito');
  end if;
  if v_financiado > 0 then
    insert into public.cuentas_por_cobrar (factura_id, cliente_id, tipo, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento)
    values (v_factura.id, p_cliente_id, 'CASHEA', v_financiado, v_financiado, v_dia, v_dia + 14);
    v_asiento := v_asiento || jsonb_build_object(
      'cuenta_clave', 'CTA_CXC_CASHEA', 'debe', v_financiado, 'descripcion', 'Financiado por Cashea');
  end if;

  -- 8) Asiento: cobros / ventas + IVA + IGTF, y costo de venta / inventario.
  if v_base > 0 then
    v_asiento := v_asiento || jsonb_build_object('cuenta_clave', 'CTA_VENTAS_GRAVADAS', 'haber', v_base, 'descripcion', 'Venta gravada');
  end if;
  if v_exento > 0 then
    v_asiento := v_asiento || jsonb_build_object('cuenta_clave', 'CTA_VENTAS_EXENTAS', 'haber', v_exento, 'descripcion', 'Venta exenta');
  end if;
  if v_iva > 0 then
    v_asiento := v_asiento || jsonb_build_object('cuenta_clave', 'CTA_IVA_DEBITO', 'haber', v_iva,
      'descripcion', 'IVA ' || v_empresa.alicuota_iva || '%');
  end if;
  if v_igtf > 0 then
    v_asiento := v_asiento || jsonb_build_object('cuenta_clave', 'CTA_IGTF_POR_PAGAR', 'haber', v_igtf,
      'descripcion', 'IGTF ' || v_empresa.alicuota_igtf || '% percibido');
  end if;
  if v_costo > 0 then
    v_asiento := v_asiento
      || jsonb_build_object('cuenta_clave', 'CTA_COSTO_VENTAS', 'debe', v_costo, 'descripcion', 'Costo de la mercancía vendida')
      || jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'haber', v_costo, 'descripcion', 'Salida de inventario');
  end if;

  perform interno.registrar_asiento(
    v_dia,
    'Venta ' || v_factura.numero_factura || coalesce(' a ' || v_cliente.nombre, ' (contado)'),
    'Ventas', v_asiento, v_tasa.tasa_usd_bs, 'FACTURA', v_factura.id);

  perform set_config('arluc.fecha_operacion', '', true);
  return v_factura;
end;
$$;

-- Anular una factura anula también la retención recibida.
create or replace function interno.retenciones_al_anular_factura()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.retenciones_iva set estado = 'ANULADA' where factura_id = new.id;
  return null;
end;
$$;

create trigger trg_facturas_anular_retenciones
after update of estado on public.facturas
for each row when (old.estado = 'emitida' and new.estado = 'anulada')
execute function interno.retenciones_al_anular_factura();

-- Registrar el comprobante que entrega el cliente.
create or replace function interno.registrar_comprobante_recibido(p_retencion_id uuid, p_numero text, p_fecha date)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_numero !~ '^[0-9]{14}$' then
    raise exception 'El número de comprobante debe tener 14 dígitos (AAAAMM + 8 dígitos).';
  end if;
  update public.retenciones_iva
     set numero_comprobante = p_numero, fecha = coalesce(p_fecha, fecha), estado = 'REGISTRADA'
   where id = p_retencion_id and tipo = 'RECIBIDA' and estado = 'PENDIENTE';
  if not found then
    raise exception 'La retención no existe o ya tiene comprobante.';
  end if;
end;
$$;

create or replace function public.registrar_comprobante_recibido(p_retencion_id uuid, p_numero text, p_fecha date default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente', 'contador') then
    raise exception 'No autorizado para registrar comprobantes de retención.';
  end if;
  perform interno.registrar_comprobante_recibido(p_retencion_id, trim(p_numero), p_fecha);
end;
$$;

-- -----------------------------------------------------------------------------
-- Compras: retención al proveedor al registrar su factura
-- -----------------------------------------------------------------------------
create or replace function interno.ordenes_al_recibir()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  d record;
  v_dia date := (new.recibida_en at time zone 'America/Caracas')::date;
  v_proveedor public.proveedores%rowtype;
  v_agente boolean;
  v_retencion numeric(14, 2) := 0;
  v_tasa numeric(18, 4);
begin
  if new.total_usd <= 0 then
    raise exception 'La orden % no tiene líneas valoradas.', new.numero_orden;
  end if;

  for d in select * from public.detalles_orden_compra where orden_id = new.id loop
    perform interno.mover_stock(
      d.producto_id, d.cantidad, 'COMPRA', d.precio_unitario_usd,
      'ORDEN_COMPRA', new.id, 'Recepción ' || new.numero_orden
    );
  end loop;

  select * into v_proveedor from public.proveedores where id = new.proveedor_id;
  select contribuyente_especial into v_agente from public.configuracion_empresa where id = 'default';
  v_tasa := public.tasa_vigente(v_dia);

  -- Como agente de retención se retiene el % del IVA del proveedor.
  if v_agente and new.iva_usd > 0 and v_proveedor.porcentaje_retencion_iva > 0 then
    v_retencion := round(new.iva_usd * v_proveedor.porcentaje_retencion_iva / 100, 2);
    insert into public.retenciones_iva (
      tipo, numero_comprobante, fecha, orden_id, tercero_rif, tercero_nombre, numero_factura, numero_control,
      base_usd, iva_usd, porcentaje, monto_retenido_usd, tasa, estado
    ) values (
      'EMITIDA', interno.numero_comprobante_retencion(v_dia), v_dia, new.id, v_proveedor.rif, v_proveedor.nombre,
      new.numero_factura_proveedor, new.numero_control_proveedor,
      new.total_usd, new.iva_usd, v_proveedor.porcentaje_retencion_iva, v_retencion, v_tasa, 'REGISTRADA'
    );
    update public.ordenes_compra set iva_retenido_usd = v_retencion where id = new.id;
  end if;

  -- El proveedor cobra el total menos lo retenido.
  insert into public.cuentas_por_pagar (orden_id, proveedor_id, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento)
  values (new.id, new.proveedor_id, new.total_usd + new.iva_usd - v_retencion,
          new.total_usd + new.iva_usd - v_retencion, v_dia, v_dia + 30);

  perform interno.registrar_asiento(
    v_dia,
    'Compra ' || new.numero_orden || ' a ' || v_proveedor.nombre
      || coalesce(' (factura ' || new.numero_factura_proveedor || ')', ''),
    'Compras',
    jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'debe', new.total_usd, 'descripcion', 'Mercancía recibida'),
      jsonb_build_object('cuenta_clave', 'CTA_CXP_PROVEEDORES', 'haber', new.total_usd + new.iva_usd - v_retencion,
                         'descripcion', v_proveedor.nombre))
    || case when new.iva_usd > 0 then jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_IVA_CREDITO', 'debe', new.iva_usd, 'descripcion', 'IVA crédito fiscal'))
       else '[]'::jsonb end
    || case when v_retencion > 0 then jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_IVA_RETENIDO_POR_ENTERAR', 'haber', v_retencion,
                         'descripcion', 'Retención IVA ' || v_proveedor.porcentaje_retencion_iva || ' %'))
       else '[]'::jsonb end,
    v_tasa, 'ORDEN_COMPRA', new.id);
  return null;
end;
$$;

-- Las órdenes se actualizan desde el trigger (iva_retenido_usd); se permite ese único cambio.
create or replace function interno.ordenes_cambio_estado()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_alicuota numeric(5, 2);
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'pendiente' then
      raise exception 'Solo se pueden eliminar órdenes pendientes.';
    end if;
    return old;
  end if;

  if old.estado = 'recibida' and new.estado = 'recibida'
     and (to_jsonb(new) - 'iva_retenido_usd') = (to_jsonb(old) - 'iva_retenido_usd') then
    return new;
  end if;

  if old.estado <> 'pendiente' then
    raise exception 'La orden % ya está %; no admite cambios.', old.numero_orden, old.estado;
  end if;

  select coalesce(sum(subtotal_usd), 0) into new.total_usd
    from public.detalles_orden_compra where orden_id = new.id;

  if new.estado = 'recibida' then
    select alicuota_iva into v_alicuota from public.configuracion_empresa where id = 'default';
    new.iva_usd := round(new.total_usd * v_alicuota / 100, 2);
    new.recibida_en := interno.fecha_operacion();
    new.recibida_por := auth.uid();
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Enteramiento quincenal de las retenciones practicadas
-- -----------------------------------------------------------------------------
create or replace function interno.enterar_retenciones_iva(
  p_anio int, p_mes int, p_quincena int, p_metodo_id text default 'transferencia', p_fecha date default current_date
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_total_usd numeric(14, 2);
  v_total_bs numeric(18, 2);
  v_cantidad int;
  v_tasa numeric(18, 4) := public.tasa_vigente(p_fecha);
  v_pago_usd numeric(14, 2);
  v_dif numeric(14, 2);
  v_cuenta uuid;
  v_asiento uuid;
  v_lineas jsonb;
begin
  select coalesce(sum(monto_retenido_usd), 0), coalesce(sum(monto_retenido_bs), 0), count(*)
    into v_total_usd, v_total_bs, v_cantidad
    from public.retenciones_iva
   where tipo = 'EMITIDA' and estado = 'REGISTRADA'
     and anio = p_anio and mes = p_mes and quincena = p_quincena;
  if v_cantidad = 0 then
    raise exception 'No hay retenciones por enterar en la quincena %/%/%.', p_quincena, p_mes, p_anio;
  end if;

  select cuenta_id into v_cuenta from public.metodos_pago_contables where metodo_id = p_metodo_id;
  -- Se paga el mismo monto en Bs; su equivalente en USD depende de la tasa de hoy.
  v_pago_usd := round(v_total_bs / v_tasa, 2);
  v_dif := v_total_usd - v_pago_usd;

  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta_clave', 'CTA_IVA_RETENIDO_POR_ENTERAR', 'debe', v_total_usd, 'debe_ves', v_total_bs,
                       'descripcion', v_cantidad || ' comprobante(s) de retención'),
    jsonb_build_object('cuenta_id', v_cuenta, 'haber', v_pago_usd, 'haber_ves', v_total_bs,
                       'descripcion', 'Pago al SENIAT'));
  if v_dif > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_DIF_CAMBIARIO_GANANCIA', 'haber', v_dif, 'haber_ves', 0,
                                               'descripcion', 'Menor equivalente en USD de una obligación en Bs');
  elsif v_dif < 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_DIF_CAMBIARIO_PERDIDA', 'debe', -v_dif, 'debe_ves', 0,
                                               'descripcion', 'Mayor equivalente en USD de una obligación en Bs');
  end if;

  v_asiento := interno.registrar_asiento(
    p_fecha,
    format('Enteramiento de retenciones de IVA, %s quincena %s/%s', case p_quincena when 1 then '1ra' else '2da' end, lpad(p_mes::text, 2, '0'), p_anio),
    'Tesorería', v_lineas, v_tasa, 'ENTERAMIENTO_IVA', null);

  update public.retenciones_iva
     set estado = 'ENTERADA', enterada_en = p_fecha, asiento_entero_id = v_asiento
   where tipo = 'EMITIDA' and estado = 'REGISTRADA'
     and anio = p_anio and mes = p_mes and quincena = p_quincena;

  return jsonb_build_object('comprobantes', v_cantidad, 'total_bs', v_total_bs, 'pagado_usd', v_pago_usd,
                            'diferencial_usd', v_dif, 'asiento_id', v_asiento);
end;
$$;

create or replace function public.enterar_retenciones_iva(p_anio int, p_mes int, p_quincena int, p_metodo_id text default 'transferencia')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'contador') then
    raise exception 'Solo un administrador o contador puede enterar retenciones.';
  end if;
  -- La quincena cierra el día 15 o el último día del mes.
  if (case p_quincena when 1 then make_date(p_anio, p_mes, 15)
        else (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date end) >= current_date then
    raise exception 'La quincena aún no ha cerrado.';
  end if;
  return interno.enterar_retenciones_iva(p_anio, p_mes, p_quincena, p_metodo_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Libros fiscales (montos en Bs a la tasa de cada documento)
-- -----------------------------------------------------------------------------
create or replace function public.libro_ventas(p_anio int, p_mes int)
returns table (
  fecha date, numero_factura text, numero_control text, rif text, nombre text, estado text,
  total_bs numeric, exento_bs numeric, base_bs numeric, alicuota numeric, iva_bs numeric,
  iva_retenido_bs numeric, comprobante_retencion text, igtf_bs numeric, tasa numeric,
  total_usd numeric, base_usd numeric, iva_usd numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform interno.exigir_direccion();
  return query
    select (f.fecha_emision at time zone 'America/Caracas')::date, f.numero_factura, f.numero_control,
           coalesce(f.cliente_documento, 'Consumidor final'), coalesce(f.cliente_nombre, 'Consumidor final'),
           upper(f.estado),
           -- Las facturas anuladas se listan con montos en cero, como exige el libro.
           case when f.estado = 'emitida' then round((f.base_imponible_usd + f.exento_usd + f.iva_usd) * t.tasa_usd_bs, 2) else 0 end,
           case when f.estado = 'emitida' then round(f.exento_usd * t.tasa_usd_bs, 2) else 0 end,
           case when f.estado = 'emitida' then round(f.base_imponible_usd * t.tasa_usd_bs, 2) else 0 end,
           f.alicuota_iva,
           case when f.estado = 'emitida' then round(f.iva_usd * t.tasa_usd_bs, 2) else 0 end,
           case when f.estado = 'emitida' then round(f.iva_retenido_usd * t.tasa_usd_bs, 2) else 0 end,
           r.numero_comprobante,
           case when f.estado = 'emitida' then round(f.igtf_usd * t.tasa_usd_bs, 2) else 0 end,
           t.tasa_usd_bs,
           case when f.estado = 'emitida' then f.base_imponible_usd + f.exento_usd + f.iva_usd else 0 end,
           case when f.estado = 'emitida' then f.base_imponible_usd else 0 end,
           case when f.estado = 'emitida' then f.iva_usd else 0 end
      from public.facturas f
      join public.tasas_cambio t on t.id = f.tasa_id
      left join public.retenciones_iva r on r.factura_id = f.id and r.estado <> 'ANULADA'
     where extract(year from f.fecha_emision at time zone 'America/Caracas') = p_anio
       and extract(month from f.fecha_emision at time zone 'America/Caracas') = p_mes
     order by f.fecha_emision, f.numero_factura;
end;
$$;

create or replace function public.libro_compras(p_anio int, p_mes int)
returns table (
  fecha date, numero_orden text, numero_factura text, numero_control text, rif text, nombre text,
  total_bs numeric, exento_bs numeric, base_bs numeric, alicuota numeric, iva_bs numeric,
  iva_retenido_bs numeric, comprobante_retencion text, tasa numeric,
  total_usd numeric, base_usd numeric, iva_usd numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_alicuota numeric := (select alicuota_iva from public.configuracion_empresa where id = 'default');
begin
  perform interno.exigir_direccion();
  return query
    select (o.recibida_en at time zone 'America/Caracas')::date, o.numero_orden,
           coalesce(o.numero_factura_proveedor, 'S/N'), coalesce(o.numero_control_proveedor, 'S/N'),
           p.rif, p.nombre,
           round((o.total_usd + o.iva_usd) * x.tasa, 2), 0::numeric, round(o.total_usd * x.tasa, 2),
           v_alicuota, round(o.iva_usd * x.tasa, 2), round(o.iva_retenido_usd * x.tasa, 2),
           r.numero_comprobante, x.tasa,
           o.total_usd + o.iva_usd, o.total_usd, o.iva_usd
      from public.ordenes_compra o
      join public.proveedores p on p.id = o.proveedor_id
      join lateral (select public.tasa_vigente((o.recibida_en at time zone 'America/Caracas')::date) as tasa) x on true
      left join public.retenciones_iva r on r.orden_id = o.id
     where o.estado = 'recibida'
       and extract(year from o.recibida_en at time zone 'America/Caracas') = p_anio
       and extract(month from o.recibida_en at time zone 'America/Caracas') = p_mes
     order by o.recibida_en, o.numero_orden;
end;
$$;

-- Resumen para la declaración mensual de IVA y los enteramientos quincenales.
create or replace function public.resumen_iva(p_anio int, p_mes int)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ventas record;
  v_compras record;
  v_ret_soportadas numeric;
  v_ret_pendientes numeric;
  v_ret_q1 numeric; v_ret_q2 numeric; v_ret_enteradas numeric;
  v_igtf_q1 numeric; v_igtf_q2 numeric;
  v_cuota numeric;
begin
  perform interno.exigir_direccion();

  select coalesce(sum(base_bs), 0) as base, coalesce(sum(exento_bs), 0) as exento, coalesce(sum(iva_bs), 0) as iva,
         count(*) filter (where estado = 'EMITIDA') as documentos, count(*) filter (where estado = 'ANULADA') as anuladas
    into v_ventas from public.libro_ventas(p_anio, p_mes);
  select coalesce(sum(base_bs), 0) as base, coalesce(sum(iva_bs), 0) as iva, count(*) as documentos
    into v_compras from public.libro_compras(p_anio, p_mes);

  -- Retenciones que nos practicaron: se deducen solo las que tienen comprobante.
  select coalesce(sum(monto_retenido_bs) filter (where estado = 'REGISTRADA'), 0),
         coalesce(sum(monto_retenido_bs) filter (where estado = 'PENDIENTE'), 0)
    into v_ret_soportadas, v_ret_pendientes
    from public.retenciones_iva where tipo = 'RECIBIDA' and anio = p_anio and mes = p_mes;

  select coalesce(sum(monto_retenido_bs) filter (where quincena = 1 and estado <> 'ANULADA'), 0),
         coalesce(sum(monto_retenido_bs) filter (where quincena = 2 and estado <> 'ANULADA'), 0),
         coalesce(sum(monto_retenido_bs) filter (where estado = 'ENTERADA'), 0)
    into v_ret_q1, v_ret_q2, v_ret_enteradas
    from public.retenciones_iva where tipo = 'EMITIDA' and anio = p_anio and mes = p_mes;

  select coalesce(sum(round(f.igtf_usd * t.tasa_usd_bs, 2)) filter (where extract(day from f.fecha_emision at time zone 'America/Caracas') <= 15), 0),
         coalesce(sum(round(f.igtf_usd * t.tasa_usd_bs, 2)) filter (where extract(day from f.fecha_emision at time zone 'America/Caracas') > 15), 0)
    into v_igtf_q1, v_igtf_q2
    from public.facturas f join public.tasas_cambio t on t.id = f.tasa_id
   where f.estado = 'emitida'
     and extract(year from f.fecha_emision at time zone 'America/Caracas') = p_anio
     and extract(month from f.fecha_emision at time zone 'America/Caracas') = p_mes;

  v_cuota := v_ventas.iva - v_compras.iva - v_ret_soportadas;

  return jsonb_build_object(
    'periodo', format('%s/%s', lpad(p_mes::text, 2, '0'), p_anio),
    'ventas', jsonb_build_object('base_bs', v_ventas.base, 'exento_bs', v_ventas.exento, 'debito_fiscal_bs', v_ventas.iva,
                                 'documentos', v_ventas.documentos, 'anuladas', v_ventas.anuladas),
    'compras', jsonb_build_object('base_bs', v_compras.base, 'credito_fiscal_bs', v_compras.iva, 'documentos', v_compras.documentos),
    'retenciones_soportadas_bs', v_ret_soportadas,
    'retenciones_sin_comprobante_bs', v_ret_pendientes,
    'cuota_a_pagar_bs', greatest(v_cuota, 0),
    'excedente_credito_bs', greatest(-v_cuota, 0),
    'retenciones_practicadas', jsonb_build_object('quincena_1_bs', v_ret_q1, 'quincena_2_bs', v_ret_q2,
                                                  'enteradas_bs', v_ret_enteradas,
                                                  'pendientes_bs', v_ret_q1 + v_ret_q2 - v_ret_enteradas),
    'igtf_percibido', jsonb_build_object('quincena_1_bs', v_igtf_q1, 'quincena_2_bs', v_igtf_q2)
  );
end;
$$;

grant execute on function public.registrar_comprobante_recibido(uuid, text, date) to authenticated;
grant execute on function public.enterar_retenciones_iva(int, int, int, text) to authenticated;
grant execute on function public.libro_ventas(int, int) to authenticated;
grant execute on function public.libro_compras(int, int) to authenticated;
grant execute on function public.resumen_iva(int, int) to authenticated;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
