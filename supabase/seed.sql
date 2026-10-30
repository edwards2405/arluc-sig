-- =============================================================================
-- Las fechas del seed son hora de Venezuela.
set timezone to 'America/Caracas';
-- =============================================================================
-- ARLUC SIG · Datos de prueba (solo entorno local: `npx supabase db reset`)
-- -----------------------------------------------------------------------------
-- Usuarios de prueba (contraseña común para todos: Arluc.2026)
--   admin@arluc.test        Administrador
--   gerente@arluc.test      Gerente (consulta SIG)
--   contador@arluc.test     Contador
--   vendedor@arluc.test     Vendedor / cajero
--   almacen@arluc.test      Almacenista
--   caja2@arluc.test        Vendedor / cajero (segunda caja)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Usuarios (auth.users dispara la creación del perfil como vendedor inactivo)
-- -----------------------------------------------------------------------------
with nuevos (id, email, nombre, rol) as (
  values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@arluc.test',    'Edwards Pérez',     'admin'),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'gerente@arluc.test',  'María Fernández',   'gerente'),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'contador@arluc.test', 'Luis Contreras',    'contador'),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'vendedor@arluc.test', 'Ana Rodríguez',     'vendedor'),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'almacen@arluc.test',  'José Ramírez',      'almacenista'),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 'caja2@arluc.test',    'Daniela Torres',    'vendedor')
), ins as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', n.id, 'authenticated', 'authenticated', n.email,
         extensions.crypt('Arluc.2026', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('nombre_completo', n.nombre), now(), now(), '', '', '', ''
    from nuevos n
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), ins.id, ins.id::text,
       jsonb_build_object('sub', ins.id::text, 'email', ins.email, 'email_verified', true),
       'email', now(), now(), now()
  from ins;

update public.usuarios u
   set rol = v.rol, activo = true
  from (values
    ('admin@arluc.test', 'admin'), ('gerente@arluc.test', 'gerente'),
    ('contador@arluc.test', 'contador'), ('vendedor@arluc.test', 'vendedor'),
    ('almacen@arluc.test', 'almacenista'), ('caja2@arluc.test', 'vendedor')
  ) as v(email, rol)
 where u.email = v.email;

-- -----------------------------------------------------------------------------
-- Empresa
-- -----------------------------------------------------------------------------
update public.configuracion_empresa set
  nombre = 'COMERCIALIZADORA ARLUC C.A.',
  rif = 'J-50123456-7',
  direccion = 'Av. Francisco de Miranda, Chacao, Caracas',
  telefono = '0212-555-0101',
  slogan = '¡Gracias por su compra!'
 where id = 'default';

-- -----------------------------------------------------------------------------
-- Tasas BCV simuladas de los últimos 90 días: devaluación de ~0,24 % diario
-- que termina cerca de la tasa real reciente. La sincronización automática
-- reemplaza la de hoy por la oficial al iniciar la app.
-- -----------------------------------------------------------------------------
insert into public.tasas_cambio (fecha_registro, tasa_usd_bs, tasa_eur_bs, fuente, registrado_por)
select d::date,
       round((885 * power(0.9976, current_date - d::date) * (1 + sin((current_date - d::date)::numeric) * 0.002))::numeric, 4),
       round((885 * 1.11 * power(0.9976, current_date - d::date))::numeric, 4),
       'BCV (simulada)',
       'a0000000-0000-4000-8000-000000000001'
  from generate_series(current_date - 89, current_date, interval '1 day') as d;

-- -----------------------------------------------------------------------------
-- Catálogo
-- -----------------------------------------------------------------------------
insert into public.categorias (nombre, descripcion) values
  ('Audio Profesional',    'Cornetas activas, subwoofers y sistemas de amplificación'),
  ('Iluminación Escénica', 'Cabezas móviles, focos LED y efectos DMX'),
  ('Equipos DJ',           'Controladores, mixers y audífonos'),
  ('Cables y Accesorios',  'Cables balanceados, conectores y pedestales');

