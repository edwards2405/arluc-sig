-- =============================================================================
-- ARLUC SIG · Migración 1: Esquema base
-- -----------------------------------------------------------------------------
-- Maestros (usuarios, categorías, productos, clientes, proveedores), tasas BCV,
-- facturación, órdenes de compra, kardex de inventario, auditoría y RLS.
--
-- Principios:
--   * La lógica crítica vive en la base de datos (triggers / funciones), no en
--     el navegador.
--   * Nada transaccional se borra: facturas y órdenes cambian de estado.
--   * Todo movimiento de stock queda en el kardex (movimientos_inventario).
--   * Las funciones internas viven en el esquema `interno`, que PostgREST no
--     expone.
-- =============================================================================

-- Hora oficial de Venezuela para now(), current_date y los filtros por fecha.
alter database postgres set timezone to 'America/Caracas';
set timezone to 'America/Caracas';

create extension if not exists pgcrypto with schema extensions;

create schema if not exists interno;
revoke all on schema interno from public, anon, authenticated;

-- Ninguna función nueva queda ejecutable por anon/public salvo GRANT explícito.
alter default privileges in schema public revoke execute on functions from public, anon;

-- -----------------------------------------------------------------------------
-- Usuarios y roles
-- -----------------------------------------------------------------------------
create table public.usuarios (
  id              uuid primary key references auth.users (id) on delete restrict,
  email           text not null unique,
  nombre_completo text not null,
  rol             text not null default 'vendedor'
                  check (rol in ('admin', 'gerente', 'contador', 'vendedor', 'almacenista')),
  activo          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on column public.usuarios.activo is
  'Todo registro nuevo nace inactivo; un administrador lo activa y le asigna rol.';

-- Rol del usuario autenticado (null si no existe o está inactivo).
create or replace function public.rol_actual()
returns text
language sql stable security definer
set search_path = ''
as $$
  select u.rol from public.usuarios u where u.id = auth.uid() and u.activo
$$;

create or replace function public.tiene_rol(variadic p_roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.rol_actual() = any (p_roles), false)
$$;

grant execute on function public.rol_actual() to authenticated;
grant execute on function public.tiene_rol(text[]) to authenticated;

-- Al registrarse en Auth se crea el perfil SIEMPRE como vendedor inactivo.
-- El rol enviado en la metadata se ignora: así nadie puede auto-asignarse admin.
create or replace function interno.crear_perfil_usuario()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.usuarios (id, email, nombre_completo)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre_completo'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger trg_auth_crear_perfil
after insert on auth.users
for each row execute function interno.crear_perfil_usuario();

-- Siempre debe quedar al menos un administrador activo.
create or replace function interno.proteger_ultimo_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.rol = 'admin' and old.activo
     and (tg_op = 'DELETE' or new.rol <> 'admin' or not new.activo)
     and not exists (
       select 1 from public.usuarios
       where rol = 'admin' and activo and id <> old.id
     ) then
    raise exception 'Debe existir al menos un administrador activo en el sistema.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_usuarios_ultimo_admin
before update or delete on public.usuarios
for each row execute function interno.proteger_ultimo_admin();

-- -----------------------------------------------------------------------------
-- Configuración de la empresa (una sola fila: id = 'default')
-- -----------------------------------------------------------------------------
create table public.configuracion_empresa (
  id          text primary key default 'default' check (id = 'default'),
  nombre      text not null default 'COMERCIALIZADORA ARLUC C.A.',
  rif         text not null default 'J-00000000-0',
  direccion   text not null default 'Caracas, Venezuela',
  telefono    text not null default '',
  logo        text not null default '/logo-arluc.jpg',
  slogan      text not null default '¡Gracias por su compra!',
  updated_at  timestamptz not null default now()
);
insert into public.configuracion_empresa (id) values ('default');

-- -----------------------------------------------------------------------------
-- Tasas de cambio BCV
-- -----------------------------------------------------------------------------
create table public.tasas_cambio (
  id              uuid primary key default gen_random_uuid(),
  fecha_registro  date not null unique default current_date,
  tasa_usd_bs     numeric(18, 4) not null check (tasa_usd_bs > 0),
  tasa_eur_bs     numeric(18, 4) check (tasa_eur_bs > 0),
  fuente          text not null default 'BCV',
  registrado_por  uuid references public.usuarios (id) default auth.uid(),
  created_at      timestamptz not null default now()
);

-- Tasa vigente para una fecha: la última registrada en o antes de ese día.
create or replace function public.tasa_vigente(p_fecha date default current_date)
returns numeric
language sql stable
set search_path = ''
as $$
  select t.tasa_usd_bs from public.tasas_cambio t
  where t.fecha_registro <= p_fecha
  order by t.fecha_registro desc
  limit 1
$$;
grant execute on function public.tasa_vigente(date) to authenticated;

-- -----------------------------------------------------------------------------
-- Catálogo
-- -----------------------------------------------------------------------------
create table public.categorias (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  created_at  timestamptz not null default now()
);

create table public.productos (
  id             uuid primary key default gen_random_uuid(),
  sku            text not null unique,
  nombre         text not null,
  descripcion    text,
  categoria_id   uuid references public.categorias (id) on delete set null,
  precio_usd     numeric(14, 2) not null check (precio_usd >= 0),
  costo_usd      numeric(14, 4) not null default 0 check (costo_usd >= 0),
  stock          integer not null default 0 check (stock >= 0),
  stock_minimo   integer not null default 0 check (stock_minimo >= 0),
  exento_iva     boolean not null default false,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on column public.productos.costo_usd is 'Costo promedio ponderado en USD (lo actualizan las compras).';
comment on column public.productos.exento_iva is 'true = producto exento de IVA según la Ley del IVA.';
create index on public.productos (categoria_id);

-- -----------------------------------------------------------------------------
-- Terceros
-- -----------------------------------------------------------------------------
create table public.clientes (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  documento_identidad text not null unique,
  telefono            text,
  email               text,
  direccion           text,
  credito_activo      boolean not null default false,
  linea_credito       numeric(14, 2) not null default 0 check (linea_credito >= 0),
  moneda_credito      text not null default 'usd' check (moneda_credito in ('usd', 'bs')),
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.proveedores (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null,
  rif              text not null unique,
  telefono         text,
  email            text,
  direccion        text,
  contacto_nombre  text,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Correlativos sin huecos (facturas, órdenes, asientos)
-- -----------------------------------------------------------------------------
create table interno.contadores (
  clave text primary key,
  valor bigint not null default 0
);

create or replace function interno.siguiente_valor(p_clave text)
returns bigint
language sql
set search_path = ''
as $$
  insert into interno.contadores as c (clave, valor) values (p_clave, 1)
  on conflict (clave) do update set valor = c.valor + 1
  returning c.valor
$$;

create or replace function public.generar_numero_factura()
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente', 'vendedor') then
    raise exception 'No autorizado para emitir facturas.';
  end if;
  return 'ARLUC-' || lpad(interno.siguiente_valor('factura')::text, 8, '0');
end;
$$;

create or replace function public.generar_numero_orden()
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'almacenista') then
    raise exception 'No autorizado para registrar órdenes de compra.';
  end if;
  return 'OC-' || lpad(interno.siguiente_valor('orden_compra')::text, 6, '0');
end;
$$;

grant execute on function public.generar_numero_factura() to authenticated;
grant execute on function public.generar_numero_orden() to authenticated;

-- -----------------------------------------------------------------------------
-- Facturación
-- -----------------------------------------------------------------------------
create table public.facturas (
  id                uuid primary key default gen_random_uuid(),
  numero_factura    text not null unique,
  cliente_id        uuid references public.clientes (id) on delete restrict,
  vendedor_id       uuid not null references public.usuarios (id) default auth.uid(),
  tasa_id           uuid not null references public.tasas_cambio (id),
  subtotal_usd      numeric(14, 2),
  descuento_usd     numeric(14, 2) not null default 0 check (descuento_usd >= 0),
  total_usd         numeric(14, 2) not null check (total_usd >= 0),
  total_bs          numeric(18, 2) not null check (total_bs >= 0),
  metodos_pago      jsonb not null default '[]'::jsonb,
  estado            text not null default 'emitida' check (estado in ('emitida', 'anulada')),
  fecha_emision     timestamptz not null default now(),
  anulada_por       uuid references public.usuarios (id),
  anulada_en        timestamptz,
  motivo_anulacion  text,
  created_at        timestamptz not null default now()
);
create index on public.facturas (fecha_emision desc);
create index on public.facturas (cliente_id);
create index on public.facturas (vendedor_id);
create index on public.facturas (tasa_id);

create table public.detalles_factura (
  id                   uuid primary key default gen_random_uuid(),
  factura_id           uuid not null references public.facturas (id) on delete restrict,
  producto_id          uuid not null references public.productos (id) on delete restrict,
  producto_nombre      text not null,
  cantidad             integer not null check (cantidad > 0),
  precio_unitario_usd  numeric(14, 2) not null check (precio_unitario_usd >= 0),
  subtotal_usd         numeric(14, 2) generated always as (round(cantidad * precio_unitario_usd, 2)) stored,
  costo_unitario_usd   numeric(14, 4) not null default 0,
  created_at           timestamptz not null default now()
);
create index on public.detalles_factura (factura_id);
create index on public.detalles_factura (producto_id);

-- -----------------------------------------------------------------------------
-- Compras
-- -----------------------------------------------------------------------------
create table public.ordenes_compra (
  id              uuid primary key default gen_random_uuid(),
  numero_orden    text not null unique,
  proveedor_id    uuid not null references public.proveedores (id) on delete restrict,
  registrado_por  uuid not null references public.usuarios (id) default auth.uid(),
  total_usd       numeric(14, 2) not null default 0 check (total_usd >= 0),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'recibida', 'cancelada')),
  notas           text,
  fecha_orden     timestamptz not null default now(),
  recibida_en     timestamptz,
  recibida_por    uuid references public.usuarios (id),
  created_at      timestamptz not null default now()
);
create index on public.ordenes_compra (proveedor_id);
create index on public.ordenes_compra (registrado_por);

create table public.detalles_orden_compra (
  id                   uuid primary key default gen_random_uuid(),
  orden_id             uuid not null references public.ordenes_compra (id) on delete cascade,
  producto_id          uuid not null references public.productos (id) on delete restrict,
  cantidad             integer not null check (cantidad > 0),
  precio_unitario_usd  numeric(14, 4) not null check (precio_unitario_usd >= 0),
  subtotal_usd         numeric(14, 2) generated always as (round(cantidad * precio_unitario_usd, 2)) stored
);
create index on public.detalles_orden_compra (orden_id);
create index on public.detalles_orden_compra (producto_id);

-- -----------------------------------------------------------------------------
-- Kardex de inventario (costo promedio ponderado)
-- -----------------------------------------------------------------------------
create table public.movimientos_inventario (
  id                  uuid primary key default gen_random_uuid(),
  producto_id         uuid not null references public.productos (id) on delete restrict,
  fecha               timestamptz not null default now(),
  tipo                text not null check (tipo in (
                        'INVENTARIO_INICIAL', 'VENTA', 'ANULACION_VENTA', 'COMPRA',
                        'AJUSTE_ENTRADA', 'AJUSTE_SALIDA')),
  cantidad            integer not null check (cantidad <> 0),
  costo_unitario_usd  numeric(14, 4) not null default 0,
  stock_resultante    integer not null,
  costo_promedio_usd  numeric(14, 4) not null,
  referencia_tipo     text,
  referencia_id       uuid,
  usuario_id          uuid references public.usuarios (id) default auth.uid(),
  notas               text
);
comment on column public.movimientos_inventario.cantidad is 'Positivo = entrada, negativo = salida.';
create index on public.movimientos_inventario (producto_id, fecha);
create index on public.movimientos_inventario (referencia_id);

-- Los triggers internos marcan sus cambios de stock con esta bandera para que
-- el trigger de productos no los registre de nuevo como "ajuste manual".
create or replace function interno.mover_stock(
  p_producto_id uuid, p_cantidad integer, p_tipo text,
  p_costo_unitario numeric, p_ref_tipo text, p_ref_id uuid, p_notas text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prod public.productos%rowtype;
  v_nuevo_stock integer;
  v_nuevo_costo numeric(14, 4);
begin
  select * into v_prod from public.productos where id = p_producto_id for update;
  if not found then
    raise exception 'Producto % no existe', p_producto_id;
  end if;

  v_nuevo_stock := v_prod.stock + p_cantidad;
  if v_nuevo_stock < 0 then
    raise exception 'Stock insuficiente para "%": disponible %, solicitado %',
      v_prod.nombre, v_prod.stock, -p_cantidad;
  end if;

  -- Solo las entradas valoradas (compras) recalculan el costo promedio.
  if p_tipo in ('COMPRA', 'INVENTARIO_INICIAL', 'AJUSTE_ENTRADA') and p_cantidad > 0
     and p_costo_unitario > 0 and v_nuevo_stock > 0 then
    v_nuevo_costo := round(
      (v_prod.stock * v_prod.costo_usd + p_cantidad * p_costo_unitario) / v_nuevo_stock, 4);
  else
    v_nuevo_costo := v_prod.costo_usd;
  end if;

  perform set_config('arluc.mov_interno', 'on', true);
  update public.productos
     set stock = v_nuevo_stock, costo_usd = v_nuevo_costo, updated_at = now()
   where id = p_producto_id;
  perform set_config('arluc.mov_interno', 'off', true);

  insert into public.movimientos_inventario (
    producto_id, tipo, cantidad, costo_unitario_usd, stock_resultante,
    costo_promedio_usd, referencia_tipo, referencia_id, notas
  ) values (
    p_producto_id, p_tipo, p_cantidad,
    coalesce(nullif(p_costo_unitario, 0), v_prod.costo_usd),
    v_nuevo_stock, v_nuevo_costo, p_ref_tipo, p_ref_id, p_notas
  );
end;
$$;

-- Altas y ediciones directas de stock desde el formulario de Inventario:
-- no se bloquean, pero quedan registradas en el kardex como ajuste.
create or replace function interno.productos_registrar_ajuste()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.stock > 0 then
      insert into public.movimientos_inventario (
        producto_id, tipo, cantidad, costo_unitario_usd, stock_resultante,
        costo_promedio_usd, referencia_tipo, notas
      ) values (
        new.id, 'INVENTARIO_INICIAL', new.stock, new.costo_usd, new.stock,
        new.costo_usd, 'PRODUCTO', 'Stock inicial al crear el producto'
      );
    end if;
    return null;
  end if;

  if new.stock is distinct from old.stock
     and coalesce(current_setting('arluc.mov_interno', true), 'off') <> 'on' then
    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, costo_unitario_usd, stock_resultante,
      costo_promedio_usd, referencia_tipo, notas
    ) values (
      new.id,
      case when new.stock > old.stock then 'AJUSTE_ENTRADA' else 'AJUSTE_SALIDA' end,
      new.stock - old.stock, new.costo_usd, new.stock, new.costo_usd,
      'AJUSTE_MANUAL', 'Ajuste manual desde el maestro de productos'
    );
  end if;
  return null;
end;
$$;

create trigger trg_productos_kardex
after insert or update of stock on public.productos
for each row execute function interno.productos_registrar_ajuste();

-- -----------------------------------------------------------------------------
-- Reglas de facturación
-- -----------------------------------------------------------------------------
create or replace function interno.facturas_antes_insertar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.subtotal_usd := coalesce(new.subtotal_usd, new.total_usd + new.descuento_usd);
  new.estado := 'emitida';
  -- Desde la app la fecha la pone el servidor; solo procesos internos
  -- (seed, migraciones de datos) pueden registrar fechas históricas.
  if auth.uid() is not null or new.fecha_emision is null then
    new.fecha_emision := now();
  end if;
  new.anulada_por := null;
  new.anulada_en := null;
  return new;
end;
$$;

create trigger trg_facturas_antes_insertar
before insert on public.facturas
for each row execute function interno.facturas_antes_insertar();

-- Una factura emitida es inmutable: solo puede pasar a 'anulada'.
create or replace function interno.facturas_inmutables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las facturas no se eliminan; deben anularse.';
  end if;

  if old.estado = 'anulada' then
    raise exception 'La factura % ya está anulada.', old.numero_factura;
  end if;

  if new.estado <> 'anulada'
     or (to_jsonb(new) - array['estado', 'anulada_por', 'anulada_en', 'motivo_anulacion'])
        is distinct from
        (to_jsonb(old) - array['estado', 'anulada_por', 'anulada_en', 'motivo_anulacion']) then
    raise exception 'La factura % es inmutable; solo puede anularse.', old.numero_factura;
  end if;

  new.anulada_por := auth.uid();
  new.anulada_en := now();
  return new;
end;
$$;

create trigger trg_facturas_inmutables
before update or delete on public.facturas
for each row execute function interno.facturas_inmutables();

-- Anular devuelve el stock al inventario al mismo costo con que salió.
create or replace function interno.facturas_al_anular()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  d record;
begin
  for d in select * from public.detalles_factura where factura_id = new.id loop
    perform interno.mover_stock(
      d.producto_id, d.cantidad, 'ANULACION_VENTA', d.costo_unitario_usd,
      'FACTURA', new.id, 'Anulación ' || new.numero_factura
    );
  end loop;
  return null;
end;
$$;

create trigger trg_facturas_al_anular
after update of estado on public.facturas
for each row when (old.estado = 'emitida' and new.estado = 'anulada')
execute function interno.facturas_al_anular();

-- Cada línea vendida: valida precio contra el maestro, fija el costo y descuenta stock.
create or replace function interno.detalle_factura_antes_insertar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prod public.productos%rowtype;
  v_fact public.facturas%rowtype;
begin
  select * into v_fact from public.facturas where id = new.factura_id;
  if v_fact.estado <> 'emitida' then
    raise exception 'No se pueden agregar líneas a una factura anulada.';
  end if;

  select * into v_prod from public.productos where id = new.producto_id;
  if not v_prod.activo then
    raise exception 'El producto "%" está inactivo.', v_prod.nombre;
  end if;
  if abs(new.precio_unitario_usd - v_prod.precio_usd) > 0.005 then
    raise exception 'Precio de "%" no coincide con el maestro (% USD).', v_prod.nombre, v_prod.precio_usd;
  end if;

  new.producto_nombre := v_prod.nombre;
  new.costo_unitario_usd := v_prod.costo_usd;

  perform interno.mover_stock(
    new.producto_id, -new.cantidad, 'VENTA', v_prod.costo_usd,
    'FACTURA', new.factura_id, 'Venta ' || v_fact.numero_factura
  );
  return new;
end;
$$;

create trigger trg_detalle_factura_antes_insertar
before insert on public.detalles_factura
for each row execute function interno.detalle_factura_antes_insertar();

create or replace function interno.detalles_inmutables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Las líneas de % no se modifican ni se eliminan.', tg_table_name;
end;
$$;

create trigger trg_detalles_factura_inmutables
before update or delete on public.detalles_factura
for each row execute function interno.detalles_inmutables();

-- -----------------------------------------------------------------------------
-- Reglas de órdenes de compra
-- -----------------------------------------------------------------------------
create or replace function interno.ordenes_cambio_estado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'pendiente' then
      raise exception 'Solo se pueden eliminar órdenes pendientes.';
    end if;
    return old;
  end if;

  if old.estado <> 'pendiente' then
    raise exception 'La orden % ya está %; no admite cambios.', old.numero_orden, old.estado;
  end if;

  if new.estado = 'recibida' then
    new.recibida_en := now();
    new.recibida_por := auth.uid();
  end if;
  return new;
end;
$$;

create trigger trg_ordenes_cambio_estado
before update or delete on public.ordenes_compra
for each row execute function interno.ordenes_cambio_estado();

-- Recibir la orden: entra stock al costo de compra (recalcula costo promedio).
create or replace function interno.ordenes_al_recibir()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  d record;
begin
  for d in select * from public.detalles_orden_compra where orden_id = new.id loop
    perform interno.mover_stock(
      d.producto_id, d.cantidad, 'COMPRA', d.precio_unitario_usd,
      'ORDEN_COMPRA', new.id, 'Recepción ' || new.numero_orden
    );
  end loop;
  return null;
end;
$$;

create trigger trg_ordenes_al_recibir
after update of estado on public.ordenes_compra
for each row when (old.estado = 'pendiente' and new.estado = 'recibida')
execute function interno.ordenes_al_recibir();

-- Los detalles solo se tocan mientras la orden está pendiente.
create or replace function interno.detalles_orden_editables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select estado from public.ordenes_compra
       where id = coalesce(new.orden_id, old.orden_id)) <> 'pendiente' then
    raise exception 'La orden ya no está pendiente; sus líneas no se modifican.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_detalles_orden_editables
