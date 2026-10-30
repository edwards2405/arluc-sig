-- Pruebas de cobranza, pagos a proveedores, mora y diferencial cambiario.
-- Corre dentro de una transacción que se revierte: no modifica los datos.
--   docker cp supabase/pruebas/cobros_pagos.sql supabase_db_ARLOC:/tmp/c.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/c.sql
\set QUIET on
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
create function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;

\echo '=== 1. Venta a crédito a Producciones Eventos 360 hace 30 días (plazo 15 días → vencida)'
select f.id as factura, f.numero_factura, f.total_usd, t.tasa_usd_bs as tasa_factura
  from interno.emitir_factura(
         (select id from usuarios where email = 'vendedor@arluc.test'),
         (select id from clientes where documento_identidad = 'J-41234567-0'),
         jsonb_build_array(jsonb_build_object('producto_id', (select id from productos where sku = 'AUD-003'), 'cantidad', 2)),
         '[{"metodo_id":"credito","monto_usd":197.20}]', false, now() - interval '30 days') f
  join tasas_cambio t on t.id = f.tasa_id \gset
\echo :numero_factura total=:total_usd tasa_factura=:tasa_factura
select id as cxc from cuentas_por_cobrar where factura_id = :'factura' \gset

\echo '=== 2. Cartera: recargo 5 % por mora sobre el capital'
select pg_temp.como('vendedor@arluc.test');
select dias_transcurridos, dias_vencida, vencida, capital_pendiente_usd, recargo_usd, saldo_total_usd
  from v_cuentas_por_cobrar where id = :'cxc';

\echo '=== 3. Abono de $50 en efectivo USD: primero recargo, luego capital; IGTF y diferencial'
select id as abono1, aplicado_recargo_usd, aplicado_capital_usd, igtf_usd, tasa, diferencial_bs
  from registrar_abono(:'cxc', 50, 'efectivo_usd', null, 'Abono parcial') \gset
\echo recargo=:aplicado_recargo_usd capital=:aplicado_capital_usd igtf=:igtf_usd tasa_hoy=:tasa diferencial_bs=:diferencial_bs
select capital_pendiente_usd, recargo_pendiente_usd, saldo_total_usd, estado from v_cuentas_por_cobrar where id = :'cxc';

\echo '=== 4. Abono que excede la deuda (debe fallar)'
select registrar_abono(:'cxc', 999, 'pago_movil', 'PM-1');

\echo '=== 5. Liquidación por pago móvil'
select aplicado_capital_usd, diferencial_bs
  from registrar_abono(:'cxc', (select saldo_total_usd from v_cuentas_por_cobrar where id = :'cxc'), 'pago_movil', 'PM-2');
select estado, saldo_usd, recargo_usd, recargo_cobrado_usd from cuentas_por_cobrar where id = :'cxc';

\echo '=== 6. La vendedora no puede anular abonos (debe fallar); la gerente sí'
select anular_abono(:'abono1', 'error');
select pg_temp.como('gerente@arluc.test');
select anular_abono(:'abono1', 'Billete falso detectado');
select capital_pendiente_usd, recargo_pendiente_usd, saldo_total_usd, estado from v_cuentas_por_cobrar where id = :'cxc';

\echo '=== 7. Compra recibida hace 20 días y pagada hoy por Zelle (IGTF a cargo + diferencial)'
reset role;
select set_config('arluc.fecha_operacion', (now() - interval '20 days')::text, true) is not null as fecha_fijada;
insert into ordenes_compra (numero_orden, proveedor_id, registrado_por)
values ('OC-PRUEBA', (select id from proveedores where rif = 'J-30512894-1'), (select id from usuarios where email = 'almacen@arluc.test'))
returning id as orden \gset
insert into detalles_orden_compra (orden_id, producto_id, cantidad, precio_unitario_usd)
values (:'orden', (select id from productos where sku = 'AUD-001'), 5, 170);
update ordenes_compra set estado = 'recibida' where id = :'orden';
select set_config('arluc.fecha_operacion', '', true) is not null as fecha_restaurada;
select id as cxp, monto_usd, tasa_origen, fecha_emision from cuentas_por_pagar where orden_id = :'orden' \gset
\echo CxP=:monto_usd tasa_origen=:tasa_origen emitida=:fecha_emision

select pg_temp.como('contador@arluc.test');
select monto_usd, igtf_usd, tasa, diferencial_bs from pagar_cxp(:'cxp', 500, 'zelle', 'ZL-77');
select saldo_usd, estado from cuentas_por_pagar where id = :'cxp';

\echo '=== 8. Asientos de cobranza y pagos de esta prueba (USD | Bs)'
select a.numero, a.modulo, a.estado, c.codigo, c.nombre, l.debe, l.haber, l.debe_ves, l.haber_ves
  from asientos_contables a join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.referencia_id in (select id from abonos_cxc where cxc_id = :'cxc' union select id from pagos_cxp where cxp_id = :'cxp')
 order by a.numero, l.orden;

\echo '=== 9. Comprobación global: Σ Debe = Σ Haber en USD y en Bs'
select sum(debe) = sum(haber) as cuadra_usd, sum(debe_ves) = sum(haber_ves) as cuadra_bs from lineas_asiento;

rollback;
