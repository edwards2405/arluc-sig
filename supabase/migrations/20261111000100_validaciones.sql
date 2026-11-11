-- =============================================================================
-- ARLUC SIG · Migración 11: Validaciones de datos y reglas de negocio
-- -----------------------------------------------------------------------------
-- Corrige los hallazgos [BD] de la auditoría de validaciones:
--   * Maestros: cédula/RIF, teléfono y correo normalizados y con formato;
--     SKU y categoría normalizados; textos obligatorios sin "solo espacios";
--     precio de venta > 0; costo > 0 cuando hay stock (1 trigger BEFORE por
--     tabla que normaliza y valida con mensajes claros + CHECK de respaldo).
--   * Contabilidad: asientos manuales sin cuentas de control ni fechas
--     futuras; solo se anulan asientos manuales; el plan de cuentas no
--     desactiva cuentas mapeadas o con saldo.
--   * Ventas: toda factura nueva con cliente; referencia bancaria obligatoria;
--     monto en Bs coherente con la tasa; motivo de anulación ≥ 10 caracteres.
--   * Compras: IVA por línea (exentos), factura del proveedor obligatoria y
--     única por proveedor, costo > 0 y alta siempre en estado pendiente.
--   * Notas, retenciones, tasa BCV, configuración, metas, usuarios y rangos de
--     fechas de los reportes.
-- Los mensajes de error se muestran tal cual en la aplicación: van en español.
--
-- Datos existentes: las CHECK nuevas se agregan NOT VALID y luego se intenta
-- validarlas; si algún dato histórico no las cumple quedan NOT VALID (rigen
-- para datos nuevos) y la migración no falla. La regla "toda factura con
-- cliente" queda NOT VALID a propósito: las facturas históricas de consumidor
-- final se respetan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------

-- Ejecuta DDL que puede fallar por datos históricos (deja un aviso, no aborta).
create or replace function interno.intentar_ddl(p_sql text, p_aviso text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
exception when others then
  raise notice '%: %', p_aviso, sqlerrm;
end;
$$;

-- Texto sin espacios sobrantes (null si queda vacío).
create or replace function interno.texto_limpio(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(p, '[[:space:]]+', ' ', 'g')), '')
$$;

