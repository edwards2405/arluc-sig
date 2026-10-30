-- =============================================================================
-- ARLUC SIG · Migración 8: Notas de crédito y de débito fiscales
-- -----------------------------------------------------------------------------
-- * Una factura emitida no se corrige anulándola días después: se emite una
--   NOTA DE CRÉDITO (devolución o descuento) o una NOTA DE DÉBITO (ajuste o
--   cargo adicional), con referencia a la factura afectada, numeración propia y
--   la misma serie de números de control.
-- * La anulación de facturas queda limitada al mismo día de emisión.
-- * Los montos fiscales de una NC se valoran en Bs a la tasa de la factura
--   original; lo que se reintegra hoy, a la tasa de hoy: la diferencia es
--   diferencial cambiario. La ND es una operación nueva, a la tasa del día.
-- * El IGTF no se revierte: grava el pago en divisas, no la venta.
-- =============================================================================

alter table public.movimientos_inventario drop constraint movimientos_inventario_tipo_check;
alter table public.movimientos_inventario add constraint movimientos_inventario_tipo_check check (tipo in (
  'INVENTARIO_INICIAL', 'VENTA', 'ANULACION_VENTA', 'DEVOLUCION_VENTA', 'COMPRA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA'));

create table public.notas_fiscales (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null check (tipo in ('CREDITO', 'DEBITO')),
  numero              text not null unique,
  numero_control      text not null unique,
  factura_id          uuid not null references public.facturas (id) on delete restrict,
  cliente_id          uuid references public.clientes (id),
  cliente_nombre      text,
  cliente_documento   text,
  fecha_emision       timestamptz not null default now(),
  concepto            text not null check (concepto in ('DEVOLUCION', 'DESCUENTO', 'AJUSTE_PRECIO', 'CARGO_ADICIONAL')),
  motivo              text not null check (length(trim(motivo)) > 0),
  base_imponible_usd  numeric(14, 2) not null default 0 check (base_imponible_usd >= 0),
  exento_usd          numeric(14, 2) not null default 0 check (exento_usd >= 0),
  alicuota_iva        numeric(5, 2) not null,
  iva_usd             numeric(14, 2) not null default 0 check (iva_usd >= 0),
  iva_retenido_usd    numeric(14, 2) not null default 0 check (iva_retenido_usd >= 0),
  total_usd           numeric(14, 2) not null check (total_usd > 0),
  tasa                numeric(18, 4) not null,
  total_bs            numeric(18, 2) generated always as (round(total_usd * tasa, 2)) stored,
  metodo              text not null,
  monto_liquidado_usd numeric(14, 2) not null,
  emitida_por         uuid references public.usuarios (id) default auth.uid(),
  created_at          timestamptz not null default now(),
  check ((tipo = 'CREDITO') = (concepto in ('DEVOLUCION', 'DESCUENTO')))
);
comment on column public.notas_fiscales.metodo is
  'NC: forma de reintegro (credito_cxc, saldo_favor o medio de pago). ND: forma de cobro (credito o medio de pago).';
comment on column public.notas_fiscales.monto_liquidado_usd is 'Monto reintegrado (NC) o cobrado (ND): total menos la retención de IVA del cliente.';
create index on public.notas_fiscales (factura_id);
create index on public.notas_fiscales (fecha_emision);

create table public.detalles_nota (
  id                  uuid primary key default gen_random_uuid(),
  nota_id             uuid not null references public.notas_fiscales (id) on delete restrict,
  producto_id         uuid not null references public.productos (id) on delete restrict,
  producto_nombre     text not null,
  cantidad            integer not null check (cantidad > 0),
  precio_unitario_usd numeric(14, 2) not null,
  exento_iva          boolean not null,
  costo_unitario_usd  numeric(14, 4) not null,
  subtotal_usd        numeric(14, 2) generated always as (round(cantidad * precio_unitario_usd, 2)) stored
);
create index on public.detalles_nota (nota_id);
create index on public.detalles_nota (producto_id);

