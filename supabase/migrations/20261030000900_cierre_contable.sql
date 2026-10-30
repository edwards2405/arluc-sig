-- =============================================================================
-- ARLUC SIG · Migración 9: Cierre contable
-- -----------------------------------------------------------------------------
-- 1) Revaluación cambiaria de partidas monetarias al cierre de cada mes
--    (diferencial cambiario NO realizado):
--      * Partidas en divisas (caja USD, Zelle, CxC, CxP...): el saldo en USD es
--        fijo y su valor en Bs se lleva a la tasa BCV de cierre.
--      * Partidas en bolívares (caja y bancos Bs, IVA, IGTF, retenciones): el
--        saldo en Bs es fijo y su equivalente en USD se lleva a la tasa de cierre.
--    El ajuste se revierte el primer día del mes siguiente para que el
--    diferencial realizado en cobros y pagos no se cuente dos veces.
-- 2) Cierre de mes: revaluación + bloqueo del período, en orden cronológico.
-- 3) Cierre del ejercicio: cancela ingresos, costos y gastos contra Resultado
--    del ejercicio; al iniciar el siguiente lo traslada a Utilidades no
--    distribuidas y constituye la reserva legal (5 % de la utilidad hasta el
--    10 % del capital social, Código de Comercio).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Cuentas nuevas y parámetros
-- -----------------------------------------------------------------------------
insert into public.plan_cuentas (codigo, nombre, tipo, naturaleza, es_padre, cuenta_padre_id)
select v.codigo, v.nombre, v.tipo, v.naturaleza, false, p.id
  from (values
    ('4.2.01.04', 'Ganancia cambiaria no realizada (revaluación)', 'INGRESO', 'ACREEDORA', '4.2.01'),
    ('6.2.01.04', 'Pérdida cambiaria no realizada (revaluación)',  'GASTO',   'DEUDORA',   '6.2.01')
  ) as v(codigo, nombre, tipo, naturaleza, padre)
  join public.plan_cuentas p on p.codigo = v.padre;

insert into public.configuracion_contable (clave, cuenta_id, descripcion)
select v.clave, c.id, v.descripcion
  from (values
    ('CTA_REVALUACION_GANANCIA', '4.2.01.04', 'Ganancia por revaluación de partidas monetarias al cierre'),
    ('CTA_REVALUACION_PERDIDA',  '6.2.01.04', 'Pérdida por revaluación de partidas monetarias al cierre'),
    ('CTA_RESERVA_LEGAL',        '3.2.01.01', 'Reserva legal (art. 262 Código de Comercio)'),
    ('CTA_PERDIDAS_ACUM',        '3.3.01.02', 'Pérdidas acumuladas de ejercicios anteriores')
  ) as v(clave, codigo, descripcion)
  join public.plan_cuentas c on c.codigo = v.codigo;

alter table public.configuracion_empresa
  add column mes_cierre_ejercicio smallint not null default 12 check (mes_cierre_ejercicio between 1 and 12);
comment on column public.configuracion_empresa.mes_cierre_ejercicio is
  'Mes en que termina el ejercicio económico según los estatutos (no tiene que ser diciembre).';

-- Moneda de origen de cada partida monetaria (las no listadas no se revalúan).
create table public.cuentas_monetarias (
  cuenta_id uuid primary key references public.plan_cuentas (id) on delete cascade,
  moneda    text not null check (moneda in ('USD', 'VES'))
);
comment on table public.cuentas_monetarias is
  'USD: el saldo en dólares es fijo y se revalúan los Bs. VES: el saldo en Bs es fijo y se revalúan los USD.';