-- Cédula o RIF: mayúsculas, sin espacios ni puntos y con guiones (igual que
-- src/utils/validaciones.js). "v12.345.678" → "V-12345678"; "j501234567" → "J-50123456-7".
create or replace function interno.normalizar_documento(p text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_limpio text := upper(regexp_replace(coalesce(p, ''), '[[:space:]._-]', '', 'g'));
  v_num text;
begin
  if p is null then
    return null;
  end if;
  if v_limpio !~ '^[VEJGP][0-9]+$' then
    return nullif(upper(btrim(p)), '');
  end if;
  v_num := substr(v_limpio, 2);
  -- 9 dígitos = RIF: 8 dígitos + dígito verificador
  if length(v_num) = 9 then
    return left(v_limpio, 1) || '-' || left(v_num, 8) || '-' || right(v_num, 1);
  end if;
  return left(v_limpio, 1) || '-' || v_num;
end;
$$;

-- Teléfono venezolano: 0412-1234567, 0212-1234567 o +58 412 1234567 → 0412-1234567.
create or replace function interno.normalizar_telefono(p text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_dig text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if nullif(btrim(p), '') is null then
    return null;
  end if;
  if v_dig like '58%' and length(v_dig) = 12 then
    v_dig := '0' || substr(v_dig, 3);
  end if;
  if v_dig ~ '^0[0-9]{10}$' then
    return left(v_dig, 4) || '-' || substr(v_dig, 5);
  end if;
  return btrim(p);
end;
$$;

-- Referencia bancaria: obligatoria para transferencia, pago móvil, punto de
-- venta y Zelle (4 a 30 letras, números o guiones). Devuelve el valor limpio.
create or replace function interno.validar_referencia(p_metodo text, p_referencia text, p_contexto text default null)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_ref text := nullif(btrim(p_referencia), '');
  v_medio text := case p_metodo when 'transferencia' then 'transferencia' when 'pago_movil' then 'pago móvil'
                                when 'punto_venta' then 'punto de venta' when 'zelle' then 'Zelle' end;
begin
  if v_medio is null then
    return v_ref;
  end if;
  if v_ref is null then
    raise exception 'Indique la referencia del pago por % (%).', v_medio, coalesce(p_contexto, 'número de operación');
  end if;
  if v_ref !~ '^[A-Za-z0-9-]{4,30}$' then
    raise exception 'Referencia de % inválida: «%». Use de 4 a 30 letras, números o guiones.', v_medio, v_ref;
  end if;
  return v_ref;
end;
$$;

-- Rango de fechas de reportes: "desde" no puede ser posterior a "hasta".
create or replace function interno.validar_rango(p_desde date, p_hasta date)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'Rango de fechas inválido: la fecha «desde» (%) es posterior a «hasta» (%).',
      to_char(p_desde, 'DD/MM/YYYY'), to_char(p_hasta, 'DD/MM/YYYY');
  end if;
end;
$$;

-- Motivo de anulación: al menos 10 caracteres sin contar espacios sobrantes.
create or replace function interno.validar_motivo(p_motivo text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_motivo text := interno.texto_limpio(p_motivo);
begin
  if coalesce(length(v_motivo), 0) < 10 then
    raise exception 'Indique el motivo de la anulación (mínimo 10 caracteres).';
  end if;
  return v_motivo;
end;
$$;

-- =============================================================================
-- Maestros
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clientes (hallazgos 11, 27, 29, 34)
-- -----------------------------------------------------------------------------
create or replace function interno.clientes_validar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.nombre := interno.texto_limpio(new.nombre);
  if new.nombre is null then
    raise exception 'El nombre del cliente es obligatorio.';
  end if;

  new.documento_identidad := interno.normalizar_documento(new.documento_identidad);
  if new.documento_identidad is null then
    raise exception 'La cédula o RIF del cliente es obligatorio.';
  end if;
  if new.documento_identidad !~ '^[VEJGP]-[0-9]{6,9}(-[0-9])?$' then
    raise exception 'Cédula o RIF inválido: «%». Use el formato V-12345678 o J-12345678-9.', new.documento_identidad;
  end if;
  if new.contribuyente_especial and new.documento_identidad !~ '^[JG]-[0-9]{8}-[0-9]$' then
    raise exception 'Solo un cliente con RIF jurídico o de gobierno (J-12345678-9 o G-12345678-9) puede ser contribuyente especial.';
  end if;

  new.telefono := interno.normalizar_telefono(new.telefono);
  if new.telefono is not null and new.telefono !~ '^0[0-9]{3}-[0-9]{7}$' then
    raise exception 'Teléfono inválido: «%». Use el formato 0414-1234567.', new.telefono;
  end if;
  new.email := nullif(lower(btrim(new.email)), '');
  if new.email is not null and new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'Correo electrónico inválido: «%».', new.email;
  end if;
  new.direccion := interno.texto_limpio(new.direccion);

  if (tg_op = 'INSERT' or new.documento_identidad is distinct from old.documento_identidad)
     and exists (select 1 from public.clientes where documento_identidad = new.documento_identidad and id <> new.id) then
    raise exception 'Ya existe un cliente registrado con la cédula o RIF %.', new.documento_identidad;
  end if;
  return new;
end;
$$;

create trigger trg_clientes_validar
before insert or update on public.clientes
for each row execute function interno.clientes_validar();

-- Crédito: solo admin o gerente. Datos fiscales (contribuyente especial y %
-- de retención): solo admin, gerente o contador.
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
  if (new.contribuyente_especial, new.porcentaje_retencion_iva)
       is distinct from
     (case when tg_op = 'UPDATE' then old.contribuyente_especial else false end,
      case when tg_op = 'UPDATE' then old.porcentaje_retencion_iva else 75 end)
     and auth.uid() is not null
     and not public.tiene_rol('admin', 'gerente', 'contador') then
    raise exception 'Solo un administrador, gerente o contador puede marcar al cliente como contribuyente especial o cambiar su porcentaje de retención.';
  end if;
  return new;
end;
$$;

alter table public.clientes
  add constraint clientes_nombre_obligatorio check (length(btrim(nombre)) > 0) not valid,
  add constraint clientes_documento_formato check (documento_identidad ~ '^[VEJGP]-[0-9]{6,9}(-[0-9])?$') not valid,
  add constraint clientes_telefono_formato check (telefono is null or telefono ~ '^0[0-9]{3}-[0-9]{7}$') not valid,
  add constraint clientes_email_formato check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$') not valid,
  add constraint clientes_contribuyente_rif check (not contribuyente_especial or documento_identidad ~ '^[JG]-[0-9]{8}-[0-9]$') not valid;

-- -----------------------------------------------------------------------------
-- Proveedores (hallazgos 28, 29, 34)
-- -----------------------------------------------------------------------------
create or replace function interno.proveedores_validar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.nombre := interno.texto_limpio(new.nombre);
  if new.nombre is null then
    raise exception 'El nombre o razón social del proveedor es obligatorio.';
  end if;

  new.rif := interno.normalizar_documento(new.rif);
  if new.rif is null then
    raise exception 'El RIF del proveedor es obligatorio.';
  end if;
  if new.rif !~ '^[VEJGP]-[0-9]{8}-[0-9]$' then
    raise exception 'RIF del proveedor inválido: «%». Use el formato J-12345678-9 (8 dígitos y el verificador).', new.rif;
  end if;

  new.telefono := interno.normalizar_telefono(new.telefono);
  if new.telefono is not null and new.telefono !~ '^0[0-9]{3}-[0-9]{7}$' then
    raise exception 'Teléfono inválido: «%». Use el formato 0212-1234567.', new.telefono;
  end if;
  new.email := nullif(lower(btrim(new.email)), '');
  if new.email is not null and new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'Correo electrónico inválido: «%».', new.email;
  end if;
  new.direccion := interno.texto_limpio(new.direccion);
  new.contacto_nombre := interno.texto_limpio(new.contacto_nombre);

  if (tg_op = 'INSERT' or new.rif is distinct from old.rif)
     and exists (select 1 from public.proveedores where rif = new.rif and id <> new.id) then
    raise exception 'Ya existe un proveedor registrado con el RIF %.', new.rif;
  end if;
  return new;
end;
$$;

create trigger trg_proveedores_validar
before insert or update on public.proveedores
for each row execute function interno.proveedores_validar();

alter table public.proveedores
  add constraint proveedores_nombre_obligatorio check (length(btrim(nombre)) > 0) not valid,
  add constraint proveedores_rif_formato check (rif ~ '^[VEJGP]-[0-9]{8}-[0-9]$') not valid,
  add constraint proveedores_telefono_formato check (telefono is null or telefono ~ '^0[0-9]{3}-[0-9]{7}$') not valid,
  add constraint proveedores_email_formato check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$') not valid;

-- -----------------------------------------------------------------------------
-- Categorías (hallazgos 33, 34)
-- -----------------------------------------------------------------------------
create or replace function interno.categorias_validar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.nombre := interno.texto_limpio(new.nombre);
  if new.nombre is null then
    raise exception 'El nombre de la categoría es obligatorio.';
  end if;
  new.descripcion := interno.texto_limpio(new.descripcion);
  if exists (select 1 from public.categorias where lower(nombre) = lower(new.nombre) and id <> new.id) then
    raise exception 'Ya existe la categoría «%».', new.nombre;
  end if;
  return new;
end;
$$;

create trigger trg_categorias_validar
before insert or update on public.categorias
for each row execute function interno.categorias_validar();

alter table public.categorias
  add constraint categorias_nombre_obligatorio check (length(btrim(nombre)) > 0) not valid;

-- -----------------------------------------------------------------------------
-- Productos (hallazgos 6, 7, 32, 33, 34)
-- -----------------------------------------------------------------------------
-- * SKU en mayúsculas y sin espacios en los extremos; nombre obligatorio.
-- * Precio de venta > 0.
-- * Stock inicial o entrada manual de stock exige costo > 0 (si no, el
--   inventario entra a costo cero y sin asiento).
-- * El costo promedio solo lo cambia interno.mover_stock (compras); la
--   condición de exento de IVA solo la cambia un administrador o contador.
create or replace function interno.productos_validar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_interno boolean := coalesce(current_setting('arluc.mov_interno', true), 'off') = 'on';
begin
  new.sku := upper(btrim(new.sku));
  if coalesce(new.sku, '') = '' then
    raise exception 'El SKU del producto es obligatorio.';
  end if;
  new.nombre := interno.texto_limpio(new.nombre);
  if new.nombre is null then
    raise exception 'El nombre del producto es obligatorio.';
  end if;
  new.descripcion := interno.texto_limpio(new.descripcion);
  if new.precio_usd is null or new.precio_usd <= 0 then
    raise exception 'El precio de venta de «%» debe ser mayor a cero.', new.nombre;
  end if;

  if (tg_op = 'INSERT' or new.sku is distinct from old.sku)
     and exists (select 1 from public.productos where upper(btrim(sku)) = new.sku and id <> new.id) then
    raise exception 'Ya existe un producto con el SKU %.', new.sku;
  end if;

  if tg_op = 'INSERT' then
    if new.stock > 0 and coalesce(new.costo_usd, 0) <= 0 then
      raise exception 'Para registrar stock inicial de «%» indique su costo unitario (mayor a cero).', new.nombre;
    end if;
    return new;
  end if;

  if not v_interno and auth.uid() is not null then
    if new.costo_usd is distinct from old.costo_usd then
      raise exception 'El costo promedio de «%» no se edita: lo actualizan las compras recibidas.', new.nombre;
    end if;
    if new.exento_iva is distinct from old.exento_iva and not public.tiene_rol('admin', 'contador') then
      raise exception 'Solo un administrador o contador puede cambiar la condición de exento de IVA de un producto.';
    end if;
    if new.stock > old.stock and new.costo_usd <= 0 then
      raise exception '«%» no tiene costo registrado: ingrese la mercancía con una orden de compra.', new.nombre;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_productos_validar
before insert or update on public.productos
for each row execute function interno.productos_validar();

alter table public.productos
  add constraint productos_nombre_obligatorio check (length(btrim(nombre)) > 0) not valid,
  add constraint productos_sku_normalizado check (sku = upper(btrim(sku)) and sku <> '') not valid,
  add constraint productos_precio_positivo check (precio_usd > 0) not valid;

-- -----------------------------------------------------------------------------
-- Configuración de la empresa (hallazgo 17)
-- -----------------------------------------------------------------------------
create or replace function interno.configuracion_empresa_validar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.nombre := interno.texto_limpio(new.nombre);
  if new.nombre is null then
    raise exception 'El nombre (razón social) de la empresa es obligatorio.';
  end if;
  new.rif := interno.normalizar_documento(new.rif);
  if coalesce(new.rif, '') !~ '^[VEJGP]-[0-9]{8}-[0-9]$' then
    raise exception 'RIF de la empresa inválido: «%». Use el formato J-12345678-9.', new.rif;
  end if;
  if tg_op = 'UPDATE' and new.rif = 'J-00000000-0' and new.rif is distinct from old.rif then
    raise exception 'Indique el RIF real de la empresa (J-00000000-0 es solo un valor de ejemplo).';
  end if;
  new.url_api_bcv := btrim(new.url_api_bcv);
  if new.url_api_bcv !~ '^https://' then
    raise exception 'La dirección de la API de la tasa BCV debe comenzar con https://.';
  end if;

  -- Los datos fiscales solo los cambia un administrador.
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.tiene_rol('admin')
     and (new.nombre, new.rif, new.contribuyente_especial, new.alicuota_iva, new.alicuota_igtf,
          new.url_api_bcv, new.mes_cierre_ejercicio)
         is distinct from
         (old.nombre, old.rif, old.contribuyente_especial, old.alicuota_iva, old.alicuota_igtf,
          old.url_api_bcv, old.mes_cierre_ejercicio) then
    raise exception 'Solo un administrador puede cambiar los datos fiscales de la empresa (razón social, RIF, contribuyente especial, alícuotas de IVA e IGTF, API BCV y mes de cierre).';
  end if;
  return new;
end;
$$;

create trigger trg_config_empresa_validar
before insert or update on public.configuracion_empresa
for each row execute function interno.configuracion_empresa_validar();

alter table public.configuracion_empresa
  add constraint configuracion_empresa_nombre_obligatorio check (length(btrim(nombre)) > 0) not valid,
  add constraint configuracion_empresa_rif_formato check (rif ~ '^[VEJGP]-[0-9]{8}-[0-9]$') not valid,
  add constraint configuracion_empresa_url_bcv check (url_api_bcv ~ '^https://') not valid;

-- -----------------------------------------------------------------------------
-- Plan de cuentas (hallazgos 19, 34)
-- -----------------------------------------------------------------------------
-- Además de la coherencia del árbol: una cuenta usada por la contabilización
-- automática o con saldo no se desactiva ni se convierte en agrupación.
create or replace function interno.plan_cuentas_validar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_padre public.plan_cuentas%rowtype;
  v_uso text;
begin
  new.nombre := interno.texto_limpio(new.nombre);
  if new.nombre is null then
    raise exception 'El nombre de la cuenta es obligatorio.';
  end if;

  if new.cuenta_padre_id is not null then
    select * into v_padre from public.plan_cuentas where id = new.cuenta_padre_id;
    if not v_padre.es_padre then
      raise exception 'La cuenta padre % no es una cuenta de agrupación.', v_padre.codigo;
    end if;
    if v_padre.tipo <> new.tipo then
      raise exception 'La cuenta % debe ser del mismo tipo que su padre (%).', new.codigo, v_padre.tipo;
    end if;
    if new.codigo not like v_padre.codigo || '.%' then
      raise exception 'El código % debe comenzar con el código del padre (%).', new.codigo, v_padre.codigo;
    end if;
  elsif position('.' in new.codigo) > 0 then
    raise exception 'La cuenta % debe tener una cuenta padre.', new.codigo;
  end if;

  if tg_op = 'UPDATE' then
    if new.codigo <> old.codigo then
      raise exception 'El código de una cuenta no se modifica; cree una nueva y desactive la anterior.';
    end if;
    if (new.tipo, new.naturaleza, new.es_padre) is distinct from (old.tipo, old.naturaleza, old.es_padre)
       and exists (select 1 from public.lineas_asiento where cuenta_id = new.id) then
      raise exception 'La cuenta % tiene movimientos: no puede cambiar tipo, naturaleza ni agrupación.', new.codigo;
    end if;

    if (old.activo and not new.activo) or (not old.es_padre and new.es_padre) then
      select coalesce(
               (select 'la contabilización automática (' || string_agg(clave, ', ') || ')'
                  from public.configuracion_contable where cuenta_id = new.id),
               (select 'el medio de pago ' || string_agg(metodo_id, ', ')
                  from public.metodos_pago_contables where cuenta_id = new.id))
        into v_uso;
      if v_uso is not null then
        raise exception 'La cuenta % - % la usa %; no puede desactivarse ni convertirse en agrupación.',
          new.codigo, new.nombre, v_uso;
      end if;
      if exists (select 1 from public.lineas_asiento where cuenta_id = new.id
                 having sum(debe - haber) <> 0 or sum(debe_ves - haber_ves) <> 0) then
        raise exception 'La cuenta % - % tiene saldo; trasládelo a otra cuenta antes de desactivarla.', new.codigo, new.nombre;
      end if;
    end if;
  end if;
  return new;
end;
$$;

alter table public.plan_cuentas
  add constraint plan_cuentas_nombre_obligatorio check (length(btrim(nombre)) > 0) not valid;

-- -----------------------------------------------------------------------------
-- Normalización de los datos ya cargados (documentos, teléfonos, SKU...).
-- Cada fila se actualiza por separado: si una no puede normalizarse (formato
-- irrecuperable o duplicado) se informa y se deja como está.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.clientes
            where documento_identidad is distinct from interno.normalizar_documento(documento_identidad)
               or telefono is distinct from interno.normalizar_telefono(telefono)
               or email is distinct from nullif(lower(btrim(email)), '')
               or nombre is distinct from interno.texto_limpio(nombre) loop
    begin
      update public.clientes set nombre = nombre where id = r.id;
    exception when others then
      raise notice 'Cliente % sin normalizar: %', r.id, sqlerrm;
    end;
  end loop;

  for r in select id from public.proveedores
            where rif is distinct from interno.normalizar_documento(rif)
               or telefono is distinct from interno.normalizar_telefono(telefono)
               or email is distinct from nullif(lower(btrim(email)), '')
               or nombre is distinct from interno.texto_limpio(nombre) loop
    begin
      update public.proveedores set nombre = nombre where id = r.id;
    exception when others then
      raise notice 'Proveedor % sin normalizar: %', r.id, sqlerrm;
    end;
  end loop;

  for r in select id from public.productos
            where sku is distinct from upper(btrim(sku)) or nombre is distinct from interno.texto_limpio(nombre) loop
    begin
      update public.productos set nombre = nombre where id = r.id;
    exception when others then
      raise notice 'Producto % sin normalizar: %', r.id, sqlerrm;
    end;
  end loop;

  for r in select id from public.categorias where nombre is distinct from interno.texto_limpio(nombre) loop
    begin
      update public.categorias set nombre = nombre where id = r.id;
    exception when others then
      raise notice 'Categoría % sin normalizar: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- Unicidad sin distinguir mayúsculas ni espacios (hallazgo 33).
select interno.intentar_ddl(
  'create unique index productos_sku_unico on public.productos (upper(btrim(sku)))',
  'Índice productos_sku_unico no creado (SKU duplicados en datos históricos)');
select interno.intentar_ddl(
  'create unique index categorias_nombre_unico on public.categorias (lower(btrim(nombre)))',
  'Índice categorias_nombre_unico no creado (categorías duplicadas en datos históricos)');

-- =============================================================================
-- Contabilidad
-- =============================================================================

-- Cuentas de control (hallazgo 2): las mueven solo los documentos (facturas,
-- compras, cobros, pagos, retenciones, cierre). Caja, bancos, capital,
-- reservas, gastos y diferencial cambiario sí admiten asientos manuales.
create or replace function interno.es_cuenta_control(p_cuenta_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.configuracion_contable
     where cuenta_id = p_cuenta_id
       and clave in ('CTA_CXC_CLIENTES', 'CTA_CXC_CASHEA', 'CTA_CXP_PROVEEDORES', 'CTA_INVENTARIO',
                     'CTA_IVA_CREDITO', 'CTA_IVA_DEBITO', 'CTA_IGTF_POR_PAGAR', 'CTA_IVA_RETENIDO_CLIENTE',
                     'CTA_IVA_RETENIDO_POR_ENTERAR', 'CTA_ANTICIPO_CLIENTES', 'CTA_VENTAS_GRAVADAS',
                     'CTA_VENTAS_EXENTAS', 'CTA_COSTO_VENTAS', 'CTA_RESULTADO_EJERCICIO'))
$$;

-- Cuentas que el formulario del Libro Diario puede ofrecer (misma regla que la BD).
create or replace function public.cuentas_asiento_manual()
returns table (id uuid, codigo text, nombre text, tipo text, naturaleza text)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.codigo, c.nombre, c.tipo, c.naturaleza
    from public.plan_cuentas c
   where public.tiene_rol('admin', 'gerente', 'contador')
     and not c.es_padre and c.activo
     and not interno.es_cuenta_control(c.id)
   order by c.codigo
$$;
grant execute on function public.cuentas_asiento_manual() to authenticated;

-- Asientos manuales (hallazgos 2 y 18): sin cuentas de control, sin módulos
-- Ventas/Compras (esos asientos los generan los documentos) y sin fechas futuras.
create or replace function public.crear_asiento(p_fecha date, p_glosa text, p_modulo text, p_lineas jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cuenta public.plan_cuentas%rowtype;
begin
  if not public.tiene_rol('admin', 'contador') then
    raise exception 'Solo un administrador o contador puede registrar asientos manuales.';
  end if;
  if p_fecha is null then
    raise exception 'Indique la fecha del asiento.';
  end if;
  if p_fecha > current_date then
    raise exception 'La fecha del asiento (%) no puede ser futura.', to_char(p_fecha, 'DD/MM/YYYY');
  end if;
  if interno.texto_limpio(p_glosa) is null then
    raise exception 'Indique la glosa (descripción) del asiento.';
  end if;
  if p_modulo is null or p_modulo not in ('Manual', 'Tesorería', 'Gastos', 'Ajuste', 'Nómina') then
    raise exception 'El origen "%" no está permitido para asientos manuales (use Manual, Tesorería, Gastos, Ajuste o Nómina).', p_modulo;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Un asiento requiere al menos dos líneas.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) e
              where e ? 'cuenta_clave' or e ? 'debe_ves' or e ? 'haber_ves') then
    raise exception 'Los asientos manuales indican cuenta_id, debe y haber en USD.';
  end if;
  for v_cuenta in
    select c.* from jsonb_array_elements(p_lineas) e
      join public.plan_cuentas c on c.id = (e ->> 'cuenta_id')::uuid
  loop
    if interno.es_cuenta_control(v_cuenta.id) then
      raise exception 'La cuenta % - % es de control: solo la mueven los documentos (facturas, compras, cobros, pagos y retenciones). No admite asientos manuales.',
        v_cuenta.codigo, v_cuenta.nombre;
    end if;
  end loop;
  return interno.registrar_asiento(p_fecha, interno.texto_limpio(p_glosa), p_modulo, p_lineas);
end;
$$;

-- Solo se anulan asientos manuales (hallazgo 1): los automáticos se revierten
-- anulando el documento que los originó.
create or replace function public.anular_asiento(p_asiento_id uuid, p_motivo text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_asiento public.asientos_contables%rowtype;
begin
  if not public.tiene_rol('admin', 'contador') then
    raise exception 'Solo un administrador o contador puede anular asientos.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  select * into v_asiento from public.asientos_contables where id = p_asiento_id;
  if not found then
    raise exception 'El asiento no existe.';
  end if;
  if v_asiento.referencia_tipo is not null
     or v_asiento.modulo not in ('Manual', 'Tesorería', 'Gastos', 'Ajuste', 'Nómina') then
    raise exception 'El asiento % es automático (%): se revierte anulando el documento que lo originó.',
      v_asiento.numero, coalesce(v_asiento.referencia_tipo, v_asiento.modulo);
  end if;
  return interno.revertir_asiento(p_asiento_id, p_motivo);
end;
$$;

-- =============================================================================
-- Ventas
-- =============================================================================

-- Toda factura nueva tiene cliente (hallazgo A). Las históricas de
-- "consumidor final" se respetan: la CHECK queda NOT VALID a propósito.
create or replace function interno.facturas_exigir_cliente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cliente_id is null then
    raise exception 'Toda factura debe tener un cliente registrado.';
  end if;
  return new;
end;
$$;

create trigger trg_facturas_exigir_cliente
before insert on public.facturas
for each row execute function interno.facturas_exigir_cliente();

alter table public.facturas
  add constraint facturas_cliente_obligatorio check (cliente_id is not null) not valid;

-- emitir_factura (versión de la migración 7) con:
--   * cliente obligatorio (A);
--   * referencia obligatoria para transferencia, pago móvil, punto de venta y
--     Zelle, y para la inicial de Cashea pagada por esos medios (24);
--   * monto en Bs de los pagos en bolívares coherente con monto_usd × tasa (15).
create or replace function interno.emitir_factura(
  p_vendedor_id uuid,
  p_cliente_id uuid,
  p_items jsonb,
  p_pagos jsonb,
  p_autorizar_sobregiro boolean default false,
  p_fecha timestamptz default null
)
returns public.facturas
language plpgsql security definer
set search_path = ''
as $$
declare
  v_empresa public.configuracion_empresa%rowtype;
  v_cliente public.clientes%rowtype;
  v_tasa public.tasas_cambio%rowtype;
  v_factura public.facturas%rowtype;
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_item jsonb;
  v_prod public.productos%rowtype;
  v_cant integer;
  v_lineas jsonb := '[]'::jsonb;
  v_base numeric(14, 2) := 0;
  v_exento numeric(14, 2) := 0;
  v_costo numeric(14, 2) := 0;
  v_iva numeric(14, 2);
  v_total_sin_igtf numeric(14, 2);
  v_pago jsonb;
  v_pagos jsonb := '[]'::jsonb;
  v_metodo_cobro text;
  v_es_divisa boolean;
  v_cuenta_cobro uuid;
  v_monto numeric(14, 2);
  v_monto_bs numeric(18, 2);
  v_igtf_pago numeric(14, 2);
  v_aplicado numeric(14, 2) := 0;
  v_en_tienda numeric(14, 2) := 0;
  v_base_igtf numeric(14, 2) := 0;
  v_igtf numeric(14, 2) := 0;
  v_financiado numeric(14, 2) := 0;
  v_credito numeric(14, 2) := 0;
  v_hay_cashea boolean := false;
  v_idx_mayor int;
  v_mayor numeric := -1;
  v_dif numeric(14, 2);
  v_limite_usd numeric(14, 2);
  v_saldo_actual numeric(14, 2);
  v_asiento jsonb := '[]'::jsonb;
  v_retencion numeric(14, 2) := 0;
  v_retencion_indicada numeric(14, 2) := 0;
  i int := 0;
begin
  select * into v_empresa from public.configuracion_empresa where id = 'default';
  select * into v_tasa from public.tasas_cambio
   where fecha_registro <= v_dia order by fecha_registro desc limit 1;
  if v_tasa.id is null then
    raise exception 'No hay tasa BCV registrada. Cargue la tasa del día antes de facturar.';
  end if;
  if v_tasa.fecha_registro < v_dia and p_fecha is null then
    raise exception 'La última tasa BCV es del %. Registre la tasa de hoy antes de facturar.',
      to_char(v_tasa.fecha_registro, 'DD/MM/YYYY');
  end if;

  if p_cliente_id is null then
    raise exception 'Seleccione el cliente de la factura: toda venta debe tener un cliente registrado.';
  end if;
  select * into v_cliente from public.clientes where id = p_cliente_id;
  if not found or not v_cliente.activo then
    raise exception 'El cliente no existe o está inactivo.';
  end if;

  -- 1) Líneas: precio, exención y costo SIEMPRE desde el maestro.
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura no tiene productos.';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item ->> 'cantidad')::integer;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida en la factura.';
    end if;
    select * into v_prod from public.productos where id = (v_item ->> 'producto_id')::uuid;
    if not found or not v_prod.activo then
      raise exception 'Producto inexistente o inactivo en la factura.';
    end if;
    v_lineas := v_lineas || jsonb_build_object(
      'producto_id', v_prod.id, 'cantidad', v_cant, 'precio', v_prod.precio_usd, 'exento', v_prod.exento_iva);
    if v_prod.exento_iva then
      v_exento := v_exento + round(v_cant * v_prod.precio_usd, 2);
    else
      v_base := v_base + round(v_cant * v_prod.precio_usd, 2);
    end if;
  end loop;

  v_iva := round(v_base * v_empresa.alicuota_iva / 100, 2);
  v_total_sin_igtf := v_base + v_exento + v_iva;

  -- Cliente contribuyente especial: retiene el % de su línea sobre el IVA.
  if v_cliente.contribuyente_especial and v_iva > 0 then
    v_retencion := round(v_iva * v_cliente.porcentaje_retencion_iva / 100, 2);
  end if;

  -- 2) Pagos.
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Indique al menos un método de pago.';
  end if;
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    if not exists (select 1 from public.metodos_pago_contables where metodo_id = v_pago ->> 'metodo_id') then
      raise exception 'Método de pago "%" no reconocido.', v_pago ->> 'metodo_id';
    end if;
    v_monto := round(coalesce((v_pago ->> 'monto_usd')::numeric, 0), 2);
    if v_pago ->> 'metodo_id' = 'retencion_iva' then
      v_retencion_indicada := v_retencion_indicada + v_monto;
    end if;
    if v_pago ->> 'metodo_id' = 'cashea' then
      if v_hay_cashea then
        raise exception 'Solo puede haber un pago Cashea por factura.';
      end if;
      v_hay_cashea := true;
      if v_monto <= 0 then
        raise exception 'Indique el monto de la inicial pagada en Cashea.';
      end if;
      v_metodo_cobro := coalesce(v_pago ->> 'cashea_metodo_inicial', 'punto_venta');
      if v_metodo_cobro in ('cashea', 'credito', 'retencion_iva')
         or not exists (select 1 from public.metodos_pago_contables where metodo_id = v_metodo_cobro) then
        raise exception 'Método inválido para la inicial de Cashea.';
      end if;
      perform interno.validar_referencia(v_metodo_cobro, v_pago ->> 'cashea_referencia_inicial', 'inicial de Cashea');
    else
      if v_monto <= 0 then
        raise exception 'Los montos de pago deben ser mayores a cero.';
      end if;
      v_metodo_cobro := v_pago ->> 'metodo_id';
      perform interno.validar_referencia(v_metodo_cobro, v_pago ->> 'referencia');
    end if;

    -- El monto en Bs que envía la caja debe corresponder al monto en USD a la
    -- tasa del día (tolerancia: 1 céntimo de dólar).
    if nullif(v_pago ->> 'monto_bs', '') is not null and v_metodo_cobro not in ('credito', 'retencion_iva')
       and not (select es_divisa from public.metodos_pago_contables where metodo_id = v_metodo_cobro) then
      v_monto_bs := round((v_pago ->> 'monto_bs')::numeric, 2);
      if abs(round(v_monto_bs / v_tasa.tasa_usd_bs, 2) - v_monto) > 0.01 then
        raise exception 'El monto en Bs del pago (Bs %) no corresponde a % USD a la tasa BCV de % Bs/USD (equivale a % USD).',
          v_monto_bs, v_monto, v_tasa.tasa_usd_bs, round(v_monto_bs / v_tasa.tasa_usd_bs, 2);
      end if;
    end if;

    if v_pago ->> 'metodo_id' = 'credito' then
      v_credito := v_credito + v_monto;
    else
      v_en_tienda := v_en_tienda + v_monto;
    end if;
    v_aplicado := v_aplicado + v_monto;
    if v_monto > v_mayor and v_pago ->> 'metodo_id' not in ('credito', 'retencion_iva') then
      v_mayor := v_monto; v_idx_mayor := i;
    end if;
    i := i + 1;
  end loop;

  if v_retencion_indicada <> v_retencion then
    if v_retencion = 0 then
      raise exception 'El cliente no es contribuyente especial: no corresponde retención de IVA.';
    end if;
    raise exception 'El cliente es contribuyente especial: la retención de IVA debe ser % USD (% %% de % USD de IVA).',
      v_retencion, v_cliente.porcentaje_retencion_iva, v_iva;
  end if;

  if v_hay_cashea then
    v_financiado := v_total_sin_igtf - v_aplicado;
    if v_financiado < 0 then
      raise exception 'Los pagos superan el total de la factura.';
    end if;
  else
    v_dif := v_total_sin_igtf - v_aplicado;
    if abs(v_dif) > 0.01 then
      if v_dif > 0 then
        raise exception 'Faltan % USD por pagar.', v_dif;
      end if;
      raise exception 'Los pagos superan el total por % USD. Registre el monto exacto (el vuelto no se factura).', -v_dif;
    end if;
    -- Diferencia de 1 céntimo por conversión Bs/USD: se absorbe en el mayor pago.
    if v_dif <> 0 and v_idx_mayor is not null then
      p_pagos := jsonb_set(p_pagos, array[v_idx_mayor::text, 'monto_usd'],
        to_jsonb(round((p_pagos -> v_idx_mayor ->> 'monto_usd')::numeric, 2) + v_dif));
    end if;
  end if;

  -- 3) Crédito directo: límite contra el saldo REAL.
  if v_credito > 0 then
    if not v_cliente.credito_activo then
      raise exception 'El cliente "%" no tiene crédito activo.', v_cliente.nombre;
    end if;
    v_limite_usd := case when v_cliente.moneda_credito = 'bs'
                         then round(v_cliente.linea_credito / v_tasa.tasa_usd_bs, 2)
                         else v_cliente.linea_credito end;
    select coalesce(sum(saldo_usd), 0) into v_saldo_actual from public.cuentas_por_cobrar
     where cliente_id = p_cliente_id and tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE';
    if v_saldo_actual + v_credito > v_limite_usd then
      if not (p_autorizar_sobregiro and public.tiene_rol('admin', 'gerente')) then
        raise exception 'Límite de crédito excedido: línea % USD, saldo pendiente % USD, disponible % USD, solicitado % USD.',
          v_limite_usd, v_saldo_actual, greatest(v_limite_usd - v_saldo_actual, 0), v_credito
          using hint = 'SOBREGIRO_CREDITO';
      end if;
    end if;
  end if;

  -- 4) IGTF por pago en divisas y detalle de pagos a guardar.
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_monto := round(coalesce((v_pago ->> 'monto_usd')::numeric, 0), 2);
    v_metodo_cobro := case when v_pago ->> 'metodo_id' = 'cashea'
                           then coalesce(v_pago ->> 'cashea_metodo_inicial', 'punto_venta')
                           else v_pago ->> 'metodo_id' end;
    select es_divisa, cuenta_id into v_es_divisa, v_cuenta_cobro
      from public.metodos_pago_contables where metodo_id = v_metodo_cobro;

    v_igtf_pago := case when v_empresa.contribuyente_especial and v_es_divisa
                        then round(v_monto * v_empresa.alicuota_igtf / 100, 2) else 0 end;
    if v_igtf_pago > 0 then
      v_base_igtf := v_base_igtf + v_monto;
      v_igtf := v_igtf + v_igtf_pago;
    end if;

    v_pagos := v_pagos || (
      (v_pago - array['monto_usd', 'monto_bs', 'aplicado_usd', 'igtf_usd', 'metodo',
                      'inicial_usd', 'inicial_bs', 'credito_cashea_usd', 'credito_cashea_bs'])
      || jsonb_build_object(
           'metodo', (select case v_pago ->> 'metodo_id'
                        when 'efectivo_usd' then 'Efectivo USD' when 'efectivo_bs' then 'Efectivo Bs'
                        when 'zelle' then 'Zelle' when 'pago_movil' then 'Pago Móvil'
                        when 'punto_venta' then 'Punto de Venta' when 'transferencia' then 'Transferencia'
                        when 'cashea' then 'Cashea' when 'credito' then 'Crédito'
                        when 'retencion_iva' then 'Retención IVA' end),
           'aplicado_usd', v_monto,
           'igtf_usd', v_igtf_pago,
           'monto_usd', v_monto + v_igtf_pago,
           'monto_bs', case when v_es_divisa then round((v_monto + v_igtf_pago) * v_tasa.tasa_usd_bs, 2)
                            else coalesce(round((v_pago ->> 'monto_bs')::numeric, 2),
                                          round(v_monto * v_tasa.tasa_usd_bs, 2)) end)
      || case when v_pago ->> 'metodo_id' = 'cashea' then jsonb_build_object(
           'cashea_metodo_inicial', v_metodo_cobro,
           'inicial_usd', v_monto + v_igtf_pago,
           'inicial_bs', round((v_monto + v_igtf_pago) * v_tasa.tasa_usd_bs, 2),
           'credito_cashea_usd', v_financiado,
           'credito_cashea_bs', round(v_financiado * v_tasa.tasa_usd_bs, 2))
         else '{}'::jsonb end);

    -- Asiento: débito a la cuenta del medio de cobro (incluye su IGTF).
    if v_pago ->> 'metodo_id' <> 'credito' then
      v_asiento := v_asiento || jsonb_build_object(
        'cuenta_id', v_cuenta_cobro, 'debe', v_monto + v_igtf_pago,
        'descripcion', 'Cobro ' || coalesce(v_pago ->> 'metodo_id', ''));
    end if;
  end loop;

  -- 5) Cabecera de la factura.
  perform set_config('arluc.fecha_operacion', v_fecha::text, true);

  insert into public.facturas (
    numero_factura, numero_control, cliente_id, cliente_nombre, cliente_documento,
    vendedor_id, tasa_id, subtotal_usd, descuento_usd,
    base_imponible_usd, exento_usd, alicuota_iva, iva_usd,
    alicuota_igtf, base_igtf_usd, igtf_usd,
    total_usd, total_bs, metodos_pago, fecha_emision, iva_retenido_usd
  ) values (
    'ARLUC-' || lpad(interno.siguiente_valor('factura')::text, 8, '0'),
    '00-' || lpad(interno.siguiente_valor('control_fiscal')::text, 8, '0'),
    p_cliente_id, v_cliente.nombre, v_cliente.documento_identidad,
    p_vendedor_id, v_tasa.id, v_base + v_exento, 0,
    v_base, v_exento, v_empresa.alicuota_iva, v_iva,
    case when v_igtf > 0 then v_empresa.alicuota_igtf else 0 end, v_base_igtf, v_igtf,
    v_total_sin_igtf + v_igtf, round((v_total_sin_igtf + v_igtf) * v_tasa.tasa_usd_bs, 2),
    v_pagos, v_fecha, v_retencion
  ) returning * into v_factura;

  -- 6) Líneas (el trigger descuenta stock y fija el costo).
  insert into public.detalles_factura (factura_id, producto_id, producto_nombre, cantidad, precio_unitario_usd, exento_iva)
  select v_factura.id, p.id, p.nombre, (l ->> 'cantidad')::integer, p.precio_usd, p.exento_iva
    from jsonb_array_elements(v_lineas) l
    join public.productos p on p.id = (l ->> 'producto_id')::uuid;

  select coalesce(sum(round(cantidad * costo_unitario_usd, 2)), 0) into v_costo
    from public.detalles_factura where factura_id = v_factura.id;

  -- 7) Retención recibida y cuentas por cobrar.
  if v_retencion > 0 then
    insert into public.retenciones_iva (
      tipo, fecha, factura_id, tercero_rif, tercero_nombre, numero_factura, numero_control,
      base_usd, iva_usd, porcentaje, monto_retenido_usd, tasa, estado
    ) values (
      'RECIBIDA', v_dia, v_factura.id, v_cliente.documento_identidad, v_cliente.nombre,
      v_factura.numero_factura, v_factura.numero_control,
      v_base, v_iva, v_cliente.porcentaje_retencion_iva, v_retencion, v_tasa.tasa_usd_bs, 'PENDIENTE'
    );
  end if;

  if v_credito > 0 then
    insert into public.cuentas_por_cobrar (factura_id, cliente_id, tipo, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento)
    values (v_factura.id, p_cliente_id, 'CREDITO_DIRECTO', v_credito, v_credito, v_dia, v_dia + v_empresa.dias_credito);
    v_asiento := v_asiento || jsonb_build_object(
      'cuenta_clave', 'CTA_CXC_CLIENTES', 'debe', v_credito, 'descripcion', 'Venta a crédito');
  end if;
  if v_financiado > 0 then
    insert into public.cuentas_por_cobrar (factura_id, cliente_id, tipo, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento)
    values (v_factura.id, p_cliente_id, 'CASHEA', v_financiado, v_financiado, v_dia, v_dia + 14);
    v_asiento := v_asiento || jsonb_build_object(
      'cuenta_clave', 'CTA_CXC_CASHEA', 'debe', v_financiado, 'descripcion', 'Financiado por Cashea');
  end if;

  -- 8) Asiento: cobros / ventas + IVA + IGTF, y costo de venta / inventario.
  if v_base > 0 then
    v_asiento := v_asiento || jsonb_build_object('cuenta_clave', 'CTA_VENTAS_GRAVADAS', 'haber', v_base, 'descripcion', 'Venta gravada');
  end if;
  if v_exento > 0 then
    v_asiento := v_asiento || jsonb_build_object('cuenta_clave', 'CTA_VENTAS_EXENTAS', 'haber', v_exento, 'descripcion', 'Venta exenta');
  end if;
  if v_iva > 0 then
    v_asiento := v_asiento || jsonb_build_object('cuenta_clave', 'CTA_IVA_DEBITO', 'haber', v_iva,
      'descripcion', 'IVA ' || v_empresa.alicuota_iva || '%');
  end if;
  if v_igtf > 0 then
    v_asiento := v_asiento || jsonb_build_object('cuenta_clave', 'CTA_IGTF_POR_PAGAR', 'haber', v_igtf,
      'descripcion', 'IGTF ' || v_empresa.alicuota_igtf || '% percibido');
  end if;
  if v_costo > 0 then
    v_asiento := v_asiento
      || jsonb_build_object('cuenta_clave', 'CTA_COSTO_VENTAS', 'debe', v_costo, 'descripcion', 'Costo de la mercancía vendida')
      || jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'haber', v_costo, 'descripcion', 'Salida de inventario');
  end if;

  perform interno.registrar_asiento(
    v_dia,
    'Venta ' || v_factura.numero_factura || ' a ' || v_cliente.nombre,
    'Ventas', v_asiento, v_tasa.tasa_usd_bs, 'FACTURA', v_factura.id);

  perform set_config('arluc.fecha_operacion', '', true);
  return v_factura;
