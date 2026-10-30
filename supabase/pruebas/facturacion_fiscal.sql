-- Pruebas de facturación fiscal y contabilización automática.
-- Ejecutar sobre una BD recién reseteada (MODIFICA datos):
--   docker cp supabase/pruebas/facturacion_fiscal.sql supabase_db_ARLOC:/tmp/f.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/f.sql
--   npx supabase db reset
\set QUIET on
\pset footer off
create or replace function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, false),
         set_config('role', 'authenticated', false) $$;
create or replace function pg_temp.prod(p_sku text) returns uuid language sql as $$
  select id from public.productos where sku = p_sku $$;
create or replace function pg_temp.cli(p_doc text) returns uuid language sql as $$
  select id from public.clientes where documento_identidad = p_doc $$;

\echo '=== A. Contado en efectivo USD: 1 corneta $280 + IVA 16% + IGTF 3%'
select pg_temp.como('vendedor@arluc.test');
select numero_factura, numero_control, base_imponible_usd base, iva_usd iva, base_igtf_usd, igtf_usd igtf, total_usd
  from emitir_factura(null, jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('AUD-001'), 'cantidad', 1)),
                      '[{"metodo_id":"efectivo_usd","monto_usd":324.80}]');

\echo '=== B. Mixto: pago móvil Bs + Zelle (IGTF solo sobre la parte en divisas)'
select numero_factura, total_usd, igtf_usd, jsonb_path_query_array(metodos_pago, '$[*].igtf_usd') igtf_por_pago
  from emitir_factura(pg_temp.cli('V-24651980'),
         jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('DJ-002'), 'cantidad', 2),
                           jsonb_build_object('producto_id', pg_temp.prod('CAB-001'), 'cantidad', 4)),
         '[{"metodo_id":"pago_movil","monto_usd":100,"referencia":"PM-1"},{"metodo_id":"zelle","monto_usd":85.60,"zelle_titular":"M R","zelle_email":"m@r.test"}]');

\echo '=== C1. Crédito que excede la línea de Carlos ($400) como vendedor (debe fallar)'
select numero_factura from emitir_factura(pg_temp.cli('V-19842516'),
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('AUD-002'), 'cantidad', 1)),
  '[{"metodo_id":"credito","monto_usd":522}]', true);

\echo '=== C2. Mismo crédito autorizado por la gerente (sobregiro)'
select pg_temp.como('gerente@arluc.test');
select numero_factura, total_usd from emitir_factura(pg_temp.cli('V-19842516'),
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('AUD-002'), 'cantidad', 1)),
  '[{"metodo_id":"credito","monto_usd":522}]', true);
select saldo_credito_cliente(pg_temp.cli('V-19842516')) as saldo_carlos;

\echo '=== D. Cashea: inicial $100 por punto de venta, resto financiado'
select pg_temp.como('vendedor@arluc.test');
select numero_factura, total_usd, igtf_usd,
       metodos_pago -> 0 ->> 'credito_cashea_usd' financiado
  from emitir_factura(null, jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('LGT-001'), 'cantidad', 2)),
                      '[{"metodo_id":"cashea","monto_usd":100,"referencia":"CSH-9","cashea_metodo_inicial":"punto_venta"}]');

\echo '=== E1. Pago incompleto (debe fallar)'
select numero_factura from emitir_factura(null, jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('CAB-002'), 'cantidad', 1)),
  '[{"metodo_id":"efectivo_bs","monto_usd":10}]');
\echo '=== E2. Pago excedido (debe fallar)'
select numero_factura from emitir_factura(null, jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('CAB-002'), 'cantidad', 1)),
  '[{"metodo_id":"efectivo_bs","monto_usd":50}]');
\echo '=== E3. Insertar factura directo sin RPC (debe fallar)'
insert into facturas (numero_factura, vendedor_id, tasa_id, total_usd, total_bs)
values ('X', auth.uid(), (select id from tasas_cambio limit 1), 1, 1);

\echo '=== F. Anular la factura A (gerente): stock, CxC y contra-asiento'
select pg_temp.como('gerente@arluc.test');
select anular_factura((select id from facturas where numero_factura = 'ARLUC-00000001'), 'Cliente desistió de la compra');
select stock as stock_aud001 from productos where sku = 'AUD-001';
select numero, modulo, estado, total_debe from asientos_contables where referencia_id = (select id from facturas where numero_factura = 'ARLUC-00000001') order by numero;

\echo '=== G. Compra recibida por almacén: costo promedio, CxP y asiento'
select pg_temp.como('almacen@arluc.test');
select costo_usd as costo_antes, stock from productos where sku = 'CAB-002';
insert into ordenes_compra (numero_orden, proveedor_id, numero_factura_proveedor)
values (generar_numero_orden(), (select id from proveedores where rif = 'J-29876543-2'), 'FP-7781');
insert into detalles_orden_compra (orden_id, producto_id, cantidad, precio_unitario_usd)
values ((select id from ordenes_compra limit 1), pg_temp.prod('CAB-002'), 20, 9.00);
update ordenes_compra set estado = 'recibida';
select costo_usd as costo_despues, stock from productos where sku = 'CAB-002';
select monto_usd as cxp from cuentas_por_pagar;

\echo '=== H. Ajuste manual de stock (faltante de 2 pedestales) por admin'
select pg_temp.como('admin@arluc.test');
update productos set stock = stock - 2 where sku = 'CAB-003';

\echo '=== I. Libro diario resultante'
select pg_temp.como('contador@arluc.test');
select a.numero, a.modulo, a.estado, c.codigo, c.nombre, l.debe, l.haber
  from asientos_contables a join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.numero <> 'AS-2026-000001'
 order by a.numero, l.orden;

\echo '=== J. Comprobación: Σ Debe = Σ Haber (USD y Bs) y cuentas clave'
select sum(debe) debe, sum(haber) haber, sum(debe_ves) debe_bs, sum(haber_ves) haber_bs from lineas_asiento;
select codigo, nombre, saldo from saldos_cuentas()
 where codigo in ('1.1.01.02','1.1.01.04','1.1.01.05','1.1.02.01','1.1.02.02','1.1.04.01','1.1.05.01',
                  '2.1.01.01','2.1.02.01','2.1.02.02','4.1.01.01','5.1.01.01','5.1.01.02');
