-- =============================================================================
-- ARLUC SIG · Migración 6: Tasa BCV automática
-- -----------------------------------------------------------------------------
-- * El SERVIDOR consulta la tasa oficial (extensión http) y la registra; el
--   navegador ya no envía montos de tasa, solo pide sincronizar.
-- * pg_cron la sincroniza cada 30 minutos aunque nadie tenga la app abierta.
-- * Salvaguardas: se rechaza una variación > 25 % frente a la tasa anterior
--   (dato corrupto) y no se modifica la tasa de un día que ya tiene facturas
--   (cambiaría el valor en Bs de documentos emitidos).
-- * Cada intento queda en la bitácora sincronizaciones_bcv.
-- =============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

alter table public.configuracion_empresa
  add column url_api_bcv text not null default 'https://chitty400.github.io/chitty-bcv-api/latest.json';

create table public.sincronizaciones_bcv (
  id         bigint generated always as identity primary key,
  fecha      timestamptz not null default now(),
  origen     text not null check (origen in ('CRON', 'APP', 'MANUAL')),
  estado     text not null check (estado in ('CREADA', 'ACTUALIZADA', 'SIN_CAMBIOS', 'BLOQUEADA', 'ERROR')),
  fecha_tasa date,
  tasa_usd   numeric(18, 4),
  detalle    text,
  usuario_id uuid default auth.uid()
);
create index on public.sincronizaciones_bcv (fecha desc);
alter table public.sincronizaciones_bcv enable row level security;
create policy sincronizaciones_select on public.sincronizaciones_bcv for select to authenticated
  using ((select public.rol_actual()) is not null);

-- -----------------------------------------------------------------------------
-- Registro validado de una tasa para una fecha valor
-- -----------------------------------------------------------------------------
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
  v_previa numeric;
  v_estado text;
  v_detalle text;
begin
  if v_usd is null or v_usd <= 0 then
    raise exception 'Tasa inválida: %', p_usd;
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
    if not found then
      insert into public.tasas_cambio (fecha_registro, tasa_usd_bs, tasa_eur_bs, fuente)
      values (p_fecha, v_usd, v_eur, p_fuente);
      v_estado := 'CREADA';
    elsif v_actual.tasa_usd_bs = v_usd then
      v_estado := 'SIN_CAMBIOS';
    elsif exists (select 1 from public.facturas where tasa_id = v_actual.id) then
      v_estado := 'BLOQUEADA';
      v_detalle := format('El %s ya tiene facturas emitidas con %s; no se cambia a %s.',
                          to_char(p_fecha, 'DD/MM/YYYY'), v_actual.tasa_usd_bs, v_usd);
    else
      update public.tasas_cambio
         set tasa_usd_bs = v_usd, tasa_eur_bs = coalesce(v_eur, tasa_eur_bs), fuente = p_fuente,
             registrado_por = auth.uid(), created_at = now()
       where id = v_actual.id;
      v_estado := 'ACTUALIZADA';
      v_detalle := format('Antes %s.', v_actual.tasa_usd_bs);
    end if;
  end if;

  insert into public.sincronizaciones_bcv (origen, estado, fecha_tasa, tasa_usd, detalle)
  values (p_origen, v_estado, p_fecha, v_usd, v_detalle);

  return jsonb_build_object('estado', v_estado, 'fecha', p_fecha, 'tasa_usd', v_usd, 'detalle', v_detalle);
end;
$$;