end;
$$;

-- Anulación (versión de la migración 8) con motivo de al menos 10 caracteres (B).
create or replace function public.anular_factura(p_factura_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fecha date;
  v_motivo text;
begin
  if not public.tiene_rol('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede anular facturas.';
  end if;
  v_motivo := interno.validar_motivo(p_motivo);
  select (fecha_emision at time zone 'America/Caracas')::date into v_fecha from public.facturas where id = p_factura_id;
  if v_fecha is null then
    raise exception 'La factura no existe.';
  end if;
  if v_fecha < current_date then
    raise exception 'Solo se anulan facturas del mismo día. Para corregir una factura del % emita una nota de crédito.',
      to_char(v_fecha, 'DD/MM/YYYY');
  end if;
  update public.facturas set estado = 'anulada', motivo_anulacion = v_motivo where id = p_factura_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Nota de crédito (hallazgo 5): un producto no puede repetirse en la devolución
-- (las disponibilidades se calculan una sola vez por producto).
-- -----------------------------------------------------------------------------
create or replace function interno.emitir_nota_credito(
  p_usuario uuid, p_factura_id uuid, p_concepto text, p_items jsonb, p_monto_base numeric,
  p_motivo text, p_metodo text, p_fecha timestamptz default null
)
returns public.notas_fiscales
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fact public.facturas%rowtype;
  v_tasa_fact numeric(18, 4);
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_tasa_hoy numeric(18, 4);
  v_saldo jsonb;
  v_item jsonb;
  v_prod jsonb;
  v_det public.detalles_factura%rowtype;
  v_cant integer;
  v_base numeric(14, 2) := 0;
  v_exento numeric(14, 2) := 0;
  v_costo numeric(14, 2) := 0;
  v_iva numeric(14, 2);
  v_ret numeric(14, 2) := 0;
  v_pct numeric;
  v_total numeric(14, 2);
  v_reintegro numeric(14, 2);
  v_cxc public.cuentas_por_cobrar%rowtype;
  v_cuenta_reintegro jsonb;
  v_reintegro_ves numeric(20, 2);
  v_debe_ves numeric(20, 2);
  v_haber_ves numeric(20, 2);
  v_dif numeric(20, 2);
  v_nota public.notas_fiscales%rowtype;
  v_lineas jsonb;
  v_detalles jsonb := '[]'::jsonb;
begin
  select * into v_fact from public.facturas where id = p_factura_id for update;
  if not found or v_fact.estado <> 'emitida' then
    raise exception 'La factura no existe o está anulada.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la nota de crédito.';
  end if;
  select tasa_usd_bs into v_tasa_fact from public.tasas_cambio where id = v_fact.tasa_id;
  v_tasa_hoy := public.tasa_vigente(v_dia);
  v_saldo := interno.saldo_notas_factura(p_factura_id);

  if p_concepto = 'DEVOLUCION' then
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'Indique los productos devueltos.';
    end if;
    if exists (select 1 from jsonb_array_elements(p_items) e group by e ->> 'producto_id' having count(*) > 1) then
      raise exception 'Hay productos repetidos en la devolución: indique cada producto una sola vez con la cantidad total.';
    end if;
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_cant := (v_item ->> 'cantidad')::integer;
      v_prod := null;
      select e.value into v_prod from jsonb_array_elements(v_saldo -> 'productos') as e(value)
       where e.value ->> 'producto_id' = v_item ->> 'producto_id';
      if v_prod is null then
        raise exception 'El producto no pertenece a la factura %.', v_fact.numero_factura;
      end if;
      if v_cant is null or v_cant <= 0 or v_cant > (v_prod ->> 'disponibles')::integer then
        raise exception 'Cantidad a devolver de "%" inválida: vendidos %, ya devueltos %.',
          v_prod ->> 'producto_nombre', v_prod ->> 'vendidos', v_prod ->> 'devueltos';
      end if;
      select * into v_det from public.detalles_factura
       where factura_id = p_factura_id and producto_id = (v_item ->> 'producto_id')::uuid limit 1;
      if v_det.exento_iva then
        v_exento := v_exento + round(v_cant * v_det.precio_unitario_usd, 2);
      else
        v_base := v_base + round(v_cant * v_det.precio_unitario_usd, 2);
      end if;
      v_costo := v_costo + round(v_cant * v_det.costo_unitario_usd, 2);
      v_detalles := v_detalles || jsonb_build_object(
        'producto_id', v_det.producto_id, 'producto_nombre', v_det.producto_nombre, 'cantidad', v_cant,
        'precio', v_det.precio_unitario_usd, 'exento', v_det.exento_iva, 'costo', v_det.costo_unitario_usd);
    end loop;
  elsif p_concepto = 'DESCUENTO' then
    if p_monto_base is null or p_monto_base <= 0 then
      raise exception 'Indique el monto del descuento (base sin IVA).';
    end if;
    -- La rebaja se aplica a la base gravada; si la factura es solo exenta, al exento.
    if v_fact.base_imponible_usd > 0 then v_base := round(p_monto_base, 2); else v_exento := round(p_monto_base, 2); end if;
  else
    raise exception 'Concepto de nota de crédito inválido: %.', p_concepto;
  end if;

  if v_base + v_exento > (v_saldo ->> 'base_disponible_usd')::numeric then
    raise exception 'La nota (% USD) supera la base disponible de la factura (% USD).',
      v_base + v_exento, v_saldo ->> 'base_disponible_usd';
  end if;

  v_iva := round(v_base * v_fact.alicuota_iva / 100, 2);
  v_pct := (v_saldo ->> 'porcentaje_retencion')::numeric;
  v_ret := round(v_iva * v_pct / 100, 2);
  v_total := v_base + v_exento + v_iva;
  v_reintegro := v_total - v_ret;

  -- Forma de reintegro
  if p_metodo = 'credito_cxc' then
    select * into v_cxc from public.cuentas_por_cobrar
     where factura_id = p_factura_id and tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE' for update;
    if not found or v_cxc.saldo_usd < v_reintegro then
      raise exception 'La factura no tiene saldo a crédito suficiente (% USD) para rebajar % USD.',
        coalesce(v_cxc.saldo_usd, 0), v_reintegro;
    end if;
    v_cuenta_reintegro := jsonb_build_object('cuenta_clave', 'CTA_CXC_CLIENTES');
    v_reintegro_ves := round(v_reintegro * v_cxc.tasa_origen, 2);
  elsif p_metodo = 'saldo_favor' then
    if v_fact.cliente_id is null then
      raise exception 'El saldo a favor requiere una factura con cliente identificado.';
    end if;
    v_cuenta_reintegro := jsonb_build_object('cuenta_clave', 'CTA_ANTICIPO_CLIENTES');
    v_reintegro_ves := round(v_reintegro * v_tasa_hoy, 2);
  elsif p_metodo in ('efectivo_usd', 'efectivo_bs', 'pago_movil', 'transferencia', 'zelle') then
    v_cuenta_reintegro := jsonb_build_object('cuenta_id', (select cuenta_id from public.metodos_pago_contables where metodo_id = p_metodo));
    v_reintegro_ves := round(v_reintegro * v_tasa_hoy, 2);
  else
    raise exception 'Forma de reintegro inválida: %.', p_metodo;
  end if;

  insert into public.notas_fiscales (
    tipo, numero, numero_control, factura_id, cliente_id, cliente_nombre, cliente_documento, fecha_emision,
    concepto, motivo, base_imponible_usd, exento_usd, alicuota_iva, iva_usd, iva_retenido_usd, total_usd,
    tasa, metodo, monto_liquidado_usd, emitida_por
  ) values (
    'CREDITO', 'NC-' || lpad(interno.siguiente_valor('nota_credito')::text, 8, '0'),
    '00-' || lpad(interno.siguiente_valor('control_fiscal')::text, 8, '0'),
    p_factura_id, v_fact.cliente_id, v_fact.cliente_nombre, v_fact.cliente_documento, v_fecha,
    p_concepto, trim(p_motivo), v_base, v_exento, v_fact.alicuota_iva, v_iva, v_ret, v_total,
    v_tasa_fact, p_metodo, v_reintegro, p_usuario
  ) returning * into v_nota;

  insert into public.detalles_nota (nota_id, producto_id, producto_nombre, cantidad, precio_unitario_usd, exento_iva, costo_unitario_usd)
  select v_nota.id, (d ->> 'producto_id')::uuid, d ->> 'producto_nombre', (d ->> 'cantidad')::int,
         (d ->> 'precio')::numeric, (d ->> 'exento')::boolean, (d ->> 'costo')::numeric
    from jsonb_array_elements(v_detalles) d;

  -- La mercancía devuelta vuelve al inventario a su costo original.
  perform set_config('arluc.fecha_operacion', v_fecha::text, true);
  for v_item in select * from jsonb_array_elements(v_detalles) loop
    perform interno.mover_stock((v_item ->> 'producto_id')::uuid, (v_item ->> 'cantidad')::int, 'DEVOLUCION_VENTA',
      (v_item ->> 'costo')::numeric, 'NOTA_CREDITO', v_nota.id, 'Devolución ' || v_nota.numero || ' de ' || v_fact.numero_factura);
  end loop;
  perform set_config('arluc.fecha_operacion', '', true);

  if p_metodo = 'credito_cxc' then
    update public.cuentas_por_cobrar
       set saldo_usd = saldo_usd - v_reintegro,
           estado = case when saldo_usd - v_reintegro = 0 and recargo_cobrado_usd = recargo_usd then 'PAGADA' else estado end
     where id = v_cxc.id;
  end if;

  -- Asiento: rebaja de la venta y del débito fiscal a la tasa de la factura;
  -- el reintegro a la tasa de hoy (o de la CxC); la diferencia es cambiaria.
  v_debe_ves := round((v_base + v_exento) * v_tasa_fact, 2) + round(v_iva * v_tasa_fact, 2);
  v_haber_ves := round(v_ret * v_tasa_fact, 2) + v_reintegro_ves;
  v_dif := v_debe_ves - v_haber_ves;

  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta_clave', 'CTA_DEVOLUCIONES_VENTAS', 'debe', v_base + v_exento,
                       'debe_ves', round((v_base + v_exento) * v_tasa_fact, 2),
                       'descripcion', initcap(lower(p_concepto)) || ' sobre ' || v_fact.numero_factura),
    v_cuenta_reintegro || jsonb_build_object('haber', v_reintegro, 'haber_ves', v_reintegro_ves,
                       'descripcion', 'Reintegro (' || p_metodo || ')'));
  if v_iva > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_IVA_DEBITO', 'debe', v_iva,
                       'debe_ves', round(v_iva * v_tasa_fact, 2), 'descripcion', 'Rebaja del débito fiscal');
  end if;
  if v_ret > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_IVA_RETENIDO_CLIENTE', 'haber', v_ret,
                       'haber_ves', round(v_ret * v_tasa_fact, 2), 'descripcion', 'Ajuste de la retención del cliente');
  end if;
  if v_dif > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_DIF_CAMBIARIO_GANANCIA', 'haber_ves', v_dif, 'descripcion', 'Ganancia cambiaria');
  elsif v_dif < 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_DIF_CAMBIARIO_PERDIDA', 'debe_ves', -v_dif, 'descripcion', 'Pérdida cambiaria');
  end if;
  if v_costo > 0 then
    v_lineas := v_lineas
      || jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'debe', v_costo, 'debe_ves', round(v_costo * v_tasa_fact, 2),
                            'descripcion', 'Reingreso de mercancía')
      || jsonb_build_object('cuenta_clave', 'CTA_COSTO_VENTAS', 'haber', v_costo, 'haber_ves', round(v_costo * v_tasa_fact, 2),
                            'descripcion', 'Reverso del costo de venta');
  end if;

  perform interno.registrar_asiento(
    v_dia, 'Nota de crédito ' || v_nota.numero || ' sobre ' || v_fact.numero_factura || ': ' || trim(p_motivo),
    'Ventas', v_lineas, v_tasa_hoy, 'NOTA_CREDITO', v_nota.id);
  return v_nota;
