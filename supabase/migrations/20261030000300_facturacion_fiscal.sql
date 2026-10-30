-- =============================================================================
-- ARLUC SIG · Migración 3: Facturación fiscal y contabilización automática
-- -----------------------------------------------------------------------------
-- * emitir_factura(): UNA transacción que calcula precios, IVA e IGTF desde el
--   servidor, valida pagos y crédito, descuenta stock, crea la cuenta por
--   cobrar y registra el asiento contable. El navegador ya no inserta facturas.
-- * IVA 16 % sobre la base gravada (Ley del IVA); exentos por producto.
-- * IGTF 3 % sobre los pagos en divisas cuando la empresa es agente de
--   percepción (contribuyente especial).
-- * Asientos automáticos: venta + costo de venta, anulación (contra-asiento),
--   recepción de compras (inventario + IVA crédito / CxP) y ajustes de stock.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Parámetros fiscales de la empresa
-- -----------------------------------------------------------------------------
alter table public.configuracion_empresa
  add column contribuyente_especial boolean not null default true,
  add column alicuota_iva  numeric(5, 2) not null default 16 check (alicuota_iva between 0 and 100),
  add column alicuota_igtf numeric(5, 2) not null default 3  check (alicuota_igtf between 0 and 100),
  add column dias_credito  integer not null default 15 check (dias_credito >= 0);

comment on column public.configuracion_empresa.contribuyente_especial is
  'Si es true la empresa percibe IGTF sobre los pagos recibidos en divisas.';

-- -----------------------------------------------------------------------------
-- Datos fiscales de la factura
-- -----------------------------------------------------------------------------
alter table public.facturas
  add column numero_control      text unique,
  add column cliente_nombre      text,
  add column cliente_documento   text,
  add column base_imponible_usd  numeric(14, 2) not null default 0,
  add column exento_usd          numeric(14, 2) not null default 0,
  add column alicuota_iva        numeric(5, 2)  not null default 16,
  add column iva_usd             numeric(14, 2) not null default 0,
  add column alicuota_igtf       numeric(5, 2)  not null default 0,
  add column base_igtf_usd       numeric(14, 2) not null default 0,
  add column igtf_usd            numeric(14, 2) not null default 0;

comment on column public.facturas.subtotal_usd is 'Base imponible + exento (antes de impuestos).';
comment on column public.facturas.total_usd is 'Base + exento + IVA + IGTF.';
comment on column public.facturas.base_igtf_usd is 'Monto de la factura pagado en divisas (base del IGTF).';

alter table public.detalles_factura
  add column exento_iva boolean not null default false;

-- El navegador ya no inserta facturas ni líneas directamente.
drop policy facturas_insert on public.facturas;
drop policy detalles_factura_insert on public.detalles_factura;
revoke execute on function public.generar_numero_factura() from authenticated;

-- -----------------------------------------------------------------------------
-- Cuentas por cobrar (documentos) y por pagar
-- -----------------------------------------------------------------------------
create table public.cuentas_por_cobrar (
  id                uuid primary key default gen_random_uuid(),
  factura_id        uuid not null references public.facturas (id) on delete restrict,
  cliente_id        uuid references public.clientes (id) on delete restrict,
  tipo              text not null check (tipo in ('CREDITO_DIRECTO', 'CASHEA')),
  monto_usd         numeric(14, 2) not null check (monto_usd > 0),
  saldo_usd         numeric(14, 2) not null check (saldo_usd >= 0),
  fecha_emision     date not null,
  fecha_vencimiento date not null,
  estado            text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'PAGADA', 'ANULADA')),
  created_at        timestamptz not null default now(),
  unique (factura_id, tipo),
  check (saldo_usd <= monto_usd)
);
create index on public.cuentas_por_cobrar (cliente_id, estado);
create index on public.cuentas_por_cobrar (estado, fecha_vencimiento);

create table public.cuentas_por_pagar (
  id                uuid primary key default gen_random_uuid(),
  orden_id          uuid not null unique references public.ordenes_compra (id) on delete restrict,
  proveedor_id      uuid not null references public.proveedores (id) on delete restrict,
  monto_usd         numeric(14, 2) not null check (monto_usd > 0),
  saldo_usd         numeric(14, 2) not null check (saldo_usd >= 0),
  fecha_emision     date not null,
  fecha_vencimiento date not null,
  estado            text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'PAGADA', 'ANULADA')),
  created_at        timestamptz not null default now(),
  check (saldo_usd <= monto_usd)
);
create index on public.cuentas_por_pagar (proveedor_id, estado);

alter table public.cuentas_por_cobrar enable row level security;
alter table public.cuentas_por_pagar  enable row level security;

create policy cxc_select on public.cuentas_por_cobrar for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy cxp_select on public.cuentas_por_pagar for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador', 'almacenista')));

