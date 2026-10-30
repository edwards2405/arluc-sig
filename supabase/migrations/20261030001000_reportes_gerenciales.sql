-- =============================================================================
-- ARLUC SIG · Migración 10: Reportes gerenciales
-- -----------------------------------------------------------------------------
-- Tipos de reporte de un Sistema de Información Gerencial:
--   * PROGRAMADOS: se generan solos en horarios fijos (pg_cron) y quedan
--     guardados como foto del momento: cierre diario, resumen semanal y
--     resumen gerencial mensual.
--   * DE EXCEPCIÓN: solo lo que se sale de lo normal según umbrales.
--   * PROYECCIÓN / PRONÓSTICO: ventas, cierre de mes, flujo de caja e
--     inventario hacia adelante.
--   * A SOLICITUD: el usuario elige período y dimensión de análisis.
-- Cada reporte incluye controles de confiabilidad verificados por la BD.
-- =============================================================================

-- Los procesos programados (sin sesión de usuario) pueden leer indicadores.
create or replace function interno.exigir_direccion()
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if coalesce(current_setting('arluc.sistema', true), 'off') = 'on' then
    return;
  end if;
  if not public.tiene_rol('admin', 'gerente', 'contador') then
    raise exception 'Solo la dirección (admin, gerente o contador) puede consultar esta información gerencial o fiscal.';
  end if;
end;
$$;

create or replace function public.saldos_cuentas(p_desde date default null, p_hasta date default null)
returns table (
  cuenta_id uuid, codigo text, nombre text, tipo text, naturaleza text,
  debe numeric, haber numeric, debe_ves numeric, haber_ves numeric,
  saldo numeric, saldo_ves numeric
)
language sql stable security definer
set search_path = ''
as $$
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
   order by c.codigo
$$;