end;
$$;

-- -----------------------------------------------------------------------------
-- Nota de débito (hallazgo 13): a crédito respeta el límite del cliente; sobre
-- una factura totalmente exenta, la nota también es exenta (sin IVA).
-- -----------------------------------------------------------------------------
create or replace function interno.emitir_nota_debito(
  p_usuario uuid, p_factura_id uuid, p_concepto text, p_monto_base numeric,
  p_motivo text, p_metodo text, p_fecha timestamptz default null
)
returns public.notas_fiscales
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fact public.facturas%rowtype;
  v_cliente public.clientes%rowtype;
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_tasa numeric(18, 4);
  v_monto numeric(14, 2) := round(p_monto_base, 2);
  v_exenta boolean;
  v_base numeric(14, 2);
  v_exento numeric(14, 2);
  v_iva numeric(14, 2);
  v_ret numeric(14, 2) := 0;
  v_cobro numeric(14, 2);
  v_dias int;
  v_limite_usd numeric(14, 2);
  v_saldo_actual numeric(14, 2);
  v_cuenta_cobro jsonb;
  v_nota public.notas_fiscales%rowtype;
  v_lineas jsonb;
begin
  select * into v_fact from public.facturas where id = p_factura_id for update;
  if not found or v_fact.estado <> 'emitida' then
    raise exception 'La factura no existe o está anulada.';
  end if;
  if p_concepto not in ('AJUSTE_PRECIO', 'CARGO_ADICIONAL') then
    raise exception 'Concepto de nota de débito inválido: %.', p_concepto;
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'Indique el monto de la nota de débito (base sin IVA).';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indique el motivo de la nota de débito.';
  end if;

  v_tasa := public.tasa_vigente(v_dia);
  if v_tasa is null then
    raise exception 'No hay tasa BCV registrada para el %.', to_char(v_dia, 'DD/MM/YYYY');
  end if;

  -- Una factura solo exenta genera una nota exenta; si no, la nota es gravada.
  v_exenta := v_fact.base_imponible_usd = 0 and v_fact.exento_usd > 0;
  v_base := case when v_exenta then 0 else v_monto end;
  v_exento := case when v_exenta then v_monto else 0 end;
  v_iva := round(v_base * v_fact.alicuota_iva / 100, 2);
  if v_fact.cliente_id is not null then
    select * into v_cliente from public.clientes where id = v_fact.cliente_id;
    if v_cliente.contribuyente_especial and v_iva > 0 then
      v_ret := round(v_iva * v_cliente.porcentaje_retencion_iva / 100, 2);
    end if;
  end if;
  v_cobro := v_base + v_exento + v_iva - v_ret;

  if p_metodo = 'credito' then
    if v_fact.cliente_id is null or not v_cliente.credito_activo then
      raise exception 'Cobrar la nota a crédito requiere un cliente con crédito activo.';
    end if;
    if exists (select 1 from public.cuentas_por_cobrar where factura_id = p_factura_id and tipo = 'CREDITO_DIRECTO') then
      raise exception 'La factura ya tiene una cuenta a crédito: cobre la nota de débito por otro medio.';
    end if;
    v_limite_usd := case when v_cliente.moneda_credito = 'bs'
                         then round(v_cliente.linea_credito / v_tasa, 2)
                         else v_cliente.linea_credito end;
    select coalesce(sum(saldo_usd), 0) into v_saldo_actual from public.cuentas_por_cobrar
     where cliente_id = v_fact.cliente_id and tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE';
    if v_saldo_actual + v_cobro > v_limite_usd then
      raise exception 'Límite de crédito excedido: línea % USD, saldo pendiente % USD, disponible % USD; la nota de débito requiere % USD.',
        v_limite_usd, v_saldo_actual, greatest(v_limite_usd - v_saldo_actual, 0), v_cobro;
    end if;
    v_cuenta_cobro := jsonb_build_object('cuenta_clave', 'CTA_CXC_CLIENTES');
  elsif p_metodo in ('efectivo_usd', 'efectivo_bs', 'pago_movil', 'transferencia', 'punto_venta', 'zelle') then
    v_cuenta_cobro := jsonb_build_object('cuenta_id', (select cuenta_id from public.metodos_pago_contables where metodo_id = p_metodo));
  else
    raise exception 'Forma de cobro inválida: %.', p_metodo;
  end if;

  insert into public.notas_fiscales (
    tipo, numero, numero_control, factura_id, cliente_id, cliente_nombre, cliente_documento, fecha_emision,
    concepto, motivo, base_imponible_usd, exento_usd, alicuota_iva, iva_usd, iva_retenido_usd, total_usd,
    tasa, metodo, monto_liquidado_usd, emitida_por
  ) values (
    'DEBITO', 'ND-' || lpad(interno.siguiente_valor('nota_debito')::text, 8, '0'),
    '00-' || lpad(interno.siguiente_valor('control_fiscal')::text, 8, '0'),
    p_factura_id, v_fact.cliente_id, v_fact.cliente_nombre, v_fact.cliente_documento, v_fecha,
    p_concepto, trim(p_motivo), v_base, v_exento, v_fact.alicuota_iva, v_iva, v_ret, v_base + v_exento + v_iva,
    v_tasa, p_metodo, v_cobro, p_usuario
  ) returning * into v_nota;

  if p_metodo = 'credito' then
    select dias_credito into v_dias from public.configuracion_empresa where id = 'default';
    insert into public.cuentas_por_cobrar (factura_id, cliente_id, tipo, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento, tasa_origen)
    values (p_factura_id, v_fact.cliente_id, 'CREDITO_DIRECTO', v_cobro, v_cobro, v_dia, v_dia + v_dias, v_tasa);
  end if;

  if v_ret > 0 then
    insert into public.retenciones_iva (
      tipo, fecha, factura_id, tercero_rif, tercero_nombre, numero_factura, numero_control,
      base_usd, iva_usd, porcentaje, monto_retenido_usd, tasa, estado
    ) values (
      'RECIBIDA', v_dia, p_factura_id, v_cliente.documento_identidad, v_cliente.nombre, v_nota.numero, v_nota.numero_control,
      v_base, v_iva, v_cliente.porcentaje_retencion_iva, v_ret, v_tasa, 'PENDIENTE'
    );
  end if;

  v_lineas := jsonb_build_array(
    v_cuenta_cobro || jsonb_build_object('debe', v_cobro, 'descripcion', 'Cobro (' || p_metodo || ')'),
    jsonb_build_object('cuenta_clave', case when v_exenta then 'CTA_VENTAS_EXENTAS' else 'CTA_VENTAS_GRAVADAS' end,
                       'haber', v_base + v_exento,
                       'descripcion', initcap(replace(lower(p_concepto), '_', ' ')) || ' sobre ' || v_fact.numero_factura));
  if v_iva > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_IVA_DEBITO', 'haber', v_iva, 'descripcion', 'IVA de la nota de débito');
  end if;
  if v_ret > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_IVA_RETENIDO_CLIENTE', 'debe', v_ret,
                                               'descripcion', 'Retención del cliente');
  end if;

  perform interno.registrar_asiento(
    v_dia, 'Nota de débito ' || v_nota.numero || ' sobre ' || v_fact.numero_factura || ': ' || trim(p_motivo),
    'Ventas', v_lineas, v_tasa, 'NOTA_DEBITO', v_nota.id);
  return v_nota;
