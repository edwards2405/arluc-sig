-- Pruebas de las validaciones de datos y reglas de negocio (migración 20261111000100_validaciones).
-- Corre dentro de una transacción que se revierte: no modifica los datos.
--   docker cp supabase/pruebas/validaciones.sql supabase_db_ARLOC:/tmp/v.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/v.sql
-- Resultado esperado: 53 ERROR (cada caso "debe fallar" produce exactamente uno).
\set QUIET on
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
create function pg_temp.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', (select id from public.usuarios where email = p_email), 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.cli(p_doc text) returns uuid language sql as $$
  select id from public.clientes where documento_identidad = p_doc $$;
create function pg_temp.prod(p_sku text) returns uuid language sql as $$
  select id from public.productos where sku = p_sku $$;
create function pg_temp.item(p_sku text, p_cant int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod(p_sku), 'cantidad', p_cant)) $$;
create function pg_temp.cuenta(p_codigo text) returns uuid language sql as $$
  select id from public.plan_cuentas where codigo = p_codigo $$;

-- =============================================================================
\echo '=== 27/29/34. Clientes: el documento y el teléfono se normalizan (pasa)'
select pg_temp.como('vendedor@arluc.test');
insert into clientes (nombre, documento_identidad, telefono, email)
values ('  Cliente   de Prueba ', 'v12.345.678 ', '+58 414 123 4567', ' Prueba@Correo.TEST ')
returning nombre, documento_identidad, telefono, email;
\echo '--- Documento con formato inválido (debe fallar)'
insert into clientes (nombre, documento_identidad) values ('Otro', 'X-123');
\echo '--- El mismo documento escrito distinto es un duplicado (debe fallar)'
insert into clientes (nombre, documento_identidad) values ('Duplicado', 'V-12.345.678');
\echo '--- Nombre de solo espacios (debe fallar)'
insert into clientes (nombre, documento_identidad) values ('   ', 'V-7654321');
\echo '--- Teléfono inválido (debe fallar)'
insert into clientes (nombre, documento_identidad, telefono) values ('Tel', 'V-7654321', '12345');
\echo '--- Correo inválido (debe fallar)'
insert into clientes (nombre, documento_identidad, email) values ('Mail', 'V-7654321', 'correo@');
\echo '=== 11. La vendedora no marca contribuyentes especiales (debe fallar)'
update clientes set contribuyente_especial = true where documento_identidad = 'J-41234567-0';
\echo '--- La gerente sí, pero solo a un RIF J- o G- (debe fallar con una cédula; pasa con RIF)'
select pg_temp.como('gerente@arluc.test');
update clientes set contribuyente_especial = true where documento_identidad = 'V-24651980';
update clientes set contribuyente_especial = true where documento_identidad = 'J-41234567-0'
returning documento_identidad, contribuyente_especial;
update clientes set contribuyente_especial = false where documento_identidad = 'J-41234567-0';

-- =============================================================================
\echo '=== 28. Proveedores: RIF sin dígito verificador (debe fallar); normalizado (pasa)'
select pg_temp.como('almacen@arluc.test');
insert into proveedores (nombre, rif) values ('Proveedor Mal', 'V-1234567');
insert into proveedores (nombre, rif, telefono) values ('Proveedor Nuevo C.A.', 'j-401234567', '0212 555 1234')
returning rif, telefono;

-- =============================================================================
\echo '=== 33/32/6. Productos: SKU normalizado (pasa)'
insert into productos (sku, nombre, precio_usd, costo_usd, stock) values (' aud-900 ', 'Producto de prueba', 20, 10, 5)
returning sku, costo_usd, stock;
\echo '--- SKU duplicado sin distinguir mayúsculas (debe fallar)'
insert into productos (sku, nombre, precio_usd) values ('Aud-900', 'Otro', 20);
\echo '--- Precio de venta cero (debe fallar)'
insert into productos (sku, nombre, precio_usd) values ('AUD-901', 'Sin precio', 0);
\echo '--- Stock inicial con costo cero (debe fallar)'
insert into productos (sku, nombre, precio_usd, costo_usd, stock) values ('AUD-902', 'Sin costo', 20, 0, 3);
\echo '=== 7. El costo promedio no se edita a mano (debe fallar)'
update productos set costo_usd = 1 where sku = 'AUD-001';
\echo '--- El almacenista no cambia la exención de IVA (debe fallar)'
update productos set exento_iva = true where sku = 'AUD-001';
\echo '--- Producto exento sin stock para las pruebas de compras (pasa)'
insert into productos (sku, nombre, precio_usd, exento_iva) values ('EXE-001', 'Producto exento de prueba', 10, true)
returning sku, exento_iva;

