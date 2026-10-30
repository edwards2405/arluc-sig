-- Pruebas de notas de crédito y débito fiscales.
-- Corre dentro de una transacción que se revierte: no modifica los datos.
--   docker cp supabase/pruebas/notas_fiscales.sql supabase_db_ARLOC:/tmp/nf.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/nf.sql
\set QUIET on
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
create function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;

-- Factura de contado de hace más de 10 días con al menos 2 unidades de un producto
select f.id as fact, f.numero_factura, d.producto_id as prod, d.producto_nombre, d.cantidad as vendidos, f.fecha_emision::date as fecha_fact
  from facturas f join detalles_factura d on d.factura_id = f.id
 where f.estado = 'emitida' and f.cliente_id is null and f.iva_retenido_usd = 0 and d.cantidad >= 2
   and f.fecha_emision < current_date - 10
   and not exists (select 1 from cuentas_por_cobrar c where c.factura_id = f.id)
 order by f.fecha_emision limit 1 \gset
\echo '=== Factura de prueba:' :numero_factura 'del' :fecha_fact '·' :vendidos 'x' :producto_nombre

select pg_temp.como('gerente@arluc.test');
select (sig_resumen(:'fecha_fact', :'fecha_fact') -> 'actual' ->> 'ventas_netas') as ventas_antes \gset
reset role;
select stock as stock_antes from productos where id = :'prod' \gset

\echo '=== 1. Una vendedora no puede emitir notas (debe fallar)'
select pg_temp.como('vendedor@arluc.test');
select emitir_nota_credito(:'fact', 'DEVOLUCION', jsonb_build_array(jsonb_build_object('producto_id', :'prod', 'cantidad', 1)), null, 'x', 'efectivo_usd');

\echo '=== 2. Devolver más de lo vendido (debe fallar)'
select pg_temp.como('gerente@arluc.test');
select emitir_nota_credito(:'fact', 'DEVOLUCION', jsonb_build_array(jsonb_build_object('producto_id', :'prod', 'cantidad', 999)), null, 'x', 'efectivo_usd');

\echo '=== 3. Devolución de 1 unidad reintegrada en efectivo USD'
select id as nc, numero, numero_control, base_imponible_usd base, iva_usd iva, total_usd, tasa as tasa_factura, monto_liquidado_usd reintegro
  from emitir_nota_credito(:'fact', 'DEVOLUCION', jsonb_build_array(jsonb_build_object('producto_id', :'prod', 'cantidad', 1)),
                           null, 'Producto defectuoso', 'efectivo_usd') \gset
\echo :numero control=:numero_control base=:base iva=:iva total=:total_usd reintegro=:reintegro tasa_factura=:tasa_factura
reset role;
select stock - :stock_antes as unidades_reingresadas from productos where id = :'prod';
select tipo, cantidad, costo_unitario_usd from movimientos_inventario where referencia_id = :'nc';
select pg_temp.como('contador@arluc.test');
\echo '--- Asiento: rebaja a la tasa de la factura, reintegro a la de hoy, diferencia cambiaria'
select c.codigo, c.nombre, l.debe, l.haber, l.debe_ves, l.haber_ves from asientos_contables a
  join lineas_asiento l on l.asiento_id = a.id join plan_cuentas c on c.id = l.cuenta_id
 where a.referencia_id = :'nc' order by l.orden;

\echo '=== 4. Descuento mayor que lo que queda de la factura (debe fallar); descuento de $5'
select pg_temp.como('gerente@arluc.test');
select emitir_nota_credito(:'fact', 'DESCUENTO', null, 999999, 'x', 'efectivo_usd');
select numero, concepto, base_imponible_usd, iva_usd, total_usd
  from emitir_nota_credito(:'fact', 'DESCUENTO', null, 5, 'Rebaja comercial acordada', 'pago_movil');
select saldo_notas_factura(:'fact') -> 'productos' -> 0 ->> 'devueltos' as devueltos,
       saldo_notas_factura(:'fact') ->> 'base_disponible_usd' as base_disponible;

\echo '=== 5. Una factura de días anteriores no se anula: se corrige con nota de crédito (debe fallar)'
select anular_factura((select id from facturas where estado = 'emitida' and fecha_emision < current_date - 3
                        and id <> :'fact' limit 1), 'x');

\echo '=== 6. NC sobre una venta a contribuyente especial: ajusta la retención'
select f.id as fact_ce, f.numero_factura as num_ce, f.iva_usd as iva_ce, f.iva_retenido_usd as ret_ce
  from facturas f where f.estado = 'emitida' and f.iva_retenido_usd > 0
   and not exists (select 1 from cuentas_por_cobrar c where c.factura_id = f.id)
 order by f.fecha_emision desc limit 1 \gset
select numero, iva_usd, iva_retenido_usd, total_usd, monto_liquidado_usd
  from emitir_nota_credito(:'fact_ce', 'DESCUENTO', null, 20, 'Descuento por volumen', 'transferencia') \gset
\echo NC :numero iva=:iva_usd retencion_ajustada=:iva_retenido_usd total=:total_usd reintegro=:monto_liquidado_usd

\echo '=== 7. NC que rebaja la cuenta por cobrar de una venta a crédito'
select c.factura_id as fact_cr, c.saldo_usd as saldo_antes
  from cuentas_por_cobrar c join facturas f on f.id = c.factura_id
 where c.tipo = 'CREDITO_DIRECTO' and c.estado = 'PENDIENTE' and c.saldo_usd > 15
 order by c.fecha_emision desc limit 1 \gset
select monto_liquidado_usd as rebaja from emitir_nota_credito(:'fact_cr', 'DESCUENTO', null, 10, 'Ajuste de precio', 'credito_cxc') \gset
select :saldo_antes as saldo_antes, :rebaja as rebaja, saldo_usd as saldo_despues from cuentas_por_cobrar where factura_id = :'fact_cr' and tipo = 'CREDITO_DIRECTO';

\echo '=== 8. Nota de débito a contribuyente especial: retiene el 75 % del IVA de la nota'
select numero, concepto, base_imponible_usd, iva_usd, iva_retenido_usd, monto_liquidado_usd as cobrado
  from emitir_nota_debito(:'fact_ce', 'CARGO_ADICIONAL', 40, 'Flete de entrega', 'transferencia');
select tipo, numero_factura, monto_retenido_usd, estado from retenciones_iva where numero_factura like 'ND-%';

\echo '=== 8b. Si la factura tiene notas ya no se puede anular, ni siquiera el mismo día (debe fallar)'
reset role;
update facturas set estado = 'anulada' where id = :'fact_ce';
select pg_temp.como('gerente@arluc.test');

\echo '=== 9. Libro de ventas del mes: las notas aparecen con su factura afectada'
select tipo_documento, numero_factura, factura_afectada, base_bs, iva_bs, iva_retenido_bs
  from libro_ventas(extract(year from current_date)::int, extract(month from current_date)::int)
 where tipo_documento <> 'FAC';
select r -> 'ventas' as ventas, r ->> 'retenciones_soportadas_bs' as ret_soportadas
  from (select resumen_iva(extract(year from current_date)::int, extract(month from current_date)::int) as r) x;

\echo '=== 10. El SIG descuenta las notas de la venta original'
select :ventas_antes as ventas_antes,
       sig_resumen(:'fecha_fact', :'fecha_fact') -> 'actual' ->> 'ventas_netas' as ventas_despues;

\echo '=== 11. Partida doble global'
reset role;
select sum(debe) = sum(haber) as cuadra_usd, sum(debe_ves) = sum(haber_ves) as cuadra_bs from lineas_asiento;
rollback;