end;
$$;

-- =============================================================================
-- Cobranza y pagos (hallazgos 14, 21, 23, B)
-- =============================================================================
create or replace function interno.registrar_abono(
  p_cxc_id uuid, p_monto_usd numeric, p_metodo_id text,
  p_referencia text default null, p_notas text default null, p_fecha timestamptz default null
)
returns public.abonos_cxc
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cxc public.cuentas_por_cobrar%rowtype;
  v_empresa public.configuracion_empresa%rowtype;
  v_metodo public.metodos_pago_contables%rowtype;
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_tasa numeric(18, 4);
  v_monto numeric(14, 2) := round(p_monto_usd, 2);
  v_referencia text;
  v_recargo numeric(14, 2);
  v_a_recargo numeric(14, 2);
  v_a_capital numeric(14, 2);
  v_igtf numeric(14, 2) := 0;
  v_cobro_ves numeric(20, 2);
  v_capital_ves numeric(20, 2);
  v_otros_ves numeric(20, 2);
  v_dif numeric(20, 2);
  v_factura text;
  v_abono public.abonos_cxc%rowtype;
  v_lineas jsonb;
begin
  select * into v_cxc from public.cuentas_por_cobrar where id = p_cxc_id for update;
  if not found or v_cxc.estado <> 'PENDIENTE' then
    raise exception 'La cuenta por cobrar no existe o no está pendiente.';
  end if;
  select * into v_metodo from public.metodos_pago_contables where metodo_id = p_metodo_id;
  if not found or p_metodo_id in ('credito', 'cashea', 'retencion_iva') then
    raise exception 'Método de cobro inválido.';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto del abono debe ser mayor a cero.';
  end if;
  v_referencia := interno.validar_referencia(p_metodo_id, p_referencia);

  select * into v_empresa from public.configuracion_empresa where id = 'default';
  v_tasa := public.tasa_vigente(v_dia);
  if v_tasa is null then
    raise exception 'No hay tasa BCV registrada.';
  end if;

  -- Fija el recargo si la cuenta está vencida y aún no se había fijado.
  v_recargo := public.recargo_cxc(v_cxc, v_dia);
  if v_recargo > v_cxc.recargo_usd then
    update public.cuentas_por_cobrar set recargo_usd = v_recargo where id = v_cxc.id
    returning * into v_cxc;
  end if;

  -- Imputación: primero recargo, luego capital.
  v_a_recargo := least(v_monto, v_cxc.recargo_usd - v_cxc.recargo_cobrado_usd);
  v_a_capital := v_monto - v_a_recargo;
  if v_a_capital > v_cxc.saldo_usd then
    raise exception 'El abono (% USD) supera la deuda pendiente (% USD).',
      v_monto, v_cxc.saldo_usd + v_cxc.recargo_usd - v_cxc.recargo_cobrado_usd;
  end if;

  if v_empresa.contribuyente_especial and v_metodo.es_divisa then
    v_igtf := round(v_monto * v_empresa.alicuota_igtf / 100, 2);
  end if;

  -- Diferencial cambiario sobre el capital cobrado.
  v_cobro_ves := round((v_monto + v_igtf) * v_tasa, 2);
  v_capital_ves := round(v_a_capital * v_cxc.tasa_origen, 2);
  v_otros_ves := round(v_a_recargo * v_tasa, 2) + round(v_igtf * v_tasa, 2);
  v_dif := v_cobro_ves - v_capital_ves - v_otros_ves;

  update public.cuentas_por_cobrar
     set saldo_usd = saldo_usd - v_a_capital,
         recargo_cobrado_usd = recargo_cobrado_usd + v_a_recargo,
         estado = case when saldo_usd - v_a_capital = 0
                        and recargo_cobrado_usd + v_a_recargo = recargo_usd then 'PAGADA' else estado end
   where id = v_cxc.id;

  insert into public.abonos_cxc (
    cxc_id, fecha, metodo_id, monto_usd, aplicado_recargo_usd, aplicado_capital_usd,
    igtf_usd, tasa, monto_bs, diferencial_bs, referencia, notas
  ) values (
    v_cxc.id, v_fecha, p_metodo_id, v_monto, v_a_recargo, v_a_capital,
    v_igtf, v_tasa, v_cobro_ves, v_dif, v_referencia, nullif(trim(p_notas), '')
  ) returning * into v_abono;

  select numero_factura into v_factura from public.facturas where id = v_cxc.factura_id;

  v_lineas := jsonb_build_array(jsonb_build_object(
    'cuenta_id', v_metodo.cuenta_id, 'debe', v_monto + v_igtf, 'debe_ves', v_cobro_ves,
    'descripcion', 'Cobro ' || p_metodo_id));
  if v_a_capital > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', case when v_cxc.tipo = 'CASHEA' then 'CTA_CXC_CASHEA' else 'CTA_CXC_CLIENTES' end,
      'haber', v_a_capital, 'haber_ves', v_capital_ves,
      'descripcion', 'Abono a capital ' || v_factura || ' (tasa origen ' || v_cxc.tasa_origen || ')');
  end if;
  if v_a_recargo > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_INGRESO_MORA', 'haber', v_a_recargo, 'descripcion', 'Recargo por mora cobrado');
  end if;
  if v_igtf > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_IGTF_POR_PAGAR', 'haber', v_igtf, 'descripcion', 'IGTF percibido');
  end if;
  if v_dif > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_DIF_CAMBIARIO_GANANCIA', 'haber_ves', v_dif, 'descripcion', 'Ganancia cambiaria');
  elsif v_dif < 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_DIF_CAMBIARIO_PERDIDA', 'debe_ves', -v_dif, 'descripcion', 'Pérdida cambiaria');
  end if;

  perform interno.registrar_asiento(
    v_dia, 'Abono a ' || v_factura || ' (' || p_metodo_id || ')',
    'Cuentas por Cobrar', v_lineas, v_tasa, 'ABONO_CXC', v_abono.id);

  return v_abono;
end;
$$;

