-- =============================================================================
-- ARLUC SIG · Migración 2: Núcleo contable (partida doble, bimonetario)
-- -----------------------------------------------------------------------------
-- * Plan de cuentas para una comercializadora PYME bajo VEN-NIF.
-- * Asientos en USD (moneda funcional de gestión) con su equivalente en Bs a la
--   tasa BCV vigente en la fecha del asiento.
-- * Partida doble garantizada por la base de datos (trigger diferido) en USD y Bs.
-- * Asientos inmutables: se corrigen con contra-asiento (anular_asiento).
-- * Períodos mensuales con cierre: no se registra en un período CERRADO.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Plan de cuentas
-- -----------------------------------------------------------------------------
create table public.plan_cuentas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique check (codigo ~ '^[1-6](\.[0-9]{1,2}){0,3}$'),
  nombre          text not null,
  tipo            text not null check (tipo in ('ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'COSTO', 'GASTO')),
  naturaleza      text not null check (naturaleza in ('DEUDORA', 'ACREEDORA')),
  nivel           smallint generated always as (
                    array_length(string_to_array(codigo, '.'), 1)) stored,
  es_padre        boolean not null default false,
  cuenta_padre_id uuid references public.plan_cuentas (id) on delete restrict,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);
comment on column public.plan_cuentas.es_padre is
  'Cuenta de agrupación (no recibe movimientos). Las de detalle tienen es_padre = false.';
create index on public.plan_cuentas (cuenta_padre_id);

-- Coherencia del árbol: el padre debe ser cuenta de agrupación, compartir el
-- tipo y ser prefijo del código. Una cuenta con movimientos no cambia de
-- tipo, naturaleza ni pasa a ser de agrupación.
create or replace function interno.plan_cuentas_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_padre public.plan_cuentas%rowtype;
begin
  if new.cuenta_padre_id is not null then
    select * into v_padre from public.plan_cuentas where id = new.cuenta_padre_id;
    if not v_padre.es_padre then
      raise exception 'La cuenta padre % no es una cuenta de agrupación.', v_padre.codigo;
    end if;
    if v_padre.tipo <> new.tipo then
      raise exception 'La cuenta % debe ser del mismo tipo que su padre (%).', new.codigo, v_padre.tipo;
    end if;
    if new.codigo not like v_padre.codigo || '.%' then
      raise exception 'El código % debe comenzar con el código del padre (%).', new.codigo, v_padre.codigo;
    end if;
  elsif position('.' in new.codigo) > 0 then
    raise exception 'La cuenta % debe tener una cuenta padre.', new.codigo;
  end if;

  if tg_op = 'UPDATE' then
    if new.codigo <> old.codigo then
      raise exception 'El código de una cuenta no se modifica; cree una nueva y desactive la anterior.';
    end if;
    if (new.tipo, new.naturaleza, new.es_padre) is distinct from (old.tipo, old.naturaleza, old.es_padre)
       and exists (select 1 from public.lineas_asiento where cuenta_id = new.id) then
      raise exception 'La cuenta % tiene movimientos: no puede cambiar tipo, naturaleza ni agrupación.', new.codigo;
    end if;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Períodos contables
-- -----------------------------------------------------------------------------
create table public.periodos_contables (
  id           uuid primary key default gen_random_uuid(),
  anio         smallint not null check (anio between 2000 and 2100),
  mes          smallint not null check (mes between 1 and 12),
  fecha_inicio date generated always as (make_date(anio, mes, 1)) stored,
  fecha_fin    date generated always as ((make_date(anio, mes, 1) + interval '1 month - 1 day')::date) stored,
  estado       text not null default 'ABIERTO' check (estado in ('ABIERTO', 'CERRADO')),
  cerrado_por  uuid references public.usuarios (id),
  cerrado_en   timestamptz,
  unique (anio, mes)
);

-- -----------------------------------------------------------------------------
-- Asientos
-- -----------------------------------------------------------------------------
create table public.asientos_contables (
  id                 uuid primary key default gen_random_uuid(),
  numero             text not null unique,
  fecha              date not null,
  periodo_id         uuid not null references public.periodos_contables (id),
  glosa              text not null check (length(trim(glosa)) > 0),
  modulo             text not null check (modulo in (
                       'Manual', 'Ventas', 'Compras', 'Tesorería', 'Gastos', 'Ajuste',
                       'Nómina', 'Inventario', 'Cuentas por Cobrar', 'Cuentas por Pagar',
                       'Anulación', 'Cierre')),
  estado             text not null default 'ASENTADO' check (estado in ('ASENTADO', 'ANULADO')),
  tasa_cambio        numeric(18, 4) not null check (tasa_cambio > 0),
  total_debe         numeric(16, 2) not null,
  total_haber        numeric(16, 2) not null,
  total_debe_ves     numeric(20, 2) not null,
  total_haber_ves    numeric(20, 2) not null,
  balanceado         boolean generated always as (
                       total_debe = total_haber and total_debe_ves = total_haber_ves) stored,
  referencia_tipo    text,
  referencia_id      uuid,
  asiento_reverso_id uuid references public.asientos_contables (id),
  anulado_por        uuid references public.usuarios (id),
  anulado_en         timestamptz,
  motivo_anulacion   text,
  registrado_por     uuid references public.usuarios (id) default auth.uid(),
  created_at         timestamptz not null default now(),
  check (balanceado)
);
create index on public.asientos_contables (fecha);
create index on public.asientos_contables (periodo_id);
create index on public.asientos_contables (referencia_tipo, referencia_id);
create index on public.asientos_contables (registrado_por);

create table public.lineas_asiento (
  id          uuid primary key default gen_random_uuid(),
  asiento_id  uuid not null references public.asientos_contables (id) on delete restrict,
  orden       smallint not null,
  cuenta_id   uuid not null references public.plan_cuentas (id) on delete restrict,
  descripcion text,
  debe        numeric(16, 2) not null default 0 check (debe >= 0),
  haber       numeric(16, 2) not null default 0 check (haber >= 0),
  debe_ves    numeric(20, 2) not null default 0 check (debe_ves >= 0),
  haber_ves   numeric(20, 2) not null default 0 check (haber_ves >= 0),
  check ((debe > 0) <> (haber > 0)),
  unique (asiento_id, orden)
);
create index on public.lineas_asiento (cuenta_id);

-- Partida doble verificada al final de la transacción (USD y Bs).
create or replace function interno.validar_partida_doble()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v record;
begin
  select a.numero, a.total_debe, a.total_haber, a.total_debe_ves, a.total_haber_ves,
         count(l.id) as lineas,
         coalesce(sum(l.debe), 0) as debe, coalesce(sum(l.haber), 0) as haber,
         coalesce(sum(l.debe_ves), 0) as debe_ves, coalesce(sum(l.haber_ves), 0) as haber_ves
    into v
    from public.asientos_contables a
    left join public.lineas_asiento l on l.asiento_id = a.id
   where a.id = new.asiento_id
   group by a.id;

  if v.lineas < 2
     or v.debe <> v.haber or v.debe_ves <> v.haber_ves
     or v.debe <> v.total_debe or v.debe_ves <> v.total_debe_ves then
    raise exception 'El asiento % no cumple la partida doble (Debe % / Haber % USD; Debe % / Haber % Bs).',
      v.numero, v.debe, v.haber, v.debe_ves, v.haber_ves;
  end if;
  return null;
end;
$$;

create constraint trigger trg_lineas_partida_doble
after insert on public.lineas_asiento
deferrable initially deferred
for each row execute function interno.validar_partida_doble();

-- Las líneas son inmutables.
create trigger trg_lineas_inmutables
before update or delete on public.lineas_asiento
for each row execute function interno.detalles_inmutables();

-- Un asiento solo puede pasar a ANULADO (y únicamente vía anular_asiento).
create or replace function interno.asientos_inmutables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los asientos contables no se eliminan; se anulan con un contra-asiento.';
  end if;
  if coalesce(current_setting('arluc.anulando_asiento', true), 'off') <> 'on'
     or old.estado <> 'ASENTADO' or new.estado <> 'ANULADO'
     or (to_jsonb(new) - array['estado', 'asiento_reverso_id', 'anulado_por', 'anulado_en', 'motivo_anulacion', 'balanceado'])
        is distinct from
        (to_jsonb(old) - array['estado', 'asiento_reverso_id', 'anulado_por', 'anulado_en', 'motivo_anulacion', 'balanceado']) then
    raise exception 'El asiento % es inmutable; use anular_asiento() para revertirlo.', old.numero;
  end if;
  return new;
end;
$$;

create trigger trg_asientos_inmutables
before update or delete on public.asientos_contables
for each row execute function interno.asientos_inmutables();

-- -----------------------------------------------------------------------------
-- Parámetros de contabilización automática
-- -----------------------------------------------------------------------------
create table public.configuracion_contable (
  clave       text primary key,
  cuenta_id   uuid not null references public.plan_cuentas (id) on delete restrict,
  descripcion text not null
);

create table public.metodos_pago_contables (
  metodo_id   text primary key,
  cuenta_id   uuid not null references public.plan_cuentas (id) on delete restrict,
  es_divisa   boolean not null,
  descripcion text not null
);
comment on column public.metodos_pago_contables.es_divisa is
  'true = cobro en divisas (sujeto a IGTF 3% en contribuyentes especiales / pagos en moneda extranjera).';

create or replace function interno.cuenta_por_clave(p_clave text)
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select cuenta_id into v_id from public.configuracion_contable where clave = p_clave;
  if v_id is null then
    raise exception 'Falta configurar la cuenta contable "%".', p_clave;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Motor de registro de asientos (uso interno: triggers y RPC públicas)
-- p_lineas: [{ "cuenta_id"|"cuenta_clave": ..., "debe": n, "haber": n, "descripcion": "..." }]
-- -----------------------------------------------------------------------------
create or replace function interno.periodo_para(p_fecha date)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_periodo public.periodos_contables%rowtype;
begin
  insert into public.periodos_contables (anio, mes)
  values (extract(year from p_fecha)::smallint, extract(month from p_fecha)::smallint)
  on conflict (anio, mes) do nothing;

  select * into v_periodo from public.periodos_contables
   where anio = extract(year from p_fecha) and mes = extract(month from p_fecha);

  if v_periodo.estado = 'CERRADO' then
    raise exception 'El período %-% está cerrado; no admite asientos.',
      v_periodo.anio, lpad(v_periodo.mes::text, 2, '0');
  end if;
  return v_periodo.id;
end;
$$;

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

  -- 1) Normalizar líneas, validar cuentas y convertir a Bs.
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
    if v_debe < 0 or v_haber < 0 or (v_debe > 0) = (v_haber > 0) then
      raise exception 'Cada línea debe tener un monto positivo en Debe o en Haber (cuenta %).', v_cuenta.codigo;
    end if;

    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_id', v_cuenta_id,
      'descripcion', v_linea ->> 'descripcion',
      'debe', v_debe, 'haber', v_haber,
      'debe_ves', round(v_debe * v_tasa, 2),
      'haber_ves', round(v_haber * v_tasa, 2));

    v_tot_debe := v_tot_debe + v_debe;
    v_tot_haber := v_tot_haber + v_haber;
    v_tot_debe_ves := v_tot_debe_ves + round(v_debe * v_tasa, 2);
    v_tot_haber_ves := v_tot_haber_ves + round(v_haber * v_tasa, 2);
    if v_debe > v_max_debe then v_max_debe := v_debe; v_idx_max_debe := i; end if;
    if v_haber > v_max_haber then v_max_haber := v_haber; v_idx_max_haber := i; end if;
    i := i + 1;
  end loop;

  if v_tot_debe <> v_tot_haber then
    raise exception 'El asiento no cuadra: Debe % USD ≠ Haber % USD.', v_tot_debe, v_tot_haber;
  end if;

  -- 2) Diferencia de redondeo en Bs: se ajusta en la línea de mayor monto del
  --    lado menor (son céntimos producidos por convertir línea a línea).
  v_dif := v_tot_debe_ves - v_tot_haber_ves;
  if v_dif > 0 then
    v_lineas := jsonb_set(v_lineas, array[v_idx_max_haber::text, 'haber_ves'],
      to_jsonb((v_lineas -> v_idx_max_haber ->> 'haber_ves')::numeric + v_dif));
    v_tot_haber_ves := v_tot_haber_ves + v_dif;
  elsif v_dif < 0 then
    v_lineas := jsonb_set(v_lineas, array[v_idx_max_debe::text, 'debe_ves'],
      to_jsonb((v_lineas -> v_idx_max_debe ->> 'debe_ves')::numeric - v_dif));
    v_tot_debe_ves := v_tot_debe_ves - v_dif;
  end if;

  -- 3) Cabecera y líneas.
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