insert into public.productos (sku, nombre, descripcion, precio_usd, costo_usd, stock, stock_minimo, exento_iva, categoria_id)
select p.sku, p.nombre, p.descripcion, p.precio, p.costo, p.stock, p.minimo, false, c.id
  from (values
    ('AUD-001', 'Corneta activa 15" 1000W',            'Parlante bi-amplificado con DSP',        280.00, 168.00, 18, 5,  'Audio Profesional'),
    ('AUD-002', 'Subwoofer activo 18" 1500W',          'Bajo con crossover integrado',           450.00, 285.00,  8, 3,  'Audio Profesional'),
    ('AUD-003', 'Kit micrófonos inalámbricos UHF',     'Sistema doble con 100 m de alcance',      85.00,  46.00, 25, 6,  'Audio Profesional'),
    ('AUD-004', 'Consola mezcladora 12 canales',       'Mixer analógico con efectos',            320.00, 205.00,  6, 2,  'Audio Profesional'),
    ('LGT-001', 'Cabeza móvil Beam 7R 230W',           'Luz robótica DMX con gobos',             195.00, 118.00, 12, 4,  'Iluminación Escénica'),
    ('LGT-002', 'Foco LED Slim Par 18x12W RGBW',       'Luminaria plana para ambientación',       38.00,  19.50, 32, 10, 'Iluminación Escénica'),
    ('LGT-003', 'Máquina de humo 1500W',               'Generador de humo con control remoto',    65.00,  37.00,  4, 5,  'Iluminación Escénica'),
    ('LGT-004', 'Controlador DMX 192 canales',         'Consola de iluminación',                  75.00,  41.00,  9, 3,  'Iluminación Escénica'),
    ('DJ-001',  'Controlador DJ 4 canales',            'Compatible con Serato / Rekordbox',      340.00, 230.00,  7, 2,  'Equipos DJ'),
    ('DJ-002',  'Audífonos DJ de monitoreo',           'Driver de 50 mm, cable espiral',          55.00,  28.00, 20, 5,  'Equipos DJ'),
    ('DJ-003',  'Mixer DJ 2 canales',                  'Mixer con crossfader intercambiable',    190.00, 125.00,  5, 2,  'Equipos DJ'),
    ('CAB-001', 'Cable XLR balanceado 10 m',           'Conectores metálicos reforzados',         12.50,   5.20, 45, 15, 'Cables y Accesorios'),
    ('CAB-002', 'Cable Speakon 15 m',                  'Calibre 2x2.5 mm',                        18.00,   8.40,  3, 10, 'Cables y Accesorios'),
    ('CAB-003', 'Pedestal para corneta (par)',         'Trípode reforzado regulable',             42.00,  22.00, 14, 4,  'Cables y Accesorios')
  ) as p(sku, nombre, descripcion, precio, costo, stock, minimo, categoria)
  join public.categorias c on c.nombre = p.categoria;

-- El stock inicial se registra en el kardex al inicio del ejercicio de prueba.
update public.movimientos_inventario
   set fecha = (current_date - 89)::timestamptz + interval '8 hours',
       usuario_id = 'a0000000-0000-4000-8000-000000000005'
 where tipo = 'INVENTARIO_INICIAL';

-- -----------------------------------------------------------------------------
-- Terceros
-- -----------------------------------------------------------------------------
insert into public.clientes (nombre, documento_identidad, telefono, email, direccion, credito_activo, linea_credito) values
  ('Inversiones Sonido Urbano C.A.', 'J-40982314-5', '0414-1234567', 'eventos@sonidourbano.test',   'Chacao, Caracas',             true,  1500),
  ('Carlos Eduardo Mendoza',         'V-19842516',   '0412-9876543', 'carlos.mendoza@correo.test',  'El Cafetal, Baruta',          true,  400),
  ('Discoteca Sahara Club C.A.',     'J-50182736-2', '0424-5551234', 'administracion@sahara.test',  'Las Mercedes, Caracas',       true,  3000),
  ('Mariana Rodríguez',              'V-24651980',   '0416-8889922', 'mariana.rodriguez@correo.test','San Antonio de los Altos',   false, 0),
  ('Producciones Eventos 360 C.A.',  'J-41234567-0', '0414-7772211', 'compras@eventos360.test',     'Los Teques, Miranda',         true,  2000),
  ('Pedro Gutiérrez',                'V-17654321',   '0426-3334455', null,                          'Petare, Miranda',             false, 0);

-- Empresas grandes designadas contribuyentes especiales: retienen el 75 % del IVA.
update public.clientes set contribuyente_especial = true
 where documento_identidad in ('J-50182736-2', 'J-40982314-5');