\echo '=== 33/34. Categorías: duplicado con otras mayúsculas/espacios y nombre vacío (deben fallar)'
insert into categorias (nombre) values ('  audio   PROFESIONAL ');
insert into categorias (nombre) values ('   ');

-- =============================================================================
\echo '=== 17. La gerente no cambia la alícuota de IVA (debe fallar); sí los días de crédito (pasa)'
select pg_temp.como('gerente@arluc.test');
update configuracion_empresa set alicuota_iva = 12;
update configuracion_empresa set dias_credito = 20 returning dias_credito;
\echo '--- El admin no puede guardar un RIF mal formado ni el de ejemplo (deben fallar)'
select pg_temp.como('admin@arluc.test');
update configuracion_empresa set rif = 'J-123';
update configuracion_empresa set rif = 'J-00000000-0';

-- =============================================================================
\echo '=== 19. Plan de cuentas: no se desactiva una cuenta mapeada ni una con saldo (deben fallar)'
select pg_temp.como('contador@arluc.test');
update plan_cuentas set activo = false where codigo = '1.1.01.04';
update plan_cuentas set activo = false where codigo = '6.1.02.01';
\echo '--- Nombre de solo espacios (debe fallar); desactivar una cuenta sin uso ni saldo (pasa)'
update plan_cuentas set nombre = '  ' where codigo = '1.1.06.01';
update plan_cuentas set activo = false where codigo = '1.1.06.01' returning codigo, activo;

-- =============================================================================
\echo '=== 2. Asiento manual contra una cuenta de control (debe fallar)'
select crear_asiento(current_date, 'Ajuste de CxC', 'Manual', jsonb_build_array(
  jsonb_build_object('cuenta_id', pg_temp.cuenta('1.1.02.01'), 'debe', 10),
  jsonb_build_object('cuenta_id', pg_temp.cuenta('1.1.01.04'), 'haber', 10)));
\echo '--- Módulo Ventas en un asiento manual (debe fallar)'
select crear_asiento(current_date, 'Venta manual', 'Ventas', jsonb_build_array(
  jsonb_build_object('cuenta_id', pg_temp.cuenta('6.1.02.04'), 'debe', 10),
  jsonb_build_object('cuenta_id', pg_temp.cuenta('1.1.01.04'), 'haber', 10)));
\echo '=== 18. Asiento con fecha futura (debe fallar)'
select crear_asiento(current_date + 1, 'Gasto futuro', 'Gastos', jsonb_build_array(
  jsonb_build_object('cuenta_id', pg_temp.cuenta('6.1.02.04'), 'debe', 10),
  jsonb_build_object('cuenta_id', pg_temp.cuenta('1.1.01.04'), 'haber', 10)));
\echo '--- Gasto pagado por banco (pasa) y lista de cuentas para el formulario sin cuentas de control'
select crear_asiento(current_date, 'Papelería', 'Gastos', jsonb_build_array(
  jsonb_build_object('cuenta_id', pg_temp.cuenta('6.1.02.04'), 'debe', 10),
  jsonb_build_object('cuenta_id', pg_temp.cuenta('1.1.01.04'), 'haber', 10))) as asiento_manual \gset
select count(*) > 0 as hay_cuentas,
       count(*) filter (where codigo in ('1.1.02.01', '1.1.05.01', '2.1.02.01', '4.1.01.01')) as cuentas_de_control,
       count(*) filter (where codigo in ('1.1.01.04', '3.1.01.01', '6.1.02.04')) as banco_capital_gasto
  from cuentas_asiento_manual();
\echo '=== 1. Un asiento automático (de una factura) no se anula a mano (debe fallar); el manual sí (pasa)'
select anular_asiento((select id from asientos_contables where referencia_tipo = 'FACTURA' and estado = 'ASENTADO' limit 1),
                      'Prueba de anulación indebida');
