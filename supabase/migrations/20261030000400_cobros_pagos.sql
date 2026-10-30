-- =============================================================================
-- ARLUC SIG · Migración 4: Cobranza (CxC), pagos a proveedores (CxP),
--                          recargo por mora y diferencial cambiario
-- -----------------------------------------------------------------------------
-- * Los abonos viven en la base de datos (antes: localStorage del navegador).
-- * Imputación del pago: primero al recargo por mora y luego al capital
--   (art. 1.304 del Código Civil venezolano).
-- * Diferencial cambiario: la CxC/CxP se registró en Bs a la tasa del día de
--   la factura; al cobrarse/pagarse a la tasa de hoy, la diferencia en Bs va a
--   Ganancia o Pérdida en diferencial cambiario.
-- * El recargo por mora se reconoce como ingreso cuando se cobra (prudencia).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Motor contable: líneas con monto en Bs explícito y líneas solo en Bs
-- (necesarias para registrar el diferencial cambiario).
-- -----------------------------------------------------------------------------
alter table public.lineas_asiento drop constraint lineas_asiento_check;
alter table public.lineas_asiento add constraint lineas_asiento_un_lado check (
  (debe > 0 and haber = 0) or (haber > 0 and debe = 0)
  or (debe = 0 and haber = 0 and ((debe_ves > 0) <> (haber_ves > 0)))
);