-- -----------------------------------------------------------------------------
-- Controles de confiabilidad
-- -----------------------------------------------------------------------------
create or replace function interno.verificaciones_confiabilidad(p_desde date, p_hasta date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_array(
    (select jsonb_build_object('control', 'Partida doble (USD y Bs)',
              'ok', sum(debe) = sum(haber) and sum(debe_ves) = sum(haber_ves),
              'detalle', format('Debe %s / Haber %s USD', sum(debe), sum(haber)))
       from public.lineas_asiento l join public.asientos_contables a on a.id = l.asiento_id
      where a.fecha <= p_hasta),
    (select jsonb_build_object('control', 'Ventas del período contabilizadas',
              'ok', count(*) filter (where a.id is null) = 0,
              'detalle', format('%s facturas, %s sin asiento', count(*), count(*) filter (where a.id is null)))
       from public.facturas f
       left join public.asientos_contables a on a.referencia_id = f.id and a.modulo = 'Ventas'
      where (f.fecha_emision at time zone 'America/Caracas')::date between p_desde and p_hasta),
    (select jsonb_build_object('control', 'Tasa BCV registrada para cada día del período',
              'ok', not exists (select 1 from generate_series(p_desde, p_hasta, interval '1 day') g(d)
                                 where public.tasa_vigente(g.d::date) is null),
              'detalle', format('Tasa al cierre: Bs %s', public.tasa_vigente(p_hasta)))),
    -- Informativo: un mes en curso está abierto y sus cifras son provisionales.
    (select jsonb_build_object('control', case when coalesce(bool_and(estado = 'CERRADO'), false)
                                              then 'Cifras definitivas (período contable cerrado)'
                                              else 'Cifras provisionales (período contable abierto)' end,
              'tipo', 'info',
              'ok', coalesce(bool_and(estado = 'CERRADO'), false),
              'detalle', coalesce(string_agg(lpad(mes::text, 2, '0') || '/' || anio || ' ' || lower(estado), ', '), 'Sin movimientos'))
       from public.periodos_contables
      where make_date(anio, mes, 1) between date_trunc('month', p_desde)::date and p_hasta)
  )
$$;

-- -----------------------------------------------------------------------------
-- Reportes programados
-- -----------------------------------------------------------------------------
create table public.reportes_generados (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null check (codigo in ('CIERRE_DIARIO', 'RESUMEN_SEMANAL', 'RESUMEN_MENSUAL')),
  titulo         text not null,
  periodo_desde  date not null,
  periodo_hasta  date not null,
  generado_en    timestamptz not null default now(),
  origen         text not null default 'CRON' check (origen in ('CRON', 'MANUAL')),
  contenido      jsonb not null,
  verificaciones jsonb not null,
  unique (codigo, periodo_desde)
);
create index on public.reportes_generados (codigo, periodo_desde desc);
alter table public.reportes_generados enable row level security;
create policy reportes_generados_select on public.reportes_generados for select to authenticated
  using ((select public.tiene_rol('admin', 'gerente', 'contador')));

create or replace function interno.ventas_por(p_desde date, p_hasta date, p_dimension text, p_limite int default 50)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x.ventas desc), '[]'::jsonb) from (
    select g.grupo, count(distinct g.factura_id) as facturas, sum(g.unidades) as unidades,
           round(sum(g.ventas), 2) as ventas, round(sum(g.costo), 2) as costo,
           round(sum(g.ventas) - sum(g.costo), 2) as margen,
           case when sum(g.ventas) > 0 then round(100 * (sum(g.ventas) - sum(g.costo)) / sum(g.ventas), 1) else 0 end as margen_pct
      from (
        select f.id as factura_id, d.cantidad as unidades, d.subtotal_usd as ventas,
               round(d.cantidad * d.costo_unitario_usd, 2) as costo,
               case p_dimension
                 when 'producto' then d.producto_nombre
                 when 'categoria' then coalesce(c.nombre, 'Sin categoría')
                 when 'vendedor' then u.nombre_completo
                 when 'cliente' then coalesce(f.cliente_nombre, 'Consumidor final')
                 when 'dia' then to_char(f.fecha_emision at time zone 'America/Caracas', 'YYYY-MM-DD')
                 when 'semana' then to_char(date_trunc('week', f.fecha_emision at time zone 'America/Caracas'), 'YYYY-MM-DD')
                 when 'mes' then to_char(f.fecha_emision at time zone 'America/Caracas', 'YYYY-MM')
                 when 'hora' then lpad(extract(hour from f.fecha_emision at time zone 'America/Caracas')::text, 2, '0') || ':00'
                 when 'dia_semana' then (array['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'])
                                          [extract(isodow from f.fecha_emision at time zone 'America/Caracas')::int]
               end as grupo
          from public.facturas f
          join public.detalles_factura d on d.factura_id = f.id
          join public.productos p on p.id = d.producto_id
          left join public.categorias c on c.id = p.categoria_id
          join public.usuarios u on u.id = f.vendedor_id
         where f.estado = 'emitida'
           and (f.fecha_emision at time zone 'America/Caracas')::date between p_desde and p_hasta
      ) g
     group by g.grupo
     order by sum(g.ventas) desc
     limit p_limite
  ) x
$$;

create or replace function interno.generar_reporte_programado(p_codigo text, p_fecha date, p_origen text default 'CRON')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_desde date;
  v_hasta date;
  v_titulo text;
  v_contenido jsonb;
  v_id uuid;
  v_dia record;
  v_prom7 numeric;