before insert or update or delete on public.detalles_orden_compra
for each row execute function interno.detalles_orden_editables();

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function interno.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_productos_updated before update on public.productos
for each row execute function interno.tocar_updated_at();
create trigger trg_clientes_updated before update on public.clientes
for each row execute function interno.tocar_updated_at();
create trigger trg_proveedores_updated before update on public.proveedores
for each row execute function interno.tocar_updated_at();
create trigger trg_config_empresa_updated before update on public.configuracion_empresa
for each row execute function interno.tocar_updated_at();

-- -----------------------------------------------------------------------------
-- Bitácora de auditoría
-- -----------------------------------------------------------------------------
create table public.auditoria (
  id               bigint generated always as identity primary key,
  fecha            timestamptz not null default now(),
  usuario_id       uuid default auth.uid(),
  tabla            text not null,
  registro_id      text,
  accion           text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  datos_anteriores jsonb,
  datos_nuevos     jsonb
);
create index on public.auditoria (tabla, fecha desc);
create index on public.auditoria (usuario_id, fecha desc);

create or replace function interno.registrar_auditoria()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;
  insert into public.auditoria (tabla, registro_id, accion, datos_anteriores, datos_nuevos)
  values (tg_table_name, coalesce(v_new, v_old) ->> 'id', tg_op, v_old, v_new);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'usuarios', 'configuracion_empresa', 'tasas_cambio', 'categorias', 'productos',
    'clientes', 'proveedores', 'facturas', 'ordenes_compra'
  ] loop
    execute format(
      'create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$I
       for each row execute function interno.registrar_auditoria()', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Eliminación de usuarios: solo si no tienen operaciones; si no, se desactivan.
-- -----------------------------------------------------------------------------
create or replace function public.eliminar_usuario(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin') then
    raise exception 'Solo un administrador puede eliminar usuarios.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'No puede eliminar su propia cuenta.';
  end if;
  if exists (select 1 from public.facturas where vendedor_id = p_user_id or anulada_por = p_user_id)
     or exists (select 1 from public.ordenes_compra where registrado_por = p_user_id)
     or exists (select 1 from public.tasas_cambio where registrado_por = p_user_id)
     or exists (select 1 from public.movimientos_inventario where usuario_id = p_user_id) then
    raise exception 'El usuario tiene operaciones registradas y no puede eliminarse. Desactívelo para conservar la trazabilidad.';
  end if;

  delete from public.usuarios where id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$$;
grant execute on function public.eliminar_usuario(uuid) to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.usuarios               enable row level security;
alter table public.configuracion_empresa  enable row level security;
alter table public.tasas_cambio           enable row level security;
alter table public.categorias             enable row level security;
alter table public.productos              enable row level security;
alter table public.clientes               enable row level security;
alter table public.proveedores            enable row level security;
alter table public.facturas               enable row level security;
alter table public.detalles_factura       enable row level security;
alter table public.ordenes_compra         enable row level security;
alter table public.detalles_orden_compra  enable row level security;
alter table public.movimientos_inventario enable row level security;
alter table public.auditoria              enable row level security;

-- usuarios: cada quien ve su perfil; el personal activo ve la lista; solo admin modifica.
create policy usuarios_select on public.usuarios for select to authenticated
  using (id = (select auth.uid()) or (select public.rol_actual()) is not null);
create policy usuarios_update on public.usuarios for update to authenticated
  using ((select public.tiene_rol('admin')))
  with check ((select public.tiene_rol('admin')));

-- configuración de empresa
create policy config_empresa_select on public.configuracion_empresa for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy config_empresa_write on public.configuracion_empresa for all to authenticated
  using ((select public.tiene_rol('admin')))
  with check ((select public.tiene_rol('admin')));

-- tasas: todo el personal las lee y puede registrar la del día; corregir otras fechas es de admin.
create policy tasas_select on public.tasas_cambio for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy tasas_insert on public.tasas_cambio for insert to authenticated
  with check ((select public.tiene_rol('admin'))
              or ((select public.rol_actual()) is not null and fecha_registro = current_date));
create policy tasas_update on public.tasas_cambio for update to authenticated
  using ((select public.tiene_rol('admin'))
         or ((select public.rol_actual()) is not null and fecha_registro = current_date))
  with check ((select public.tiene_rol('admin'))
              or ((select public.rol_actual()) is not null and fecha_registro = current_date));

-- catálogo
create policy categorias_select on public.categorias for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy categorias_write on public.categorias for all to authenticated
  using ((select public.tiene_rol('admin', 'almacenista')))
  with check ((select public.tiene_rol('admin', 'almacenista')));

create policy productos_select on public.productos for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy productos_write on public.productos for all to authenticated
  using ((select public.tiene_rol('admin', 'almacenista')))
  with check ((select public.tiene_rol('admin', 'almacenista')));

-- clientes: el personal de ventas los crea y edita; solo admin los elimina.
create policy clientes_select on public.clientes for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy clientes_insert on public.clientes for insert to authenticated
  with check ((select public.tiene_rol('admin', 'gerente', 'vendedor')));
create policy clientes_update on public.clientes for update to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'vendedor')))
  with check ((select public.tiene_rol('admin', 'gerente', 'vendedor')));