create or replace function interno.registrar_asiento(
  p_fecha date,
  p_glosa text,
  p_modulo text,
  p_lineas jsonb,
  p_tasa numeric default null,
  p_referencia_tipo text default null,
  p_referencia_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tasa numeric(18, 4) := coalesce(p_tasa, public.tasa_vigente(p_fecha));
  v_asiento_id uuid := gen_random_uuid();
  v_lineas jsonb := '[]'::jsonb;
  v_linea jsonb;
  v_cuenta public.plan_cuentas%rowtype;
  v_cuenta_id uuid;
  v_debe numeric(16, 2);
  v_haber numeric(16, 2);
  v_debe_ves numeric(20, 2);
  v_haber_ves numeric(20, 2);
  v_tot_debe numeric(16, 2) := 0;
  v_tot_haber numeric(16, 2) := 0;
  v_tot_debe_ves numeric(20, 2) := 0;
  v_tot_haber_ves numeric(20, 2) := 0;
  v_idx_max_debe int;
  v_idx_max_haber int;
  v_max_debe numeric := -1;
  v_max_haber numeric := -1;
  v_dif numeric(20, 2);
  i int := 0;
begin
  if v_tasa is null then
    raise exception 'No hay tasa BCV registrada para el % o fechas anteriores.', p_fecha;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 2 then
    raise exception 'Un asiento requiere al menos dos líneas.';
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_cuenta_id := coalesce(
      (v_linea ->> 'cuenta_id')::uuid,
      interno.cuenta_por_clave(v_linea ->> 'cuenta_clave'));
    select * into v_cuenta from public.plan_cuentas where id = v_cuenta_id;
    if not found then
      raise exception 'La cuenta % no existe.', v_cuenta_id;
    end if;
    if v_cuenta.es_padre or not v_cuenta.activo then
      raise exception 'La cuenta % - % no acepta movimientos (es de agrupación o está inactiva).',
        v_cuenta.codigo, v_cuenta.nombre;
    end if;

    v_debe := round(coalesce((v_linea ->> 'debe')::numeric, 0), 2);
    v_haber := round(coalesce((v_linea ->> 'haber')::numeric, 0), 2);
    -- El monto en Bs puede venir explícito (tasa histórica); si no, a la tasa del asiento.
    v_debe_ves := round(coalesce((v_linea ->> 'debe_ves')::numeric, v_debe * v_tasa), 2);
    v_haber_ves := round(coalesce((v_linea ->> 'haber_ves')::numeric, v_haber * v_tasa), 2);

    if v_debe < 0 or v_haber < 0 or v_debe_ves < 0 or v_haber_ves < 0
       or (v_debe > 0 and v_haber > 0)
       or (v_debe = 0 and v_haber = 0 and (v_debe_ves > 0) = (v_haber_ves > 0)) then
      raise exception 'Cada línea debe tener un monto positivo en Debe o en Haber (cuenta %).', v_cuenta.codigo;
    end if;

    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_id', v_cuenta_id,
      'descripcion', v_linea ->> 'descripcion',
      'debe', v_debe, 'haber', v_haber,
      'debe_ves', v_debe_ves, 'haber_ves', v_haber_ves);

    v_tot_debe := v_tot_debe + v_debe;
    v_tot_haber := v_tot_haber + v_haber;
    v_tot_debe_ves := v_tot_debe_ves + v_debe_ves;
    v_tot_haber_ves := v_tot_haber_ves + v_haber_ves;
    if v_debe > v_max_debe then v_max_debe := v_debe; v_idx_max_debe := i; end if;
    if v_haber > v_max_haber then v_max_haber := v_haber; v_idx_max_haber := i; end if;
    i := i + 1;
  end loop;

  if v_tot_debe <> v_tot_haber then
    raise exception 'El asiento no cuadra: Debe % USD ≠ Haber % USD.', v_tot_debe, v_tot_haber;
  end if;

  -- Solo se absorben céntimos de redondeo (máx. 1 céntimo por línea); una
  -- diferencia mayor indica un asiento mal construido.
  v_dif := v_tot_debe_ves - v_tot_haber_ves;
  if abs(v_dif) > 0.01 * i then
    raise exception 'El asiento no cuadra en Bs: Debe % ≠ Haber % (diferencia %).',
      v_tot_debe_ves, v_tot_haber_ves, v_dif;
  end if;
  if v_dif > 0 then
    v_lineas := jsonb_set(v_lineas, array[v_idx_max_haber::text, 'haber_ves'],
      to_jsonb((v_lineas -> v_idx_max_haber ->> 'haber_ves')::numeric + v_dif));
    v_tot_haber_ves := v_tot_haber_ves + v_dif;
  elsif v_dif < 0 then
    v_lineas := jsonb_set(v_lineas, array[v_idx_max_debe::text, 'debe_ves'],
      to_jsonb((v_lineas -> v_idx_max_debe ->> 'debe_ves')::numeric - v_dif));
    v_tot_debe_ves := v_tot_debe_ves - v_dif;
  end if;

  insert into public.asientos_contables (
    id, numero, fecha, periodo_id, glosa, modulo, tasa_cambio,
    total_debe, total_haber, total_debe_ves, total_haber_ves,
    referencia_tipo, referencia_id
  ) values (
    v_asiento_id,
    'AS-' || extract(year from p_fecha) || '-'
      || lpad(interno.siguiente_valor('asiento_' || extract(year from p_fecha))::text, 6, '0'),
    p_fecha, interno.periodo_para(p_fecha), trim(p_glosa), p_modulo, v_tasa,
    v_tot_debe, v_tot_haber, v_tot_debe_ves, v_tot_haber_ves,
    p_referencia_tipo, p_referencia_id
  );

  insert into public.lineas_asiento (asiento_id, orden, cuenta_id, descripcion, debe, haber, debe_ves, haber_ves)
  select v_asiento_id, (e.ord - 1)::smallint, (e.l ->> 'cuenta_id')::uuid, e.l ->> 'descripcion',
         (e.l ->> 'debe')::numeric, (e.l ->> 'haber')::numeric,
         (e.l ->> 'debe_ves')::numeric, (e.l ->> 'haber_ves')::numeric
    from jsonb_array_elements(v_lineas) with ordinality as e(l, ord);

  return v_asiento_id;
end;
$$;

-- El contra-asiento debe invertir también los Bs exactos del original.
create or replace function interno.revertir_asiento(p_asiento_id uuid, p_motivo text, p_fecha date default current_date)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_original public.asientos_contables%rowtype;
  v_reverso_id uuid;
begin
  select * into v_original from public.asientos_contables where id = p_asiento_id for update;
  if not found then
    raise exception 'El asiento no existe.';
  end if;
  if v_original.estado = 'ANULADO' then
    raise exception 'El asiento % ya está anulado.', v_original.numero;
  end if;

  v_reverso_id := interno.registrar_asiento(
    p_fecha,
    'Reverso de ' || v_original.numero || ': ' || coalesce(nullif(trim(p_motivo), ''), v_original.glosa),
    'Anulación',
    (select jsonb_agg(jsonb_build_object(
              'cuenta_id', l.cuenta_id, 'descripcion', l.descripcion,
              'debe', l.haber, 'haber', l.debe,
              'debe_ves', l.haber_ves, 'haber_ves', l.debe_ves) order by l.orden)
       from public.lineas_asiento l where l.asiento_id = p_asiento_id),
    v_original.tasa_cambio,
    v_original.referencia_tipo,
    v_original.referencia_id
  );

  perform set_config('arluc.anulando_asiento', 'on', true);
  update public.asientos_contables
     set estado = 'ANULADO', asiento_reverso_id = v_reverso_id,
         anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = p_motivo
   where id = p_asiento_id;
  perform set_config('arluc.anulando_asiento', 'off', true);

  return v_reverso_id;