insert into public.cuentas_monetarias (cuenta_id, moneda)
select c.id, v.moneda
  from (values
    ('1.1.01.02', 'USD'), ('1.1.01.05', 'USD'), ('1.1.02.01', 'USD'), ('1.1.02.02', 'USD'),
    ('2.1.01.01', 'USD'), ('2.1.01.02', 'USD'), ('2.1.04.01', 'USD'),
    ('1.1.01.01', 'VES'), ('1.1.01.03', 'VES'), ('1.1.01.04', 'VES'),
    ('1.1.04.01', 'VES'), ('1.1.04.02', 'VES'),
    ('2.1.02.01', 'VES'), ('2.1.02.02', 'VES'), ('2.1.02.03', 'VES'), ('2.1.02.04', 'VES')
  ) as v(codigo, moneda)
  join public.plan_cuentas c on c.codigo = v.codigo;

alter table public.cuentas_monetarias enable row level security;
create policy cuentas_monetarias_select on public.cuentas_monetarias for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));
create policy cuentas_monetarias_write on public.cuentas_monetarias for all to authenticated
  using ((select public.tiene_rol('admin', 'contador')))
  with check ((select public.tiene_rol('admin', 'contador')));

create table public.ejercicios_contables (
  anio                smallint primary key,
  fecha_inicio        date not null,
  fecha_fin           date not null,
  utilidad_usd        numeric(16, 2) not null,
  utilidad_ves        numeric(20, 2) not null,
  reserva_legal_usd   numeric(16, 2) not null default 0,
  asiento_cierre_id   uuid references public.asientos_contables (id),
  asiento_traslado_id uuid references public.asientos_contables (id),
  cerrado_por         uuid references public.usuarios (id) default auth.uid(),
  cerrado_en          timestamptz not null default now()
);
alter table public.ejercicios_contables enable row level security;
create policy ejercicios_select on public.ejercicios_contables for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));

-- -----------------------------------------------------------------------------
-- Saldos para estados financieros:
--   * El saldo se expresa según el TIPO de cuenta (Activo, Costo y Gasto:
--     Debe − Haber; Pasivo, Patrimonio e Ingreso: Haber − Debe). Así las
--     cuentas que restan dentro de su grupo (Devoluciones en ventas,
--     Depreciación acumulada, Pérdidas acumuladas) salen en negativo y los
--     totales por grupo son correctos.
--   * Los períodos excluyen los asientos de cierre
-- (si no, el Estado de Resultados del ejercicio cerrado saldría en cero);
-- los saldos acumulados al corte (Balance General) sí los incluyen.
-- -----------------------------------------------------------------------------
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
         case when c.tipo in ('ACTIVO', 'COSTO', 'GASTO')
              then coalesce(sum(l.debe), 0) - coalesce(sum(l.haber), 0)
              else coalesce(sum(l.haber), 0) - coalesce(sum(l.debe), 0) end,
         case when c.tipo in ('ACTIVO', 'COSTO', 'GASTO')
              then coalesce(sum(l.debe_ves), 0) - coalesce(sum(l.haber_ves), 0)
              else coalesce(sum(l.haber_ves), 0) - coalesce(sum(l.debe_ves), 0) end
    from public.plan_cuentas c
    join public.lineas_asiento l on l.cuenta_id = c.id
    join public.asientos_contables a on a.id = l.asiento_id
   where public.tiene_rol('admin', 'gerente', 'contador')
     and not c.es_padre
     and (p_desde is null or a.fecha >= p_desde)
     and (p_hasta is null or a.fecha <= p_hasta)
     and (p_desde is null or a.modulo <> 'Cierre')
   group by c.id
   order by c.codigo
$$;

-- El cierre del ejercicio puede asentar en su último mes (ya cerrado).
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

  if v_periodo.estado = 'CERRADO'
     and coalesce(current_setting('arluc.cierre_ejercicio', true), 'off') <> 'on' then
    raise exception 'El período %-% está cerrado; no admite asientos.',
      v_periodo.anio, lpad(v_periodo.mes::text, 2, '0');
  end if;
  return v_periodo.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Revaluación cambiaria