select anular_asiento(:'asiento_manual', 'Registro duplicado') is not null as manual_anulado;

-- =============================================================================
\echo '=== A. Factura sin cliente (debe fallar)'
select pg_temp.como('vendedor@arluc.test');
select emitir_factura(null, pg_temp.item('CAB-001', 1), '[{"metodo_id":"efectivo_usd","monto_usd":14.50}]');
\echo '=== 24. Zelle sin referencia, pago móvil con referencia inválida y Cashea con inicial por punto sin referencia (deben fallar)'
select emitir_factura(pg_temp.cli('V-17654321'), pg_temp.item('CAB-001', 1), '[{"metodo_id":"zelle","monto_usd":14.50}]');
select emitir_factura(pg_temp.cli('V-17654321'), pg_temp.item('CAB-001', 1),
  '[{"metodo_id":"pago_movil","monto_usd":14.50,"referencia":"ab"}]');
select emitir_factura(pg_temp.cli('V-17654321'), pg_temp.item('LGT-001', 1),
  '[{"metodo_id":"cashea","monto_usd":50,"referencia":"CSH-1","cashea_metodo_inicial":"punto_venta"}]');
\echo '=== 15. Monto en Bs que no corresponde a la tasa (debe fallar); monto correcto (pasa)'
select tasa_vigente() as tasa \gset
select emitir_factura(pg_temp.cli('V-17654321'), pg_temp.item('CAB-001', 1),
  jsonb_build_array(jsonb_build_object('metodo_id', 'efectivo_bs', 'monto_usd', 14.50, 'monto_bs', round(14.50 * :tasa * 0.9, 2))));
select id as fact, numero_factura, total_usd
  from emitir_factura(pg_temp.cli('V-17654321'), pg_temp.item('CAB-001', 1),
         jsonb_build_array(jsonb_build_object('metodo_id', 'efectivo_bs', 'monto_usd', 14.50, 'monto_bs', round(14.50 * :tasa, 2)))) \gset
\echo :numero_factura total=:total_usd

\echo '=== B. Anular con motivo corto (debe fallar); con motivo suficiente (pasa)'
select pg_temp.como('gerente@arluc.test');
select anular_factura(:'fact', '  corto     ');
select anular_factura(:'fact', 'Error en el cliente seleccionado');
select estado, motivo_anulacion from facturas where id = :'fact';

-- =============================================================================
\echo '=== 21/14. Abono por transferencia sin referencia y "abono" con retención de IVA (deben fallar)'
select id as cxc from cuentas_por_cobrar where tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE' and saldo_usd > 5
 order by fecha_emision desc limit 1 \gset
select pg_temp.como('vendedor@arluc.test');
select registrar_abono(:'cxc', 1, 'transferencia');
select registrar_abono(:'cxc', 1, 'retencion_iva');
\echo '--- Abono por pago móvil con referencia (pasa)'
select id as abono, referencia from registrar_abono(:'cxc', 1, 'pago_movil', ' PM-5555 ') \gset
\echo referencia=:referencia
\echo '=== B. Anular el abono con motivo corto (debe fallar); con motivo suficiente (pasa)'
select pg_temp.como('gerente@arluc.test');
select anular_abono(:'abono', 'error');
select anular_abono(:'abono', 'Pago móvil rechazado por el banco');
select estado from abonos_cxc where id = :'abono';

\echo '=== 23/14. Pago a proveedor por transferencia sin referencia y con retención de IVA (deben fallar); Zelle con referencia (pasa)'
select id as cxp from cuentas_por_pagar where estado = 'PENDIENTE' and saldo_usd > 5 limit 1 \gset
select pg_temp.como('contador@arluc.test');
select pagar_cxp(:'cxp', 1, 'transferencia');
select pagar_cxp(:'cxp', 1, 'retencion_iva');
select monto_usd, referencia from pagar_cxp(:'cxp', 1, 'zelle', 'ZL-1234');

\echo '=== 14. Enterar retenciones con un medio inválido o en divisas (deben fallar)'
reset role;
select interno.enterar_retenciones_iva(2026, 1, 1, 'credito', current_date);
select interno.enterar_retenciones_iva(2026, 1, 1, 'zelle', current_date);