end;
$$;

-- Los asientos manuales no fijan montos en Bs: siempre a la tasa vigente.
create or replace function public.crear_asiento(p_fecha date, p_glosa text, p_modulo text, p_lineas jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'contador') then
    raise exception 'Solo un administrador o contador puede registrar asientos manuales.';
  end if;
  if p_modulo not in ('Manual', 'Tesorería', 'Gastos', 'Ajuste', 'Nómina', 'Compras', 'Ventas') then
    raise exception 'El origen "%" no está permitido para asientos manuales.', p_modulo;
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) e
              where e ? 'cuenta_clave' or e ? 'debe_ves' or e ? 'haber_ves') then
    raise exception 'Los asientos manuales indican cuenta_id, debe y haber en USD.';
  end if;
  return interno.registrar_asiento(p_fecha, p_glosa, p_modulo, p_lineas);
end;
$$;

-- -----------------------------------------------------------------------------
-- Política de mora (antes en localStorage)
-- -----------------------------------------------------------------------------
alter table public.configuracion_empresa
  add column porcentaje_recargo_mora numeric(5, 2) not null default 5
    check (porcentaje_recargo_mora between 0 and 100),
  add column aplicar_recargo_mora boolean not null default true;

comment on column public.configuracion_empresa.dias_credito is
  'Días de plazo (gracia) de una venta a crédito antes de considerarse vencida.';

-- -----------------------------------------------------------------------------
-- CxC / CxP: tasa de origen y recargo
-- -----------------------------------------------------------------------------
alter table public.cuentas_por_cobrar
  add column tasa_origen numeric(18, 4),
  add column recargo_usd numeric(14, 2) not null default 0 check (recargo_usd >= 0),
  add column recargo_cobrado_usd numeric(14, 2) not null default 0 check (recargo_cobrado_usd >= 0),
  add constraint cxc_recargo_cobrado check (recargo_cobrado_usd <= recargo_usd);

alter table public.cuentas_por_pagar
  add column tasa_origen numeric(18, 4);

create or replace function interno.cxc_fijar_tasa_origen()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.tasa_origen is null then
    select t.tasa_usd_bs into new.tasa_origen
      from public.facturas f join public.tasas_cambio t on t.id = f.tasa_id
     where f.id = new.factura_id;
  end if;
  return new;
end;
$$;

create trigger trg_cxc_tasa_origen
before insert on public.cuentas_por_cobrar
for each row execute function interno.cxc_fijar_tasa_origen();

create or replace function interno.cxp_fijar_tasa_origen()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.tasa_origen := coalesce(new.tasa_origen, public.tasa_vigente(new.fecha_emision));
  return new;
end;
$$;

create trigger trg_cxp_tasa_origen
before insert on public.cuentas_por_pagar
for each row execute function interno.cxp_fijar_tasa_origen();

update public.cuentas_por_cobrar c set tasa_origen = t.tasa_usd_bs
  from public.facturas f join public.tasas_cambio t on t.id = f.tasa_id
 where f.id = c.factura_id and c.tasa_origen is null;
update public.cuentas_por_pagar set tasa_origen = public.tasa_vigente(fecha_emision) where tasa_origen is null;

alter table public.cuentas_por_cobrar alter column tasa_origen set not null;
alter table public.cuentas_por_pagar alter column tasa_origen set not null;

-- Recargo vigente de una CxC: el ya fijado o, si está vencida, el % sobre el
-- capital pendiente.
create or replace function public.recargo_cxc(p_cxc public.cuentas_por_cobrar, p_dia date default current_date)
returns numeric
language sql stable
set search_path = ''
as $$
  select case
    when p_cxc.recargo_usd > 0 then p_cxc.recargo_usd
    when p_cxc.tipo = 'CREDITO_DIRECTO' and p_cxc.estado = 'PENDIENTE'
         and p_dia > p_cxc.fecha_vencimiento and e.aplicar_recargo_mora and p_cxc.saldo_usd > 0
      then round(p_cxc.saldo_usd * e.porcentaje_recargo_mora / 100, 2)
    else 0 end
  from public.configuracion_empresa e where e.id = 'default'