create or replace function public.anular_abono(p_abono_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_abono public.abonos_cxc%rowtype;
  v_asiento_id uuid;
  v_motivo text;
begin
  if not public.tiene_rol('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede anular abonos.';
  end if;
  v_motivo := interno.validar_motivo(p_motivo);
  select * into v_abono from public.abonos_cxc where id = p_abono_id for update;
  if not found or v_abono.estado <> 'VIGENTE' then
    raise exception 'El abono no existe o ya fue anulado.';
  end if;

  update public.cuentas_por_cobrar
     set saldo_usd = saldo_usd + v_abono.aplicado_capital_usd,
         recargo_cobrado_usd = recargo_cobrado_usd - v_abono.aplicado_recargo_usd,
         estado = 'PENDIENTE'
   where id = v_abono.cxc_id;

  update public.abonos_cxc
     set estado = 'ANULADO', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_abono_id;

  select id into v_asiento_id from public.asientos_contables
   where referencia_tipo = 'ABONO_CXC' and referencia_id = p_abono_id and estado = 'ASENTADO';
  perform interno.revertir_asiento(v_asiento_id, 'Anulación de abono: ' || v_motivo);
end;
$$;

create or replace function interno.pagar_cxp(
  p_cxp_id uuid, p_monto_usd numeric, p_metodo_id text,
  p_referencia text default null, p_notas text default null, p_fecha timestamptz default null
)
returns public.pagos_cxp
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cxp public.cuentas_por_pagar%rowtype;
  v_empresa public.configuracion_empresa%rowtype;
  v_metodo public.metodos_pago_contables%rowtype;
  v_dia date := (coalesce(p_fecha, now()) at time zone 'America/Caracas')::date;
  v_tasa numeric(18, 4);
  v_monto numeric(14, 2) := round(p_monto_usd, 2);
  v_referencia text;
  v_igtf numeric(14, 2) := 0;
  v_deuda_ves numeric(20, 2);
  v_pago_ves numeric(20, 2);
  v_dif numeric(20, 2);
  v_pago public.pagos_cxp%rowtype;
  v_orden text;
  v_lineas jsonb;
begin
  select * into v_cxp from public.cuentas_por_pagar where id = p_cxp_id for update;
  if not found or v_cxp.estado <> 'PENDIENTE' then
    raise exception 'La cuenta por pagar no existe o no está pendiente.';
  end if;
  select * into v_metodo from public.metodos_pago_contables where metodo_id = p_metodo_id;
  if not found or p_metodo_id in ('credito', 'cashea', 'retencion_iva') then
    raise exception 'Método de pago inválido.';
  end if;
  if v_monto is null or v_monto <= 0 or v_monto > v_cxp.saldo_usd then
    raise exception 'El pago debe ser mayor a cero y no superar el saldo (% USD).', v_cxp.saldo_usd;
  end if;
  v_referencia := interno.validar_referencia(p_metodo_id, p_referencia);

  select * into v_empresa from public.configuracion_empresa where id = 'default';
  v_tasa := public.tasa_vigente(v_dia);
  if v_tasa is null then
    raise exception 'No hay tasa BCV registrada.';
  end if;

  -- Pagar en divisas genera IGTF a cargo de la empresa (gasto).
  if v_empresa.contribuyente_especial and v_metodo.es_divisa then
    v_igtf := round(v_monto * v_empresa.alicuota_igtf / 100, 2);
  end if;

  v_deuda_ves := round(v_monto * v_cxp.tasa_origen, 2);
  v_pago_ves := round(v_monto * v_tasa, 2);
  v_dif := v_deuda_ves - v_pago_ves;

  update public.cuentas_por_pagar
     set saldo_usd = saldo_usd - v_monto,
         estado = case when saldo_usd - v_monto = 0 then 'PAGADA' else estado end
   where id = v_cxp.id;

  insert into public.pagos_cxp (cxp_id, fecha, metodo_id, monto_usd, igtf_usd, tasa, monto_bs, diferencial_bs, referencia, notas)
  values (v_cxp.id, coalesce(p_fecha, now()), p_metodo_id, v_monto, v_igtf, v_tasa,
          round((v_monto + v_igtf) * v_tasa, 2), v_dif, v_referencia, nullif(trim(p_notas), ''))
  returning * into v_pago;

  select numero_orden into v_orden from public.ordenes_compra where id = v_cxp.orden_id;

  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta_clave', 'CTA_CXP_PROVEEDORES', 'debe', v_monto, 'debe_ves', v_deuda_ves,
                       'descripcion', 'Pago ' || v_orden || ' (tasa origen ' || v_cxp.tasa_origen || ')'),
    jsonb_build_object('cuenta_id', v_metodo.cuenta_id, 'haber', v_monto + v_igtf,
                       'descripcion', 'Pago ' || p_metodo_id));
  if v_igtf > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_id', (select id from public.plan_cuentas where codigo = '6.2.01.02'),
      'debe', v_igtf, 'descripcion', 'IGTF pagado');
  end if;
  if v_dif > 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_DIF_CAMBIARIO_GANANCIA', 'haber_ves', v_dif, 'descripcion', 'Ganancia cambiaria');
  elsif v_dif < 0 then
    v_lineas := v_lineas || jsonb_build_object(
      'cuenta_clave', 'CTA_DIF_CAMBIARIO_PERDIDA', 'debe_ves', -v_dif, 'descripcion', 'Pérdida cambiaria');
  end if;

  perform interno.registrar_asiento(
    v_dia, 'Pago a proveedor ' || v_orden, 'Cuentas por Pagar', v_lineas, v_tasa, 'PAGO_CXP', v_pago.id);
  return v_pago;
end;
$$;

-- =============================================================================
-- Compras (hallazgos 3, 4, 9, 10)
-- =============================================================================
alter table public.ordenes_compra
  add column exento_usd numeric(14, 2) not null default 0;
comment on column public.ordenes_compra.exento_usd is 'Parte del total de la compra correspondiente a productos exentos de IVA.';

-- Una orden siempre nace pendiente: recibirla es un paso aparte que registra
-- inventario, CxP, IVA y asiento.
create or replace function interno.ordenes_antes_insertar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.estado := 'pendiente';
  new.recibida_en := null;
  new.recibida_por := null;
  new.iva_usd := 0;
  new.iva_retenido_usd := 0;
  new.exento_usd := 0;
  new.numero_factura_proveedor := interno.texto_limpio(new.numero_factura_proveedor);
  new.numero_control_proveedor := interno.texto_limpio(new.numero_control_proveedor);
  new.notas := interno.texto_limpio(new.notas);
  return new;
end;
$$;

create trigger trg_ordenes_antes_insertar
before insert on public.ordenes_compra
for each row execute function interno.ordenes_antes_insertar();

-- Líneas: cantidad y costo unitario mayores a cero.
create or replace function interno.detalles_orden_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cantidad is null or new.cantidad <= 0 then
    raise exception 'La cantidad de cada línea de la orden debe ser mayor a cero.';
  end if;
  if new.precio_unitario_usd is null or new.precio_unitario_usd <= 0 then
    raise exception 'El costo unitario de cada línea de la orden debe ser mayor a cero.';
  end if;
  return new;
end;
$$;

create trigger trg_detalles_orden_validar
before insert or update on public.detalles_orden_compra
for each row execute function interno.detalles_orden_validar();

alter table public.detalles_orden_compra
  add constraint detalles_orden_precio_positivo check (precio_unitario_usd > 0) not valid;

-- Al recibir: factura y control del proveedor obligatorios, factura única por
-- proveedor e IVA calculado solo sobre los productos gravados.
create or replace function interno.ordenes_cambio_estado()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_alicuota numeric(5, 2);
  v_otra text;
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'pendiente' then
      raise exception 'Solo se pueden eliminar órdenes pendientes.';
    end if;
    return old;
  end if;

  if old.estado = 'recibida' and new.estado = 'recibida'
     and (to_jsonb(new) - 'iva_retenido_usd') = (to_jsonb(old) - 'iva_retenido_usd') then
    return new;
  end if;

  if old.estado <> 'pendiente' then
    raise exception 'La orden % ya está %; no admite cambios.', old.numero_orden, old.estado;
  end if;

  new.numero_factura_proveedor := interno.texto_limpio(new.numero_factura_proveedor);
  new.numero_control_proveedor := interno.texto_limpio(new.numero_control_proveedor);

  select coalesce(sum(d.subtotal_usd), 0), coalesce(sum(d.subtotal_usd) filter (where p.exento_iva), 0)
    into new.total_usd, new.exento_usd
    from public.detalles_orden_compra d join public.productos p on p.id = d.producto_id
   where d.orden_id = new.id;

  if new.estado = 'recibida' then
    if new.numero_factura_proveedor is null then
      raise exception 'Indique el número de factura del proveedor antes de recibir la orden %.', new.numero_orden;
    end if;
    if new.numero_control_proveedor is null then
      raise exception 'Indique el número de control de la factura del proveedor antes de recibir la orden %.', new.numero_orden;
    end if;
    -- Bloquea al proveedor para que dos recepciones simultáneas no registren la misma factura.
    perform 1 from public.proveedores where id = new.proveedor_id for update;
    select numero_orden into v_otra from public.ordenes_compra
     where proveedor_id = new.proveedor_id and id <> new.id and estado = 'recibida'
       and upper(numero_factura_proveedor) = upper(new.numero_factura_proveedor)
     limit 1;
    if v_otra is not null then
      raise exception 'La factura % de este proveedor ya está registrada en la orden %.', new.numero_factura_proveedor, v_otra;
    end if;

    select alicuota_iva into v_alicuota from public.configuracion_empresa where id = 'default';
    new.iva_usd := round((new.total_usd - new.exento_usd) * v_alicuota / 100, 2);
    new.recibida_en := interno.fecha_operacion();
    new.recibida_por := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function interno.ordenes_al_recibir()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  d record;
  v_dia date := (new.recibida_en at time zone 'America/Caracas')::date;
  v_proveedor public.proveedores%rowtype;
  v_agente boolean;
  v_retencion numeric(14, 2) := 0;
  v_tasa numeric(18, 4);
begin
  if new.total_usd <= 0 then
    raise exception 'La orden % no tiene líneas valoradas.', new.numero_orden;
  end if;

  for d in select * from public.detalles_orden_compra where orden_id = new.id loop
    perform interno.mover_stock(
      d.producto_id, d.cantidad, 'COMPRA', d.precio_unitario_usd,
      'ORDEN_COMPRA', new.id, 'Recepción ' || new.numero_orden
    );
  end loop;

  select * into v_proveedor from public.proveedores where id = new.proveedor_id;
  select contribuyente_especial into v_agente from public.configuracion_empresa where id = 'default';
  v_tasa := public.tasa_vigente(v_dia);

  -- Como agente de retención se retiene el % del IVA del proveedor (base: solo lo gravado).
  if v_agente and new.iva_usd > 0 and v_proveedor.porcentaje_retencion_iva > 0 then
    v_retencion := round(new.iva_usd * v_proveedor.porcentaje_retencion_iva / 100, 2);
    insert into public.retenciones_iva (
      tipo, numero_comprobante, fecha, orden_id, tercero_rif, tercero_nombre, numero_factura, numero_control,
      base_usd, iva_usd, porcentaje, monto_retenido_usd, tasa, estado
    ) values (
      'EMITIDA', interno.numero_comprobante_retencion(v_dia), v_dia, new.id, v_proveedor.rif, v_proveedor.nombre,
      new.numero_factura_proveedor, new.numero_control_proveedor,
      new.total_usd - new.exento_usd, new.iva_usd, v_proveedor.porcentaje_retencion_iva, v_retencion, v_tasa, 'REGISTRADA'
    );
    update public.ordenes_compra set iva_retenido_usd = v_retencion where id = new.id;
  end if;

  -- El proveedor cobra el total menos lo retenido.
  insert into public.cuentas_por_pagar (orden_id, proveedor_id, monto_usd, saldo_usd, fecha_emision, fecha_vencimiento)
  values (new.id, new.proveedor_id, new.total_usd + new.iva_usd - v_retencion,
          new.total_usd + new.iva_usd - v_retencion, v_dia, v_dia + 30);

  perform interno.registrar_asiento(
    v_dia,
    'Compra ' || new.numero_orden || ' a ' || v_proveedor.nombre
      || coalesce(' (factura ' || new.numero_factura_proveedor || ')', ''),
    'Compras',
    jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_INVENTARIO', 'debe', new.total_usd, 'descripcion', 'Mercancía recibida'),
      jsonb_build_object('cuenta_clave', 'CTA_CXP_PROVEEDORES', 'haber', new.total_usd + new.iva_usd - v_retencion,
                         'descripcion', v_proveedor.nombre))
    || case when new.iva_usd > 0 then jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_IVA_CREDITO', 'debe', new.iva_usd, 'descripcion', 'IVA crédito fiscal'))
       else '[]'::jsonb end
    || case when v_retencion > 0 then jsonb_build_array(
      jsonb_build_object('cuenta_clave', 'CTA_IVA_RETENIDO_POR_ENTERAR', 'haber', v_retencion,
                         'descripcion', 'Retención IVA ' || v_proveedor.porcentaje_retencion_iva || ' %'))
       else '[]'::jsonb end,
    v_tasa, 'ORDEN_COMPRA', new.id);
  return null;
end;
$$;

alter table public.ordenes_compra
  add constraint ordenes_compra_factura_al_recibir check (
    estado <> 'recibida' or (numero_factura_proveedor is not null and numero_control_proveedor is not null)) not valid;

-- Respaldo de la regla "una factura del proveedor, una sola orden recibida".
select interno.intentar_ddl(
  'create unique index ordenes_compra_factura_proveedor_unica on public.ordenes_compra '
  || '(proveedor_id, upper(numero_factura_proveedor)) where estado = ''recibida''',
  'Índice ordenes_compra_factura_proveedor_unica no creado (facturas de proveedor repetidas en datos históricos; el trigger aplica la regla a las nuevas)');