create trigger trg_notas_inmutables before update or delete on public.notas_fiscales
for each row execute function interno.detalles_inmutables();
create trigger trg_detalles_nota_inmutables before update or delete on public.detalles_nota
for each row execute function interno.detalles_inmutables();
create trigger trg_notas_auditoria after insert on public.notas_fiscales
for each row execute function interno.registrar_auditoria();

alter table public.notas_fiscales enable row level security;
alter table public.detalles_nota enable row level security;
create policy notas_select on public.notas_fiscales for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy detalles_nota_select on public.detalles_nota for select to authenticated
  using ((select public.rol_actual()) is not null);

-- Saldo de la factura que todavía puede rebajarse con notas de crédito.
create or replace function interno.saldo_notas_factura(p_factura_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'base_disponible_usd', f.base_imponible_usd + f.exento_usd
       + coalesce((select sum(n.base_imponible_usd + n.exento_usd) from public.notas_fiscales n where n.factura_id = f.id and n.tipo = 'DEBITO'), 0)
       - coalesce((select sum(n.base_imponible_usd + n.exento_usd) from public.notas_fiscales n where n.factura_id = f.id and n.tipo = 'CREDITO'), 0),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', d.producto_id, 'producto_nombre', d.producto_nombre, 'precio_unitario_usd', d.precio_unitario_usd,
               'vendidos', d.vendidos,
               'devueltos', coalesce(dv.devueltos, 0),
               'disponibles', d.vendidos - coalesce(dv.devueltos, 0)))
        from (select producto_id, max(producto_nombre) as producto_nombre, max(precio_unitario_usd) as precio_unitario_usd,
                     sum(cantidad) as vendidos
                from public.detalles_factura where factura_id = f.id group by producto_id) d
        left join (select dn.producto_id, sum(dn.cantidad) as devueltos
                     from public.detalles_nota dn join public.notas_fiscales n on n.id = dn.nota_id
                    where n.factura_id = f.id and n.tipo = 'CREDITO' group by dn.producto_id) dv on dv.producto_id = d.producto_id), '[]'::jsonb),
    'cxc_pendiente_usd', coalesce((select saldo_usd from public.cuentas_por_cobrar
                                    where factura_id = f.id and tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE'), 0),
    'porcentaje_retencion', coalesce((select max(porcentaje) from public.retenciones_iva
                                       where factura_id = f.id and tipo = 'RECIBIDA' and estado <> 'ANULADA'), 0))
  from public.facturas f
  where f.id = p_factura_id
$$;

create or replace function public.saldo_notas_factura(p_factura_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select interno.saldo_notas_factura(p_factura_id) where public.rol_actual() is not null
$$;

-- -----------------------------------------------------------------------------
-- Nota de crédito
-- -----------------------------------------------------------------------------
create or replace function interno.emitir_nota_credito(
  p_usuario uuid, p_factura_id uuid, p_concepto text, p_items jsonb, p_monto_base numeric,
  p_motivo text, p_metodo text, p_fecha timestamptz default null
)
returns public.notas_fiscales
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fact public.facturas%rowtype;
  v_tasa_fact numeric(18, 4);
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_tasa_hoy numeric(18, 4);
  v_saldo jsonb;
  v_item jsonb;
  v_prod jsonb;
  v_det public.detalles_factura%rowtype;
  v_cant integer;
  v_base numeric(14, 2) := 0;
  v_exento numeric(14, 2) := 0;
  v_costo numeric(14, 2) := 0;
  v_iva numeric(14, 2);
  v_ret numeric(14, 2) := 0;
  v_pct numeric;
  v_total numeric(14, 2);
  v_reintegro numeric(14, 2);
  v_cxc public.cuentas_por_cobrar%rowtype;
  v_cuenta_reintegro jsonb;
  v_reintegro_ves numeric(20, 2);
  v_debe_ves numeric(20, 2);
  v_haber_ves numeric(20, 2);
  v_dif numeric(20, 2);
  v_nota public.notas_fiscales%rowtype;
  v_lineas jsonb;
  v_detalles jsonb := '[]'::jsonb;
begin
  select * into v_fact from public.facturas where id = p_factura_id for update;
  if not found or v_fact.estado <> 'emitida' then
    raise exception 'La factura no existe o está anulada.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la nota de crédito.';
  end if;
  select tasa_usd_bs into v_tasa_fact from public.tasas_cambio where id = v_fact.tasa_id;
  v_tasa_hoy := public.tasa_vigente(v_dia);
  v_saldo := interno.saldo_notas_factura(p_factura_id);

  if p_concepto = 'DEVOLUCION' then
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'Indique los productos devueltos.';
    end if;
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_cant := (v_item ->> 'cantidad')::integer;
      v_prod := null;
      select e.value into v_prod from jsonb_array_elements(v_saldo -> 'productos') as e(value)
       where e.value ->> 'producto_id' = v_item ->> 'producto_id';
      if v_prod is null then
        raise exception 'El producto no pertenece a la factura %.', v_fact.numero_factura;
      end if;
      if v_cant is null or v_cant <= 0 or v_cant > (v_prod ->> 'disponibles')::integer then
        raise exception 'Cantidad a devolver de "%" inválida: vendidos %, ya devueltos %.',
          v_prod ->> 'producto_nombre', v_prod ->> 'vendidos', v_prod ->> 'devueltos';
      end if;
      select * into v_det from public.detalles_factura
       where factura_id = p_factura_id and producto_id = (v_item ->> 'producto_id')::uuid limit 1;
      if v_det.exento_iva then
        v_exento := v_exento + round(v_cant * v_det.precio_unitario_usd, 2);
      else
        v_base := v_base + round(v_cant * v_det.precio_unitario_usd, 2);
      end if;
      v_costo := v_costo + round(v_cant * v_det.costo_unitario_usd, 2);
      v_detalles := v_detalles || jsonb_build_object(
        'producto_id', v_det.producto_id, 'producto_nombre', v_det.producto_nombre, 'cantidad', v_cant,
        'precio', v_det.precio_unitario_usd, 'exento', v_det.exento_iva, 'costo', v_det.costo_unitario_usd);
    end loop;
  elsif p_concepto = 'DESCUENTO' then
    if p_monto_base is null or p_monto_base <= 0 then
      raise exception 'Indique el monto del descuento (base sin IVA).';
    end if;
    -- La rebaja se aplica a la base gravada; si la factura es solo exenta, al exento.
    if v_fact.base_imponible_usd > 0 then v_base := round(p_monto_base, 2); else v_exento := round(p_monto_base, 2); end if;
  else
    raise exception 'Concepto de nota de crédito inválido: %.', p_concepto;
  end if;

  if v_base + v_exento > (v_saldo ->> 'base_disponible_usd')::numeric then
    raise exception 'La nota (% USD) supera la base disponible de la factura (% USD).',
      v_base + v_exento, v_saldo ->> 'base_disponible_usd';
  end if;

  v_iva := round(v_base * v_fact.alicuota_iva / 100, 2);
  v_pct := (v_saldo ->> 'porcentaje_retencion')::numeric;
  v_ret := round(v_iva * v_pct / 100, 2);
  v_total := v_base + v_exento + v_iva;
  v_reintegro := v_total - v_ret;

  -- Forma de reintegro
  if p_metodo = 'credito_cxc' then
    select * into v_cxc from public.cuentas_por_cobrar
     where factura_id = p_factura_id and tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE' for update;
    if not found or v_cxc.saldo_usd < v_reintegro then
      raise exception 'La factura no tiene saldo a crédito suficiente (% USD) para rebajar % USD.',
        coalesce(v_cxc.saldo_usd, 0), v_reintegro;
    end if;
    v_cuenta_reintegro := jsonb_build_object('cuenta_clave', 'CTA_CXC_CLIENTES');
    v_reintegro_ves := round(v_reintegro * v_cxc.tasa_origen, 2);
  elsif p_metodo = 'saldo_favor' then
    if v_fact.cliente_id is null then
      raise exception 'El saldo a favor requiere una factura con cliente identificado.';
    end if;
    v_cuenta_reintegro := jsonb_build_object('cuenta_clave', 'CTA_ANTICIPO_CLIENTES');
    v_reintegro_ves := round(v_reintegro * v_tasa_hoy, 2);
  elsif p_metodo in ('efectivo_usd', 'efectivo_bs', 'pago_movil', 'transferencia', 'zelle') then
    v_cuenta_reintegro := jsonb_build_object('cuenta_id', (select cuenta_id from public.metodos_pago_contables where metodo_id = p_metodo));
    v_reintegro_ves := round(v_reintegro * v_tasa_hoy, 2);
  else
    raise exception 'Forma de reintegro inválida: %.', p_metodo;
  end if;

  insert into public.notas_fiscales (
    tipo, numero, numero_control, factura_id, cliente_id, cliente_nombre, cliente_documento, fecha_emision,
    concepto, motivo, base_imponible_usd, exento_usd, alicuota_iva, iva_usd, iva_retenido_usd, total_usd,
    tasa, metodo, monto_liquidado_usd, emitida_por
  ) values (
    'CREDITO', 'NC-' || lpad(interno.siguiente_valor('nota_credito')::text, 8, '0'),
    '00-' || lpad(interno.siguiente_valor('control_fiscal')::text, 8, '0'),
    p_factura_id, v_fact.cliente_id, v_fact.cliente_nombre, v_fact.cliente_documento, v_fecha,
    p_concepto, trim(p_motivo), v_base, v_exento, v_fact.alicuota_iva, v_iva, v_ret, v_total,
    v_tasa_fact, p_metodo, v_reintegro, p_usuario
  ) returning * into v_nota;

  insert into public.detalles_nota (nota_id, producto_id, producto_nombre, cantidad, precio_unitario_usd, exento_iva, costo_unitario_usd)
  select v_nota.id, (d ->> 'producto_id')::uuid, d ->> 'producto_nombre', (d ->> 'cantidad')::int,
         (d ->> 'precio')::numeric, (d ->> 'exento')::boolean, (d ->> 'costo')::numeric
    from jsonb_array_elements(v_detalles) d;

  -- La mercancía devuelta vuelve al inventario a su costo original.
  perform set_config('arluc.fecha_operacion', v_fecha::text, true);
  for v_item in select * from jsonb_array_elements(v_detalles) loop
    perform interno.mover_stock((v_item ->> 'producto_id')::uuid, (v_item ->> 'cantidad')::int, 'DEVOLUCION_VENTA',
      (v_item ->> 'costo')::numeric, 'NOTA_CREDITO', v_nota.id, 'Devolución ' || v_nota.numero || ' de ' || v_fact.numero_factura);
  end loop;
  perform set_config('arluc.fecha_operacion', '', true);

  if p_metodo = 'credito_cxc' then
    update public.cuentas_por_cobrar
       set saldo_usd = saldo_usd - v_reintegro,
           estado = case when saldo_usd - v_reintegro = 0 and recargo_cobrado_usd = recargo_usd then 'PAGADA' else estado end
     where id = v_cxc.id;
  end if;

  -- Asiento: rebaja de la venta y del débito fiscal a la tasa de la factura;
  -- el reintegro a la tasa de hoy (o de la CxC); la diferencia es cambiaria.
  v_debe_ves := round((v_base + v_exento) * v_tasa_fact, 2) + round(v_iva * v_tasa_fact, 2);
  v_haber_ves := round(v_ret * v_tasa_fact, 2) + v_reintegro_ves;
  v_dif := v_debe_ves - v_haber_ves;

  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta_clave', 'CTA_DEVOLUCIONES_VENTAS', 'debe', v_base + v_exento,
                       'debe_ves', round((v_base + v_exento) * v_tasa_fact, 2),
                       'descripcion', initcap(lower(p_concepto)) || ' sobre ' || v_fact.numero_factura),
    v_cuenta_reintegro || jsonb_build_object('haber', v_reintegro, 'haber_ves', v_reintegro_ves,
                       'descripcion', 'Reintegro (' || p_metodo || ')'));
  if v_iva > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_IVA_DEBITO', 'debe', v_iva,
                       'debe_ves', round(v_iva * v_tasa_fact, 2), 'descripcion', 'Rebaja del débito fiscal');
  end if;
  if v_ret > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_IVA_RETENIDO_CLIENTE', 'haber', v_ret,
                       'haber_ves', round(v_ret * v_tasa_fact, 2), 'descripcion', 'Ajuste de la retención del cliente');
  end if;
  if v_dif > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_DIF_CAMBIARIO_GANANCIA', 'haber_ves', v_dif, 'descripcion', 'Ganancia cambiaria');
  elsif v_dif < 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_DIF_CAMBIARIO_PERDIDA', 'debe_ves', -v_dif, 'descripcion', 'Pérdida cambiaria');
  end if;
  if v_costo > 0 then
    v_lineas := v_lineas
      || jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'debe', v_costo, 'debe_ves', round(v_costo * v_tasa_fact, 2),
                            'descripcion', 'Reingreso de mercancía')
      || jsonb_build_object('cuenta_clave', 'CTA_COSTO_VENTAS', 'haber', v_costo, 'haber_ves', round(v_costo * v_tasa_fact, 2),
                            'descripcion', 'Reverso del costo de venta');
  end if;

  perform interno.registrar_asiento(
    v_dia, 'Nota de crédito ' || v_nota.numero || ' sobre ' || v_fact.numero_factura || ': ' || trim(p_motivo),
    'Ventas', v_lineas, v_tasa_hoy, 'NOTA_CREDITO', v_nota.id);
  return v_nota;