$$;

-- -----------------------------------------------------------------------------
-- Abonos de clientes
-- -----------------------------------------------------------------------------
create table public.abonos_cxc (
  id                    uuid primary key default gen_random_uuid(),
  cxc_id                uuid not null references public.cuentas_por_cobrar (id) on delete restrict,
  fecha                 timestamptz not null default now(),
  metodo_id             text not null references public.metodos_pago_contables (metodo_id),
  monto_usd             numeric(14, 2) not null check (monto_usd > 0),
  aplicado_recargo_usd  numeric(14, 2) not null default 0,
  aplicado_capital_usd  numeric(14, 2) not null default 0,
  igtf_usd              numeric(14, 2) not null default 0,
  tasa                  numeric(18, 4) not null,
  monto_bs              numeric(18, 2) not null,
  diferencial_bs        numeric(18, 2) not null default 0,
  referencia            text,
  notas                 text,
  estado                text not null default 'VIGENTE' check (estado in ('VIGENTE', 'ANULADO')),
  registrado_por        uuid references public.usuarios (id) default auth.uid(),
  anulado_por           uuid references public.usuarios (id),
  anulado_en            timestamptz,
  motivo_anulacion      text,
  check (aplicado_recargo_usd + aplicado_capital_usd = monto_usd)
);
comment on column public.abonos_cxc.monto_usd is 'Monto imputado a la deuda (sin IGTF).';
comment on column public.abonos_cxc.diferencial_bs is 'Positivo = ganancia cambiaria, negativo = pérdida.';
create index on public.abonos_cxc (cxc_id);
create index on public.abonos_cxc (fecha);

create or replace function interno.registrar_abono(
  p_cxc_id uuid, p_monto_usd numeric, p_metodo_id text,
  p_referencia text default null, p_notas text default null, p_fecha timestamptz default null
)
returns public.abonos_cxc
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cxc public.cuentas_por_cobrar%rowtype;
  v_empresa public.configuracion_empresa%rowtype;
  v_metodo public.metodos_pago_contables%rowtype;
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_tasa numeric(18, 4);
  v_monto numeric(14, 2) := round(p_monto_usd, 2);
  v_recargo numeric(14, 2);
  v_a_recargo numeric(14, 2);
  v_a_capital numeric(14, 2);
  v_igtf numeric(14, 2) := 0;
  v_cobro_ves numeric(20, 2);
  v_capital_ves numeric(20, 2);
  v_otros_ves numeric(20, 2);
  v_dif numeric(20, 2);
  v_factura text;
  v_abono public.abonos_cxc%rowtype;
  v_lineas jsonb;