-- Saldo de crédito directo pendiente de un cliente.
create or replace function public.saldo_credito_cliente(p_cliente_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(saldo_usd), 0) from public.cuentas_por_cobrar
   where cliente_id = p_cliente_id and tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE'
     and public.rol_actual() is not null
$$;
grant execute on function public.saldo_credito_cliente(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Compras: datos fiscales del proveedor
-- -----------------------------------------------------------------------------
alter table public.ordenes_compra
  add column numero_factura_proveedor text,
  add column numero_control_proveedor text,
  add column iva_usd numeric(14, 2) not null default 0;

-- -----------------------------------------------------------------------------
-- Fecha de operación (permite al seed registrar historia; la app usa now())
-- -----------------------------------------------------------------------------
create or replace function interno.fecha_operacion()
returns timestamptz
language sql stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('arluc.fecha_operacion', true), '')::timestamptz, now())
$$;

alter table public.movimientos_inventario
  alter column fecha set default interno.fecha_operacion();

-- =============================================================================
-- Emisión de facturas
-- =============================================================================
-- p_items: [{ "producto_id": uuid, "cantidad": int }]
-- p_pagos: [{ "metodo_id": "efectivo_usd" | ..., "monto_usd": n, "monto_bs": n,
--             "referencia": "...", "zelle_titular": "...", "zelle_email": "...",
--             "cashea_metodo_inicial": "...", "cashea_referencia_inicial": "..." }]
-- Los montos de cada pago cubren el total SIN IGTF; el IGTF se calcula aquí y se
-- suma a los pagos en divisas.
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

  -- 2) Pagos.
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Indique al menos un método de pago.';
  end if;
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    if not exists (select 1 from public.metodos_pago_contables where metodo_id = v_pago ->> 'metodo_id') then
      raise exception 'Método de pago "%" no reconocido.', v_pago ->> 'metodo_id';
    end if;
    v_monto := round(coalesce((v_pago ->> 'monto_usd')::numeric, 0), 2);
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
    if v_monto > v_mayor and v_pago ->> 'metodo_id' <> 'credito' then
      v_mayor := v_monto; v_idx_mayor := i;
    end if;
    i := i + 1;
  end loop;

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
                        when 'cashea' then 'Cashea' when 'credito' then 'Crédito' end),
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
    total_usd, total_bs, metodos_pago, fecha_emision
  ) values (
    'ARLUC-' || lpad(interno.siguiente_valor('factura')::text, 8, '0'),
    '00-' || lpad(interno.siguiente_valor('control_fiscal')::text, 8, '0'),
    p_cliente_id, v_cliente.nombre, v_cliente.documento_identidad,
    p_vendedor_id, v_tasa.id, v_base + v_exento, 0,
    v_base, v_exento, v_empresa.alicuota_iva, v_iva,
    case when v_igtf > 0 then v_empresa.alicuota_igtf else 0 end, v_base_igtf, v_igtf,
    v_total_sin_igtf + v_igtf, round((v_total_sin_igtf + v_igtf) * v_tasa.tasa_usd_bs, 2),
    v_pagos, v_fecha
  ) returning * into v_factura;

  -- 6) Líneas (el trigger descuenta stock y fija el costo).
  insert into public.detalles_factura (factura_id, producto_id, producto_nombre, cantidad, precio_unitario_usd, exento_iva)
  select v_factura.id, p.id, p.nombre, (l ->> 'cantidad')::integer, p.precio_usd, p.exento_iva
    from jsonb_array_elements(v_lineas) l
    join public.productos p on p.id = (l ->> 'producto_id')::uuid;

  select coalesce(sum(round(cantidad * costo_unitario_usd, 2)), 0) into v_costo
    from public.detalles_factura where factura_id = v_factura.id;

  -- 7) Cuentas por cobrar.
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

create or replace function public.emitir_factura(
  p_cliente_id uuid,
  p_items jsonb,
  p_pagos jsonb,
  p_autorizar_sobregiro boolean default false
)
returns public.facturas
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente', 'vendedor') then
    raise exception 'No autorizado para emitir facturas.';
  end if;
  return interno.emitir_factura(auth.uid(), p_cliente_id, p_items, p_pagos, p_autorizar_sobregiro);