end;
$$;

-- -----------------------------------------------------------------------------
-- Nota de débito
-- -----------------------------------------------------------------------------
create or replace function interno.emitir_nota_debito(
  p_usuario uuid, p_factura_id uuid, p_concepto text, p_monto_base numeric,
  p_motivo text, p_metodo text, p_fecha timestamptz default null
)
returns public.notas_fiscales
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fact public.facturas%rowtype;
  v_cliente public.clientes%rowtype;
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_tasa numeric(18, 4);
  v_base numeric(14, 2) := round(p_monto_base, 2);
  v_iva numeric(14, 2);
  v_ret numeric(14, 2) := 0;
  v_cobro numeric(14, 2);
  v_dias int;
  v_cuenta_cobro jsonb;
  v_nota public.notas_fiscales%rowtype;
  v_lineas jsonb;
begin
  select * into v_fact from public.facturas where id = p_factura_id for update;
  if not found or v_fact.estado <> 'emitida' then
    raise exception 'La factura no existe o está anulada.';
  end if;
  if p_concepto not in ('AJUSTE_PRECIO', 'CARGO_ADICIONAL') then
    raise exception 'Concepto de nota de débito inválido: %.', p_concepto;
  end if;
  if v_base is null or v_base <= 0 then
    raise exception 'Indique el monto de la nota de débito (base sin IVA).';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la nota de débito.';
  end if;

  v_tasa := public.tasa_vigente(v_dia);
  v_iva := round(v_base * v_fact.alicuota_iva / 100, 2);
  if v_fact.cliente_id is not null then
    select * into v_cliente from public.clientes where id = v_fact.cliente_id;
    if v_cliente.contribuyente_especial then
      v_ret := round(v_iva * v_cliente.porcentaje_retencion_iva / 100, 2);
    end if;
  end if;
  v_cobro := v_base + v_iva - v_ret;

  if p_metodo = 'credito' then
    if v_fact.cliente_id is null or not v_cliente.credito_activo then
      raise exception 'Cobrar la nota a crédito requiere un cliente con crédito activo.';
    end if;
    if exists (select 1 from public.cuentas_por_cobrar where factura_id = p_factura_id and tipo = 'CREDITO_DIRECTO') then
      raise exception 'La factura ya tiene una cuenta a crédito: cobre la nota de débito por otro medio.';
    end if;
    v_cuenta_cobro := jsonb_build_object('cuenta_clave', 'CTA_CXC_CLIENTES');
  elsif p_metodo in ('efectivo_usd', 'efectivo_bs', 'pago_movil', 'transferencia', 'punto_venta', 'zelle') then
    v_cuenta_cobro := jsonb_build_object('cuenta_id', (select cuenta_id from public.metodos_pago_contables where metodo_id = p_metodo));
  else
    raise exception 'Forma de cobro inválida: %.', p_metodo;
  end if;

  insert into public.notas_fiscales (
    tipo, numero, numero_control, factura_id, cliente_id, cliente_nombre, cliente_documento, fecha_emision,
    concepto, motivo, base_imponible_usd, exento_usd, alicuota_iva, iva_usd, iva_retenido_usd, total_usd,
    tasa, metodo, monto_liquidado_usd, emitida_por
  ) values (
    'DEBITO', 'ND-' || lpad(interno.siguiente_valor('nota_debito')::text, 8, '0'),
    '00-' || lpad(interno.siguiente_valor('control_fiscal')::text, 8, '0'),
    p_factura_id, v_fact.cliente_id, v_fact.cliente_nombre, v_fact.cliente_documento, v_fecha,
    p_concepto, trim(p_motivo), v_base, 0, v_fact.alicuota_iva, v_iva, v_ret, v_base + v_iva,
    v_tasa, p_metodo, v_cobro, p_usuario
  ) returning * into v_nota;

  if p_metodo = 'credito' then
    select dias_credito into v_dias from public.configuracion_empresa where id = 'default';
    insert into public.cuentas_por_cobrar (factura_id, cliente_id, tipo, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento, tasa_origen)
    values (p_factura_id, v_fact.cliente_id, 'CREDITO_DIRECTO', v_cobro, v_cobro, v_dia, v_dia + v_dias, v_tasa);
  end if;

  if v_ret > 0 then
    insert into public.retenciones_iva (
      tipo, fecha, factura_id, tercero_rif, tercero_nombre, numero_factura, numero_control,
      base_usd, iva_usd, porcentaje, monto_retenido_usd, tasa, estado
    ) values (
      'RECIBIDA', v_dia, p_factura_id, v_cliente.documento_identidad, v_cliente.nombre, v_nota.numero, v_nota.numero_control,
      v_base, v_iva, v_cliente.porcentaje_retencion_iva, v_ret, v_tasa, 'PENDIENTE'
    );
  end if;

  v_lineas := jsonb_build_array(
    v_cuenta_cobro || jsonb_build_object('debe', v_cobro, 'descripcion', 'Cobro (' || p_metodo || ')'),
    jsonb_build_object('cuenta_clave', 'CTA_VENTAS_GRAVADAS', 'haber', v_base,
                       'descripcion', initcap(replace(lower(p_concepto), '_', ' ')) || ' sobre ' || v_fact.numero_factura),
    jsonb_build_object('cuenta_clave', 'CTA_IVA_DEBITO', 'haber', v_iva, 'descripcion', 'IVA de la nota de débito'));
  if v_ret > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_IVA_RETENIDO_CLIENTE', 'debe', v_ret,
                                               'descripcion', 'Retención del cliente');
  end if;

  perform interno.registrar_asiento(
    v_dia, 'Nota de débito ' || v_nota.numero || ' sobre ' || v_fact.numero_factura || ': ' || trim(p_motivo),
    'Ventas', v_lineas, v_tasa, 'NOTA_DEBITO', v_nota.id);
  return v_nota;
