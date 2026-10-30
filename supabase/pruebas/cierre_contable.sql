-- Pruebas de revaluación cambiaria, cierre de mes y cierre del ejercicio.
-- El seed deja cerrados los meses ya terminados. Corre en una transacción que se revierte.
--   docker cp supabase/pruebas/cierre_contable.sql supabase_db_ARLOC:/tmp/cc.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/cc.sql
\set QUIET on
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
create function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
-- Saldo deudor neto (USD y Bs) de una cuenta acumulado a una fecha
create function pg_temp.saldo(p_codigo text, p_fecha date) returns table (usd numeric, ves numeric) language sql as $$
  select coalesce(sum(l.debe - l.haber), 0), coalesce(sum(l.debe_ves - l.haber_ves), 0)
    from public.lineas_asiento l join public.asientos_contables a on a.id = l.asiento_id
    join public.plan_cuentas c on c.id = l.cuenta_id
   where c.codigo = p_codigo and a.fecha <= p_fecha $$;

select (date_trunc('month', current_date) - interval '1 day')::date as fin_ant,
       extract(year from current_date - interval '1 month')::int as anio_ant,
       extract(month from current_date - interval '1 month')::int as mes_ant \gset
\echo '=== Último mes cerrado:' :mes_ant/:anio_ant 'termina el' :fin_ant

\echo '=== 1. Revaluación del mes: partidas en USD ajustan sus Bs; partidas en Bs ajustan sus USD'
select c.codigo, c.nombre, l.debe, l.haber, l.debe_ves, l.haber_ves
  from asientos_contables a join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.referencia_tipo = 'REVALUACION' and a.fecha = :'fin_ant' and a.modulo = 'Ajuste'
 order by l.orden;

\echo '=== 2. Al cierre, la caja en divisas vale en Bs exactamente USD x tasa de cierre'
select s.usd, s.ves, public.tasa_vigente(:'fin_ant') as tasa_cierre,
       round(s.usd * public.tasa_vigente(:'fin_ant'), 2) = s.ves as revaluada
  from pg_temp.saldo('1.1.01.02', :'fin_ant') s;
\echo '    ... y el banco en Bs vale en USD exactamente Bs / tasa de cierre'
select s.usd, s.ves, round(s.ves / public.tasa_vigente(:'fin_ant'), 2) = s.usd as revaluado
  from pg_temp.saldo('1.1.01.04', :'fin_ant') s;
\echo '    ... y el día 1 se revierte (vuelve al valor histórico)'
select (select ves from pg_temp.saldo('1.1.01.02', (:'fin_ant'::date + 1)))
     - (select ves from pg_temp.saldo('1.1.01.02', :'fin_ant')) as cambio_bs_por_reverso;

\echo '=== 3. No se registran operaciones en un mes cerrado (debe fallar)'
select interno.emitir_factura((select id from usuarios where email = 'vendedor@arluc.test'), null,
  jsonb_build_array(jsonb_build_object('producto_id', (select id from productos where sku = 'CAB-001'), 'cantidad', 1)),
  '[{"metodo_id":"efectivo_bs","monto_usd":14.50}]', false, (:'fin_ant'::date - 2)::timestamptz + interval '12 hours');

\echo '=== 4. Permisos y orden (deben fallar): vendedora cierra; cerrar el mes en curso; reabrir uno anterior'
select pg_temp.como('vendedor@arluc.test');
select cerrar_mes(extract(year from current_date)::int, extract(month from current_date)::int);
select pg_temp.como('contador@arluc.test');
select cerrar_mes(extract(year from current_date)::int, extract(month from current_date)::int);
select pg_temp.como('admin@arluc.test');
select reabrir_periodo(extract(year from current_date - interval '2 months')::int, extract(month from current_date - interval '2 months')::int);

\echo '=== 5. Reabrir (admin) revierte la revaluación; volver a cerrar (contador) la recalcula'
select reabrir_periodo(:anio_ant, :mes_ant);
reset role;
select round(s.usd * public.tasa_vigente(:'fin_ant'), 2) = s.ves as sigue_revaluada from pg_temp.saldo('1.1.01.02', :'fin_ant') s;
select pg_temp.como('contador@arluc.test');
select cerrar_mes(:anio_ant, :mes_ant) ->> 'tasa_cierre' as tasa_cierre;
reset role;
select round(s.usd * public.tasa_vigente(:'fin_ant'), 2) = s.ves as revaluada_de_nuevo from pg_temp.saldo('1.1.01.02', :'fin_ant') s;

\echo '=== 6. Cierre del ejercicio (ejercicio económico que termina en el mes cerrado)'
update configuracion_empresa set mes_cierre_ejercicio = :mes_ant;
select pg_temp.como('contador@arluc.test');
select jsonb_pretty(cerrar_ejercicio(:anio_ant));

\echo '--- Las cuentas de resultado quedan en cero al cierre'
reset role;
select count(*) as cuentas_resultado_con_saldo
  from (select c.codigo, sum(l.debe - l.haber) as usd, sum(l.debe_ves - l.haber_ves) as ves
          from lineas_asiento l join asientos_contables a on a.id = l.asiento_id join plan_cuentas c on c.id = l.cuenta_id
         where c.tipo in ('INGRESO', 'COSTO', 'GASTO') and a.fecha <= :'fin_ant'
         group by c.codigo having sum(l.debe - l.haber) <> 0 or sum(l.debe_ves - l.haber_ves) <> 0) x;

\echo '--- El Estado de Resultados del período sigue mostrando la utilidad (excluye el asiento de cierre)'
select pg_temp.como('contador@arluc.test');
select sum(saldo) filter (where tipo = 'INGRESO') - sum(saldo) filter (where tipo in ('COSTO', 'GASTO')) as utilidad_periodo_usd
  from saldos_cuentas((select fecha_inicio from ejercicios_contables where anio = :anio_ant), :'fin_ant');

\echo '--- Traslado: utilidades no distribuidas y reserva legal'
select c.codigo, c.nombre, l.debe, l.haber
  from asientos_contables a join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.referencia_tipo = 'TRASLADO_RESULTADO' order by l.orden;

\echo '--- Balance General al día siguiente: Activo = Pasivo + Patrimonio + resultado del nuevo ejercicio'
select sum(saldo) filter (where tipo = 'ACTIVO') as activo,
       sum(saldo) filter (where tipo in ('PASIVO', 'PATRIMONIO', 'INGRESO'))
         - coalesce(sum(saldo) filter (where tipo in ('COSTO', 'GASTO')), 0) as pasivo_patrimonio_resultado,
       sum(saldo_ves) filter (where tipo = 'ACTIVO') as activo_bs,
       sum(saldo_ves) filter (where tipo in ('PASIVO', 'PATRIMONIO', 'INGRESO'))
         - coalesce(sum(saldo_ves) filter (where tipo in ('COSTO', 'GASTO')), 0) as pasivo_patrimonio_resultado_bs
  from saldos_cuentas(null, (:'fin_ant'::date + 1));

\echo '=== 7. Un mes de un ejercicio cerrado no se reabre (debe fallar)'
select pg_temp.como('admin@arluc.test');
select reabrir_periodo(:anio_ant, :mes_ant);

\echo '=== 8. Partida doble global'
reset role;
select sum(debe) = sum(haber) as cuadra_usd, sum(debe_ves) = sum(haber_ves) as cuadra_bs from lineas_asiento;
rollback;
