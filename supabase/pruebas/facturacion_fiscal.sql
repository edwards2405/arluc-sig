-- Pruebas de facturación fiscal y contabilización automática.
-- Corre dentro de una transacción que se revierte: no modifica los datos.
--   docker cp supabase/pruebas/facturacion_fiscal.sql supabase_db_ARLOC:/tmp/f.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/f.sql
\set QUIET on
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
create function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.prod(p_sku text) returns uuid language sql as $$
  select id from public.productos where sku = p_sku $$;
create function pg_temp.cli(p_doc text) returns uuid language sql as $$
  select id from public.clientes where documento_identidad = p_doc $$;
create function pg_temp.item(p_sku text, p_cant int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod(p_sku), 'cantidad', p_cant)) $$;

\echo '=== A. Contado en efectivo USD: 1 corneta $280 + IVA 16 % + IGTF 3 %'
select pg_temp.como('vendedor@arluc.test');
select stock as stock_antes from productos where sku = 'AUD-001' \gset
select id as fact_a, numero_factura, numero_control, base_imponible_usd base, iva_usd iva, igtf_usd igtf, total_usd
  from emitir_factura(null, pg_temp.item('AUD-001', 1), '[{"metodo_id":"efectivo_usd","monto_usd":324.80}]') \gset
\echo :numero_factura :numero_control base=:base iva=:iva igtf=:igtf total=:total_usd

\echo '=== B. Mixto: pago móvil + Zelle (IGTF solo sobre la parte en divisas)'
select total_usd, igtf_usd, jsonb_path_query_array(metodos_pago, '$[*].igtf_usd') igtf_por_pago
  from emitir_factura(pg_temp.cli('V-24651980'),
         jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('DJ-002'), 'cantidad', 2),
                           jsonb_build_object('producto_id', pg_temp.prod('CAB-001'), 'cantidad', 4)),
         '[{"metodo_id":"pago_movil","monto_usd":100,"referencia":"PM-1"},{"metodo_id":"zelle","monto_usd":85.60,"zelle_titular":"M R","zelle_email":"m@r.test"}]');

\echo '=== C1. Crédito que excede la línea de Carlos como vendedor (debe fallar)'
select numero_factura from emitir_factura(pg_temp.cli('V-19842516'), pg_temp.item('AUD-002', 1),
  '[{"metodo_id":"credito","monto_usd":522}]', true);
\echo '=== C2. El mismo crédito autorizado por la gerente (sobregiro)'
select pg_temp.como('gerente@arluc.test');
select numero_factura, total_usd from emitir_factura(pg_temp.cli('V-19842516'), pg_temp.item('AUD-002', 1),
  '[{"metodo_id":"credito","monto_usd":522}]', true);

\echo '=== D. Cashea: inicial $100 por punto de venta, resto financiado'
select pg_temp.como('vendedor@arluc.test');
select total_usd, metodos_pago -> 0 ->> 'credito_cashea_usd' as financiado
  from emitir_factura(null, pg_temp.item('LGT-001', 2),
         '[{"metodo_id":"cashea","monto_usd":100,"referencia":"CSH-9","cashea_metodo_inicial":"punto_venta"}]');

\echo '=== E. Pago incompleto, pago excedido y stock insuficiente (deben fallar)'
select emitir_factura(null, pg_temp.item('CAB-002', 1), '[{"metodo_id":"efectivo_bs","monto_usd":10}]');
select emitir_factura(null, pg_temp.item('CAB-002', 1), '[{"metodo_id":"efectivo_bs","monto_usd":50}]');
select emitir_factura(null, pg_temp.item('CAB-002', 9999), '[{"metodo_id":"efectivo_bs","monto_usd":208779.12}]');

\echo '=== F. Anular la factura A (gerente): stock, contra-asiento'
select pg_temp.como('gerente@arluc.test');
select anular_factura(:'fact_a', 'Cliente desistió de la compra');
select stock = :stock_antes as stock_restituido from productos where sku = 'AUD-001';
select pg_temp.como('contador@arluc.test');
select numero, modulo, estado, total_debe from asientos_contables where referencia_id = :'fact_a' order by numero;

\echo '=== G. Compra recibida por almacén: costo promedio, CxP y asiento'
select pg_temp.como('almacen@arluc.test');
select costo_usd as costo_antes, stock as stock_antes from productos where sku = 'CAB-002';
insert into ordenes_compra (numero_orden, proveedor_id, numero_factura_proveedor)
values (generar_numero_orden(), (select id from proveedores where rif = 'J-29876543-2'), 'FP-7781')
returning id as orden \gset
insert into detalles_orden_compra (orden_id, producto_id, cantidad, precio_unitario_usd)
values (:'orden', pg_temp.prod('CAB-002'), 20, 9.00);
update ordenes_compra set estado = 'recibida' where id = :'orden';
select costo_usd as costo_despues, stock as stock_despues from productos where sku = 'CAB-002';
select monto_usd as cxp_con_iva from cuentas_por_pagar where orden_id = :'orden';

\echo '=== H. Libro diario de la venta A y de la compra'
select pg_temp.como('contador@arluc.test');
select a.numero, a.modulo, c.codigo, c.nombre, l.debe, l.haber
  from asientos_contables a join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.referencia_id in (:'fact_a', :'orden')
 order by a.numero, l.orden;

\echo '=== I. Comprobación global: Σ Debe = Σ Haber (USD y Bs)'
select sum(debe) = sum(haber) as cuadra_usd, sum(debe_ves) = sum(haber_ves) as cuadra_bs from lineas_asiento;

rollback;