-- -----------------------------------------------------------------------------
-- Sincronización con la API oficial
-- -----------------------------------------------------------------------------
create or replace function interno.sincronizar_tasa_bcv(p_origen text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_resp extensions.http_response;
  v_json jsonb;
  v_usd numeric;
  v_eur numeric;
  v_resultado jsonb;
  v_adelantada jsonb;
begin
  select url_api_bcv into v_url from public.configuracion_empresa where id = 'default';

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '10');
    v_resp := extensions.http_get(v_url);
    if v_resp.status <> 200 then
      raise exception 'HTTP %', v_resp.status;
    end if;
    v_json := v_resp.content::jsonb;
    v_usd := coalesce((v_json -> 'tasas' ->> 'usd')::numeric, (v_json ->> 'tasa_bcv')::numeric);
    v_eur := (v_json -> 'tasas' ->> 'eur')::numeric;
    if v_usd is null then
      raise exception 'Respuesta sin tasa USD';
    end if;
  exception when others then
    insert into public.sincronizaciones_bcv (origen, estado, detalle)
    values (p_origen, 'ERROR', 'No se pudo consultar la API BCV: ' || sqlerrm);
    return jsonb_build_object('estado', 'ERROR', 'detalle', sqlerrm);
  end;

  -- La tasa publicada es la vigente hoy (los fines de semana sigue la del viernes).
  v_resultado := interno.guardar_tasa(current_date, v_usd, v_eur, 'BCV (API)', p_origen);

  -- Si el BCV ya publicó la tasa del próximo día hábil, se registra con su fecha valor.
  v_adelantada := v_json -> 'adelantada';
  if jsonb_typeof(v_adelantada) = 'object' and v_adelantada ? 'fecha'
     and coalesce(v_adelantada -> 'tasas' ->> 'usd', v_adelantada ->> 'usd', v_adelantada ->> 'tasa_bcv') is not null then
    v_resultado := v_resultado || jsonb_build_object('adelantada', interno.guardar_tasa(
      (v_adelantada ->> 'fecha')::date,
      coalesce(v_adelantada -> 'tasas' ->> 'usd', v_adelantada ->> 'usd', v_adelantada ->> 'tasa_bcv')::numeric,
      (v_adelantada -> 'tasas' ->> 'eur')::numeric,
      'BCV (API, adelantada)', p_origen));
  end if;

  return v_resultado || jsonb_build_object('fuente', v_url, 'publicada', v_json ->> 'updated_at');
end;
$$;

-- Cualquier usuario activo puede pedir la sincronización (el valor lo trae el servidor).
create or replace function public.sincronizar_tasa_bcv()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if public.rol_actual() is null then
    raise exception 'Usuario no autorizado.';
  end if;
  -- Evita consultar la API más de una vez por minuto si muchas cajas abren a la vez.
  if exists (select 1 from public.sincronizaciones_bcv
              where fecha > now() - interval '1 minute' and estado <> 'ERROR')
     and exists (select 1 from public.tasas_cambio where fecha_registro = current_date) then
    return jsonb_build_object('estado', 'RECIENTE');
  end if;
  return interno.sincronizar_tasa_bcv('APP');
end;
$$;

-- Corrección manual (solo admin): cuando la API falle o para fechas pasadas sin facturas.
create or replace function public.registrar_tasa_manual(p_fecha date, p_usd numeric, p_eur numeric default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin') then
    raise exception 'Solo un administrador puede registrar tasas manualmente.';
  end if;
  return interno.guardar_tasa(p_fecha, p_usd, p_eur, 'Manual', 'MANUAL', 0.5);
end;
$$;

grant execute on function public.sincronizar_tasa_bcv() to authenticated;
grant execute on function public.registrar_tasa_manual(date, numeric, numeric) to authenticated;

-- La tabla ya no se escribe directamente desde la app.
drop policy tasas_insert on public.tasas_cambio;
drop policy tasas_update on public.tasas_cambio;

-- -----------------------------------------------------------------------------
-- Tarea programada: cada 30 minutos
-- -----------------------------------------------------------------------------
select cron.schedule('sincronizar-tasa-bcv', '*/30 * * * *', $$select interno.sincronizar_tasa_bcv('CRON')$$);

-- -----------------------------------------------------------------------------
-- Alerta si la última sincronización falló o fue bloqueada
-- -----------------------------------------------------------------------------
create or replace function public.sig_alertas_tasa()
returns table (nivel text, categoria text, mensaje text, detalle text, ruta text)
language sql stable security definer
set search_path = ''
as $$
  select case when s.estado = 'ERROR' then 'ADVERTENCIA' else 'CRITICA' end, 'Tasa BCV',
         case when s.estado = 'ERROR' then 'Falló la sincronización automática de la tasa BCV'
              else 'La sincronización automática de la tasa fue bloqueada' end,
         s.detalle, '/tasa-cambio'
    from (select * from public.sincronizaciones_bcv order by fecha desc limit 1) s
   where s.estado in ('ERROR', 'BLOQUEADA') and public.tiene_rol('admin', 'gerente', 'contador')
$$;
grant execute on function public.sig_alertas_tasa() to authenticated;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