begin
  select * into v_cxc from public.cuentas_por_cobrar where id = p_cxc_id for update;
  if not found or v_cxc.estado <> 'PENDIENTE' then
    raise exception 'La cuenta por cobrar no existe o no está pendiente.';
  end if;
  select * into v_metodo from public.metodos_pago_contables where metodo_id = p_metodo_id;
  if not found or p_metodo_id in ('credito', 'cashea') then
    raise exception 'Método de cobro inválido.';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto del abono debe ser mayor a cero.';
  end if;

  select * into v_empresa from public.configuracion_empresa where id = 'default';
  v_tasa := public.tasa_vigente(v_dia);
  if v_tasa is null then
    raise exception 'No hay tasa BCV registrada.';
  end if;

  -- Fija el recargo si la cuenta está vencida y aún no se había fijado.
  v_recargo := public.recargo_cxc(v_cxc, v_dia);
  if v_recargo > v_cxc.recargo_usd then
    update public.cuentas_por_cobrar set recargo_usd = v_recargo where id = v_cxc.id
    returning * into v_cxc;
  end if;

  -- Imputación: primero recargo, luego capital.
  v_a_recargo := least(v_monto, v_cxc.recargo_usd - v_cxc.recargo_cobrado_usd);
  v_a_capital := v_monto - v_a_recargo;
  if v_a_capital > v_cxc.saldo_usd then
    raise exception 'El abono (% USD) supera la deuda pendiente (% USD).',
      v_monto, v_cxc.saldo_usd + v_cxc.recargo_usd - v_cxc.recargo_cobrado_usd;
  end if;

  if v_empresa.contribuyente_especial and v_metodo.es_divisa then
    v_igtf := round(v_monto * v_empresa.alicuota_igtf / 100, 2);
  end if;

  -- Diferencial cambiario sobre el capital cobrado.
  v_cobro_ves := round((v_monto + v_igtf) * v_tasa, 2);
  v_capital_ves := round(v_a_capital * v_cxc.tasa_origen, 2);
  v_otros_ves := round(v_a_recargo * v_tasa, 2) + round(v_igtf * v_tasa, 2);
  v_dif := v_cobro_ves - v_capital_ves - v_otros_ves;

  update public.cuentas_por_cobrar
     set saldo_usd = saldo_usd - v_a_capital,
         recargo_cobrado_usd = recargo_cobrado_usd + v_a_recargo,
         estado = case when saldo_usd - v_a_capital = 0
                        and recargo_cobrado_usd + v_a_recargo = recargo_usd then 'PAGADA' else estado end
   where id = v_cxc.id;

  insert into public.abonos_cxc (
    cxc_id, fecha, metodo_id, monto_usd, aplicado_recargo_usd, aplicado_capital_usd,
    igtf_usd, tasa, monto_bs, diferencial_bs, referencia, notas
  ) values (
    v_cxc.id, v_fecha, p_metodo_id, v_monto, v_a_recargo, v_a_capital,
    v_igtf, v_tasa, v_cobro_ves, v_dif, nullif(trim(p_referencia), ''), nullif(trim(p_notas), '')
  ) returning * into v_abono;

  select numero_factura into v_factura from public.facturas where id = v_cxc.factura_id;

  v_lineas := jsonb_build_array(jsonb_build_object(
    'cuenta_id', v_metodo.cuenta_id, 'debe', v_monto + v_igtf, 'debe_ves', v_cobro_ves,
    'descripcion', 'Cobro ' || p_metodo_id));
  if v_a_capital > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', case when v_cxc.tipo = 'CASHEA' then 'CTA_CXC_CASHEA' else 'CTA_CXC_CLIENTES' end,
      'haber', v_a_capital, 'haber_ves', v_capital_ves,
      'descripcion', 'Abono a capital ' || v_factura || ' (tasa origen ' || v_cxc.tasa_origen || ')');
  end if;
  if v_a_recargo > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_INGRESO_MORA', 'haber', v_a_recargo, 'descripcion', 'Recargo por mora cobrado');
  end if;
  if v_igtf > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_IGTF_POR_PAGAR', 'haber', v_igtf, 'descripcion', 'IGTF percibido');
  end if;
  if v_dif > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_DIF_CAMBIARIO_GANANCIA', 'haber_ves', v_dif, 'descripcion', 'Ganancia cambiaria');
  elsif v_dif < 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_DIF_CAMBIARIO_PERDIDA', 'debe_ves', -v_dif, 'descripcion', 'Pérdida cambiaria');
  end if;

  perform interno.registrar_asiento(
    v_dia, 'Abono a ' || v_factura || ' (' || p_metodo_id || ')',
    'Cuentas por Cobrar', v_lineas, v_tasa, 'ABONO_CXC', v_abono.id);

  return v_abono;
end;
$$;

create or replace function public.registrar_abono(
  p_cxc_id uuid, p_monto_usd numeric, p_metodo_id text,
  p_referencia text default null, p_notas text default null
)
returns public.abonos_cxc
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente', 'vendedor') then
    raise exception 'No autorizado para registrar cobros.';
  end if;
  return interno.registrar_abono(p_cxc_id, p_monto_usd, p_metodo_id, p_referencia, p_notas);
end;
$$;