begin
  perform set_config('arluc.sistema', 'on', true);

  if p_codigo = 'CIERRE_DIARIO' then
    v_desde := p_fecha; v_hasta := p_fecha;
    v_titulo := 'Cierre diario de ventas · ' || to_char(p_fecha, 'DD/MM/YYYY');
    select count(*) as facturas, coalesce(sum(venta_neta), 0) as venta_neta, coalesce(sum(iva), 0) as iva,
           coalesce(sum(igtf), 0) as igtf, coalesce(sum(total), 0) as total, coalesce(sum(costo), 0) as costo
      into v_dia from interno.ventas_rango(p_fecha, p_fecha);
    select coalesce(sum(venta_neta), 0) / 7 into v_prom7 from interno.ventas_rango(p_fecha - 7, p_fecha - 1);
    v_contenido := jsonb_build_object(
      'tasa_bcv', public.tasa_vigente(p_fecha),
      'ventas', jsonb_build_object('facturas', v_dia.facturas, 'venta_neta', v_dia.venta_neta, 'iva', v_dia.iva,
                                   'igtf', v_dia.igtf, 'total', v_dia.total, 'costo', v_dia.costo,
                                   'margen', v_dia.venta_neta - v_dia.costo,
                                   'ticket_promedio', case when v_dia.facturas > 0 then round(v_dia.venta_neta / v_dia.facturas, 2) else 0 end),
      'comparacion', jsonb_build_object('promedio_7_dias', round(v_prom7, 2),
                                        'variacion_pct', case when v_prom7 > 0 then round(100 * (v_dia.venta_neta / v_prom7 - 1), 1) end),
      'por_metodo', (select coalesce(jsonb_agg(jsonb_build_object('grupo', metodo, 'monto', monto) order by monto desc), '[]'::jsonb)
                       from (select coalesce(p ->> 'metodo', p ->> 'metodo_id') as metodo,
                                    round(sum(coalesce((p ->> 'aplicado_usd')::numeric, (p ->> 'monto_usd')::numeric)), 2) as monto
                               from interno.ventas_rango(p_fecha, p_fecha) v, jsonb_array_elements(v.metodos_pago) p group by 1) m),
      'por_vendedor', interno.ventas_por(p_fecha, p_fecha, 'vendedor'),
      'top_productos', interno.ventas_por(p_fecha, p_fecha, 'producto', 5),
      'anulaciones', (select jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total_usd), 0))
                        from public.facturas where estado = 'anulada' and (anulada_en at time zone 'America/Caracas')::date = p_fecha),
      'notas_credito', (select jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total_usd), 0))
                          from public.notas_fiscales where tipo = 'CREDITO' and (fecha_emision at time zone 'America/Caracas')::date = p_fecha),
      'cobranza', (select jsonb_build_object('abonos', count(*), 'monto', coalesce(sum(monto_usd), 0))
                     from public.abonos_cxc where estado = 'VIGENTE' and (fecha at time zone 'America/Caracas')::date = p_fecha));

  elsif p_codigo = 'RESUMEN_SEMANAL' then
    v_desde := date_trunc('week', p_fecha)::date; v_hasta := v_desde + 6;
    v_titulo := 'Resumen semanal · ' || to_char(v_desde, 'DD/MM') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY');
    v_contenido := jsonb_build_object(
      'resumen', public.sig_resumen(v_desde, v_hasta),
      'top_productos', interno.ventas_por(v_desde, v_hasta, 'producto', 10),
      'por_vendedor', interno.ventas_por(v_desde, v_hasta, 'vendedor'),
      'por_dia', interno.ventas_por(v_desde, v_hasta, 'dia'),
      'alertas', case when v_hasta >= current_date - 7
                      then (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.sig_alertas() a)
                      else '[]'::jsonb end);

  elsif p_codigo = 'RESUMEN_MENSUAL' then
    v_desde := date_trunc('month', p_fecha)::date; v_hasta := (v_desde + interval '1 month - 1 day')::date;
    v_titulo := 'Resumen gerencial mensual · ' || to_char(v_desde, 'MM/YYYY');
    v_contenido := jsonb_build_object(
      'resumen', public.sig_resumen(v_desde, v_hasta),
      'metas', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
                  from public.sig_metas(extract(year from v_desde)::int, extract(month from v_desde)::int) m),
      'estado_resultados', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'cuenta', nombre, 'tipo', tipo, 'monto', saldo)
                                              order by codigo), '[]'::jsonb)
                              from public.saldos_cuentas(v_desde, v_hasta) where tipo in ('INGRESO', 'COSTO', 'GASTO')),
      'top_productos', interno.ventas_por(v_desde, v_hasta, 'producto', 10),
      'por_categoria', interno.ventas_por(v_desde, v_hasta, 'categoria'),
      'por_vendedor', interno.ventas_por(v_desde, v_hasta, 'vendedor'));
  else
    raise exception 'Reporte programado desconocido: %', p_codigo;
  end if;

  insert into public.reportes_generados (codigo, titulo, periodo_desde, periodo_hasta, origen, contenido, verificaciones, generado_en)
  values (p_codigo, v_titulo, v_desde, v_hasta, p_origen, v_contenido,
          interno.verificaciones_confiabilidad(v_desde, v_hasta),
          case when p_origen = 'CRON' and v_hasta < current_date
               then (v_hasta + time '20:30') at time zone 'America/Caracas' else now() end)
  on conflict (codigo, periodo_desde) do update
     set contenido = excluded.contenido, verificaciones = excluded.verificaciones, titulo = excluded.titulo,
         generado_en = now(), origen = excluded.origen
  returning id into v_id;

  perform set_config('arluc.sistema', 'off', true);
  return v_id;