create policy clientes_delete on public.clientes for delete to authenticated
  using ((select public.tiene_rol('admin')));

-- Las condiciones de crédito solo las cambia admin o gerente.
create or replace function interno.clientes_proteger_credito()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.credito_activo, new.linea_credito, new.moneda_credito)
       is distinct from
     (case when tg_op = 'UPDATE' then old.credito_activo else false end,
      case when tg_op = 'UPDATE' then old.linea_credito else 0 end,
      case when tg_op = 'UPDATE' then old.moneda_credito else 'usd' end)
     and auth.uid() is not null
     and not public.tiene_rol('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede modificar las condiciones de crédito.';
  end if;
  return new;
end;
$$;

create trigger trg_clientes_proteger_credito
before insert or update on public.clientes
for each row execute function interno.clientes_proteger_credito();

-- proveedores y compras
create policy proveedores_select on public.proveedores for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador', 'almacenista')));
create policy proveedores_write on public.proveedores for all to authenticated
  using ((select public.tiene_rol('admin', 'almacenista')))
  with check ((select public.tiene_rol('admin', 'almacenista')));

create policy ordenes_select on public.ordenes_compra for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador', 'almacenista')));
create policy ordenes_write on public.ordenes_compra for all to authenticated
  using ((select public.tiene_rol('admin', 'almacenista')))
  with check ((select public.tiene_rol('admin', 'almacenista')));

create policy detalles_orden_select on public.detalles_orden_compra for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador', 'almacenista')));
create policy detalles_orden_write on public.detalles_orden_compra for all to authenticated
  using ((select public.tiene_rol('admin', 'almacenista')))
  with check ((select public.tiene_rol('admin', 'almacenista')));

-- facturas: todo el personal activo consulta; el vendedor emite a su nombre;
-- anular es de admin o gerente.
create policy facturas_select on public.facturas for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy facturas_insert on public.facturas for insert to authenticated
  with check ((select public.tiene_rol('admin', 'gerente', 'vendedor'))
              and vendedor_id = (select auth.uid()));
create policy facturas_update on public.facturas for update to authenticated
  using ((select public.tiene_rol('admin', 'gerente')))
  with check ((select public.tiene_rol('admin', 'gerente')));

create policy detalles_factura_select on public.detalles_factura for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy detalles_factura_insert on public.detalles_factura for insert to authenticated
  with check (exists (
    select 1 from public.facturas f
    where f.id = factura_id
      and f.vendedor_id = (select auth.uid())
      and f.created_at > now() - interval '10 minutes'
  ));

-- kardex y auditoría: solo lectura para perfiles de control.
create policy kardex_select on public.movimientos_inventario for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador', 'almacenista')));
create policy auditoria_select on public.auditoria for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente')));

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