-- Libro de compras con la parte exenta separada (hallazgo 3).
create or replace function public.libro_compras(p_anio int, p_mes int)
returns table (
  fecha date, numero_orden text, numero_factura text, numero_control text, rif text, nombre text,
  total_bs numeric, exento_bs numeric, base_bs numeric, alicuota numeric, iva_bs numeric,
  iva_retenido_bs numeric, comprobante_retencion text, tasa numeric,
  total_usd numeric, base_usd numeric, iva_usd numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_alicuota numeric := (select alicuota_iva from public.configuracion_empresa where id = 'default');
begin
  perform interno.exigir_direccion();
  return query
    select (o.recibida_en at time zone 'America/Caracas')::date, o.numero_orden,
           coalesce(o.numero_factura_proveedor, 'S/N'), coalesce(o.numero_control_proveedor, 'S/N'),
           p.rif, p.nombre,
           round((o.total_usd + o.iva_usd) * x.tasa, 2), round(o.exento_usd * x.tasa, 2),
           round((o.total_usd - o.exento_usd) * x.tasa, 2),
           v_alicuota, round(o.iva_usd * x.tasa, 2), round(o.iva_retenido_usd * x.tasa, 2),
           r.numero_comprobante, x.tasa,
           o.total_usd + o.iva_usd, o.total_usd - o.exento_usd, o.iva_usd
      from public.ordenes_compra o
      join public.proveedores p on p.id = o.proveedor_id
      join lateral (select public.tasa_vigente((o.recibida_en at time zone 'America/Caracas')::date) as tasa) x on true
      left join public.retenciones_iva r on r.orden_id = o.id
     where o.estado = 'recibida'
       and extract(year from o.recibida_en at time zone 'America/Caracas') = p_anio
       and extract(month from o.recibida_en at time zone 'America/Caracas') = p_mes
     order by o.recibida_en, o.numero_orden;
end;
$$;

-- =============================================================================
-- Retenciones (hallazgos 12 y 14)
-- =============================================================================
-- El número del comprobante RECIBIDO lo pone cada cliente: es único por
-- tercero, no global. Los EMITIDOS (numeración propia) siguen siendo únicos.
alter table public.retenciones_iva drop constraint retenciones_iva_numero_comprobante_key;
alter table public.retenciones_iva
  add constraint retenciones_iva_comprobante_por_tercero unique (tipo, tercero_rif, numero_comprobante);
create unique index retenciones_iva_emitidas_numero on public.retenciones_iva (numero_comprobante) where tipo = 'EMITIDA';

create or replace function interno.registrar_comprobante_recibido(p_retencion_id uuid, p_numero text, p_fecha date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ret public.retenciones_iva%rowtype;
  v_fecha date;
begin
  if p_numero is null or p_numero !~ '^[0-9]{14}$' then
    raise exception 'El número de comprobante debe tener 14 dígitos (AAAAMM + 8 dígitos).';
  end if;
  select * into v_ret from public.retenciones_iva
   where id = p_retencion_id and tipo = 'RECIBIDA' and estado = 'PENDIENTE' for update;
  if not found then
    raise exception 'La retención no existe o ya tiene comprobante.';
  end if;

  v_fecha := coalesce(p_fecha, v_ret.fecha);
  if v_fecha > current_date then
    raise exception 'La fecha del comprobante (%) no puede ser futura.', to_char(v_fecha, 'DD/MM/YYYY');
  end if;
  if v_fecha < v_ret.fecha then
    raise exception 'La fecha del comprobante (%) no puede ser anterior a la del documento retenido (%).',
      to_char(v_fecha, 'DD/MM/YYYY'), to_char(v_ret.fecha, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.retenciones_iva
              where tipo = 'RECIBIDA' and tercero_rif = v_ret.tercero_rif and numero_comprobante = p_numero and id <> v_ret.id) then
    raise exception 'El comprobante % ya está registrado para %.', p_numero, coalesce(v_ret.tercero_nombre, v_ret.tercero_rif);
  end if;

  update public.retenciones_iva
     set numero_comprobante = p_numero, fecha = v_fecha, estado = 'REGISTRADA'
   where id = v_ret.id;
end;
$$;

create or replace function interno.enterar_retenciones_iva(
  p_anio int, p_mes int, p_quincena int, p_metodo_id text default 'transferencia', p_fecha date default current_date
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_total_usd numeric(14, 2);
  v_total_bs numeric(18, 2);
  v_cantidad int;
  v_tasa numeric(18, 4) := public.tasa_vigente(p_fecha);
  v_pago_usd numeric(14, 2);
  v_dif numeric(14, 2);
  v_metodo public.metodos_pago_contables%rowtype;
  v_asiento uuid;
  v_lineas jsonb;
begin
  -- Se paga al SENIAT en bolívares desde caja o banco.
  select * into v_metodo from public.metodos_pago_contables where metodo_id = p_metodo_id;
  if not found or p_metodo_id in ('credito', 'cashea', 'retencion_iva') or v_metodo.es_divisa then
    raise exception 'Medio de pago inválido para enterar retenciones: use transferencia, pago móvil o efectivo en bolívares.';
  end if;
  if v_tasa is null then
    raise exception 'No hay tasa BCV registrada para el %.', to_char(p_fecha, 'DD/MM/YYYY');
  end if;

  select coalesce(sum(monto_retenido_usd), 0), coalesce(sum(monto_retenido_bs), 0), count(*)
    into v_total_usd, v_total_bs, v_cantidad
    from public.retenciones_iva
   where tipo = 'EMITIDA' and estado = 'REGISTRADA'
     and anio = p_anio and mes = p_mes and quincena = p_quincena;
  if v_cantidad = 0 then
    raise exception 'No hay retenciones por enterar en la quincena %/%/%.', p_quincena, p_mes, p_anio;
  end if;

  -- Se paga el mismo monto en Bs; su equivalente en USD depende de la tasa de hoy.
  v_pago_usd := round(v_total_bs / v_tasa, 2);
  v_dif := v_total_usd - v_pago_usd;

  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta_clave', 'CTA_IVA_RETENIDO_POR_ENTERAR', 'debe', v_total_usd, 'debe_ves', v_total_bs,
                       'descripcion', v_cantidad || ' comprobante(s) de retención'),
    jsonb_build_object('cuenta_id', v_metodo.cuenta_id, 'haber', v_pago_usd, 'haber_ves', v_total_bs,
                       'descripcion', 'Pago al SENIAT'));
  if v_dif > 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_DIF_CAMBIARIO_GANANCIA', 'haber', v_dif, 'haber_ves', 0,
                                               'descripcion', 'Menor equivalente en USD de una obligación en Bs');
  elsif v_dif < 0 then
    v_lineas := v_lineas || jsonb_build_object('cuenta_clave', 'CTA_DIF_CAMBIARIO_PERDIDA', 'debe', -v_dif, 'debe_ves', 0,
                                               'descripcion', 'Mayor equivalente en USD de una obligación en Bs');
  end if;

  v_asiento := interno.registrar_asiento(
    p_fecha,
    format('Enteramiento de retenciones de IVA, %s quincena %s/%s', case p_quincena when 1 then '1ra' else '2da' end, lpad(p_mes::text, 2, '0'), p_anio),
    'Tesorería', v_lineas, v_tasa, 'ENTERAMIENTO_IVA', null);

  update public.retenciones_iva
     set estado = 'ENTERADA', enterada_en = p_fecha, asiento_entero_id = v_asiento
   where tipo = 'EMITIDA' and estado = 'REGISTRADA'
     and anio = p_anio and mes = p_mes and quincena = p_quincena;

  return jsonb_build_object('comprobantes', v_cantidad, 'total_bs', v_total_bs, 'pagado_usd', v_pago_usd,
                            'diferencial_usd', v_dif, 'asiento_id', v_asiento);
end;
$$;

-- =============================================================================
-- Tasa BCV (hallazgo 16): no se crea ni cambia la tasa de un día que ya tiene
-- operaciones (facturas, notas, cobros, pagos, compras o asientos) ni de un
-- período cerrado. La tasa de HOY sí se crea aunque ya haya operaciones (las
-- de hoy usaron la de ayer de forma provisional y facturar exige la de hoy).
-- =============================================================================
create or replace function interno.operaciones_en_fecha(p_fecha date, p_tasa_id uuid default null)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_partes text[] := '{}';
begin
  if exists (select 1 from public.periodos_contables
              where anio = extract(year from p_fecha) and mes = extract(month from p_fecha) and estado = 'CERRADO') then
    return format('el período %s está cerrado', to_char(p_fecha, 'MM/YYYY'));
  end if;
  if exists (select 1 from public.facturas
              where tasa_id = p_tasa_id or (fecha_emision at time zone 'America/Caracas')::date = p_fecha) then
    v_partes := v_partes || 'facturas'::text;
  end if;
  if exists (select 1 from public.notas_fiscales where (fecha_emision at time zone 'America/Caracas')::date = p_fecha) then
    v_partes := v_partes || 'notas de crédito/débito'::text;
  end if;
  if exists (select 1 from public.abonos_cxc where (fecha at time zone 'America/Caracas')::date = p_fecha) then
    v_partes := v_partes || 'cobros'::text;
  end if;
  if exists (select 1 from public.pagos_cxp where (fecha at time zone 'America/Caracas')::date = p_fecha) then
    v_partes := v_partes || 'pagos a proveedores'::text;
  end if;
  if exists (select 1 from public.ordenes_compra
              where estado = 'recibida' and (recibida_en at time zone 'America/Caracas')::date = p_fecha) then
    v_partes := v_partes || 'compras'::text;
  end if;
  if exists (select 1 from public.asientos_contables where fecha = p_fecha) then
    v_partes := v_partes || 'asientos contables'::text;
  end if;
  if cardinality(v_partes) = 0 then
    return null;
  end if;
  return format('el %s ya tiene operaciones registradas (%s)', to_char(p_fecha, 'DD/MM/YYYY'), array_to_string(v_partes, ', '));
end;
$$;

