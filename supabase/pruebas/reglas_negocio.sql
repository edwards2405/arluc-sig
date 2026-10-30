-- Pruebas de reglas de negocio (ejecutar sobre una BD recién reseteada; MODIFICA datos).
-- docker cp supabase/pruebas/reglas_negocio.sql supabase_db_ARLOC:/tmp/r.sql
-- docker exec supabase_db_ARLOC psql -U postgres -f /tmp/r.sql
-- Luego: npx supabase db reset
\set ON_ERROR_STOP off
\set QUIET on
create or replace function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role','authenticated')::text, false),
         set_config('role','authenticated', false) $$;
-- 1. venta como vendedor
select pg_temp.como('a0000000-0000-4000-8000-000000000004');
insert into facturas (numero_factura, vendedor_id, tasa_id, total_usd, total_bs, metodos_pago)
values (generar_numero_factura(), 'a0000000-0000-4000-8000-000000000004', (select id from tasas_cambio where fecha_registro=current_date), 280, 1, '[]') returning numero_factura, fecha_emision::date;
insert into detalles_factura (factura_id, producto_id, producto_nombre, cantidad, precio_unitario_usd)
select f.id, p.id, 'x', 2, 280 from facturas f, productos p where p.sku='AUD-001' returning subtotal_usd, costo_unitario_usd;
select 'stock AUD-001 =' , stock from productos where sku='AUD-001';
\echo '--- 2. precio manipulado (debe fallar)'
insert into detalles_factura (factura_id, producto_id, producto_nombre, cantidad, precio_unitario_usd)
select f.id, p.id, 'x', 1, 1 from facturas f, productos p where p.sku='AUD-002';
\echo '--- 3. stock insuficiente (debe fallar)'
insert into detalles_factura (factura_id, producto_id, producto_nombre, cantidad, precio_unitario_usd)
select f.id, p.id, 'x', 999, 450 from facturas f, productos p where p.sku='AUD-002';
\echo '--- 4. vendedor cambia credito (debe fallar)'
update clientes set linea_credito = 99999 where documento_identidad='V-19842516';
\echo '--- 5. vendedor anula factura (0 filas)'
update facturas set estado='anulada';
\echo '--- 6. vendedor ve asientos (0)'
select count(*) from asientos_contables;
\echo '--- 7. vendedor se hace admin (0 filas)'
update usuarios set rol='admin' where id='a0000000-0000-4000-8000-000000000004';
select rol from usuarios where id='a0000000-0000-4000-8000-000000000004';
-- 8. admin anula
select pg_temp.como('a0000000-0000-4000-8000-000000000001');
\echo '--- 8. admin modifica total (debe fallar)'
update facturas set total_usd = 1;
\echo '--- 9. admin anula: stock vuelve'
update facturas set estado='anulada', motivo_anulacion='prueba';
select 'stock AUD-001 =', stock from productos where sku='AUD-001';
select tipo, cantidad, stock_resultante from movimientos_inventario where producto_id=(select id from productos where sku='AUD-001') order by fecha;
\echo '--- 10. asiento descuadrado (debe fallar)'
select crear_asiento(current_date, 'x', 'Manual', jsonb_build_array(
  jsonb_build_object('cuenta_id',(select id from plan_cuentas where codigo='1.1.01.02'),'debe',10),
  jsonb_build_object('cuenta_id',(select id from plan_cuentas where codigo='3.1.01.01'),'haber',9)));
\echo '--- 11. cuenta padre (debe fallar)'
select crear_asiento(current_date, 'x', 'Manual', jsonb_build_array(
  jsonb_build_object('cuenta_id',(select id from plan_cuentas where codigo='1.1.01'),'debe',10),
  jsonb_build_object('cuenta_id',(select id from plan_cuentas where codigo='3.1.01.01'),'haber',10)));
\echo '--- 12. asiento ok + anulación'
select crear_asiento(current_date, 'Gasto de alquiler', 'Gastos', jsonb_build_array(
  jsonb_build_object('cuenta_id',(select id from plan_cuentas where codigo='6.1.02.01'),'debe',333.33),
  jsonb_build_object('cuenta_id',(select id from plan_cuentas where codigo='1.1.01.04'),'haber',333.33)));
select anular_asiento((select id from asientos_contables where glosa='Gasto de alquiler'), 'error de prueba');
select numero, estado, modulo, total_debe_ves = total_haber_ves as cuadra_bs from asientos_contables order by numero;
\echo '--- 13. borrar/editar asiento (debe fallar)'
update asientos_contables set glosa='hack';
delete from lineas_asiento;
\echo '--- 14. saldos'
select codigo, saldo from saldos_cuentas() ;
\echo '--- 15. anon llama RPC'
reset role; set role anon; select generar_numero_factura();