insert into public.proveedores (nombre, rif, telefono, email, direccion, contacto_nombre) values
  ('Importadora Audio Global C.A.',      'J-30512894-1', '0212-9098765', 'ventas@audioglobal.test', 'La Yaguara, Caracas',  'Roberto Gómez'),
  ('Luminarias y Escenario Caracas C.A.', 'J-40112233-8', '0212-7654321', 'contacto@lumicaracas.test', 'Sabana Grande, Caracas', 'Elena Martínez'),
  ('Distribuidora Cables del Centro C.A.', 'J-29876543-2', '0241-8123456', 'ventas@cablescentro.test', 'Valencia, Carabobo',  'Andrés Silva');

-- -----------------------------------------------------------------------------
-- Asiento de apertura del ejercicio de prueba
-- Activo (efectivo + inventario a costo + equipos) = Capital social
-- -----------------------------------------------------------------------------
do $$
declare
  v_inventario numeric := (select sum(stock * costo_usd) from public.productos);
  v_cuenta jsonb := (select jsonb_object_agg(codigo, id) from public.plan_cuentas);
begin
  perform interno.registrar_asiento(
    current_date - 89,
    'Asiento de apertura: aporte de capital en efectivo, mercancía y equipos',
    'Manual',
    jsonb_build_array(
      jsonb_build_object('cuenta_id', v_cuenta ->> '1.1.01.02', 'debe', 3000, 'descripcion', 'Efectivo en divisas'),
      jsonb_build_object('cuenta_id', v_cuenta ->> '1.1.01.04', 'debe', 2500, 'descripcion', 'Saldo bancario en Bs (equivalente USD)'),
      jsonb_build_object('cuenta_id', v_cuenta ->> '1.1.05.01', 'debe', v_inventario, 'descripcion', 'Inventario inicial a costo'),
      jsonb_build_object('cuenta_id', v_cuenta ->> '1.2.01.01', 'debe', 1800, 'descripcion', 'Mobiliario y exhibidores'),
      jsonb_build_object('cuenta_id', v_cuenta ->> '1.2.01.02', 'debe', 1200, 'descripcion', 'Computadoras e impresoras fiscales'),
      jsonb_build_object('cuenta_id', v_cuenta ->> '3.1.01.01', 'haber', 3000 + 2500 + v_inventario + 1800 + 1200,
                         'descripcion', 'Capital social suscrito y pagado')
    )
  );
end;
$$;

-- =============================================================================
-- 90 días de operación simulada (para reportes, CxC y estados financieros).
-- Usa las mismas funciones que la aplicación: emitir_factura, registrar_abono,
-- pagar_cxp, recepción de compras y asientos de gastos.
-- =============================================================================
do $$
declare
  c_vendedores uuid[] := array['a0000000-0000-4000-8000-000000000004'::uuid, 'a0000000-0000-4000-8000-000000000006'::uuid];
  c_almacen uuid := 'a0000000-0000-4000-8000-000000000005';
  v_cuenta jsonb := (select jsonb_object_agg(codigo, id) from public.plan_cuentas);
  d date;
  k int;
  v_ts timestamptz;
  v_items jsonb;
  v_base numeric;
  v_total numeric;
  v_mitad numeric;
  v_retencion numeric;
  v_es_especial boolean;
  v_pagos jsonb;
  v_cliente uuid;
  v_r numeric;
  v_orden uuid;
  p record;
  c record;