-- =============================================================================
\echo '=== 10. Una orden nace pendiente aunque se envíe "recibida" (pasa)'
select pg_temp.como('almacen@arluc.test');
insert into ordenes_compra (numero_orden, proveedor_id, estado)
values (generar_numero_orden(), (select id from proveedores where rif = 'J-30512894-1'), 'recibida')
returning id as orden, estado \gset
\echo estado_inicial=:estado
\echo '=== 9. Línea con costo cero (debe fallar)'
insert into detalles_orden_compra (orden_id, producto_id, cantidad, precio_unitario_usd) values (:'orden', pg_temp.prod('AUD-003'), 1, 0);
insert into detalles_orden_compra (orden_id, producto_id, cantidad, precio_unitario_usd)
values (:'orden', pg_temp.prod('AUD-003'), 10, 50), (:'orden', pg_temp.prod('EXE-001'), 10, 5);
\echo '=== 4. Recibir sin factura del proveedor (debe fallar)'
update ordenes_compra set estado = 'recibida' where id = :'orden';
\echo '--- Recibir con una factura ya registrada para ese proveedor (debe fallar)'
select numero_factura_proveedor as fp_usada from ordenes_compra
 where estado = 'recibida' and proveedor_id = (select id from proveedores where rif = 'J-30512894-1') limit 1 \gset
update ordenes_compra set estado = 'recibida', numero_factura_proveedor = lower(:'fp_usada'), numero_control_proveedor = '00-1'
 where id = :'orden';
\echo '=== 3. Recibir con factura nueva: IVA solo sobre lo gravado (500 × 16 % = 80; exento 50) (pasa)'
update ordenes_compra set estado = 'recibida', numero_factura_proveedor = 'FV-990001', numero_control_proveedor = '00-990001'
 where id = :'orden';
select total_usd, exento_usd, iva_usd, iva_retenido_usd from ordenes_compra where id = :'orden';
select pg_temp.como('contador@arluc.test');
select exento_bs > 0 as libro_con_exento, base_usd, iva_usd
  from libro_compras(extract(year from current_date)::int, extract(month from current_date)::int)
 where numero_factura = 'FV-990001';

-- =============================================================================
\echo '=== 5. Nota de crédito con el mismo producto repetido (debe fallar)'
select pg_temp.como('vendedor@arluc.test');
select id as fact_carlos from emitir_factura(pg_temp.cli('V-19842516'), pg_temp.item('CAB-001', 1),
  '[{"metodo_id":"efectivo_usd","monto_usd":14.50}]') \gset
select pg_temp.como('gerente@arluc.test');
select emitir_nota_credito(:'fact_carlos', 'DEVOLUCION',
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('CAB-001'), 'cantidad', 1),
                    jsonb_build_object('producto_id', pg_temp.prod('CAB-001'), 'cantidad', 1)),
  null, 'Devolución duplicada', 'efectivo_usd');
\echo '=== 13. Nota de débito a crédito que excede la línea del cliente (debe fallar)'
select emitir_nota_debito(:'fact_carlos', 'CARGO_ADICIONAL', 1000, 'Instalación y flete', 'credito');
\echo '--- Nota de débito sobre una factura exenta: exenta, sin IVA (pasa)'
select pg_temp.como('vendedor@arluc.test');
select id as fact_exenta from emitir_factura(pg_temp.cli('V-17654321'), pg_temp.item('EXE-001', 1),
  '[{"metodo_id":"efectivo_bs","monto_usd":10}]') \gset
select pg_temp.como('gerente@arluc.test');
select base_imponible_usd, exento_usd, iva_usd, total_usd
  from emitir_nota_debito(:'fact_exenta', 'CARGO_ADICIONAL', 5, 'Flete de entrega', 'efectivo_usd');

-- =============================================================================
\echo '=== 12. Comprobante de retención recibido: fecha futura, anterior a la factura y repetido del cliente (deben fallar)'
select pg_temp.como('vendedor@arluc.test');
select id as fact_ce from emitir_factura(pg_temp.cli('J-50182736-2'), pg_temp.item('AUD-003', 1),
  '[{"metodo_id":"pago_movil","monto_usd":88.40,"referencia":"PM-7788"},{"metodo_id":"retencion_iva","monto_usd":10.20}]') \gset