end;
$$;

-- Regenerar a demanda (por ejemplo, después de una corrección).
create or replace function public.generar_reporte_programado(p_codigo text, p_fecha date)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin', 'gerente', 'contador') then
    raise exception 'No autorizado para generar reportes gerenciales.';
  end if;
  return interno.generar_reporte_programado(p_codigo, p_fecha, 'MANUAL');
end;
$$;

-- Horarios (pg_cron trabaja en UTC; Venezuela es UTC−4):
--   cierre diario 20:30 VET, resumen semanal lunes 07:00 VET, mensual día 1 07:00 VET.
select cron.schedule('reporte-cierre-diario', '30 0 * * *',
  $$select interno.generar_reporte_programado('CIERRE_DIARIO', current_date)$$);
select cron.schedule('reporte-resumen-semanal', '0 11 * * 1',
  $$select interno.generar_reporte_programado('RESUMEN_SEMANAL', current_date - 7)$$);
select cron.schedule('reporte-resumen-mensual', '0 11 1 * *',
  $$select interno.generar_reporte_programado('RESUMEN_MENSUAL', (current_date - interval '1 month')::date)$$);

-- -----------------------------------------------------------------------------
-- Reporte de excepción
-- -----------------------------------------------------------------------------
create or replace function public.reporte_excepciones(p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_promedio numeric;
begin
  perform interno.exigir_direccion();
  -- Promedio por día hábil (la tienda no abre los domingos)
  select coalesce(sum(venta_neta), 0)
         / greatest((select count(*) from generate_series(p_desde, least(p_hasta, current_date - 1), interval '1 day') g(d)
                      where extract(isodow from g.d) <> 7), 1)
    into v_promedio
    from interno.ventas_rango(p_desde, least(p_hasta, current_date - 1));

  return jsonb_build_array(
    jsonb_build_object('codigo', 'margen_bajo', 'titulo', 'Productos vendidos con margen menor al 15 %',
      'umbral', 'Margen bruto < 15 % de la venta', 'responsable', 'Gerencia comercial',
      'filas', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                 select grupo as producto, unidades, ventas, costo, margen, margen_pct
                   from jsonb_to_recordset(interno.ventas_por(p_desde, p_hasta, 'producto', 1000))
                        as t(grupo text, unidades numeric, ventas numeric, costo numeric, margen numeric, margen_pct numeric)
                  where margen_pct < 15 order by margen_pct) x)),
    jsonb_build_object('codigo', 'dias_bajos', 'titulo', 'Días con ventas por debajo del 50 % del promedio diario',
      'umbral', format('Promedio diario del período: %s USD (sin domingos)', round(v_promedio, 2)), 'responsable', 'Gerencia',
      'filas', (select coalesce(jsonb_agg(x order by x.dia), '[]'::jsonb) from (
                 select g.d::date as dia, coalesce(sum(v.venta_neta), 0) as ventas,
                        round(100 * coalesce(sum(v.venta_neta), 0) / nullif(v_promedio, 0), 1) as porcentaje_del_promedio
                   from generate_series(p_desde, p_hasta, interval '1 day') g(d)
                   left join interno.ventas_rango(p_desde, p_hasta) v on v.dia = g.d::date
                  where extract(isodow from g.d) <> 7 and g.d::date < current_date
                  group by g.d having coalesce(sum(v.venta_neta), 0) < 0.5 * v_promedio) x)),
    jsonb_build_object('codigo', 'anulaciones', 'titulo', 'Anulaciones y notas de crédito (control interno)',
      'umbral', 'Todo documento que reverse una venta', 'responsable', 'Administración / auditoría',
      'filas', (select coalesce(jsonb_agg(x order by x.fecha), '[]'::jsonb) from (
                 select (f.anulada_en at time zone 'America/Caracas')::date as fecha, 'Anulación' as tipo, f.numero_factura as documento,
                        f.total_usd as monto, coalesce(f.motivo_anulacion, 'Sin motivo') as motivo, u.nombre_completo as usuario
                   from public.facturas f left join public.usuarios u on u.id = f.anulada_por
                  where f.estado = 'anulada' and (f.anulada_en at time zone 'America/Caracas')::date between p_desde and p_hasta
                 union all
                 select (n.fecha_emision at time zone 'America/Caracas')::date, 'Nota de crédito', n.numero || ' (' || f.numero_factura || ')',
                        n.total_usd, n.motivo, u.nombre_completo
                   from public.notas_fiscales n join public.facturas f on f.id = n.factura_id
                   left join public.usuarios u on u.id = n.emitida_por
                  where n.tipo = 'CREDITO' and (n.fecha_emision at time zone 'America/Caracas')::date between p_desde and p_hasta) x)),
    jsonb_build_object('codigo', 'cartera_vencida', 'titulo', 'Cuentas por cobrar con más de 30 días de atraso',
      'umbral', 'Días vencidos > 30', 'responsable', 'Cobranza',
      'filas', (select coalesce(jsonb_agg(x order by x.dias_vencida desc), '[]'::jsonb) from (
                 select cliente_nombre as cliente, telefono, numero_factura as factura, dias_vencida, saldo_total_usd as saldo
                   from public.v_cuentas_por_cobrar where vencida and dias_vencida > 30) x)),
    jsonb_build_object('codigo', 'sobre_limite', 'titulo', 'Clientes por encima de su línea de crédito',
      'umbral', 'Saldo pendiente > línea de crédito', 'responsable', 'Gerencia / crédito',
      'filas', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                 select c.nombre as cliente, c.linea_credito as linea, s.saldo, s.saldo - c.linea_credito as exceso
                   from public.clientes c
                   cross join lateral (select coalesce(sum(saldo_usd), 0) as saldo from public.cuentas_por_cobrar
                                        where cliente_id = c.id and tipo = 'CREDITO_DIRECTO' and estado = 'PENDIENTE') s
                  where c.credito_activo and c.moneda_credito = 'usd' and s.saldo > c.linea_credito) x)),
    jsonb_build_object('codigo', 'inventario', 'titulo', 'Productos agotados o bajo el stock mínimo',
      'umbral', 'Stock ≤ stock mínimo', 'responsable', 'Almacén / compras',
      'filas', (select coalesce(jsonb_agg(x order by x.stock), '[]'::jsonb) from (
                 select sku, nombre as producto, stock, stock_minimo, round(stock * costo_usd, 2) as valor_costo
                   from public.productos where activo and stock <= stock_minimo) x)),
    jsonb_build_object('codigo', 'mermas', 'titulo', 'Ajustes manuales de inventario (mermas y sobrantes)',
      'umbral', 'Todo ajuste fuera de compras y ventas', 'responsable', 'Almacén / auditoría',
      'filas', (select coalesce(jsonb_agg(x order by x.fecha), '[]'::jsonb) from (
                 select (m.fecha at time zone 'America/Caracas')::date as fecha, p.sku, p.nombre as producto, m.cantidad,
                        round(abs(m.cantidad) * m.costo_unitario_usd, 2) as valor_costo, u.nombre_completo as usuario
                   from public.movimientos_inventario m join public.productos p on p.id = m.producto_id
                   left join public.usuarios u on u.id = m.usuario_id
                  where m.tipo in ('AJUSTE_ENTRADA', 'AJUSTE_SALIDA')
                    and (m.fecha at time zone 'America/Caracas')::date between p_desde and p_hasta) x)),
    jsonb_build_object('codigo', 'cxp_vencidas', 'titulo', 'Pagos a proveedores vencidos o por vencer en 7 días',
      'umbral', 'Vencimiento ≤ hoy + 7 días', 'responsable', 'Tesorería',
      'filas', (select coalesce(jsonb_agg(x order by x.vence), '[]'::jsonb) from (
                 select p.nombre as proveedor, o.numero_orden as orden, x.fecha_vencimiento as vence, x.saldo_usd as saldo
                   from public.cuentas_por_pagar x join public.proveedores p on p.id = x.proveedor_id
                   join public.ordenes_compra o on o.id = x.orden_id
                  where x.estado = 'PENDIENTE' and x.fecha_vencimiento <= current_date + 7) x)),
    jsonb_build_object('codigo', 'tasa_bcv', 'titulo', 'Fallas o bloqueos en la sincronización de la tasa BCV',
      'umbral', 'Estado ERROR o BLOQUEADA', 'responsable', 'Administración',
      'filas', (select coalesce(jsonb_agg(x order by x.momento desc), '[]'::jsonb) from (
                 select fecha as momento, origen, estado, detalle from public.sincronizaciones_bcv
                  where estado in ('ERROR', 'BLOQUEADA') and (fecha at time zone 'America/Caracas')::date between p_desde and p_hasta) x))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Proyecciones y pronósticos