create or replace function public.anular_abono(p_abono_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_abono public.abonos_cxc%rowtype;
  v_asiento_id uuid;
begin
  if not public.tiene_rol('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede anular abonos.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  select * into v_abono from public.abonos_cxc where id = p_abono_id for update;
  if not found or v_abono.estado <> 'VIGENTE' then
    raise exception 'El abono no existe o ya fue anulado.';
  end if;

  update public.cuentas_por_cobrar
     set saldo_usd = saldo_usd + v_abono.aplicado_capital_usd,
         recargo_cobrado_usd = recargo_cobrado_usd - v_abono.aplicado_recargo_usd,
         estado = 'PENDIENTE'
   where id = v_abono.cxc_id;

  update public.abonos_cxc
     set estado = 'ANULADO', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = trim(p_motivo)
   where id = p_abono_id;

  select id into v_asiento_id from public.asientos_contables
   where referencia_tipo = 'ABONO_CXC' and referencia_id = p_abono_id and estado = 'ASENTADO';
  perform interno.revertir_asiento(v_asiento_id, 'Anulación de abono: ' || trim(p_motivo));
end;
$$;

-- Vista de cartera con antigüedad y recargo vigente (base de la pantalla CxC).
create or replace view public.v_cuentas_por_cobrar
with (security_invoker = true) as
select c.id, c.factura_id, f.numero_factura, f.fecha_emision, f.total_usd as total_factura_usd,
       c.cliente_id, cl.nombre as cliente_nombre, cl.documento_identidad, cl.telefono, cl.email, cl.direccion,
       c.tipo, c.monto_usd, c.saldo_usd as capital_pendiente_usd, c.tasa_origen,
       c.fecha_vencimiento, c.estado,
       (current_date - c.fecha_emision) as dias_transcurridos,
       greatest(current_date - c.fecha_vencimiento, 0) as dias_vencida,
       (c.estado = 'PENDIENTE' and current_date > c.fecha_vencimiento) as vencida,
       public.recargo_cxc(c) as recargo_usd,
       public.recargo_cxc(c) - c.recargo_cobrado_usd as recargo_pendiente_usd,
       c.monto_usd - c.saldo_usd + c.recargo_cobrado_usd as total_abonado_usd,
       c.saldo_usd + public.recargo_cxc(c) - c.recargo_cobrado_usd as saldo_total_usd
  from public.cuentas_por_cobrar c
  join public.facturas f on f.id = c.factura_id
  left join public.clientes cl on cl.id = c.cliente_id;

grant execute on function public.recargo_cxc(public.cuentas_por_cobrar, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Pagos a proveedores
-- -----------------------------------------------------------------------------
create table public.pagos_cxp (
  id              uuid primary key default gen_random_uuid(),
  cxp_id          uuid not null references public.cuentas_por_pagar (id) on delete restrict,
  fecha           timestamptz not null default now(),
  metodo_id       text not null references public.metodos_pago_contables (metodo_id),
  monto_usd       numeric(14, 2) not null check (monto_usd > 0),
  igtf_usd        numeric(14, 2) not null default 0,
  tasa            numeric(18, 4) not null,
  monto_bs        numeric(18, 2) not null,
  diferencial_bs  numeric(18, 2) not null default 0,
  referencia      text,
  notas           text,
  registrado_por  uuid references public.usuarios (id) default auth.uid()
);
create index on public.pagos_cxp (cxp_id);

create or replace function interno.pagar_cxp(
  p_cxp_id uuid, p_monto_usd numeric, p_metodo_id text,
  p_referencia text default null, p_notas text default null, p_fecha timestamptz default null
)
returns public.pagos_cxp
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cxp public.cuentas_por_pagar%rowtype;
  v_empresa public.configuracion_empresa%rowtype;
  v_metodo public.metodos_pago_contables%rowtype;
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_tasa numeric(18, 4);
  v_monto numeric(14, 2) := round(p_monto_usd, 2);
  v_igtf numeric(14, 2) := 0;
  v_deuda_ves numeric(20, 2);
  v_pago_ves numeric(20, 2);
  v_dif numeric(20, 2);
  v_pago public.pagos_cxp%rowtype;
  v_orden text;
  v_lineas jsonb;
begin
  select * into v_cxp from public.cuentas_por_pagar where id = p_cxp_id for update;
  if not found or v_cxp.estado <> 'PENDIENTE' then
    raise exception 'La cuenta por pagar no existe o no está pendiente.';
  end if;
  select * into v_metodo from public.metodos_pago_contables where metodo_id = p_metodo_id;
  if not found or p_metodo_id in ('credito', 'cashea') then
    raise exception 'Método de pago inválido.';
  end if;
  if v_monto is null or v_monto <= 0 or v_monto > v_cxp.saldo_usd then
    raise exception 'El pago debe ser mayor a cero y no superar el saldo (% USD).', v_cxp.saldo_usd;
  end if;

  select * into v_empresa from public.configuracion_empresa where id = 'default';
  v_tasa := public.tasa_vigente(v_dia);

  -- Pagar en divisas genera IGTF a cargo de la empresa (gasto).
  if v_empresa.contribuyente_especial and v_metodo.es_divisa then
    v_igtf := round(v_monto * v_empresa.alicuota_igtf / 100, 2);
  end if;

  v_deuda_ves := round(v_monto * v_cxp.tasa_origen, 2);
  v_pago_ves := round(v_monto * v_tasa, 2);
  v_dif := v_deuda_ves - v_pago_ves;

  update public.cuentas_por_pagar
     set saldo_usd = saldo_usd - v_monto,
         estado = case when saldo_usd - v_monto = 0 then 'PAGADA' else estado end
   where id = v_cxp.id;

  insert into public.pagos_cxp (cxp_id, fecha, metodo_id, monto_usd, igtf_usd, tasa, monto_bs, diferencial_bs, referencia, notas)
  values (v_cxp.id, coalesce(p_fecha, now()), p_metodo_id, v_monto, v_igtf, v_tasa,
          round((v_monto + v_igtf) * v_tasa, 2), v_dif, nullif(trim(p_referencia), ''), nullif(trim(p_notas), ''))
  returning * into v_pago;

  select numero_orden into v_orden from public.ordenes_compra where id = v_cxp.orden_id;

  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta_clave', 'CTA_CXP_PROVEEDORES', 'debe', v_monto, 'debe_ves', v_deuda_ves,
                       'descripcion', 'Pago ' || v_orden || ' (tasa origen ' || v_cxp.tasa_origen || ')'),
    jsonb_build_object('cuenta_id', v_metodo.cuenta_id, 'haber', v_monto + v_igtf,
                       'descripcion', 'Pago ' || p_metodo_id));
  if v_igtf > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_id', (select id from public.plan_cuentas where codigo = '6.2.01.02'),
      'debe', v_igtf, 'descripcion', 'IGTF pagado');
  end if;
  if v_dif > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_DIF_CAMBIARIO_GANANCIA', 'haber_ves', v_dif, 'descripcion', 'Ganancia cambiaria');
  elsif v_dif < 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_DIF_CAMBIARIO_PERDIDA', 'debe_ves', -v_dif, 'descripcion', 'Pérdida cambiaria');
  end if;

  perform interno.registrar_asiento(
    v_dia, 'Pago a proveedor ' || v_orden, 'Cuentas por Pagar', v_lineas, v_tasa, 'PAGO_CXP', v_pago.id);
  return v_pago;
