-- Pruebas de seguridad y reglas de negocio (RLS, inmutabilidad, partida doble).
-- Corre dentro de una transacción que se revierte: no modifica los datos.
--   docker cp supabase/pruebas/reglas_negocio.sql supabase_db_ARLOC:/tmp/r.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/r.sql
\set QUIET on
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
create function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.cuenta(p_codigo text) returns uuid language sql as $$
  select id from public.plan_cuentas where codigo = p_codigo $$;

\echo '=== 1. Vendedor: no puede insertar facturas sin el RPC (debe fallar)'
select pg_temp.como('vendedor@arluc.test');
insert into facturas (numero_factura, vendedor_id, tasa_id, total_usd, total_bs)
values ('X-1', auth.uid(), (select id from tasas_cambio limit 1), 1, 1);
\echo '=== 2. Vendedor: no puede cambiar condiciones de crédito (debe fallar)'
update clientes set linea_credito = 99999 where documento_identidad = 'V-19842516';
\echo '=== 3. Vendedor: no puede anular facturas ni hacerse admin (0 filas afectadas)'
update facturas set estado = 'anulada' where estado = 'emitida';
update usuarios set rol = 'admin' where email = 'vendedor@arluc.test';
select rol as rol_vendedor from usuarios where email = 'vendedor@arluc.test';
\echo '=== 4. Vendedor: no ve la contabilidad (0)'
select count(*) as asientos_visibles from asientos_contables;

\echo '=== 5. Admin: una factura emitida no se edita (debe fallar)'
select pg_temp.como('admin@arluc.test');
update facturas set total_usd = 1 where estado = 'emitida';
\echo '=== 6. Admin: las facturas no se eliminan (0 filas, sin política de borrado)'
delete from facturas;

\echo '=== 7. Contador: asiento descuadrado y cuenta de agrupación (deben fallar)'
select pg_temp.como('contador@arluc.test');
select crear_asiento(current_date, 'x', 'Manual', jsonb_build_array(
  jsonb_build_object('cuenta_id', pg_temp.cuenta('1.1.01.02'), 'debe', 10),
  jsonb_build_object('cuenta_id', pg_temp.cuenta('3.1.01.01'), 'haber', 9)));
select crear_asiento(current_date, 'x', 'Manual', jsonb_build_array(
  jsonb_build_object('cuenta_id', pg_temp.cuenta('1.1.01'), 'debe', 10),
  jsonb_build_object('cuenta_id', pg_temp.cuenta('3.1.01.01'), 'haber', 10)));

\echo '=== 8. Contador: asiento manual válido y su anulación con contra-asiento'
select crear_asiento(current_date, 'Prueba de gasto', 'Gastos', jsonb_build_array(
  jsonb_build_object('cuenta_id', pg_temp.cuenta('6.1.02.04'), 'debe', 33.33),
  jsonb_build_object('cuenta_id', pg_temp.cuenta('1.1.01.04'), 'haber', 33.33))) as asiento \gset
select anular_asiento(:'asiento', 'Prueba de anulación') as reverso \gset
select numero, modulo, estado, total_debe, total_debe_ves = total_haber_ves as cuadra_bs
  from asientos_contables where id in (:'asiento', :'reverso') order by numero;

\echo '=== 9. Contador: los asientos y sus líneas no se editan ni borran (0 filas)'
update asientos_contables set glosa = 'hack' where id = :'asiento';
delete from lineas_asiento where asiento_id = :'asiento';
select glosa from asientos_contables where id = :'asiento';

\echo '=== 10. Sin sesión (anon): no puede invocar funciones (debe fallar)'
reset role;
set local role anon;
select emitir_factura(null, '[]', '[]');

rollback;