-- -----------------------------------------------------------------------------
create or replace function public.reporte_proyecciones()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_efectivo numeric;
  v_gasto_semanal numeric;
  v_pct_contado numeric;
  v_flujo jsonb := '[]'::jsonb;
  v_saldo numeric;
  v_semana record;
  v_entradas_cxc numeric;
  v_salidas_cxp numeric;
  v_ventas_contado numeric;
  v_inicio date := date_trunc('week', current_date)::date;
begin
  perform interno.exigir_direccion();

  -- Efectivo disponible hoy (caja y bancos)
  select coalesce(sum(saldo), 0) into v_efectivo from public.saldos_cuentas(null, current_date) where codigo like '1.1.01.%';
  -- Gasto operativo semanal promedio de las últimas 8 semanas
  select coalesce(sum(saldo), 0) / 8 into v_gasto_semanal
    from public.saldos_cuentas(current_date - 56, current_date - 1) where codigo like '6.1.%';
  -- Proporción de las ventas que se cobra al contado (no a crédito ni Cashea)
  select case when sum(total) > 0
              then 1 - coalesce((select sum(c.monto_usd) from public.cuentas_por_cobrar c join public.facturas f on f.id = c.factura_id
                                  where f.estado = 'emitida' and f.fecha_emision >= current_date - 56), 0) / sum(total)
              else 1 end
    into v_pct_contado from interno.ventas_rango(current_date - 56, current_date - 1);

  v_saldo := v_efectivo;
  for v_semana in select * from public.sig_proyeccion(8, 4) where tipo = 'PROYECCION' order by semana loop
    select coalesce(sum(saldo_usd), 0) into v_entradas_cxc from public.cuentas_por_cobrar
     where estado = 'PENDIENTE' and fecha_vencimiento between v_semana.semana and v_semana.semana + 6;
    select coalesce(sum(saldo_usd), 0) into v_salidas_cxp from public.cuentas_por_pagar
     where estado = 'PENDIENTE' and greatest(fecha_vencimiento, v_inicio) between v_semana.semana and v_semana.semana + 6;
    -- Ventas proyectadas con IVA, solo la porción de contado
    v_ventas_contado := round(v_semana.ventas * 1.16 * v_pct_contado, 2);
    v_saldo := v_saldo + v_ventas_contado + v_entradas_cxc - v_salidas_cxp - v_gasto_semanal;
    v_flujo := v_flujo || jsonb_build_object(
      'semana', v_semana.semana, 'ventas_contado', v_ventas_contado, 'cobros_cxc', v_entradas_cxc,
      'pagos_proveedores', v_salidas_cxp, 'gastos_operativos', round(v_gasto_semanal, 2), 'saldo_final', round(v_saldo, 2));
  end loop;

  return jsonb_build_object(
    'ventas', (select coalesce(jsonb_agg(to_jsonb(p) order by p.semana), '[]'::jsonb) from public.sig_proyeccion(8, 4) p),
    'cierre_mes', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
                     from public.sig_metas(extract(year from current_date)::int, extract(month from current_date)::int) m),
    'flujo_caja', jsonb_build_object('efectivo_actual', round(v_efectivo, 2), 'porcentaje_contado', round(100 * v_pct_contado, 1),
                                     'gasto_semanal_promedio', round(v_gasto_semanal, 2), 'semanas', v_flujo),
    'inventario', (select coalesce(jsonb_agg(x order by x.dias_cobertura nulls last), '[]'::jsonb) from (
       select p.sku, p.nombre as producto, p.stock, round(v.unidades / 30.0, 2) as venta_diaria,
              case when v.unidades > 0 then round(p.stock / (v.unidades / 30.0), 1) end as dias_cobertura,
              case when v.unidades > 0 then current_date + floor(p.stock / (v.unidades / 30.0))::int end as fecha_agotamiento,
              greatest(ceil(v.unidades / 30.0 * 30) - p.stock, 0)::int as sugerencia_compra
         from public.productos p
         left join lateral (select coalesce(sum(d.cantidad), 0) as unidades from public.detalles_factura d
                              join public.facturas f on f.id = d.factura_id
                             where d.producto_id = p.id and f.estado = 'emitida' and f.fecha_emision >= current_date - 30) v on true
        where p.activo) x)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Reporte a solicitud
-- -----------------------------------------------------------------------------
create or replace function public.reporte_a_solicitud(p_desde date, p_hasta date, p_dimension text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform interno.exigir_direccion();
  if p_dimension not in ('producto', 'categoria', 'vendedor', 'cliente', 'dia', 'semana', 'mes', 'hora', 'dia_semana') then
    raise exception 'Dimensión no válida: %', p_dimension;
  end if;
  return jsonb_build_object(
    'filas', interno.ventas_por(p_desde, p_hasta, p_dimension, 1000),
    'verificaciones', interno.verificaciones_confiabilidad(p_desde, p_hasta));
end;
$$;

grant execute on function public.generar_reporte_programado(text, date) to authenticated;
grant execute on function public.reporte_excepciones(date, date) to authenticated;
grant execute on function public.reporte_proyecciones() to authenticated;
grant execute on function public.reporte_a_solicitud(date, date, text) to authenticated;

-- Ninguna función de public es invocable sin sesión.
revoke execute on all functions in schema public from public, anon;
