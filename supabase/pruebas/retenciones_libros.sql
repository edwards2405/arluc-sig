-- Pruebas de retenciones de IVA y libros fiscales.
-- Corre dentro de una transacción que se revierte: no modifica los datos.
--   docker cp supabase/pruebas/retenciones_libros.sql supabase_db_ARLOC:/tmp/rl.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/rl.sql
\set QUIET on
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
create function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.item(p_sku text, p_cant int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', (select id from public.productos where sku = p_sku), 'cantidad', p_cant)) $$;
create function pg_temp.cli(p_doc text) returns uuid language sql as $$
  select id from public.clientes where documento_identidad = p_doc $$;

\echo '=== 1. Venta de $280 + IVA a la Discoteca (contribuyente especial) SIN retención (debe fallar)'
select pg_temp.como('vendedor@arluc.test');
select emitir_factura(pg_temp.cli('J-50182736-2'), pg_temp.item('AUD-001', 1), '[{"metodo_id":"pago_movil","monto_usd":324.80,"referencia":"1"}]');
\echo '=== 2. Con retención equivocada (debe fallar)'
select emitir_factura(pg_temp.cli('J-50182736-2'), pg_temp.item('AUD-001', 1),
  '[{"metodo_id":"pago_movil","monto_usd":294.80,"referencia":"1"},{"metodo_id":"retencion_iva","monto_usd":30}]');
\echo '=== 3. Con la retención correcta: 75 % de 44,80 = 33,60; se cobran 291,20'
select id as fact, numero_factura, total_usd, iva_usd, iva_retenido_usd
  from emitir_factura(pg_temp.cli('J-50182736-2'), pg_temp.item('AUD-001', 1),
         '[{"metodo_id":"pago_movil","monto_usd":291.20,"referencia":"PM-77"},{"metodo_id":"retencion_iva","monto_usd":33.60}]') \gset
\echo :numero_factura total=:total_usd iva=:iva_usd retenido=:iva_retenido_usd
\echo '=== 4. Un cliente que NO es contribuyente especial no puede retener (debe fallar)'
select emitir_factura(pg_temp.cli('V-24651980'), pg_temp.item('AUD-001', 1),
  '[{"metodo_id":"pago_movil","monto_usd":291.20,"referencia":"1"},{"metodo_id":"retencion_iva","monto_usd":33.60}]');

\echo '=== 5. Asiento de la venta: la retención es un crédito fiscal (1.1.04.02)'
select pg_temp.como('contador@arluc.test');
select c.codigo, c.nombre, l.debe, l.haber from asientos_contables a
  join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.referencia_id = :'fact' order by l.orden;

\echo '=== 6. Comprobante del cliente: formato inválido (debe fallar) y válido'
select id as ret from retenciones_iva where factura_id = :'fact' \gset
select registrar_comprobante_recibido(:'ret', '123');
select registrar_comprobante_recibido(:'ret', to_char(current_date, 'YYYYMM') || '00004521');
select tipo, numero_comprobante, porcentaje, monto_retenido_usd, monto_retenido_bs, estado from retenciones_iva where id = :'ret';

\echo '=== 7. Anular la factura anula también la retención'
select pg_temp.como('gerente@arluc.test');
select anular_factura(:'fact', 'Prueba de anulación con retención');
select estado as estado_retencion from retenciones_iva where id = :'ret';

\echo '=== 8. Compra de $500 + IVA $80: se retienen $60 y el proveedor cobra $520'
select pg_temp.como('almacen@arluc.test');
insert into ordenes_compra (numero_orden, proveedor_id, numero_factura_proveedor, numero_control_proveedor)
values (generar_numero_orden(), (select id from proveedores where rif = 'J-30512894-1'), 'F-1234', '00-998877')
returning id as orden \gset
insert into detalles_orden_compra (orden_id, producto_id, cantidad, precio_unitario_usd)
values (:'orden', (select id from productos where sku = 'AUD-003'), 10, 50);
update ordenes_compra set estado = 'recibida' where id = :'orden';
select pg_temp.como('contador@arluc.test');
select o.total_usd, o.iva_usd, o.iva_retenido_usd, x.monto_usd as cxp_neta, r.numero_comprobante, length(r.numero_comprobante) as digitos
  from ordenes_compra o join cuentas_por_pagar x on x.orden_id = o.id join retenciones_iva r on r.orden_id = o.id
 where o.id = :'orden';
select c.codigo, c.nombre, l.debe, l.haber from asientos_contables a
  join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.referencia_id = :'orden' order by l.orden;

\echo '=== 9. No se puede enterar una quincena que no ha cerrado (debe fallar)'
select enterar_retenciones_iva(extract(year from current_date + 20)::int, extract(month from current_date + 20)::int, 2);

\echo '=== 10. Enteramiento histórico: la obligación en Bs vale menos en USD (diferencial)'
select a.numero, c.codigo, c.nombre, l.debe, l.haber, l.debe_ves, l.haber_ves
  from asientos_contables a join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.id = (select asiento_entero_id from retenciones_iva where estado = 'ENTERADA' order by fecha limit 1)
 order by l.orden;

\echo '=== 11. Libros del mes anterior: ventas, compras y resumen de IVA (Bs)'
select count(*) as facturas, count(*) filter (where estado = 'ANULADA') as anuladas,
       sum(base_bs) as base_bs, sum(iva_bs) as iva_bs, sum(iva_retenido_bs) as retenido_bs, sum(igtf_bs) as igtf_bs
  from libro_ventas(extract(year from current_date - 30)::int, extract(month from current_date - 30)::int);
select count(*) as compras, sum(base_bs) as base_bs, sum(iva_bs) as credito_bs, sum(iva_retenido_bs) as retenido_bs
  from libro_compras(extract(year from current_date - 30)::int, extract(month from current_date - 30)::int);
select jsonb_pretty(resumen_iva(extract(year from current_date - 30)::int, extract(month from current_date - 30)::int));

\echo '=== 12. El IVA del libro de ventas coincide con el débito fiscal contabilizado (Bs)'
select round(sum(l.iva_bs), 2) as libro_iva_bs,
       (select round(sum(li.haber_ves), 2) from asientos_contables a join lineas_asiento li on li.asiento_id = a.id
         join plan_cuentas c on c.id = li.cuenta_id
        where c.codigo = '2.1.02.01' and a.modulo = 'Ventas'
          and a.referencia_id in (select f.id from facturas f where f.estado = 'emitida'
                                    and extract(year from f.fecha_emision) = extract(year from current_date - 30)
                                    and extract(month from f.fecha_emision) = extract(month from current_date - 30))) as contabilidad_bs
  from libro_ventas(extract(year from current_date - 30)::int, extract(month from current_date - 30)::int) l;

\echo '=== 13. Una vendedora no puede ver los libros (debe fallar)'
select pg_temp.como('vendedor@arluc.test');
select count(*) from libro_ventas(2026, 10);

\echo '=== 14. Partida doble global'
reset role;
select sum(debe) = sum(haber) as cuadra_usd, sum(debe_ves) = sum(haber_ves) as cuadra_bs from lineas_asiento;
rollback;