-- Contra-asiento: invierte Debe/Haber con la MISMA tasa del original.
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
              'debe', l.haber, 'haber', l.debe) order by l.orden)
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

-- -----------------------------------------------------------------------------
-- RPC públicas (contabilidad manual)
-- -----------------------------------------------------------------------------
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
  if exists (select 1 from jsonb_array_elements(p_lineas) e where e ? 'cuenta_clave') then
    raise exception 'Los asientos manuales deben indicar cuenta_id.';
  end if;
  return interno.registrar_asiento(p_fecha, p_glosa, p_modulo, p_lineas);
end;
$$;

create or replace function public.anular_asiento(p_asiento_id uuid, p_motivo text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'contador') then
    raise exception 'Solo un administrador o contador puede anular asientos.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  if (select modulo from public.asientos_contables where id = p_asiento_id)
       not in ('Manual', 'Tesorería', 'Gastos', 'Ajuste', 'Nómina', 'Compras', 'Ventas') then
    raise exception 'Los asientos automáticos se revierten anulando el documento que los originó.';
  end if;
  return interno.revertir_asiento(p_asiento_id, p_motivo);
end;
$$;

create or replace function public.cerrar_periodo(p_anio int, p_mes int)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'contador') then
    raise exception 'Solo un administrador o contador puede cerrar períodos.';
  end if;
  if make_date(p_anio, p_mes, 1) > date_trunc('month', current_date)::date then
    raise exception 'No se puede cerrar un período futuro.';
  end if;
  if exists (select 1 from public.periodos_contables
              where estado = 'ABIERTO' and make_date(anio, mes, 1) < make_date(p_anio, p_mes, 1)) then
    raise exception 'Hay períodos anteriores abiertos; ciérrelos en orden.';
  end if;

  insert into public.periodos_contables (anio, mes) values (p_anio, p_mes)
  on conflict (anio, mes) do nothing;
  update public.periodos_contables
     set estado = 'CERRADO', cerrado_por = auth.uid(), cerrado_en = now()
   where anio = p_anio and mes = p_mes;