select pg_temp.como('contador@arluc.test');
select id as ret from retenciones_iva where factura_id = :'fact_ce' \gset
select numero_comprobante as comp_mismo from retenciones_iva
 where tipo = 'RECIBIDA' and tercero_rif = 'J-50182736-2' and numero_comprobante is not null limit 1 \gset
select numero_comprobante as comp_otro from retenciones_iva
 where tipo = 'RECIBIDA' and tercero_rif = 'J-40982314-5' and numero_comprobante is not null
   and numero_comprobante not in (select numero_comprobante from retenciones_iva
                                   where tercero_rif = 'J-50182736-2' and numero_comprobante is not null) limit 1 \gset
select registrar_comprobante_recibido(:'ret', to_char(current_date, 'YYYYMM') || '00000001', current_date + 1);
select registrar_comprobante_recibido(:'ret', to_char(current_date, 'YYYYMM') || '00000001', current_date - 1);
select registrar_comprobante_recibido(:'ret', :'comp_mismo', current_date);
\echo '--- El mismo número que usó OTRO cliente sí se acepta (único por tercero) (pasa)'
select registrar_comprobante_recibido(:'ret', :'comp_otro', current_date);
select estado, numero_comprobante = :'comp_otro' as comprobante_ok from retenciones_iva where id = :'ret';

-- =============================================================================
\echo '=== 16. Tasa manual de un día con operaciones o de un período cerrado: BLOQUEADA (no es error)'
select pg_temp.como('admin@arluc.test');
select registrar_tasa_manual(current_date - 40, 500) ->> 'estado' as periodo_cerrado,
       registrar_tasa_manual((select coalesce(max(fecha), current_date - 1) from asientos_contables where fecha < current_date
                                and fecha >= date_trunc('month', current_date)), 500) ->> 'estado' as dia_con_operaciones;

-- =============================================================================
\echo '=== 37. Metas: mes pasado, modificar una pasada y vendedor que no factura (deben fallar); mes próximo (pasa)'
select pg_temp.como('gerente@arluc.test');
insert into metas_ventas (anio, mes, vendedor_id, monto_usd)
values (extract(year from current_date - interval '1 month'), extract(month from current_date - interval '1 month'),
        (select id from usuarios where email = 'caja2@arluc.test'), 5000)
on conflict do nothing;
update metas_ventas set monto_usd = 1 where make_date(anio, mes, 1) < date_trunc('month', current_date);
insert into metas_ventas (anio, mes, vendedor_id, monto_usd)
values (extract(year from current_date + interval '1 month'), extract(month from current_date + interval '1 month'),
        (select id from usuarios where email = 'almacen@arluc.test'), 5000);
insert into metas_ventas (anio, mes, vendedor_id, monto_usd)
values (extract(year from current_date + interval '1 month'), extract(month from current_date + interval '1 month'),
        (select id from usuarios where email = 'vendedor@arluc.test'), 15000)
returning anio, mes, monto_usd;

\echo '=== 36. No se elimina un usuario con operaciones (debe fallar)'
select pg_temp.como('admin@arluc.test');
select eliminar_usuario((select id from usuarios where email = 'caja2@arluc.test'));

-- =============================================================================
\echo '=== 39. Rangos de fecha invertidos (deben fallar)'
select pg_temp.como('gerente@arluc.test');
select sig_resumen(current_date, current_date - 5);
select count(*) from saldos_cuentas(current_date, current_date - 5);
select reporte_a_solicitud(current_date, current_date - 5, 'producto');
\echo '--- Rango válido (pasa)'
select (sig_resumen(current_date - 5, current_date) -> 'periodo' ->> 'dias')::int as dias;

-- =============================================================================
\echo '=== A. Las facturas históricas sin cliente se respetan: la restricción queda NOT VALID'
reset role;
select conname, convalidated from pg_constraint where conname = 'facturas_cliente_obligatorio';
\echo '=== Partida doble global'
select sum(debe) = sum(haber) as cuadra_usd, sum(debe_ves) = sum(haber_ves) as cuadra_bs from lineas_asiento;
rollback;