end;
$$;

create or replace function public.emitir_nota_credito(
  p_factura_id uuid, p_concepto text, p_items jsonb, p_monto_base numeric, p_motivo text, p_metodo text
)
returns public.notas_fiscales
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede emitir notas de crédito.';
  end if;
  return interno.emitir_nota_credito(auth.uid(), p_factura_id, p_concepto, p_items, p_monto_base, p_motivo, p_metodo);
end;
$$;

create or replace function public.emitir_nota_debito(
  p_factura_id uuid, p_concepto text, p_monto_base numeric, p_motivo text, p_metodo text
)
returns public.notas_fiscales
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede emitir notas de débito.';
  end if;
  return interno.emitir_nota_debito(auth.uid(), p_factura_id, p_concepto, p_monto_base, p_motivo, p_metodo);
end;
$$;

-- -----------------------------------------------------------------------------
-- Anulación: solo el mismo día y sin notas emitidas
-- -----------------------------------------------------------------------------
create or replace function interno.facturas_bloquear_anulacion_con_notas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.notas_fiscales where factura_id = new.id) then
    raise exception 'La factura % tiene notas de crédito o débito; ya no puede anularse.', new.numero_factura;
  end if;
  return new;
end;
$$;

create trigger trg_facturas_anular_sin_notas
before update of estado on public.facturas
for each row when (old.estado = 'emitida' and new.estado = 'anulada')
execute function interno.facturas_bloquear_anulacion_con_notas();