begin
  perform setseed(0.2026);

  for d in select generate_series(current_date - 88, current_date - 1, interval '1 day')::date loop
    -- 1) Reposición: compra y recepción de lo que está bajo el mínimo.
    perform set_config('arluc.fecha_operacion', (d + time '09:00')::text, false);
    for p in select * from public.productos where stock < stock_minimo + 2 loop
      insert into public.ordenes_compra (numero_orden, proveedor_id, registrado_por, numero_factura_proveedor, numero_control_proveedor)
      values ('OC-' || lpad(interno.siguiente_valor('orden_compra')::text, 6, '0'),
              (select id from public.proveedores order by random() limit 1), c_almacen,
              'FP-' || (10000 + floor(random() * 89999))::int, '00-' || lpad(floor(random() * 99999999)::int::text, 8, '0'))
      returning id into v_orden;
      insert into public.detalles_orden_compra (orden_id, producto_id, cantidad, precio_unitario_usd)
      values (v_orden, p.id, p.stock_minimo * 3 + 5, round(p.costo_usd * (0.97 + random() * 0.08)::numeric, 2));
      update public.ordenes_compra set estado = 'recibida' where id = v_orden;
    end loop;

    -- 2) Ventas del día (los domingos no se abre).
    for k in 1 .. case when extract(dow from d) = 0 then 0 else 2 + floor(random() * 4)::int end loop
      v_ts := d + time '10:00' + random() * interval '9 hours';
      select jsonb_agg(jsonb_build_object('producto_id', x.id, 'cantidad', x.cant)),
             sum(round(x.cant * x.precio_usd, 2))
        into v_items, v_base
        from (select pr.id, pr.precio_usd,
                     least(pr.stock, case when pr.precio_usd < 20 then 1 + floor(random() * 4)::int
                                          else 1 + floor(random() * 2)::int end) as cant
                from public.productos pr where pr.stock > 0 order by random() limit 1 + floor(random() * 3)::int) x;
      v_r := random();
      v_cliente := null;
      if v_r >= 0.88 then
        select id into v_cliente from public.clientes where credito_activo order by random() limit 1;
      elsif random() < 0.35 then
        select id into v_cliente from public.clientes order by random() limit 1;
      end if;
      select coalesce(bool_or(contribuyente_especial), false) into v_es_especial from public.clientes where id = v_cliente;

      -- El cliente contribuyente especial retiene el 75 % del IVA: se cobra el resto.
      v_retencion := case when v_es_especial then round(round(v_base * 0.16, 2) * 0.75, 2) else 0 end;
      v_total := v_base + round(v_base * 0.16, 2) - v_retencion;
      v_mitad := round(v_total / 2, 2);
      v_pagos := case
        when v_r < 0.28 then jsonb_build_array(jsonb_build_object('metodo_id', 'efectivo_usd', 'monto_usd', v_total))
        when v_r < 0.50 then jsonb_build_array(jsonb_build_object('metodo_id', 'pago_movil', 'monto_usd', v_total,
                               'referencia', 'PM-' || floor(random() * 999999)::int))
        when v_r < 0.62 then jsonb_build_array(jsonb_build_object('metodo_id', 'punto_venta', 'monto_usd', v_total,
                               'referencia', 'PV-' || floor(random() * 999999)::int))
        when v_r < 0.71 then jsonb_build_array(jsonb_build_object('metodo_id', 'zelle', 'monto_usd', v_total,
                               'zelle_titular', 'Cliente Zelle', 'zelle_email', 'pagos@correo.test'))
        when v_r < 0.80 then jsonb_build_array(
                               jsonb_build_object('metodo_id', 'pago_movil', 'monto_usd', v_mitad,
                                                  'referencia', 'PM-' || floor(random() * 999999)::int),
                               jsonb_build_object('metodo_id', 'efectivo_usd', 'monto_usd', v_total - v_mitad))
        when v_r < 0.88 then jsonb_build_array(jsonb_build_object('metodo_id', 'cashea', 'monto_usd', round(v_total * 0.4, 2),
                               'referencia', 'CSH-' || floor(random() * 99999)::int, 'cashea_metodo_inicial', 'punto_venta'))
        else jsonb_build_array(jsonb_build_object('metodo_id', 'credito', 'monto_usd', v_total)) end;
      if v_retencion > 0 then
        v_pagos := v_pagos || jsonb_build_array(jsonb_build_object('metodo_id', 'retencion_iva', 'monto_usd', v_retencion));
      end if;

      begin
        perform interno.emitir_factura(c_vendedores[1 + floor(random() * 2)::int], v_cliente, v_items, v_pagos, false, v_ts);
      exception when others then
        null; -- p. ej. límite de crédito excedido: la venta no se concreta
      end;
    end loop;

    -- 3) Cobranza: algunos clientes abonan sus créditos.
    for c in select * from public.cuentas_por_cobrar
              where tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE' and fecha_emision <= d - 5 loop
      if random() < 0.12 then
        perform interno.registrar_abono(
          c.id, case when random() < 0.5 then round(c.saldo_usd / 2, 2) else c.saldo_usd end,
          (array['efectivo_usd', 'pago_movil', 'transferencia'])[1 + floor(random() * 3)::int],
          null, 'Abono de cliente', d + time '11:30');
      end if;
    end loop;
    -- Cashea liquida lo financiado al vencimiento.
    for c in select * from public.cuentas_por_cobrar
              where tipo = 'CASHEA' and estado = 'PENDIENTE' and fecha_vencimiento <= d loop
      perform interno.registrar_abono(c.id, c.saldo_usd, 'transferencia', 'CASHEA-LIQ', 'Liquidación Cashea', d + time '15:00');
    end loop;

    -- 4) Pagos a proveedores a partir de los 20 días.
    for c in select * from public.cuentas_por_pagar where estado = 'PENDIENTE' and fecha_emision <= d - 20 loop
      if random() < 0.5 then
        perform interno.pagar_cxp(c.id, c.saldo_usd,
          (array['transferencia', 'efectivo_usd'])[1 + floor(random() * 2)::int], null, null, d + time '16:00');
      end if;
    end loop;

    -- 4b) Los clientes entregan su comprobante de retención a los 3 días.
    for c in select * from public.retenciones_iva
              where tipo = 'RECIBIDA' and estado = 'PENDIENTE' and fecha <= d - 3 loop
      perform interno.registrar_comprobante_recibido(
        c.id, to_char(c.fecha, 'YYYYMM') || lpad((10000000 + floor(random() * 89999999))::text, 8, '0'), c.fecha);
    end loop;

    -- 4c) Enteramiento al SENIAT: la 1ra quincena el día 20 y la 2da el día 5 del mes siguiente.
    if extract(day from d) = 20 and exists (select 1 from public.retenciones_iva where tipo = 'EMITIDA' and estado = 'REGISTRADA'
         and anio = extract(year from d) and mes = extract(month from d) and quincena = 1) then
      perform interno.enterar_retenciones_iva(extract(year from d)::int, extract(month from d)::int, 1, 'transferencia', d);
    end if;
    if extract(day from d) = 5 and exists (select 1 from public.retenciones_iva where tipo = 'EMITIDA' and estado = 'REGISTRADA'
         and anio = extract(year from d - 10) and mes = extract(month from d - 10) and quincena = 2) then
      perform interno.enterar_retenciones_iva(extract(year from d - 10)::int, extract(month from d - 10)::int, 2, 'transferencia', d);
    end if;

    -- 5) Gastos fijos: alquiler y servicios el día 1; nómina los días 15 y último.
    if extract(day from d) = 1 then
      perform interno.registrar_asiento(d, 'Alquiler del local ' || to_char(d, 'MM/YYYY'), 'Gastos', jsonb_build_array(
        jsonb_build_object('cuenta_id', v_cuenta ->> '6.1.02.01', 'debe', 650),
        jsonb_build_object('cuenta_id', v_cuenta ->> '1.1.01.04', 'haber', 650)));
      perform interno.registrar_asiento(d, 'Servicios públicos e internet ' || to_char(d, 'MM/YYYY'), 'Gastos', jsonb_build_array(
        jsonb_build_object('cuenta_id', v_cuenta ->> '6.1.02.02', 'debe', 85),
        jsonb_build_object('cuenta_id', v_cuenta ->> '6.1.02.03', 'debe', 45),
        jsonb_build_object('cuenta_id', v_cuenta ->> '1.1.01.04', 'haber', 130)));
    end if;
    if extract(day from d) = 15 or d = (date_trunc('month', d) + interval '1 month - 1 day')::date then
      perform interno.registrar_asiento(d, 'Nómina quincenal ' || to_char(d, 'DD/MM/YYYY'), 'Nómina', jsonb_build_array(
        jsonb_build_object('cuenta_id', v_cuenta ->> '6.1.01.01', 'debe', 720),
        jsonb_build_object('cuenta_id', v_cuenta ->> '6.1.01.02', 'debe', 160),
        jsonb_build_object('cuenta_id', v_cuenta ->> '1.1.01.04', 'haber', 880)));
    end if;
  end loop;

  perform set_config('arluc.fecha_operacion', '', false);

  -- 6) Algunas facturas de contado anuladas (devuelven stock y generan contra-asiento).
  update public.facturas set estado = 'anulada', motivo_anulacion = 'Error de facturación (dato de prueba)'
   where id in (select f.id from public.facturas f
                 where not exists (select 1 from public.cuentas_por_cobrar x where x.factura_id = f.id)
                 order by random() limit 3);
end;
$$;

-- Metas de ventas netas: empresa y cada vendedor, últimos tres meses.
insert into public.metas_ventas (anio, mes, vendedor_id, monto_usd, creada_por)
select extract(year from m)::int, extract(month from m)::int, v.id, v.monto,
       'a0000000-0000-4000-8000-000000000002'
  from generate_series(date_trunc('month', current_date) - interval '2 months', date_trunc('month', current_date), interval '1 month') m
  cross join (values
    (null::uuid, 28000::numeric),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 14000),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 13000)) as v(id, monto);
