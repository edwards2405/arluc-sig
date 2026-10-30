-- =============================================================================
-- ARLUC SIG · Migración 5: Sistema de Información Gerencial
-- -----------------------------------------------------------------------------
-- Indicadores calculados en la base de datos a partir de la operación y de la
-- contabilidad (una sola fuente de verdad):
--   * sig_resumen          KPIs del período vs. período anterior equivalente
--   * sig_ventas_diarias   serie diaria de ventas, costo y margen
--   * sig_mapa_ventas      ventas por día de la semana y hora
--   * sig_analisis_abc     clasificación ABC (Pareto) de productos
--   * sig_clientes_rfm     segmentación de clientes por Recencia/Frecuencia/Monto
--   * sig_metas            cumplimiento de metas y proyección al cierre del mes
--   * sig_proyeccion       pronóstico semanal por regresión lineal
--   * sig_alertas          alertas de gestión (inventario, cartera, fiscal, tasa)
-- Solo admin, gerente y contador pueden consultarlos.
-- =============================================================================

create or replace function interno.exigir_direccion()
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente', 'contador') then
    raise exception 'Solo la dirección (admin, gerente o contador) puede consultar esta información gerencial o fiscal.';
  end if;
end;
$$;

-- Ventas (facturas emitidas) por día con su costo, en hora de Venezuela.
create or replace function interno.ventas_rango(p_desde date, p_hasta date)
returns table (
  factura_id uuid, dia date, hora int, dow int, vendedor_id uuid, cliente_id uuid,
  venta_neta numeric, iva numeric, igtf numeric, total numeric, costo numeric, unidades bigint, metodos_pago jsonb
)
language sql stable
set search_path = ''
as $$
  select f.id,
         (f.fecha_emision at time zone 'America/Caracas')::date,
         extract(hour from f.fecha_emision at time zone 'America/Caracas')::int,
         extract(isodow from f.fecha_emision at time zone 'America/Caracas')::int,
         f.vendedor_id, f.cliente_id,
         f.base_imponible_usd + f.exento_usd, f.iva_usd, f.igtf_usd, f.total_usd,
         coalesce(d.costo, 0), coalesce(d.unidades, 0), f.metodos_pago
    from public.facturas f
    left join lateral (
      select sum(round(x.cantidad * x.costo_unitario_usd, 2)) as costo, sum(x.cantidad) as unidades
        from public.detalles_factura x where x.factura_id = f.id
    ) d on true
   where f.estado = 'emitida'
     and (f.fecha_emision at time zone 'America/Caracas')::date between p_desde and p_hasta
$$;

-- -----------------------------------------------------------------------------
-- KPIs del período
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Series y análisis
-- -----------------------------------------------------------------------------
create or replace function public.sig_ventas_diarias(p_desde date, p_hasta date)
returns table (dia date, ventas numeric, costo numeric, margen numeric, facturas bigint)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform interno.exigir_direccion();
  return query
    select g.d::date, coalesce(sum(v.venta_neta), 0), coalesce(sum(v.costo), 0),
           coalesce(sum(v.venta_neta - v.costo), 0), count(v.factura_id)
      from generate_series(p_desde, p_hasta, interval '1 day') g(d)
      left join interno.ventas_rango(p_desde, p_hasta) v on v.dia = g.d::date
     group by g.d order by g.d;
end;
$$;

create or replace function public.sig_mapa_ventas(p_desde date, p_hasta date)
returns table (dia_semana int, hora int, facturas bigint, ventas numeric)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform interno.exigir_direccion();
  return query
    select v.dow, v.hora, count(*), sum(v.venta_neta)
      from interno.ventas_rango(p_desde, p_hasta) v
     group by v.dow, v.hora order by v.dow, v.hora;
end;
$$;