-- -----------------------------------------------------------------------------
create or replace function interno.calcular_revaluacion(p_fecha_corte date)
returns table (
  cuenta_id uuid, codigo text, nombre text, moneda text,
  saldo_usd numeric, saldo_ves numeric, tasa_cierre numeric,
  ajuste_usd numeric, ajuste_ves numeric
)
language sql stable
set search_path = ''
as $$
  with tasa as (select public.tasa_vigente(p_fecha_corte) as t),
  saldos as (
    -- Convención deudora: positivo = saldo deudor, negativo = saldo acreedor.
    select m.cuenta_id, c.codigo, c.nombre, m.moneda,
           coalesce(sum(l.debe - l.haber), 0) as usd,
           coalesce(sum(l.debe_ves - l.haber_ves), 0) as ves
      from public.cuentas_monetarias m
      join public.plan_cuentas c on c.id = m.cuenta_id
      left join public.lineas_asiento l on l.cuenta_id = m.cuenta_id
      left join public.asientos_contables a on a.id = l.asiento_id
     where a.fecha is null or a.fecha <= p_fecha_corte
     group by m.cuenta_id, c.codigo, c.nombre, m.moneda
  )
  select s.cuenta_id, s.codigo, s.nombre, s.moneda, s.usd, s.ves, tasa.t,
         case when s.moneda = 'VES' then round(s.ves / tasa.t, 2) - s.usd else 0 end,
         case when s.moneda = 'USD' then round(s.usd * tasa.t, 2) - s.ves else 0 end
    from saldos s, tasa
   order by s.codigo
$$;

