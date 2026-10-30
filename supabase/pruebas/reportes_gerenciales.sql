-- Pruebas de los reportes gerenciales (programados, excepción, proyección y a solicitud).
-- Solo lectura; corre en una transacción que se revierte.
--   docker cp supabase/pruebas/reportes_gerenciales.sql supabase_db_ARLOC:/tmp/rg.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/rg.sql
\set QUIET on
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
create function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;

\echo '=== 1. Una vendedora no puede consultar reportes gerenciales (debe fallar)'
select pg_temp.como('vendedor@arluc.test');
select reporte_excepciones(current_date - 30, current_date);

\echo '=== 2. Programados: generados por el cron con sus controles de confiabilidad'
select pg_temp.como('gerente@arluc.test');
select codigo, count(*) as reportes, max(periodo_hasta) as ultimo,
       bool_and((verificaciones -> 0 ->> 'ok')::boolean) as partida_doble_siempre_ok
  from reportes_generados group by codigo order by codigo;

\echo '=== 3. Excepciones de los últimos 30 días (sección → casos)'
select e ->> 'titulo' as excepcion, jsonb_array_length(e -> 'filas') as casos, e ->> 'responsable' as responsable
  from jsonb_array_elements(reporte_excepciones(current_date - 30, current_date)) e;

\echo '=== 4. Proyección del flujo de caja a 4 semanas'
select x ->> 'semana' as semana, x ->> 'ventas_contado' as ventas_contado, x ->> 'cobros_cxc' as cobros,
       x ->> 'pagos_proveedores' as pagos, x ->> 'gastos_operativos' as gastos, x ->> 'saldo_final' as saldo
  from jsonb_array_elements(reporte_proyecciones() -> 'flujo_caja' -> 'semanas') x;
select reporte_proyecciones() -> 'flujo_caja' ->> 'efectivo_actual' as efectivo_hoy;

\echo '=== 5. Pronóstico de agotamiento de inventario (los 5 más urgentes)'
select x ->> 'producto' as producto, x ->> 'stock' as stock, x ->> 'venta_diaria' as venta_diaria,
       x ->> 'dias_cobertura' as dias, x ->> 'fecha_agotamiento' as se_agota, x ->> 'sugerencia_compra' as comprar
  from jsonb_array_elements(reporte_proyecciones() -> 'inventario') x limit 5;

\echo '=== 6. A solicitud: ventas del mes por categoría'
select x ->> 'grupo' as categoria, x ->> 'facturas' as facturas, x ->> 'ventas' as ventas, x ->> 'margen_pct' as margen_pct
  from jsonb_array_elements(reporte_a_solicitud(date_trunc('month', current_date)::date, current_date, 'categoria') -> 'filas') x;
\echo '    ... y una dimensión inválida (debe fallar)'
select reporte_a_solicitud(current_date - 7, current_date, 'color');
rollback;