-- Clasificación ABC por margen bruto aportado (A ≈ 80 %, B ≈ 15 %, C ≈ 5 %).
create or replace function public.sig_analisis_abc(p_desde date, p_hasta date)
returns table (
  producto_id uuid, sku text, nombre text, categoria text, unidades bigint, ventas numeric, costo numeric,
  margen numeric, margen_pct numeric, participacion_pct numeric, acumulado_pct numeric, clase text,
  stock integer, stock_minimo integer, dias_cobertura numeric, ultima_venta date
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform interno.exigir_direccion();
  return query
    with ventas as (
      select d.producto_id, sum(d.cantidad) as unidades,
             sum(d.subtotal_usd) as ventas, sum(round(d.cantidad * d.costo_unitario_usd, 2)) as costo
        from public.detalles_factura d join public.facturas f on f.id = d.factura_id
       where f.estado = 'emitida'
         and (f.fecha_emision at time zone 'America/Caracas')::date between p_desde and p_hasta
       group by d.producto_id
    ), base as (
      select p.id, p.sku, p.nombre, c.nombre as categoria, p.stock, p.stock_minimo,
             coalesce(v.unidades, 0) as unidades, coalesce(v.ventas, 0) as ventas, coalesce(v.costo, 0) as costo,
             coalesce(v.ventas, 0) - coalesce(v.costo, 0) as margen
        from public.productos p
        left join public.categorias c on c.id = p.categoria_id
        left join ventas v on v.producto_id = p.id
       where p.activo
    ), ranking as (
      select b.*,
             100 * b.margen / nullif(sum(b.margen) over (), 0) as participacion,
             100 * sum(b.margen) over (order by b.margen desc, b.sku rows unbounded preceding)
                 / nullif(sum(b.margen) over (), 0) as acumulado
        from base b
    )
    select r.id, r.sku, r.nombre, r.categoria, r.unidades::bigint, r.ventas, r.costo, r.margen,
           case when r.ventas > 0 then round(100 * r.margen / r.ventas, 1) else 0 end,
           round(coalesce(r.participacion, 0), 2), round(coalesce(r.acumulado, 0), 2),
           case when r.margen <= 0 then 'C'
                when r.acumulado - r.participacion < 80 then 'A'
                when r.acumulado - r.participacion < 95 then 'B'
                else 'C' end,
           r.stock, r.stock_minimo,
           case when r.unidades > 0 then round(r.stock / (r.unidades::numeric / (p_hasta - p_desde + 1)), 1) end,
           (select max((f.fecha_emision at time zone 'America/Caracas')::date)
              from public.detalles_factura d join public.facturas f on f.id = d.factura_id
             where d.producto_id = r.id and f.estado = 'emitida')
      from ranking r
     order by r.margen desc, r.sku;
end;
$$;

-- Segmentación RFM de clientes identificados. Recencia por días desde la última
-- compra (≤7, ≤15, ≤30, ≤60, >60 → 5..1); Frecuencia y Monto por quintiles.
create or replace function public.sig_clientes_rfm(p_hasta date default current_date)
returns table (
  cliente_id uuid, nombre text, documento text, telefono text,
  ultima_compra date, recencia_dias int, frecuencia bigint, monto numeric,
  r int, f int, m int, segmento text, saldo_pendiente numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform interno.exigir_direccion();
  return query
    with compras as (
      select f.cliente_id,
             max((f.fecha_emision at time zone 'America/Caracas')::date) as ultima,
             count(*) as frecuencia, sum(f.base_imponible_usd + f.exento_usd) as monto
        from public.facturas f
       where f.estado = 'emitida' and f.cliente_id is not null
         and (f.fecha_emision at time zone 'America/Caracas')::date <= p_hasta
       group by f.cliente_id
    ), puntaje as (
      select c.*, (p_hasta - c.ultima) as recencia,
             case when p_hasta - c.ultima <= 7 then 5 when p_hasta - c.ultima <= 15 then 4
                  when p_hasta - c.ultima <= 30 then 3 when p_hasta - c.ultima <= 60 then 2 else 1 end as r_score,
             ntile(5) over (order by c.frecuencia) as f_score,
             ntile(5) over (order by c.monto) as m_score
        from compras c
    )
    select p.cliente_id, cl.nombre, cl.documento_identidad, cl.telefono, p.ultima, p.recencia,
           p.frecuencia, p.monto, p.r_score, p.f_score, p.m_score,
           case
             when p.r_score >= 4 and p.f_score >= 4 and p.m_score >= 4 then 'Campeón'
             when p.r_score >= 3 and p.f_score >= 3 then 'Leal'
             when p.r_score >= 4 and p.f_score <= 2 then 'Nuevo / prometedor'
             when p.r_score <= 2 and p.f_score >= 3 then 'En riesgo'
             when p.r_score <= 2 and p.f_score <= 2 then 'Inactivo'
             else 'Ocasional' end,
           public.saldo_credito_cliente(p.cliente_id)
      from puntaje p join public.clientes cl on cl.id = p.cliente_id
     order by p.monto desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- Metas de ventas
-- -----------------------------------------------------------------------------
create table public.metas_ventas (
  id          uuid primary key default gen_random_uuid(),
  anio        smallint not null check (anio between 2000 and 2100),
  mes         smallint not null check (mes between 1 and 12),
  vendedor_id uuid references public.usuarios (id) on delete cascade,
  monto_usd   numeric(14, 2) not null check (monto_usd > 0),
  creada_por  uuid references public.usuarios (id) default auth.uid(),
  created_at  timestamptz not null default now()
);
comment on table public.metas_ventas is 'Meta mensual de ventas netas (sin IVA). vendedor_id nulo = meta de la empresa.';
create unique index metas_ventas_unica on public.metas_ventas (anio, mes, coalesce(vendedor_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.metas_ventas enable row level security;
create policy metas_select on public.metas_ventas for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')) or vendedor_id = (select auth.uid()));
create policy metas_write on public.metas_ventas for all to authenticated
  using ((select public.tiene_rol('admin', 'gerente')))
  with check ((select public.tiene_rol('admin', 'gerente')));
create trigger trg_metas_ventas_auditoria after insert or update or delete on public.metas_ventas
for each row execute function interno.registrar_auditoria();

-- Cumplimiento del mes y proyección lineal al cierre (ritmo diario actual).
create or replace function public.sig_metas(p_anio int, p_mes int)
returns table (
  vendedor_id uuid, nombre text, meta numeric, vendido numeric, cumplimiento_pct numeric,
  proyeccion_cierre numeric, proyeccion_pct numeric, facturas bigint, semaforo text
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_inicio date := make_date(p_anio, p_mes, 1);
  v_fin date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  v_dias_mes int;
  v_transcurridos int;
begin
  perform interno.exigir_direccion();
  v_dias_mes := v_fin - v_inicio + 1;
  v_transcurridos := greatest(least(current_date, v_fin) - v_inicio + 1, 1);
  return query
    with ventas as (
      select v.vendedor_id, sum(v.venta_neta) as vendido, count(*) as facturas
        from interno.ventas_rango(v_inicio, v_fin) v group by rollup (v.vendedor_id)
    ), filas as (
      -- Empresa (vendedor nulo) y cada vendedor activo o con ventas en el mes.
      select null::uuid as vid, 'Empresa'::text as nombre
      union all
      select u.id, u.nombre_completo from public.usuarios u
       where (u.rol = 'vendedor' and u.activo)
          or exists (select 1 from interno.ventas_rango(v_inicio, v_fin) x where x.vendedor_id = u.id)
    )
    select f.vid, f.nombre, m.monto_usd, coalesce(v.vendido, 0),
           case when m.monto_usd > 0 then round(100 * coalesce(v.vendido, 0) / m.monto_usd, 1) end,
           round(coalesce(v.vendido, 0) / v_transcurridos * v_dias_mes, 2),
           case when m.monto_usd > 0 then round(100 * coalesce(v.vendido, 0) / v_transcurridos * v_dias_mes / m.monto_usd, 1) end,
           coalesce(v.facturas, 0),
           case when m.monto_usd is null then 'SIN_META'
                when coalesce(v.vendido, 0) / v_transcurridos * v_dias_mes >= m.monto_usd then 'VERDE'
                when coalesce(v.vendido, 0) / v_transcurridos * v_dias_mes >= 0.85 * m.monto_usd then 'AMARILLO'
                else 'ROJO' end
      from filas f
      left join public.metas_ventas m
        on m.anio = p_anio and m.mes = p_mes and m.vendedor_id is not distinct from f.vid
      left join ventas v on v.vendedor_id is not distinct from f.vid
     order by f.vid nulls first, coalesce(v.vendido, 0) desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- Pronóstico semanal (mínimos cuadrados sobre las últimas N semanas)
-- -----------------------------------------------------------------------------
create or replace function public.sig_proyeccion(p_semanas_historia int default 10, p_semanas_futuras int default 4)
returns table (semana date, ventas numeric, tipo text)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_inicio date := date_trunc('week', current_date)::date - 7 * p_semanas_historia;
  v_fin date := date_trunc('week', current_date)::date - 1;
begin
  perform interno.exigir_direccion();
  return query
    with semanas as (
      select row_number() over (order by g.s)::int as n, g.s::date as semana, coalesce(sum(v.venta_neta), 0) as total
        from generate_series(v_inicio, v_fin - 6, interval '7 days') g(s)
        left join interno.ventas_rango(v_inicio, v_fin) v on date_trunc('week', v.dia)::date = g.s::date
       group by g.s
    ), coef as (
      select regr_slope(x.total, x.n)::numeric as pendiente, regr_intercept(x.total, x.n)::numeric as intercepto from semanas x
    )
    select x.semana, round(x.total, 2), 'REAL'::text from semanas x
    union all
    select v_fin + 1 + 7 * (k - 1),
           round(greatest(c.intercepto + c.pendiente * (p_semanas_historia + k), 0), 2), 'PROYECCION'
      from coef c, generate_series(1, p_semanas_futuras) k
    order by 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Alertas de gestión
-- -----------------------------------------------------------------------------
create or replace function public.sig_alertas()
returns table (nivel text, categoria text, mensaje text, detalle text, ruta text)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_semana numeric;
  v_semana_ant numeric;
  v_iva numeric;
  v_igtf numeric;
begin
  perform interno.exigir_direccion();

  -- Tasa BCV del día
  if not exists (select 1 from public.tasas_cambio where fecha_registro = current_date) then
    return query select 'CRITICA', 'Tasa BCV', 'No se ha registrado la tasa BCV de hoy',
      'La facturación está bloqueada hasta registrarla.', '/tasa-cambio';
  end if;

  -- Inventario
  return query
    select case when p.stock = 0 then 'CRITICA' else 'ADVERTENCIA' end, 'Inventario',
           case when p.stock = 0 then 'Agotado: ' else 'Bajo mínimo: ' end || p.nombre,
           'Stock ' || p.stock || ' / mínimo ' || p.stock_minimo || ' (' || p.sku || ')', '/inventario'
      from public.productos p where p.activo and p.stock <= p.stock_minimo
     order by p.stock;

  return query
    select 'INFO', 'Inventario', 'Sin ventas en 30 días: ' || p.nombre,
           'Capital inmovilizado ' || to_char(p.stock * p.costo_usd, 'FM999G999D00') || ' USD', '/inventario/reportes'
      from public.productos p
     where p.activo and p.stock > 0
       and not exists (select 1 from public.detalles_factura d join public.facturas f on f.id = d.factura_id
                        where d.producto_id = p.id and f.estado = 'emitida'
                          and f.fecha_emision >= current_date - 30);

  -- Cartera
  return query
    select 'ADVERTENCIA', 'Cuentas por cobrar',
           count(*) || ' cuenta(s) vencida(s) por ' || to_char(sum(v.saldo_total_usd), 'FM999G999D00') || ' USD',
           'La más antigua tiene ' || max(v.dias_vencida) || ' días de atraso.', '/cuentas-por-cobrar'
      from public.v_cuentas_por_cobrar v where v.vencida
    having count(*) > 0;

  return query
    select 'ADVERTENCIA', 'Crédito', 'Cliente sobre su límite: ' || c.nombre,
           'Debe ' || to_char(public.saldo_credito_cliente(c.id), 'FM999G999D00') || ' USD con línea de '
             || to_char(c.linea_credito, 'FM999G999D00'), '/clientes'
      from public.clientes c
     where c.credito_activo and c.moneda_credito = 'usd'
       and public.saldo_credito_cliente(c.id) > c.linea_credito;

  -- Proveedores
  return query
    select case when bool_or(x.fecha_vencimiento < current_date) then 'CRITICA' else 'ADVERTENCIA' end,
           'Cuentas por pagar',
           count(*) || ' pago(s) a proveedores vencido(s) o por vencer en 7 días',
           'Total ' || to_char(sum(x.saldo_usd), 'FM999G999D00') || ' USD', '/cuentas-por-pagar'
      from public.cuentas_por_pagar x
     where x.estado = 'PENDIENTE' and x.fecha_vencimiento <= current_date + 7
    having count(*) > 0;

  -- Tendencia de ventas: últimos 7 días vs. los 7 anteriores
  select coalesce(sum(venta_neta), 0) into v_semana from interno.ventas_rango(current_date - 6, current_date);
  select coalesce(sum(venta_neta), 0) into v_semana_ant from interno.ventas_rango(current_date - 13, current_date - 7);
  if v_semana_ant > 0 and v_semana < 0.8 * v_semana_ant then
    return query select 'ADVERTENCIA', 'Ventas',
      'Las ventas cayeron ' || round(100 * (1 - v_semana / v_semana_ant)) || ' % frente a la semana anterior',
      to_char(v_semana, 'FM999G999D00') || ' vs ' || to_char(v_semana_ant, 'FM999G999D00') || ' USD', '/panel-gerencial';
  end if;

  -- Obligaciones fiscales (saldos contables al día)
  select coalesce(sum(saldo) filter (where codigo = '2.1.02.01'), 0) - coalesce(sum(saldo) filter (where codigo = '1.1.04.01'), 0),
         coalesce(sum(saldo) filter (where codigo = '2.1.02.02'), 0)
    into v_iva, v_igtf from public.saldos_cuentas(null, current_date);
  if v_iva > 0 or v_igtf > 0 then
    return query select 'INFO', 'Fiscal (SENIAT)',
      'Impuestos por declarar: IVA neto ' || to_char(greatest(v_iva, 0), 'FM999G999D00') || ' USD · IGTF '
        || to_char(v_igtf, 'FM999G999D00') || ' USD',
      'Contribuyente especial: IVA e IGTF se declaran y enteran quincenalmente.', '/contabilidad/balance-comprobacion';
  end if;
end;
$$;

grant execute on function public.sig_resumen(date, date) to authenticated;
grant execute on function public.sig_ventas_diarias(date, date) to authenticated;
grant execute on function public.sig_mapa_ventas(date, date) to authenticated;
grant execute on function public.sig_analisis_abc(date, date) to authenticated;
grant execute on function public.sig_clientes_rfm(date) to authenticated;
grant execute on function public.sig_metas(int, int) to authenticated;
grant execute on function public.sig_proyeccion(int, int) to authenticated;
grant execute on function public.sig_alertas() to authenticated;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