end;
$$;

create or replace function public.pagar_cxp(
  p_cxp_id uuid, p_monto_usd numeric, p_metodo_id text,
  p_referencia text default null, p_notas text default null
)
returns public.pagos_cxp
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente', 'contador') then
    raise exception 'No autorizado para registrar pagos a proveedores.';
  end if;
  return interno.pagar_cxp(p_cxp_id, p_monto_usd, p_metodo_id, p_referencia, p_notas);
end;
$$;

grant execute on function public.registrar_abono(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.anular_abono(uuid, text) to authenticated;
grant execute on function public.pagar_cxp(uuid, numeric, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS y auditoría
-- -----------------------------------------------------------------------------
alter table public.abonos_cxc enable row level security;
alter table public.pagos_cxp  enable row level security;

create policy abonos_select on public.abonos_cxc for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy pagos_cxp_select on public.pagos_cxp for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador', 'almacenista')));

-- Los gerentes también ajustan la política de crédito y mora.
drop policy config_empresa_write on public.configuracion_empresa;
create policy config_empresa_write on public.configuracion_empresa for update to authenticated
  using ((select public.tiene_rol('admin', 'gerente')))
  with check ((select public.tiene_rol('admin', 'gerente')));
create policy config_empresa_insert on public.configuracion_empresa for insert to authenticated
  with check ((select public.tiene_rol('admin')));

do $$
declare
  t text;
begin
  foreach t in array array['cuentas_por_cobrar', 'cuentas_por_pagar', 'abonos_cxc', 'pagos_cxp'] loop
    execute format(
      'create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$I
       for each row execute function interno.registrar_auditoria()', t);
  end loop;
end;
$$;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
