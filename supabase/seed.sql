-- =============================================================================
-- ARLUC SIG · Datos de prueba (solo entorno local: `npx supabase db reset`)
-- -----------------------------------------------------------------------------
-- Usuarios de prueba (contraseña común para todos: Arluc.2026)
--   admin@arluc.test        Administrador
--   gerente@arluc.test      Gerente (consulta SIG)
--   contador@arluc.test     Contador
--   vendedor@arluc.test     Vendedor / cajero
--   almacen@arluc.test      Almacenista
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
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'almacen@arluc.test',  'José Ramírez',      'almacenista')
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
    ('almacen@arluc.test', 'almacenista')
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
-- Tasas BCV de los últimos 90 días (tendencia alcista con ruido)
-- -----------------------------------------------------------------------------
insert into public.tasas_cambio (fecha_registro, tasa_usd_bs, tasa_eur_bs, fuente, registrado_por)
select d::date,
       round((420 + (89 - (current_date - d::date)) * 0.9 + sin((current_date - d::date)::numeric) * 1.5)::numeric, 4),
       round(((420 + (89 - (current_date - d::date)) * 0.9) * 1.08)::numeric, 4),
       'BCV',
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