create or replace function public.anular_factura(p_factura_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fecha date;
begin
  if not public.tiene_rol('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede anular facturas.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  select (fecha_emision at time zone 'America/Caracas')::date into v_fecha from public.facturas where id = p_factura_id;
  if v_fecha is null then
    raise exception 'La factura no existe.';
  end if;
  if v_fecha < current_date then
    raise exception 'Solo se anulan facturas del mismo día. Para corregir una factura del % emita una nota de crédito.',
      to_char(v_fecha, 'DD/MM/YYYY');
  end if;
  update public.facturas set estado = 'anulada', motivo_anulacion = trim(p_motivo) where id = p_factura_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Libro de ventas con notas, resumen de IVA y ventas del SIG netas de notas
-- -----------------------------------------------------------------------------
drop function public.libro_ventas(int, int);
create function public.libro_ventas(p_anio int, p_mes int)
returns table (
  fecha date, tipo_documento text, numero_factura text, numero_control text, factura_afectada text,
  rif text, nombre text, estado text,
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
    select * from (
      select (f.fecha_emision at time zone 'America/Caracas')::date, 'FAC'::text, f.numero_factura, f.numero_control, null::text,
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
        left join public.retenciones_iva r
          on r.factura_id = f.id and r.numero_factura = f.numero_factura and r.estado <> 'ANULADA'
       where extract(year from f.fecha_emision at time zone 'America/Caracas') = p_anio
         and extract(month from f.fecha_emision at time zone 'America/Caracas') = p_mes
      union all
      -- Notas: crédito en negativo, débito en positivo.
      select (n.fecha_emision at time zone 'America/Caracas')::date, case n.tipo when 'CREDITO' then 'NC' else 'ND' end,
             n.numero, n.numero_control, f.numero_factura,
             coalesce(n.cliente_documento, 'Consumidor final'), coalesce(n.cliente_nombre, 'Consumidor final'), 'EMITIDA',
             s.signo * round((n.base_imponible_usd + n.exento_usd + n.iva_usd) * n.tasa, 2),
             s.signo * round(n.exento_usd * n.tasa, 2),
             s.signo * round(n.base_imponible_usd * n.tasa, 2),
             n.alicuota_iva,
             s.signo * round(n.iva_usd * n.tasa, 2),
             s.signo * round(n.iva_retenido_usd * n.tasa, 2),
             r.numero_comprobante, 0::numeric, n.tasa,
             s.signo * (n.base_imponible_usd + n.exento_usd + n.iva_usd),
             s.signo * n.base_imponible_usd, s.signo * n.iva_usd
        from public.notas_fiscales n
        join public.facturas f on f.id = n.factura_id
        cross join lateral (select case n.tipo when 'CREDITO' then -1 else 1 end as signo) s
        left join public.retenciones_iva r on r.factura_id = n.factura_id and r.numero_factura = n.numero and r.estado <> 'ANULADA'
       where extract(year from n.fecha_emision at time zone 'America/Caracas') = p_anio
         and extract(month from n.fecha_emision at time zone 'America/Caracas') = p_mes
    ) libro
    order by 1, 3;
end;
$$;
grant execute on function public.libro_ventas(int, int) to authenticated;

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
  v_ret_ajuste_nc numeric;
  v_ret_q1 numeric; v_ret_q2 numeric; v_ret_enteradas numeric;
  v_igtf_q1 numeric; v_igtf_q2 numeric;
  v_cuota numeric;
begin
  perform interno.exigir_direccion();

  -- Las notas ya vienen con signo: el débito fiscal es neto de NC y ND.
  select coalesce(sum(base_bs), 0) as base, coalesce(sum(exento_bs), 0) as exento, coalesce(sum(iva_bs), 0) as iva,
         count(*) filter (where tipo_documento = 'FAC' and estado = 'EMITIDA') as documentos,
         count(*) filter (where tipo_documento = 'FAC' and estado = 'ANULADA') as anuladas,
         count(*) filter (where tipo_documento = 'NC') as notas_credito,
         count(*) filter (where tipo_documento = 'ND') as notas_debito,
         coalesce(-sum(iva_bs) filter (where tipo_documento = 'NC'), 0) as iva_nc
    into v_ventas from public.libro_ventas(p_anio, p_mes);
  select coalesce(sum(base_bs), 0) as base, coalesce(sum(iva_bs), 0) as iva, count(*) as documentos
    into v_compras from public.libro_compras(p_anio, p_mes);

  select coalesce(sum(monto_retenido_bs) filter (where estado = 'REGISTRADA'), 0),
         coalesce(sum(monto_retenido_bs) filter (where estado = 'PENDIENTE'), 0)
    into v_ret_soportadas, v_ret_pendientes
    from public.retenciones_iva where tipo = 'RECIBIDA' and anio = p_anio and mes = p_mes;
  -- Una NC sobre una factura con retención reduce la retención soportada.
  select coalesce(sum(round(iva_retenido_usd * tasa, 2)), 0) into v_ret_ajuste_nc
    from public.notas_fiscales
   where tipo = 'CREDITO' and extract(year from fecha_emision at time zone 'America/Caracas') = p_anio
     and extract(month from fecha_emision at time zone 'America/Caracas') = p_mes;
  v_ret_soportadas := v_ret_soportadas - v_ret_ajuste_nc;

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
                                 'documentos', v_ventas.documentos, 'anuladas', v_ventas.anuladas,
                                 'notas_credito', v_ventas.notas_credito, 'notas_debito', v_ventas.notas_debito,
                                 'iva_rebajado_nc_bs', v_ventas.iva_nc),
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

-- Indicadores del SIG: cada factura neta de sus notas (devoluciones, descuentos y débitos).
create or replace function interno.ventas_rango(p_desde date, p_hasta date)
returns table (
  factura_id uuid, dia date, hora int, dow int, vendedor_id uuid, cliente_id uuid,
  venta_neta numeric, iva numeric, igtf numeric, total numeric, costo numeric, unidades bigint, metodos_pago jsonb
)
language sql stable
set search_path = ''
as $$
  select f.id,
         (f.fecha_emision at time zone 'America/Caracas')::date,
         extract(hour from f.fecha_emision at time zone 'America/Caracas')::int,
         extract(isodow from f.fecha_emision at time zone 'America/Caracas')::int,
         f.vendedor_id, f.cliente_id,
         f.base_imponible_usd + f.exento_usd + coalesce(n.base, 0),
         f.iva_usd + coalesce(n.iva, 0), f.igtf_usd,
         f.total_usd + coalesce(n.base, 0) + coalesce(n.iva, 0),
         coalesce(d.costo, 0) - coalesce(dv.costo, 0),
         coalesce(d.unidades, 0) - coalesce(dv.unidades, 0),
         f.metodos_pago
    from public.facturas f
    left join lateral (
      select sum(round(x.cantidad * x.costo_unitario_usd, 2)) as costo, sum(x.cantidad) as unidades
        from public.detalles_factura x where x.factura_id = f.id
    ) d on true
    left join lateral (
      select sum(case nf.tipo when 'CREDITO' then -1 else 1 end * (nf.base_imponible_usd + nf.exento_usd)) as base,
             sum(case nf.tipo when 'CREDITO' then -1 else 1 end * nf.iva_usd) as iva
        from public.notas_fiscales nf where nf.factura_id = f.id
    ) n on true
    left join lateral (
      select sum(round(dn.cantidad * dn.costo_unitario_usd, 2)) as costo, sum(dn.cantidad) as unidades
        from public.detalles_nota dn join public.notas_fiscales nf on nf.id = dn.nota_id
       where nf.factura_id = f.id
    ) dv on true
   where f.estado = 'emitida'
     and (f.fecha_emision at time zone 'America/Caracas')::date between p_desde and p_hasta
$$;

grant execute on function public.saldo_notas_factura(uuid) to authenticated;
grant execute on function public.emitir_nota_credito(uuid, text, jsonb, numeric, text, text) to authenticated;
grant execute on function public.emitir_nota_debito(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.anular_factura(uuid, text) to authenticated;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