end;
$$;

create or replace function public.reabrir_periodo(p_anio int, p_mes int)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin') then
    raise exception 'Solo un administrador puede reabrir períodos.';
  end if;
  if exists (select 1 from public.periodos_contables
              where estado = 'CERRADO' and make_date(anio, mes, 1) > make_date(p_anio, p_mes, 1)) then
    raise exception 'Hay períodos posteriores cerrados; reábralos primero.';
  end if;
  update public.periodos_contables
     set estado = 'ABIERTO', cerrado_por = null, cerrado_en = null
   where anio = p_anio and mes = p_mes;
end;
$$;

grant execute on function public.crear_asiento(date, text, text, jsonb) to authenticated;
grant execute on function public.anular_asiento(uuid, text) to authenticated;
grant execute on function public.cerrar_periodo(int, int) to authenticated;
grant execute on function public.reabrir_periodo(int, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Reportes contables calculados en la base de datos (sin límite de 1.000 filas)
-- -----------------------------------------------------------------------------

-- Saldos por cuenta de detalle entre dos fechas.
-- Para el Balance General use p_desde = null (saldo acumulado al corte).
create or replace function public.saldos_cuentas(p_desde date default null, p_hasta date default null)
returns table (
  cuenta_id uuid, codigo text, nombre text, tipo text, naturaleza text,
  debe numeric, haber numeric, debe_ves numeric, haber_ves numeric,
  saldo numeric, saldo_ves numeric
)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.codigo, c.nombre, c.tipo, c.naturaleza,
         coalesce(sum(l.debe), 0), coalesce(sum(l.haber), 0),
         coalesce(sum(l.debe_ves), 0), coalesce(sum(l.haber_ves), 0),
         case when c.naturaleza = 'DEUDORA'
              then coalesce(sum(l.debe), 0) - coalesce(sum(l.haber), 0)
              else coalesce(sum(l.haber), 0) - coalesce(sum(l.debe), 0) end,
         case when c.naturaleza = 'DEUDORA'
              then coalesce(sum(l.debe_ves), 0) - coalesce(sum(l.haber_ves), 0)
              else coalesce(sum(l.haber_ves), 0) - coalesce(sum(l.debe_ves), 0) end
    from public.plan_cuentas c
    join public.lineas_asiento l on l.cuenta_id = c.id
    join public.asientos_contables a on a.id = l.asiento_id
   where public.tiene_rol('admin', 'gerente', 'contador')
     and not c.es_padre
     and (p_desde is null or a.fecha >= p_desde)
     and (p_hasta is null or a.fecha <= p_hasta)
   group by c.id
   order by c.codigo
$$;
grant execute on function public.saldos_cuentas(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.plan_cuentas           enable row level security;
alter table public.periodos_contables     enable row level security;
alter table public.asientos_contables     enable row level security;
alter table public.lineas_asiento         enable row level security;
alter table public.configuracion_contable enable row level security;
alter table public.metodos_pago_contables enable row level security;

create policy plan_cuentas_select on public.plan_cuentas for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy plan_cuentas_insert on public.plan_cuentas for insert to authenticated
  with check ((select public.tiene_rol('admin', 'contador')));
create policy plan_cuentas_update on public.plan_cuentas for update to authenticated
  using ((select public.tiene_rol('admin', 'contador')))
  with check ((select public.tiene_rol('admin', 'contador')));

create policy periodos_select on public.periodos_contables for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));
create policy asientos_select on public.asientos_contables for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));
create policy lineas_select on public.lineas_asiento for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));