create or replace function public.vista_revaluacion(p_anio int, p_mes int)
returns table (
  cuenta_id uuid, codigo text, nombre text, moneda text,
  saldo_usd numeric, saldo_ves numeric, tasa_cierre numeric,
  ajuste_usd numeric, ajuste_ves numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform interno.exigir_direccion();
  return query select * from interno.calcular_revaluacion(
    (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date);
end;
$$;

create or replace function interno.registrar_revaluacion(p_anio int, p_mes int)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fin date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  v_tasa numeric(18, 4) := public.tasa_vigente((make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date);
  v_periodo uuid;
  v_r record;
  v_lineas jsonb := '[]'::jsonb;
  v_total_ves numeric(20, 2) := 0;
  v_total_usd numeric(16, 2) := 0;
  v_asiento uuid;
  v_reverso uuid;
begin
  select id into v_periodo from public.periodos_contables where anio = p_anio and mes = p_mes;

  for v_r in select * from interno.calcular_revaluacion(v_fin)
              where abs(ajuste_usd) >= 0.01 or abs(ajuste_ves) >= 0.01 loop
    if v_r.moneda = 'USD' then
      v_lineas := v_lineas || case when v_r.ajuste_ves > 0
        then jsonb_build_object('cuenta_id', v_r.cuenta_id, 'debe_ves', v_r.ajuste_ves, 'descripcion', 'Revaluación a tasa ' || v_tasa)
        else jsonb_build_object('cuenta_id', v_r.cuenta_id, 'haber_ves', -v_r.ajuste_ves, 'descripcion', 'Revaluación a tasa ' || v_tasa) end;
      v_total_ves := v_total_ves + v_r.ajuste_ves;
    else
      v_lineas := v_lineas || case when v_r.ajuste_usd > 0
        then jsonb_build_object('cuenta_id', v_r.cuenta_id, 'debe', v_r.ajuste_usd, 'debe_ves', 0, 'descripcion', 'Equivalente USD a tasa ' || v_tasa)
        else jsonb_build_object('cuenta_id', v_r.cuenta_id, 'haber', -v_r.ajuste_usd, 'haber_ves', 0, 'descripcion', 'Equivalente USD a tasa ' || v_tasa) end;
      v_total_usd := v_total_usd + v_r.ajuste_usd;
    end if;
  end loop;

  if jsonb_array_length(v_lineas) = 0 then
    return null;
  end if;

  -- Contrapartida: resultado cambiario no realizado (en Bs y en USD por separado).
  if v_total_ves > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_REVALUACION_GANANCIA', 'haber_ves', v_total_ves, 'descripcion', 'Revaluación de partidas en divisas');
  elsif v_total_ves < 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_REVALUACION_PERDIDA', 'debe_ves', -v_total_ves, 'descripcion', 'Revaluación de partidas en divisas');
  end if;
  if v_total_usd > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_REVALUACION_GANANCIA', 'haber', v_total_usd, 'haber_ves', 0, 'descripcion', 'Revaluación de partidas en bolívares');
  elsif v_total_usd < 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_REVALUACION_PERDIDA', 'debe', -v_total_usd, 'debe_ves', 0, 'descripcion', 'Revaluación de partidas en bolívares');
  end if;

  v_asiento := interno.registrar_asiento(
    v_fin, format('Revaluación cambiaria de partidas monetarias al %s (tasa BCV %s)', to_char(v_fin, 'DD/MM/YYYY'), v_tasa),
    'Ajuste', v_lineas, v_tasa, 'REVALUACION', v_periodo);

  -- Reversión automática el primer día del mes siguiente.
  v_reverso := interno.registrar_asiento(
    v_fin + 1, format('Reverso automático de la revaluación al %s', to_char(v_fin, 'DD/MM/YYYY')),
    'Ajuste',
    (select jsonb_agg(jsonb_build_object('cuenta_id', l.cuenta_id, 'descripcion', l.descripcion,
                                         'debe', l.haber, 'haber', l.debe, 'debe_ves', l.haber_ves, 'haber_ves', l.debe_ves) order by l.orden)
       from public.lineas_asiento l where l.asiento_id = v_asiento),
    v_tasa, 'REVALUACION_REVERSO', v_periodo);
  return v_asiento;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cierre y reapertura de meses
-- -----------------------------------------------------------------------------
create or replace function interno.cerrar_mes(p_anio int, p_mes int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inicio date := make_date(p_anio, p_mes, 1);
  v_fin date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  v_periodo public.periodos_contables%rowtype;
  v_reval uuid;
  v_desbalance numeric;
begin
  if v_fin >= current_date then
    raise exception 'El mes %/% aún no ha terminado.', lpad(p_mes::text, 2, '0'), p_anio;
  end if;
  if exists (select 1 from public.periodos_contables
              where estado = 'ABIERTO' and make_date(anio, mes, 1) < v_inicio
                and exists (select 1 from public.asientos_contables a where a.periodo_id = periodos_contables.id)) then
    raise exception 'Hay meses anteriores abiertos; ciérrelos en orden.';
  end if;

  insert into public.periodos_contables (anio, mes) values (p_anio, p_mes) on conflict (anio, mes) do nothing;
  select * into v_periodo from public.periodos_contables where anio = p_anio and mes = p_mes for update;
  if v_periodo.estado = 'CERRADO' then
    raise exception 'El mes %/% ya está cerrado.', lpad(p_mes::text, 2, '0'), p_anio;
  end if;

  select coalesce(sum(l.debe) - sum(l.haber), 0) + coalesce(sum(l.debe_ves) - sum(l.haber_ves), 0) into v_desbalance
    from public.lineas_asiento l join public.asientos_contables a on a.id = l.asiento_id where a.periodo_id = v_periodo.id;
  if v_desbalance <> 0 then
    raise exception 'El mes no cuadra (diferencia %); revise los asientos.', v_desbalance;
  end if;

  if not exists (select 1 from public.asientos_contables
                  where referencia_tipo = 'REVALUACION' and referencia_id = v_periodo.id
                    and estado = 'ASENTADO' and modulo = 'Ajuste') then
    v_reval := interno.registrar_revaluacion(p_anio, p_mes);
  end if;

  update public.periodos_contables
     set estado = 'CERRADO', cerrado_por = auth.uid(), cerrado_en = now()
   where id = v_periodo.id;

  return jsonb_build_object('periodo', format('%s/%s', lpad(p_mes::text, 2, '0'), p_anio),
                            'asiento_revaluacion', v_reval,
                            'tasa_cierre', public.tasa_vigente(v_fin));
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
  perform interno.cerrar_mes(p_anio, p_mes);
end;
$$;

create or replace function public.cerrar_mes(p_anio int, p_mes int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'contador') then
    raise exception 'Solo un administrador o contador puede cerrar períodos.';
  end if;
  return interno.cerrar_mes(p_anio, p_mes);
end;
$$;

-- Reabrir revierte la revaluación (y su reverso) para recalcularla al volver a cerrar.
create or replace function public.reabrir_periodo(p_anio int, p_mes int)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_periodo public.periodos_contables%rowtype;
  v_a record;
begin
  if not public.tiene_rol('admin') then
    raise exception 'Solo un administrador puede reabrir períodos.';
  end if;
  if exists (select 1 from public.periodos_contables
              where estado = 'CERRADO' and make_date(anio, mes, 1) > make_date(p_anio, p_mes, 1)) then
    raise exception 'Hay períodos posteriores cerrados; reábralos primero.';
  end if;
  if exists (select 1 from public.ejercicios_contables where make_date(p_anio, p_mes, 1) between fecha_inicio and fecha_fin) then
    raise exception 'El mes pertenece a un ejercicio cerrado; no puede reabrirse.';
  end if;

  update public.periodos_contables set estado = 'ABIERTO', cerrado_por = null, cerrado_en = null
   where anio = p_anio and mes = p_mes
  returning * into v_periodo;
  if not found then
    raise exception 'El período no existe.';
  end if;

  for v_a in select id, fecha from public.asientos_contables
              where referencia_id = v_periodo.id and estado = 'ASENTADO' and modulo = 'Ajuste'
                and referencia_tipo in ('REVALUACION', 'REVALUACION_REVERSO') loop
    perform interno.revertir_asiento(v_a.id, 'Reapertura del período', v_a.fecha);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cierre del ejercicio
-- -----------------------------------------------------------------------------
create or replace function interno.cerrar_ejercicio(p_anio int, p_permitir_mes_abierto boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_mes_cierre int := (select mes_cierre_ejercicio from public.configuracion_empresa where id = 'default');
  v_fin date;
  v_inicio date;
  v_r record;
  v_lineas jsonb := '[]'::jsonb;
  v_net_usd numeric(16, 2) := 0;
  v_net_ves numeric(20, 2) := 0;
  v_utilidad_usd numeric(16, 2);
  v_utilidad_ves numeric(20, 2);
  v_capital numeric(16, 2);
  v_reserva_actual numeric(16, 2);
  v_reserva numeric(16, 2) := 0;
  v_reserva_ves numeric(20, 2) := 0;
  v_tasa numeric(18, 4);
  v_cierre uuid;
  v_traslado uuid;
  v_traslado_lineas jsonb;
begin
  v_fin := (make_date(p_anio, v_mes_cierre, 1) + interval '1 month - 1 day')::date;
  v_inicio := v_fin - interval '1 year' + interval '1 day';
  if v_fin >= current_date then
    raise exception 'El ejercicio que termina el % aún no ha concluido.', to_char(v_fin, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.ejercicios_contables where anio = p_anio) then
    raise exception 'El ejercicio % ya está cerrado.', p_anio;
  end if;
  if not p_permitir_mes_abierto and exists (
       select 1 from public.periodos_contables p
        where p.estado = 'ABIERTO' and make_date(p.anio, p.mes, 1) between v_inicio and v_fin
          and exists (select 1 from public.asientos_contables a where a.periodo_id = p.id)) then
    raise exception 'Cierre primero todos los meses del ejercicio.';
  end if;

  -- 1) Cancelar cada cuenta de resultado contra Resultado del ejercicio.
  for v_r in
    select l.cuenta_id, sum(l.debe - l.haber) as usd, sum(l.debe_ves - l.haber_ves) as ves
      from public.lineas_asiento l
      join public.asientos_contables a on a.id = l.asiento_id
      join public.plan_cuentas c on c.id = l.cuenta_id
     where c.tipo in ('INGRESO', 'COSTO', 'GASTO') and a.fecha between v_inicio and v_fin
     group by l.cuenta_id
    having sum(l.debe - l.haber) <> 0 or sum(l.debe_ves - l.haber_ves) <> 0
  loop
    -- Línea que deja la cuenta en cero (USD y Bs pueden tener signos distintos).
    if v_r.usd <> 0 then
      v_lineas := v_lineas || jsonb_build_object('cuenta_id', v_r.cuenta_id,
        case when v_r.usd > 0 then 'haber' else 'debe' end, abs(v_r.usd),
        case when v_r.usd > 0 then 'haber_ves' else 'debe_ves' end,
        case when sign(v_r.usd) = sign(v_r.ves) then abs(v_r.ves) else 0 end,
        'descripcion', 'Cierre del ejercicio');
    end if;
    if v_r.ves <> 0 and (v_r.usd = 0 or sign(v_r.usd) <> sign(v_r.ves)) then
      v_lineas := v_lineas || jsonb_build_object('cuenta_id', v_r.cuenta_id,
        case when v_r.ves > 0 then 'haber_ves' else 'debe_ves' end, abs(v_r.ves), 'descripcion', 'Cierre del ejercicio (Bs)');
    end if;
    v_net_usd := v_net_usd + v_r.usd;
    v_net_ves := v_net_ves + v_r.ves;
  end loop;

  if jsonb_array_length(v_lineas) = 0 then
    raise exception 'El ejercicio % no tiene movimientos de resultado.', p_anio;
  end if;

  -- Utilidad = ingresos − costos − gastos = −(saldo deudor neto de resultados).
  v_utilidad_usd := -v_net_usd;
  v_utilidad_ves := -v_net_ves;
  if v_utilidad_usd <> 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_RESULTADO_EJERCICIO',
      case when v_utilidad_usd > 0 then 'haber' else 'debe' end, abs(v_utilidad_usd),
      case when v_utilidad_usd > 0 then 'haber_ves' else 'debe_ves' end,
      case when sign(v_utilidad_usd) = sign(v_utilidad_ves) then abs(v_utilidad_ves) else 0 end,
      'descripcion', case when v_utilidad_usd > 0 then 'Utilidad del ejercicio' else 'Pérdida del ejercicio' end);
  end if;
  if v_utilidad_ves <> 0 and (v_utilidad_usd = 0 or sign(v_utilidad_usd) <> sign(v_utilidad_ves)) then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_RESULTADO_EJERCICIO',
      case when v_utilidad_ves > 0 then 'haber_ves' else 'debe_ves' end, abs(v_utilidad_ves),
      'descripcion', 'Resultado del ejercicio (Bs)');
  end if;

  v_tasa := public.tasa_vigente(v_fin);
  perform set_config('arluc.cierre_ejercicio', 'on', true);
  v_cierre := interno.registrar_asiento(v_fin, format('Cierre del ejercicio económico %s', p_anio), 'Cierre',
                                        v_lineas, v_tasa, 'CIERRE_EJERCICIO', null);
  perform set_config('arluc.cierre_ejercicio', 'off', true);

  -- 2) Traslado a resultados acumulados y reserva legal (inicio del ejercicio siguiente).
  select coalesce(sum(case when c.codigo = '3.1.01.01' then l.haber - l.debe end), 0),
         coalesce(sum(case when c.codigo = '3.2.01.01' then l.haber - l.debe end), 0)
    into v_capital, v_reserva_actual
    from public.lineas_asiento l join public.plan_cuentas c on c.id = l.cuenta_id
   where c.codigo in ('3.1.01.01', '3.2.01.01');

  if v_utilidad_usd > 0 then
    v_reserva := least(round(v_utilidad_usd * 0.05, 2), greatest(round(v_capital * 0.10, 2) - v_reserva_actual, 0));
    v_reserva_ves := case when v_utilidad_ves > 0 then round(v_utilidad_ves * v_reserva / v_utilidad_usd, 2) else 0 end;
    v_traslado_lineas := jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_RESULTADO_EJERCICIO', 'debe', v_utilidad_usd, 'debe_ves', greatest(v_utilidad_ves, 0),
                         'descripcion', 'Traslado de la utilidad del ejercicio ' || p_anio),
      jsonb_build_object('cuenta_clave', 'CTA_RESULTADOS_ACUM', 'haber', v_utilidad_usd - v_reserva,
                         'haber_ves', greatest(v_utilidad_ves, 0) - v_reserva_ves, 'descripcion', 'Utilidades no distribuidas'));
    if v_reserva > 0 then
      v_traslado_lineas := v_traslado_lineas || jsonb_build_object('cuenta_clave', 'CTA_RESERVA_LEGAL', 'haber', v_reserva,
        'haber_ves', v_reserva_ves, 'descripcion', 'Reserva legal 5 % (art. 262 Código de Comercio)');
    end if;
    if v_utilidad_ves < 0 then
      v_traslado_lineas := v_traslado_lineas || jsonb_build_object('cuenta_clave', 'CTA_RESULTADO_EJERCICIO', 'haber_ves', -v_utilidad_ves,
        'descripcion', 'Resultado en Bs');
      v_traslado_lineas := v_traslado_lineas || jsonb_build_object('cuenta_clave', 'CTA_PERDIDAS_ACUM', 'debe_ves', -v_utilidad_ves,
        'descripcion', 'Resultado en Bs');
    end if;
  else
    v_traslado_lineas := jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_PERDIDAS_ACUM', 'debe', -v_utilidad_usd, 'debe_ves', greatest(-v_utilidad_ves, 0),
                         'descripcion', 'Pérdida del ejercicio ' || p_anio),
      jsonb_build_object('cuenta_clave', 'CTA_RESULTADO_EJERCICIO', 'haber', -v_utilidad_usd, 'haber_ves', greatest(-v_utilidad_ves, 0),
                         'descripcion', 'Traslado de la pérdida del ejercicio'));
  end if;

  v_traslado := interno.registrar_asiento(v_fin + 1,
    format('Traslado del resultado del ejercicio %s a resultados acumulados', p_anio), 'Cierre',
    v_traslado_lineas, public.tasa_vigente(v_fin + 1), 'TRASLADO_RESULTADO', null);

  insert into public.ejercicios_contables (anio, fecha_inicio, fecha_fin, utilidad_usd, utilidad_ves, reserva_legal_usd,
                                           asiento_cierre_id, asiento_traslado_id)
  values (p_anio, v_inicio, v_fin, v_utilidad_usd, v_utilidad_ves, v_reserva, v_cierre, v_traslado);

  return jsonb_build_object('ejercicio', p_anio, 'desde', v_inicio, 'hasta', v_fin,
                            'utilidad_usd', v_utilidad_usd, 'utilidad_ves', v_utilidad_ves, 'reserva_legal_usd', v_reserva);
end;
$$;

create or replace function public.cerrar_ejercicio(p_anio int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'contador') then
    raise exception 'Solo un administrador o contador puede cerrar el ejercicio.';
  end if;
  return interno.cerrar_ejercicio(p_anio);
end;
$$;

grant execute on function public.vista_revaluacion(int, int) to authenticated;
grant execute on function public.cerrar_mes(int, int) to authenticated;
grant execute on function public.cerrar_periodo(int, int) to authenticated;
grant execute on function public.reabrir_periodo(int, int) to authenticated;
grant execute on function public.cerrar_ejercicio(int) to authenticated;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