create or replace function interno.guardar_tasa(
  p_fecha date, p_usd numeric, p_eur numeric, p_fuente text, p_origen text, p_tolerancia numeric default 0.25
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_usd numeric(18, 4) := round(p_usd, 4);
  v_eur numeric(18, 4) := round(p_eur, 4);
  v_actual public.tasas_cambio%rowtype;
  v_existe boolean;
  v_previa numeric;
  v_motivo text;
  v_estado text;
  v_detalle text;
begin
  if v_usd is null or v_usd <= 0 then
    raise exception 'Tasa inválida: %', p_usd;
  end if;
  if p_fecha is null then
    raise exception 'Indique la fecha de la tasa.';
  end if;
  if p_fecha > current_date + 3 then
    raise exception 'No se registran tasas con fecha valor de más de 3 días en el futuro.';
  end if;

  select t.tasa_usd_bs into v_previa from public.tasas_cambio t
   where t.fecha_registro < p_fecha order by t.fecha_registro desc limit 1;
  if v_previa is not null and abs(v_usd / v_previa - 1) > p_tolerancia then
    v_estado := 'BLOQUEADA';
    v_detalle := format('Variación de %s %% frente a la tasa anterior (%s); supera la tolerancia de %s %%.',
                        round(100 * (v_usd / v_previa - 1), 1), v_previa, round(100 * p_tolerancia));
  else
    select * into v_actual from public.tasas_cambio where fecha_registro = p_fecha for update;
    v_existe := found;
    if v_existe and v_actual.tasa_usd_bs = v_usd then
      v_estado := 'SIN_CAMBIOS';
    else
      if v_existe or p_fecha < current_date then
        v_motivo := interno.operaciones_en_fecha(p_fecha, v_actual.id);
      end if;
      if v_motivo is not null then
        v_estado := 'BLOQUEADA';
        v_detalle := format('No se %s la tasa del %s a %s: %s.',
                            case when v_existe then 'cambia' else 'registra' end,
                            to_char(p_fecha, 'DD/MM/YYYY'), v_usd, v_motivo);
      elsif not v_existe then
        insert into public.tasas_cambio (fecha_registro, tasa_usd_bs, tasa_eur_bs, fuente)
        values (p_fecha, v_usd, v_eur, p_fuente);
        v_estado := 'CREADA';
      else
        update public.tasas_cambio
           set tasa_usd_bs = v_usd, tasa_eur_bs = coalesce(v_eur, tasa_eur_bs), fuente = p_fuente,
               registrado_por = auth.uid(), created_at = now()
         where id = v_actual.id;
        v_estado := 'ACTUALIZADA';
        v_detalle := format('Antes %s.', v_actual.tasa_usd_bs);
      end if;
    end if;
  end if;

  insert into public.sincronizaciones_bcv (origen, estado, fecha_tasa, tasa_usd, detalle)
  values (p_origen, v_estado, p_fecha, v_usd, v_detalle);

  return jsonb_build_object('estado', v_estado, 'fecha', p_fecha, 'tasa_usd', v_usd, 'detalle', v_detalle);
end;
$$;

-- =============================================================================
-- Metas de ventas (hallazgo 37) y eliminación de usuarios (hallazgo 36)
-- =============================================================================
-- Las metas de meses ya transcurridos no se tocan desde la app, y cada meta
-- individual es de un usuario activo que puede facturar.
create or replace function interno.metas_validar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_mes_actual date := date_trunc('month', current_date)::date;
begin
  if auth.uid() is not null then
    if tg_op in ('UPDATE', 'DELETE') and make_date(old.anio, old.mes, 1) < v_mes_actual then
      raise exception 'La meta de %/% corresponde a un mes ya transcurrido: no se modifica ni se elimina.',
        lpad(old.mes::text, 2, '0'), old.anio;
    end if;
    if tg_op in ('INSERT', 'UPDATE') and make_date(new.anio, new.mes, 1) < v_mes_actual then
      raise exception 'No se registran metas para meses ya transcurridos (%/%).', lpad(new.mes::text, 2, '0'), new.anio;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.vendedor_id is not null
     and not exists (select 1 from public.usuarios
                      where id = new.vendedor_id and activo and rol in ('admin', 'gerente', 'vendedor')) then
    raise exception 'La meta debe asignarse a un usuario activo que pueda facturar (vendedor, gerente o administrador).';
  end if;
  return new;
end;
$$;

create trigger trg_metas_validar
before insert or update or delete on public.metas_ventas
for each row execute function interno.metas_validar();

-- Borrar un usuario ya no borra sus metas en cascada.
alter table public.metas_ventas drop constraint metas_ventas_vendedor_id_fkey;
alter table public.metas_ventas
  add constraint metas_ventas_vendedor_id_fkey foreign key (vendedor_id) references public.usuarios (id) on delete restrict;

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
  if not exists (select 1 from public.usuarios where id = p_user_id) then
    raise exception 'El usuario no existe.';
  end if;
  if exists (select 1 from public.facturas where vendedor_id = p_user_id or anulada_por = p_user_id)
     or exists (select 1 from public.notas_fiscales where emitida_por = p_user_id)
     or exists (select 1 from public.ordenes_compra where registrado_por = p_user_id or recibida_por = p_user_id)
     or exists (select 1 from public.tasas_cambio where registrado_por = p_user_id)
     or exists (select 1 from public.movimientos_inventario where usuario_id = p_user_id)
     or exists (select 1 from public.asientos_contables where registrado_por = p_user_id or anulado_por = p_user_id)
     or exists (select 1 from public.abonos_cxc where registrado_por = p_user_id or anulado_por = p_user_id)
     or exists (select 1 from public.pagos_cxp where registrado_por = p_user_id)
     or exists (select 1 from public.metas_ventas where vendedor_id = p_user_id or creada_por = p_user_id)
     or exists (select 1 from public.periodos_contables where cerrado_por = p_user_id)
     or exists (select 1 from public.ejercicios_contables where cerrado_por = p_user_id)
     or exists (select 1 from public.auditoria where usuario_id = p_user_id) then
    raise exception 'El usuario tiene operaciones registradas y no puede eliminarse. Desactívelo para conservar la trazabilidad.';
  end if;

  begin
    delete from public.usuarios where id = p_user_id;
    delete from auth.users where id = p_user_id;
  exception when foreign_key_violation then
    raise exception 'El usuario tiene operaciones registradas y no puede eliminarse. Desactívelo para conservar la trazabilidad.';
  end;
end;
$$;

-- =============================================================================
-- Reportes: rangos de fecha (hallazgo 39)
-- =============================================================================
create or replace function public.saldos_cuentas(p_desde date default null, p_hasta date default null)
returns table (
  cuenta_id uuid, codigo text, nombre text, tipo text, naturaleza text,
  debe numeric, haber numeric, debe_ves numeric, haber_ves numeric,
  saldo numeric, saldo_ves numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform interno.validar_rango(p_desde, p_hasta);
  return query
    select c.id, c.codigo, c.nombre, c.tipo, c.naturaleza,
           coalesce(sum(l.debe), 0), coalesce(sum(l.haber), 0),
           coalesce(sum(l.debe_ves), 0), coalesce(sum(l.haber_ves), 0),
           case when c.tipo in ('ACTIVO', 'COSTO', 'GASTO')
                then coalesce(sum(l.debe), 0) - coalesce(sum(l.haber), 0)
                else coalesce(sum(l.haber), 0) - coalesce(sum(l.debe), 0) end,
           case when c.tipo in ('ACTIVO', 'COSTO', 'GASTO')
                then coalesce(sum(l.debe_ves), 0) - coalesce(sum(l.haber_ves), 0)
                else coalesce(sum(l.haber_ves), 0) - coalesce(sum(l.debe_ves), 0) end
      from public.plan_cuentas c
      join public.lineas_asiento l on l.cuenta_id = c.id
      join public.asientos_contables a on a.id = l.asiento_id
     where (public.tiene_rol('admin', 'gerente', 'contador') or coalesce(current_setting('arluc.sistema', true), 'off') = 'on')
       and not c.es_padre
       and (p_desde is null or a.fecha >= p_desde)
       and (p_hasta is null or a.fecha <= p_hasta)
       and (p_desde is null or a.modulo <> 'Cierre')
     group by c.id
     order by c.codigo;
end;
$$;

create or replace function public.reporte_a_solicitud(p_desde date, p_hasta date, p_dimension text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform interno.exigir_direccion();
  if p_desde is null or p_hasta is null then
    raise exception 'Indique el rango de fechas del reporte.';
  end if;
  perform interno.validar_rango(p_desde, p_hasta);
  if p_dimension not in ('producto', 'categoria', 'vendedor', 'cliente', 'dia', 'semana', 'mes', 'hora', 'dia_semana') then
    raise exception 'Dimensión no válida: %', p_dimension;
  end if;
  return jsonb_build_object(
    'filas', interno.ventas_por(p_desde, p_hasta, p_dimension, 1000),
    'verificaciones', interno.verificaciones_confiabilidad(p_desde, p_hasta));
end;
$$;

-- =============================================================================
-- Validación de las CHECK nuevas contra los datos existentes
-- (facturas_cliente_obligatorio queda NOT VALID a propósito).
-- =============================================================================
do $$
declare
  r record;
begin
  for r in select * from (values
      ('public.clientes', 'clientes_nombre_obligatorio'), ('public.clientes', 'clientes_documento_formato'),
      ('public.clientes', 'clientes_telefono_formato'), ('public.clientes', 'clientes_email_formato'),
      ('public.clientes', 'clientes_contribuyente_rif'),
      ('public.proveedores', 'proveedores_nombre_obligatorio'), ('public.proveedores', 'proveedores_rif_formato'),
      ('public.proveedores', 'proveedores_telefono_formato'), ('public.proveedores', 'proveedores_email_formato'),
      ('public.categorias', 'categorias_nombre_obligatorio'),
      ('public.productos', 'productos_nombre_obligatorio'), ('public.productos', 'productos_sku_normalizado'),
      ('public.productos', 'productos_precio_positivo'),
      ('public.configuracion_empresa', 'configuracion_empresa_nombre_obligatorio'),
      ('public.configuracion_empresa', 'configuracion_empresa_rif_formato'),
      ('public.configuracion_empresa', 'configuracion_empresa_url_bcv'),
      ('public.plan_cuentas', 'plan_cuentas_nombre_obligatorio'),
      ('public.detalles_orden_compra', 'detalles_orden_precio_positivo'),
      ('public.ordenes_compra', 'ordenes_compra_factura_al_recibir')
    ) as v(tabla, restriccion) loop
    perform interno.intentar_ddl(
      format('alter table %s validate constraint %I', r.tabla, r.restriccion),
      format('La restricción %s queda NOT VALID (hay datos históricos que no la cumplen; rige para los datos nuevos)', r.restriccion));
  end loop;
end;
$$;

-- sig_resumen (versión de la migración 5): con un rango invertido v_dias era <= 0
-- y los indicadores por día dividían entre cero.
create or replace function public.sig_resumen(p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_dias int := p_hasta - p_desde + 1;
  v_prev_desde date := p_desde - (p_hasta - p_desde + 1);
  v_prev_hasta date := p_desde - 1;
  v_act jsonb;
  v_ant jsonb;
  v_saldos jsonb;
  v_cartera jsonb;
  v_inventario numeric;
  v_ac numeric; v_pc numeric; v_activo numeric; v_pasivo numeric; v_patrimonio numeric;
  v_resultado jsonb;
  v_metodos jsonb;
  v_ventas_credito numeric;
begin
  perform interno.exigir_direccion();
  perform interno.validar_rango(p_desde, p_hasta);
  if p_desde is null or p_hasta is null then
    raise exception 'Indique el rango de fechas del resumen.';
  end if;

  select jsonb_build_object(
           'ventas_netas', coalesce(sum(venta_neta), 0),
           'facturado_total', coalesce(sum(total), 0),
           'iva', coalesce(sum(iva), 0),
           'igtf', coalesce(sum(igtf), 0),
           'costo_ventas', coalesce(sum(costo), 0),
           'margen_bruto', coalesce(sum(venta_neta - costo), 0),
           'margen_pct', case when sum(venta_neta) > 0 then round(100 * sum(venta_neta - costo) / sum(venta_neta), 2) else 0 end,
           'facturas', count(*),
           'unidades', coalesce(sum(unidades), 0),
           'ticket_promedio', case when count(*) > 0 then round(sum(venta_neta) / count(*), 2) else 0 end,
           'clientes_unicos', count(distinct cliente_id))
    into v_act from interno.ventas_rango(p_desde, p_hasta);

  select jsonb_build_object(
           'ventas_netas', coalesce(sum(venta_neta), 0),
           'margen_bruto', coalesce(sum(venta_neta - costo), 0),
           'margen_pct', case when sum(venta_neta) > 0 then round(100 * sum(venta_neta - costo) / sum(venta_neta), 2) else 0 end,
           'facturas', count(*),
           'ticket_promedio', case when count(*) > 0 then round(sum(venta_neta) / count(*), 2) else 0 end)
    into v_ant from interno.ventas_rango(v_prev_desde, v_prev_hasta);

  -- Mezcla de medios de cobro (montos aplicados a la factura, sin IGTF).
  select coalesce(jsonb_object_agg(metodo, monto), '{}'::jsonb) into v_metodos
    from (select case when p ->> 'metodo_id' = 'cashea' then 'Cashea (inicial)' else coalesce(p ->> 'metodo', p ->> 'metodo_id') end as metodo,
                 round(sum(coalesce((p ->> 'aplicado_usd')::numeric, (p ->> 'monto_usd')::numeric)), 2) as monto
            from interno.ventas_rango(p_desde, p_hasta) v, jsonb_array_elements(v.metodos_pago) p
           group by 1) m;
  -- Lo financiado por Cashea también es medio de cobro.
  v_metodos := v_metodos || jsonb_build_object('Cashea (financiado)', (
    select coalesce(sum(c.monto_usd), 0) from public.cuentas_por_cobrar c
      join public.facturas f on f.id = c.factura_id
     where c.tipo = 'CASHEA' and f.estado = 'emitida'
       and (f.fecha_emision at time zone 'America/Caracas')::date between p_desde and p_hasta));

  -- Resultado contable del período (incluye gastos y diferencial cambiario).
  select jsonb_build_object(
           'ingresos', coalesce(sum(saldo) filter (where tipo = 'INGRESO'), 0),
           'costos', coalesce(sum(saldo) filter (where tipo = 'COSTO'), 0),
           'gastos', coalesce(sum(saldo) filter (where tipo = 'GASTO'), 0),
           'utilidad_neta', coalesce(sum(saldo) filter (where tipo = 'INGRESO'), 0)
                            - coalesce(sum(saldo) filter (where tipo in ('COSTO', 'GASTO')), 0),
           'diferencial_cambiario_bs',
             coalesce(sum(saldo_ves) filter (where codigo = '4.2.01.01'), 0)
             - coalesce(sum(saldo_ves) filter (where codigo = '6.2.01.01'), 0))
    into v_resultado from public.saldos_cuentas(p_desde, p_hasta);

  -- Situación financiera al corte.
  select coalesce(sum(saldo) filter (where codigo like '1.1.%'), 0),
         coalesce(sum(saldo) filter (where codigo like '2.1.%'), 0),
         coalesce(sum(saldo) filter (where tipo = 'ACTIVO'), 0),
         coalesce(sum(saldo) filter (where tipo = 'PASIVO'), 0),
         coalesce(sum(saldo) filter (where tipo = 'PATRIMONIO'), 0)
           + coalesce(sum(saldo) filter (where tipo = 'INGRESO'), 0)
           - coalesce(sum(saldo) filter (where tipo in ('COSTO', 'GASTO')), 0)
    into v_ac, v_pc, v_activo, v_pasivo, v_patrimonio
    from public.saldos_cuentas(null, p_hasta);

  select coalesce(sum(stock * costo_usd), 0) into v_inventario from public.productos;

  select jsonb_build_object(
           'cxc_pendiente', coalesce(sum(saldo_total_usd) filter (where tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE'), 0),
           'cxc_vencida', coalesce(sum(saldo_total_usd) filter (where tipo = 'CREDITO_DIRECTO' and vencida), 0),
           'cuentas_vencidas', count(*) filter (where vencida),
           'cashea_por_cobrar', coalesce(sum(capital_pendiente_usd) filter (where tipo = 'CASHEA' and estado = 'PENDIENTE'), 0))
    into v_cartera from public.v_cuentas_por_cobrar where tipo in ('CREDITO_DIRECTO', 'CASHEA');

  -- Ventas a crédito (directo + Cashea) del período: base del DSO.
  select coalesce(sum(c.monto_usd), 0) into v_ventas_credito
    from public.cuentas_por_cobrar c join public.facturas f on f.id = c.factura_id
   where f.estado = 'emitida'
     and (f.fecha_emision at time zone 'America/Caracas')::date between p_desde and p_hasta;

  return jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'dias', v_dias,
                                  'anterior_desde', v_prev_desde, 'anterior_hasta', v_prev_hasta),
    'actual', v_act,
    'anterior', v_ant,
    'variacion_pct', jsonb_build_object(
      'ventas_netas', case when (v_ant ->> 'ventas_netas')::numeric > 0
        then round(100 * ((v_act ->> 'ventas_netas')::numeric / (v_ant ->> 'ventas_netas')::numeric - 1), 1) end,
      'margen_bruto', case when (v_ant ->> 'margen_bruto')::numeric > 0
        then round(100 * ((v_act ->> 'margen_bruto')::numeric / (v_ant ->> 'margen_bruto')::numeric - 1), 1) end,
      'facturas', case when (v_ant ->> 'facturas')::numeric > 0
        then round(100 * ((v_act ->> 'facturas')::numeric / (v_ant ->> 'facturas')::numeric - 1), 1) end,
      'ticket_promedio', case when (v_ant ->> 'ticket_promedio')::numeric > 0
        then round(100 * ((v_act ->> 'ticket_promedio')::numeric / (v_ant ->> 'ticket_promedio')::numeric - 1), 1) end),
    'resultado', v_resultado,
    'metodos_pago', v_metodos,
    'cartera', v_cartera || jsonb_build_object(
      'morosidad_pct', case when (v_cartera ->> 'cxc_pendiente')::numeric > 0
        then round(100 * (v_cartera ->> 'cxc_vencida')::numeric / (v_cartera ->> 'cxc_pendiente')::numeric, 1) else 0 end,
      'ventas_credito', v_ventas_credito,
      'credito_pct_ventas', case when (v_act ->> 'facturado_total')::numeric > 0
        then round(100 * v_ventas_credito / (v_act ->> 'facturado_total')::numeric, 1) else 0 end,
      -- Días promedio de cobro (DSO) = cartera pendiente / ventas a crédito diarias
      'dso_dias', case when v_ventas_credito > 0
        then round(((v_cartera ->> 'cxc_pendiente')::numeric + (v_cartera ->> 'cashea_por_cobrar')::numeric)
                   / (v_ventas_credito / v_dias), 1) else 0 end),
    'inventario', jsonb_build_object(
      'valor_costo', round(v_inventario, 2),
      'rotacion_anual', case when v_inventario > 0
        then round((v_act ->> 'costo_ventas')::numeric / v_inventario * 365.0 / v_dias, 2) else 0 end,
      'dias_inventario', case when (v_act ->> 'costo_ventas')::numeric > 0
        then round(v_inventario / ((v_act ->> 'costo_ventas')::numeric / v_dias), 1) else null end),
    'financiero', jsonb_build_object(
      'activo_corriente', v_ac, 'pasivo_corriente', v_pc,
      'liquidez_corriente', case when v_pc > 0 then round(v_ac / v_pc, 2) end,
      'prueba_acida', case when v_pc > 0 then round((v_ac - v_inventario) / v_pc, 2) end,
      'endeudamiento_pct', case when v_activo > 0 then round(100 * v_pasivo / v_activo, 1) end,
      'patrimonio', v_patrimonio,
      'cxp_pendiente', (select coalesce(sum(saldo_usd), 0) from public.cuentas_por_pagar where estado = 'PENDIENTE'))
  );
end;
$$;

drop function interno.intentar_ddl(text, text);

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