create policy config_contable_select on public.configuracion_contable for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));
create policy config_contable_write on public.configuracion_contable for all to authenticated
  using ((select public.tiene_rol('admin', 'contador')))
  with check ((select public.tiene_rol('admin', 'contador')));
create policy metodos_contables_select on public.metodos_pago_contables for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));
create policy metodos_contables_write on public.metodos_pago_contables for all to authenticated
  using ((select public.tiene_rol('admin', 'contador')))
  with check ((select public.tiene_rol('admin', 'contador')));

do $$
declare
  t text;
begin
  foreach t in array array['plan_cuentas', 'periodos_contables', 'configuracion_contable', 'metodos_pago_contables'] loop
    execute format(
      'create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$I
       for each row execute function interno.registrar_auditoria()', t);
  end loop;
end;
$$;

-- =============================================================================
-- Plan de cuentas VEN-NIF (PYME comercializadora)
-- =============================================================================
create temporary table _plan (codigo text, nombre text, tipo text, naturaleza text, es_padre boolean)
;

insert into _plan values
-- 1 ACTIVO ---------------------------------------------------------------------
('1',          'ACTIVO',                                         'ACTIVO', 'DEUDORA',   true),
('1.1',        'ACTIVO CORRIENTE',                               'ACTIVO', 'DEUDORA',   true),
('1.1.01',     'Efectivo y equivalentes de efectivo',            'ACTIVO', 'DEUDORA',   true),
('1.1.01.01',  'Caja principal Bs',                              'ACTIVO', 'DEUDORA',   false),
('1.1.01.02',  'Caja divisas USD',                               'ACTIVO', 'DEUDORA',   false),
('1.1.01.03',  'Caja chica',                                     'ACTIVO', 'DEUDORA',   false),
('1.1.01.04',  'Banco nacional cuenta corriente Bs',             'ACTIVO', 'DEUDORA',   false),
('1.1.01.05',  'Banco en el exterior / Zelle USD',               'ACTIVO', 'DEUDORA',   false),
('1.1.02',     'Cuentas por cobrar comerciales',                 'ACTIVO', 'DEUDORA',   true),
('1.1.02.01',  'Clientes - crédito directo',                     'ACTIVO', 'DEUDORA',   false),
('1.1.02.02',  'Cuentas por cobrar Cashea',                      'ACTIVO', 'DEUDORA',   false),
('1.1.02.03',  'Estimación para cuentas incobrables',            'ACTIVO', 'ACREEDORA', false),
('1.1.03',     'Otras cuentas por cobrar',                       'ACTIVO', 'DEUDORA',   true),
('1.1.03.01',  'Anticipos a proveedores',                        'ACTIVO', 'DEUDORA',   false),
('1.1.03.02',  'Cuentas por cobrar a empleados',                 'ACTIVO', 'DEUDORA',   false),
('1.1.04',     'Impuestos por recuperar',                        'ACTIVO', 'DEUDORA',   true),
('1.1.04.01',  'IVA crédito fiscal',                             'ACTIVO', 'DEUDORA',   false),
('1.1.04.02',  'IVA retenido por clientes',                      'ACTIVO', 'DEUDORA',   false),
('1.1.04.03',  'ISLR retenido por clientes / anticipos',         'ACTIVO', 'DEUDORA',   false),
('1.1.05',     'Inventarios',                                    'ACTIVO', 'DEUDORA',   true),
('1.1.05.01',  'Inventario de mercancía para la venta',          'ACTIVO', 'DEUDORA',   false),
('1.1.05.02',  'Mercancía en tránsito',                          'ACTIVO', 'DEUDORA',   false),
('1.1.06',     'Gastos pagados por anticipado',                  'ACTIVO', 'DEUDORA',   true),
('1.1.06.01',  'Seguros pagados por anticipado',                 'ACTIVO', 'DEUDORA',   false),
('1.1.06.02',  'Alquileres pagados por anticipado',              'ACTIVO', 'DEUDORA',   false),
('1.2',        'ACTIVO NO CORRIENTE',                            'ACTIVO', 'DEUDORA',   true),
('1.2.01',     'Propiedad, planta y equipo',                     'ACTIVO', 'DEUDORA',   true),
('1.2.01.01',  'Mobiliario y equipos de oficina',                'ACTIVO', 'DEUDORA',   false),
('1.2.01.02',  'Equipos de computación',                         'ACTIVO', 'DEUDORA',   false),
('1.2.01.03',  'Vehículos',                                      'ACTIVO', 'DEUDORA',   false),
('1.2.01.04',  'Depreciación acumulada mobiliario',              'ACTIVO', 'ACREEDORA', false),
('1.2.01.05',  'Depreciación acumulada equipos de computación',  'ACTIVO', 'ACREEDORA', false),
('1.2.01.06',  'Depreciación acumulada vehículos',               'ACTIVO', 'ACREEDORA', false),
('1.2.02',     'Otros activos no corrientes',                    'ACTIVO', 'DEUDORA',   true),
('1.2.02.01',  'Depósitos en garantía',                          'ACTIVO', 'DEUDORA',   false),
-- 2 PASIVO ---------------------------------------------------------------------
('2',          'PASIVO',                                         'PASIVO', 'ACREEDORA', true),
('2.1',        'PASIVO CORRIENTE',                               'PASIVO', 'ACREEDORA', true),
('2.1.01',     'Cuentas por pagar comerciales',                  'PASIVO', 'ACREEDORA', true),
('2.1.01.01',  'Proveedores nacionales',                         'PASIVO', 'ACREEDORA', false),
('2.1.01.02',  'Proveedores del exterior',                       'PASIVO', 'ACREEDORA', false),
('2.1.02',     'Obligaciones tributarias',                       'PASIVO', 'ACREEDORA', true),
('2.1.02.01',  'IVA débito fiscal',                              'PASIVO', 'ACREEDORA', false),
('2.1.02.02',  'IGTF por pagar',                                 'PASIVO', 'ACREEDORA', false),
('2.1.02.03',  'IVA retenido a proveedores por enterar',         'PASIVO', 'ACREEDORA', false),
('2.1.02.04',  'ISLR retenido a terceros por enterar',           'PASIVO', 'ACREEDORA', false),
('2.1.02.05',  'ISLR por pagar',                                 'PASIVO', 'ACREEDORA', false),
('2.1.02.06',  'Impuesto municipal de actividades económicas',   'PASIVO', 'ACREEDORA', false),
('2.1.03',     'Obligaciones laborales',                         'PASIVO', 'ACREEDORA', true),
('2.1.03.01',  'Sueldos y salarios por pagar',                   'PASIVO', 'ACREEDORA', false),
('2.1.03.02',  'Vacaciones y utilidades por pagar',              'PASIVO', 'ACREEDORA', false),
('2.1.03.03',  'Aportes IVSS, FAOV, INCES por pagar',            'PASIVO', 'ACREEDORA', false),
('2.1.04',     'Otros pasivos corrientes',                       'PASIVO', 'ACREEDORA', true),
('2.1.04.01',  'Anticipos de clientes',                          'PASIVO', 'ACREEDORA', false),
('2.1.04.02',  'Cuentas por pagar diversas',                     'PASIVO', 'ACREEDORA', false),
('2.2',        'PASIVO NO CORRIENTE',                            'PASIVO', 'ACREEDORA', true),
('2.2.01',     'Obligaciones a largo plazo',                     'PASIVO', 'ACREEDORA', true),
('2.2.01.01',  'Préstamos bancarios a largo plazo',              'PASIVO', 'ACREEDORA', false),
('2.2.01.02',  'Garantía de prestaciones sociales',              'PASIVO', 'ACREEDORA', false),
-- 3 PATRIMONIO -----------------------------------------------------------------
('3',          'PATRIMONIO',                                     'PATRIMONIO', 'ACREEDORA', true),
('3.1',        'CAPITAL',                                        'PATRIMONIO', 'ACREEDORA', true),
('3.1.01',     'Capital social',                                 'PATRIMONIO', 'ACREEDORA', true),
('3.1.01.01',  'Capital social suscrito y pagado',               'PATRIMONIO', 'ACREEDORA', false),
('3.2',        'RESERVAS',                                       'PATRIMONIO', 'ACREEDORA', true),
('3.2.01',     'Reservas legales',                               'PATRIMONIO', 'ACREEDORA', true),
('3.2.01.01',  'Reserva legal',                                  'PATRIMONIO', 'ACREEDORA', false),
('3.3',        'RESULTADOS',                                     'PATRIMONIO', 'ACREEDORA', true),
('3.3.01',     'Resultados acumulados',                          'PATRIMONIO', 'ACREEDORA', true),
('3.3.01.01',  'Utilidades no distribuidas',                     'PATRIMONIO', 'ACREEDORA', false),
('3.3.01.02',  'Pérdidas acumuladas',                            'PATRIMONIO', 'DEUDORA',   false),
('3.3.02',     'Resultado del ejercicio',                        'PATRIMONIO', 'ACREEDORA', true),
('3.3.02.01',  'Resultado del ejercicio',                        'PATRIMONIO', 'ACREEDORA', false),
-- 4 INGRESOS -------------------------------------------------------------------
('4',          'INGRESOS',                                       'INGRESO', 'ACREEDORA', true),
('4.1',        'INGRESOS OPERACIONALES',                         'INGRESO', 'ACREEDORA', true),
('4.1.01',     'Ventas',                                         'INGRESO', 'ACREEDORA', true),
('4.1.01.01',  'Ventas de mercancía gravadas',                   'INGRESO', 'ACREEDORA', false),
('4.1.01.02',  'Ventas de mercancía exentas',                    'INGRESO', 'ACREEDORA', false),
('4.1.01.03',  'Devoluciones y descuentos en ventas',            'INGRESO', 'DEUDORA',   false),
('4.2',        'OTROS INGRESOS',                                 'INGRESO', 'ACREEDORA', true),
('4.2.01',     'Ingresos no operacionales',                      'INGRESO', 'ACREEDORA', true),
('4.2.01.01',  'Ganancia en diferencial cambiario',              'INGRESO', 'ACREEDORA', false),
('4.2.01.02',  'Recargos por mora cobrados',                     'INGRESO', 'ACREEDORA', false),
('4.2.01.03',  'Otros ingresos',                                 'INGRESO', 'ACREEDORA', false),
-- 5 COSTOS ---------------------------------------------------------------------
('5',          'COSTOS',                                         'COSTO', 'DEUDORA', true),
('5.1',        'COSTO DE VENTAS',                                'COSTO', 'DEUDORA', true),
('5.1.01',     'Costo de la mercancía vendida',                  'COSTO', 'DEUDORA', true),
('5.1.01.01',  'Costo de ventas de mercancía',                   'COSTO', 'DEUDORA', false),
('5.1.01.02',  'Mermas y ajustes de inventario',                 'COSTO', 'DEUDORA', false),
-- 6 GASTOS ---------------------------------------------------------------------
('6',          'GASTOS',                                         'GASTO', 'DEUDORA', true),
('6.1',        'GASTOS OPERACIONALES',                           'GASTO', 'DEUDORA', true),
('6.1.01',     'Gastos de personal',                             'GASTO', 'DEUDORA', true),
('6.1.01.01',  'Sueldos y salarios',                             'GASTO', 'DEUDORA', false),
('6.1.01.02',  'Bono de alimentación (cestaticket)',             'GASTO', 'DEUDORA', false),
('6.1.01.03',  'Aportes patronales IVSS, FAOV, INCES',           'GASTO', 'DEUDORA', false),
('6.1.01.04',  'Prestaciones sociales',                          'GASTO', 'DEUDORA', false),
('6.1.01.05',  'Vacaciones y utilidades',                        'GASTO', 'DEUDORA', false),
('6.1.02',     'Gastos generales y de administración',           'GASTO', 'DEUDORA', true),
('6.1.02.01',  'Alquiler de local',                              'GASTO', 'DEUDORA', false),
('6.1.02.02',  'Servicios públicos',                             'GASTO', 'DEUDORA', false),
('6.1.02.03',  'Telefonía e internet',                           'GASTO', 'DEUDORA', false),
('6.1.02.04',  'Papelería y útiles de oficina',                  'GASTO', 'DEUDORA', false),
('6.1.02.05',  'Mantenimiento y reparaciones',                   'GASTO', 'DEUDORA', false),
('6.1.02.06',  'Depreciación',                                   'GASTO', 'DEUDORA', false),
('6.1.02.07',  'Impuestos municipales',                          'GASTO', 'DEUDORA', false),
('6.1.02.08',  'Cuentas incobrables',                            'GASTO', 'DEUDORA', false),
('6.1.03',     'Gastos de ventas',                               'GASTO', 'DEUDORA', true),
('6.1.03.01',  'Publicidad y mercadeo',                          'GASTO', 'DEUDORA', false),
('6.1.03.02',  'Comisiones bancarias y de punto de venta',       'GASTO', 'DEUDORA', false),
('6.1.03.03',  'Comisiones Cashea',                              'GASTO', 'DEUDORA', false),
('6.1.03.04',  'Fletes y transporte en ventas',                  'GASTO', 'DEUDORA', false),
('6.2',        'GASTOS NO OPERACIONALES',                        'GASTO', 'DEUDORA', true),
('6.2.01',     'Gastos financieros',                             'GASTO', 'DEUDORA', true),
('6.2.01.01',  'Pérdida en diferencial cambiario',               'GASTO', 'DEUDORA', false),
('6.2.01.02',  'IGTF pagado',                                    'GASTO', 'DEUDORA', false),
('6.2.01.03',  'Intereses y gastos financieros',                 'GASTO', 'DEUDORA', false);

-- Se insertan por nivel para que cada padre exista antes que sus hijos.
insert into public.plan_cuentas (codigo, nombre, tipo, naturaleza, es_padre, cuenta_padre_id)
select p.codigo, p.nombre, p.tipo, p.naturaleza, p.es_padre, null
  from _plan p where position('.' in p.codigo) = 0;

do $$
declare
  n int;
begin
  for n in 2..4 loop
    insert into public.plan_cuentas (codigo, nombre, tipo, naturaleza, es_padre, cuenta_padre_id)
    select p.codigo, p.nombre, p.tipo, p.naturaleza, p.es_padre, padre.id
      from _plan p
      join public.plan_cuentas padre
        on padre.codigo = regexp_replace(p.codigo, '\.[0-9]+$', '')
     where array_length(string_to_array(p.codigo, '.'), 1) = n;
  end loop;
end;
$$;

create trigger trg_plan_cuentas_validar
before insert or update on public.plan_cuentas
for each row execute function interno.plan_cuentas_validar();

-- -----------------------------------------------------------------------------
-- Mapeo de contabilización automática
-- -----------------------------------------------------------------------------
insert into public.configuracion_contable (clave, cuenta_id, descripcion)
select v.clave, c.id, v.descripcion
  from (values
    ('CTA_CXC_CLIENTES',        '1.1.02.01', 'Ventas a crédito directo'),
    ('CTA_CXC_CASHEA',          '1.1.02.02', 'Monto financiado por Cashea'),
    ('CTA_IVA_CREDITO',         '1.1.04.01', 'IVA pagado en compras'),
    ('CTA_IVA_RETENIDO_CLIENTE','1.1.04.02', 'Retenciones de IVA que nos practican'),
    ('CTA_INVENTARIO',          '1.1.05.01', 'Inventario valorado a costo promedio'),
    ('CTA_CXP_PROVEEDORES',     '2.1.01.01', 'Compras a crédito'),
    ('CTA_IVA_DEBITO',          '2.1.02.01', 'IVA facturado en ventas'),
    ('CTA_IGTF_POR_PAGAR',      '2.1.02.02', 'IGTF percibido en cobros en divisas'),
    ('CTA_ANTICIPO_CLIENTES',   '2.1.04.01', 'Excedentes y anticipos de clientes'),
    ('CTA_CAPITAL',             '3.1.01.01', 'Aportes de capital'),
    ('CTA_RESULTADOS_ACUM',     '3.3.01.01', 'Traslado del resultado al cierre anual'),
    ('CTA_RESULTADO_EJERCICIO', '3.3.02.01', 'Resultado del ejercicio'),
    ('CTA_VENTAS_GRAVADAS',     '4.1.01.01', 'Ventas sujetas a IVA'),
    ('CTA_VENTAS_EXENTAS',      '4.1.01.02', 'Ventas exentas de IVA'),
    ('CTA_DEVOLUCIONES_VENTAS', '4.1.01.03', 'Notas de crédito por devoluciones'),
    ('CTA_DIF_CAMBIARIO_GANANCIA','4.2.01.01','Ganancia por fluctuación de la tasa'),
    ('CTA_INGRESO_MORA',        '4.2.01.02', 'Recargos por mora cobrados'),
    ('CTA_COSTO_VENTAS',        '5.1.01.01', 'Costo de la mercancía vendida'),
    ('CTA_AJUSTE_INVENTARIO',   '5.1.01.02', 'Mermas, faltantes y sobrantes'),
    ('CTA_COMISION_CASHEA',     '6.1.03.03', 'Comisión cobrada por Cashea'),
    ('CTA_DIF_CAMBIARIO_PERDIDA','6.2.01.01','Pérdida por fluctuación de la tasa')
  ) as v(clave, codigo, descripcion)
  join public.plan_cuentas c on c.codigo = v.codigo;

insert into public.metodos_pago_contables (metodo_id, cuenta_id, es_divisa, descripcion)
select v.metodo_id, c.id, v.es_divisa, v.descripcion
  from (values
    ('efectivo_usd',  '1.1.01.02', true,  'Efectivo en dólares'),
    ('efectivo_bs',   '1.1.01.01', false, 'Efectivo en bolívares'),
    ('zelle',         '1.1.01.05', true,  'Zelle / banco en el exterior'),
    ('pago_movil',    '1.1.01.04', false, 'Pago móvil interbancario'),
    ('punto_venta',   '1.1.01.04', false, 'Lote de punto de venta'),
    ('transferencia', '1.1.01.04', false, 'Transferencia bancaria nacional'),
    ('cashea',        '1.1.02.02', false, 'Monto financiado por Cashea'),
    ('credito',       '1.1.02.01', false, 'Crédito directo de la tienda')
  ) as v(metodo_id, codigo, es_divisa, descripcion)
  join public.plan_cuentas c on c.codigo = v.codigo;

drop table _plan;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