end;
$$;
grant execute on function public.emitir_factura(uuid, jsonb, jsonb, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Anulación: además de devolver el stock, revierte el asiento y la CxC.
-- -----------------------------------------------------------------------------
create or replace function interno.facturas_al_anular()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  d record;
  v_asiento_id uuid;
begin
  if exists (select 1 from public.cuentas_por_cobrar
              where factura_id = new.id and saldo_usd < monto_usd) then
    raise exception 'La factura % tiene abonos registrados; emita una nota de crédito en lugar de anularla.',
      new.numero_factura;
  end if;

  for d in select * from public.detalles_factura where factura_id = new.id loop
    perform interno.mover_stock(
      d.producto_id, d.cantidad, 'ANULACION_VENTA', d.costo_unitario_usd,
      'FACTURA', new.id, 'Anulación ' || new.numero_factura
    );
  end loop;

  update public.cuentas_por_cobrar set estado = 'ANULADA', saldo_usd = 0 where factura_id = new.id;

  select id into v_asiento_id from public.asientos_contables
   where referencia_tipo = 'FACTURA' and referencia_id = new.id
     and modulo = 'Ventas' and estado = 'ASENTADO';
  if v_asiento_id is not null then
    perform interno.revertir_asiento(
      v_asiento_id,
      'Anulación de factura ' || new.numero_factura || coalesce(': ' || new.motivo_anulacion, ''));
  end if;
  return null;
end;
$$;

create or replace function public.anular_factura(p_factura_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede anular facturas.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  update public.facturas set estado = 'anulada', motivo_anulacion = trim(p_motivo)
   where id = p_factura_id;
  if not found then
    raise exception 'La factura no existe.';
  end if;
end;
$$;
grant execute on function public.anular_factura(uuid, text) to authenticated;

-- =============================================================================
-- Compras: al recibir la orden se registra inventario, IVA crédito y CxP.
-- =============================================================================
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

  if old.estado <> 'pendiente' then
    raise exception 'La orden % ya está %; no admite cambios.', old.numero_orden, old.estado;
  end if;

  -- El total siempre se recalcula desde las líneas.
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

create or replace function interno.ordenes_al_recibir()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  d record;
  v_dia date := (new.recibida_en at time zone 'America/Caracas')::date;
  v_proveedor text;
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

  insert into public.cuentas_por_pagar (orden_id, proveedor_id, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento)
  values (new.id, new.proveedor_id, new.total_usd + new.iva_usd, new.total_usd + new.iva_usd, v_dia, v_dia + 30);

  select nombre into v_proveedor from public.proveedores where id = new.proveedor_id;
  perform interno.registrar_asiento(
    v_dia,
    'Compra ' || new.numero_orden || ' a ' || v_proveedor
      || coalesce(' (factura ' || new.numero_factura_proveedor || ')', ''),
    'Compras',
    jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'debe', new.total_usd, 'descripcion', 'Mercancía recibida'),
      jsonb_build_object('cuenta_clave', 'CTA_CXP_PROVEEDORES', 'haber', new.total_usd + new.iva_usd, 'descripcion', v_proveedor))
    || case when new.iva_usd > 0 then jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_IVA_CREDITO', 'debe', new.iva_usd, 'descripcion', 'IVA crédito fiscal'))
       else '[]'::jsonb end,
    null, 'ORDEN_COMPRA', new.id);
  return null;
end;
$$;

-- =============================================================================
-- Ajustes manuales de inventario → asiento contra "Mermas y ajustes".
-- =============================================================================
create or replace function interno.productos_registrar_ajuste()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cantidad integer;
  v_monto numeric(14, 2);
begin
  if tg_op = 'INSERT' then
    if new.stock = 0 then
      return null;
    end if;
    v_cantidad := new.stock;
    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, costo_unitario_usd, stock_resultante,
      costo_promedio_usd, referencia_tipo, notas
    ) values (
      new.id, 'INVENTARIO_INICIAL', new.stock, new.costo_usd, new.stock,
      new.costo_usd, 'PRODUCTO', 'Stock inicial al crear el producto'
    );
  else
    if new.stock is not distinct from old.stock
       or coalesce(current_setting('arluc.mov_interno', true), 'off') = 'on' then
      return null;
    end if;
    v_cantidad := new.stock - old.stock;
    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, costo_unitario_usd, stock_resultante,
      costo_promedio_usd, referencia_tipo, notas
    ) values (
      new.id,
      case when v_cantidad > 0 then 'AJUSTE_ENTRADA' else 'AJUSTE_SALIDA' end,
      v_cantidad, new.costo_usd, new.stock, new.costo_usd,
      'AJUSTE_MANUAL', 'Ajuste manual desde el maestro de productos'
    );
  end if;

  -- Desde la app (no en el seed, que tiene su asiento de apertura) se contabiliza.
  v_monto := round(abs(v_cantidad) * new.costo_usd, 2);
  if auth.uid() is not null and v_monto > 0 then
    perform interno.registrar_asiento(
      current_date,
      case when v_cantidad > 0 then 'Sobrante / entrada de inventario: ' else 'Faltante / salida de inventario: ' end
        || new.sku || ' (' || abs(v_cantidad) || ' und.)',
      'Inventario',
      case when v_cantidad > 0 then jsonb_build_array(
        jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'debe', v_monto),
        jsonb_build_object('cuenta_clave', 'CTA_AJUSTE_INVENTARIO', 'haber', v_monto))
      else jsonb_build_array(
        jsonb_build_object('cuenta_clave', 'CTA_AJUSTE_INVENTARIO', 'debe', v_monto),
        jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'haber', v_monto)) end,
      null, 'PRODUCTO', new.id);
  end if;
  return null;
end;
$$;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
