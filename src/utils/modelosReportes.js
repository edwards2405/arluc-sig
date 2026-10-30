/**
 * Convierte las respuestas de la BD en reportes del motor común
 * (utils/reportes.js): el mismo modelo se ve en pantalla, se exporta a Excel
 * y se imprime. Cada uno declara su ficha de calidad de la información.
 */
import { formatFecha } from './formatters';

const col = (titulo, clave, tipo = 'texto', ancho) => ({ titulo, clave, tipo, ancho });
const ventasCols = (grupo) => [
  col(grupo, 'grupo', 'texto', 30), col('Facturas', 'facturas', 'numero'), col('Unidades', 'unidades', 'numero'),
  col('Ventas netas', 'ventas', 'usd'), col('Costo', 'costo', 'usd'), col('Margen', 'margen', 'usd'), col('Margen %', 'margen_pct', 'porcentaje'),
];
const conTotal = (filas, etiqueta = 'Total') => {
  if (!filas.length) return filas;
  const suma = (k) => filas.reduce((t, f) => t + Number(f[k] || 0), 0);
  const ventas = suma('ventas');
  return [...filas, { grupo: etiqueta, facturas: suma('facturas'), unidades: suma('unidades'), ventas, costo: suma('costo'),
    margen: suma('margen'), margen_pct: ventas ? (100 * suma('margen')) / ventas : 0, _estilo: 'total' }];
};

export const TIPOS_PROGRAMADOS = {
  CIERRE_DIARIO: { etiqueta: 'Cierre diario de ventas', frecuencia: 'Todos los días a las 8:30 p. m.', para: 'Gerente y cajeros: cuadre del día, desempeño y anomalías.' },
  RESUMEN_SEMANAL: { etiqueta: 'Resumen semanal', frecuencia: 'Cada lunes a las 7:00 a. m. (semana anterior)', para: 'Gerencia: tendencia de ventas, productos y vendedores.' },
  RESUMEN_MENSUAL: { etiqueta: 'Resumen gerencial mensual', frecuencia: 'El día 1 de cada mes a las 7:00 a. m. (mes anterior)', para: 'Dirección: resultados, metas y salud financiera del mes.' },
};

// ---------------------------------------------------------------------------
// Programados
// ---------------------------------------------------------------------------
export function modeloProgramado(r) {
  const c = r.contenido;
  const tipo = TIPOS_PROGRAMADOS[r.codigo];
  const base = {
    titulo: r.titulo,
    subtitulo: `Reporte programado · ${tipo.frecuencia} · generado el ${new Date(r.generado_en).toLocaleString('es-VE')}`,
    moneda: 'USD',
    archivo: r.titulo.replace(/[·/]/g, '-').replace(/\s+/g, '_'),
    calidad: {
      relevante: tipo.para,
      oportunidad: `Generado automáticamente (${r.origen === 'CRON' ? 'programado' : 'regenerado manualmente'}) el ${new Date(r.generado_en).toLocaleString('es-VE')}. ${tipo.frecuencia}.`,
      comprensible: 'Cifras clave arriba; detalle por sección con totales; montos en USD sin IVA salvo que se indique.',
      fuente: 'Facturas, notas, cobros y contabilidad registrados en el sistema al momento de generarse.',
    },
  };

  if (r.codigo === 'CIERRE_DIARIO') {
    const v = c.ventas;
    return {
      ...base,
      resumen: [
        { etiqueta: 'Ventas netas', valor: v.venta_neta, detalle: c.comparacion.variacion_pct !== null ? `${c.comparacion.variacion_pct > 0 ? '+' : ''}${c.comparacion.variacion_pct} % vs. promedio 7 días` : '' },
        { etiqueta: 'Facturas', valor: v.facturas, tipo: 'numero', detalle: `Ticket promedio $ ${Number(v.ticket_promedio).toFixed(2)}` },
        { etiqueta: 'Margen bruto', valor: v.margen },
        { etiqueta: 'Tasa BCV del día', valor: c.tasa_bcv, tipo: 'bs' },
      ],
      secciones: [
        { titulo: 'Recaudación del día', columnas: [col('Concepto', 'concepto', 'texto', 34), col('Monto', 'monto', 'usd')], filas: [
          { concepto: 'Ventas netas (sin IVA)', monto: v.venta_neta }, { concepto: 'IVA facturado', monto: v.iva },
          { concepto: 'IGTF percibido', monto: v.igtf }, { concepto: 'Total facturado', monto: v.total, _estilo: 'total' },
          { concepto: 'Cobranza de créditos', monto: c.cobranza.monto },
          { concepto: `Anulaciones (${c.anulaciones.cantidad})`, monto: c.anulaciones.monto },
          { concepto: `Notas de crédito (${c.notas_credito.cantidad})`, monto: c.notas_credito.monto },
        ] },
        { titulo: 'Por medio de cobro', columnas: [col('Medio', 'grupo', 'texto', 28), col('Monto aplicado', 'monto', 'usd')], filas: c.por_metodo },
        { titulo: 'Por vendedor', columnas: ventasCols('Vendedor'), filas: conTotal(c.por_vendedor) },
        { titulo: 'Productos más vendidos', columnas: ventasCols('Producto'), filas: c.top_productos },
      ],
    };
  }

  const res = c.resumen;
  const kpis = [
    { etiqueta: 'Ventas netas', valor: res.actual.ventas_netas, detalle: res.variacion_pct.ventas_netas !== null ? `${res.variacion_pct.ventas_netas > 0 ? '+' : ''}${res.variacion_pct.ventas_netas} % vs. período anterior` : '' },
    { etiqueta: 'Margen bruto', valor: res.actual.margen_bruto, detalle: `${res.actual.margen_pct} % de margen` },
    { etiqueta: 'Utilidad neta contable', valor: res.resultado.utilidad_neta },
    { etiqueta: 'Facturas', valor: res.actual.facturas, tipo: 'numero', detalle: `Ticket $ ${Number(res.actual.ticket_promedio).toFixed(2)}` },
  ];
  const financiero = { titulo: 'Indicadores financieros y de gestión', columnas: [col('Indicador', 'indicador', 'texto', 40), col('Valor', 'valor', 'texto'), col('Referencia', 'ref', 'texto', 36)], filas: [
    { indicador: 'Liquidez corriente', valor: res.financiero.liquidez_corriente, ref: 'Sano entre 1,5 y 3' },
    { indicador: 'Prueba ácida', valor: res.financiero.prueba_acida, ref: 'Deseable ≥ 1' },
    { indicador: 'Endeudamiento', valor: `${res.financiero.endeudamiento_pct} %`, ref: 'Deseable < 50 %' },
    { indicador: 'Días promedio de cobro (DSO)', valor: `${res.cartera.dso_dias} días`, ref: 'Sobre ventas a crédito' },
    { indicador: 'Morosidad de la cartera', valor: `${res.cartera.morosidad_pct} %`, ref: 'Deseable ≤ 10 %' },
    { indicador: 'Rotación de inventario', valor: `${res.inventario.rotacion_anual} veces/año`, ref: `Cubre ${res.inventario.dias_inventario ?? '—'} días de venta` },
  ] };

  if (r.codigo === 'RESUMEN_SEMANAL') {
    return {
      ...base, resumen: kpis,
      secciones: [
        { titulo: 'Ventas por día', columnas: ventasCols('Día'), filas: conTotal(c.por_dia.map((d) => ({ ...d, grupo: formatFecha(d.grupo) }))) },
        { titulo: 'Por vendedor', columnas: ventasCols('Vendedor'), filas: conTotal(c.por_vendedor) },
        { titulo: 'Top 10 productos', columnas: ventasCols('Producto'), filas: c.top_productos },
        financiero,
        ...(c.alertas?.length ? [{ titulo: 'Alertas al cierre de la semana', columnas: [col('Nivel', 'nivel'), col('Área', 'categoria'), col('Situación', 'mensaje', 'texto', 50)], filas: c.alertas }] : []),
      ],
    };
  }

  // Mensual
  const er = c.estado_resultados;
  const total = (tipo) => er.filter((x) => x.tipo === tipo).reduce((t, x) => t + Number(x.monto), 0);
  const filasER = [
    ...er.filter((x) => x.tipo === 'INGRESO'), { codigo: '', cuenta: 'Total ingresos', monto: total('INGRESO'), _estilo: 'subtotal' },
    ...er.filter((x) => x.tipo === 'COSTO'), { codigo: '', cuenta: 'Total costos', monto: total('COSTO'), _estilo: 'subtotal' },
    ...er.filter((x) => x.tipo === 'GASTO'), { codigo: '', cuenta: 'Total gastos', monto: total('GASTO'), _estilo: 'subtotal' },
    { codigo: '', cuenta: 'Utilidad neta del mes', monto: total('INGRESO') - total('COSTO') - total('GASTO'), _estilo: 'total' },
  ];
  return {
    ...base, resumen: kpis,
    secciones: [
      { titulo: 'Cumplimiento de metas', columnas: [col('Responsable', 'nombre', 'texto', 24), col('Meta', 'meta', 'usd'), col('Vendido', 'vendido', 'usd'),
        col('Cumplimiento', 'cumplimiento_pct', 'porcentaje'), col('Facturas', 'facturas', 'numero')], filas: c.metas },
      { titulo: 'Estado de resultados del mes', columnas: [col('Código', 'codigo', 'codigo'), col('Cuenta', 'cuenta', 'texto', 42), col('Monto', 'monto', 'usd')], filas: filasER },
      financiero,
      { titulo: 'Ventas por categoría', columnas: ventasCols('Categoría'), filas: conTotal(c.por_categoria) },
      { titulo: 'Por vendedor', columnas: ventasCols('Vendedor'), filas: conTotal(c.por_vendedor) },
      { titulo: 'Top 10 productos', columnas: ventasCols('Producto'), filas: c.top_productos },
    ],
  };
}

// ---------------------------------------------------------------------------
// De excepción
// ---------------------------------------------------------------------------
const COLUMNAS_EXCEPCION = {
  margen_bajo: [col('Producto', 'producto', 'texto', 30), col('Unidades', 'unidades', 'numero'), col('Ventas', 'ventas', 'usd'), col('Costo', 'costo', 'usd'), col('Margen %', 'margen_pct', 'porcentaje')],
  dias_bajos: [col('Día', 'dia', 'fecha'), col('Ventas', 'ventas', 'usd'), col('% del promedio', 'porcentaje_del_promedio', 'porcentaje')],
  anulaciones: [col('Fecha', 'fecha', 'fecha'), col('Tipo', 'tipo'), col('Documento', 'documento', 'codigo'), col('Monto', 'monto', 'usd'), col('Motivo', 'motivo', 'texto', 34), col('Usuario', 'usuario')],
  cartera_vencida: [col('Cliente', 'cliente', 'texto', 28), col('Teléfono', 'telefono', 'codigo'), col('Factura', 'factura', 'codigo'), col('Días vencida', 'dias_vencida', 'numero'), col('Saldo', 'saldo', 'usd')],
  sobre_limite: [col('Cliente', 'cliente', 'texto', 28), col('Línea', 'linea', 'usd'), col('Saldo', 'saldo', 'usd'), col('Exceso', 'exceso', 'usd')],
  inventario: [col('SKU', 'sku', 'codigo'), col('Producto', 'producto', 'texto', 30), col('Stock', 'stock', 'numero'), col('Mínimo', 'stock_minimo', 'numero'), col('Valor a costo', 'valor_costo', 'usd')],
  mermas: [col('Fecha', 'fecha', 'fecha'), col('SKU', 'sku', 'codigo'), col('Producto', 'producto', 'texto', 28), col('Cantidad', 'cantidad', 'numero'), col('Valor a costo', 'valor_costo', 'usd'), col('Usuario', 'usuario')],
  cxp_vencidas: [col('Proveedor', 'proveedor', 'texto', 30), col('Orden', 'orden', 'codigo'), col('Vence', 'vence', 'fecha'), col('Saldo', 'saldo', 'usd')],
  tasa_bcv: [col('Momento', 'momento'), col('Origen', 'origen'), col('Estado', 'estado'), col('Detalle', 'detalle', 'texto', 50)],
};

export function modeloExcepciones(datos, desde, hasta) {
  const conCasos = datos.filter((e) => e.filas.length > 0);
  return {
    titulo: 'Reporte de excepciones',
    subtitulo: `Del ${formatFecha(desde)} al ${formatFecha(hasta)} · solo situaciones fuera de los umbrales normales`,
    moneda: 'USD',
    archivo: `Reporte_de_Excepciones_${desde}_al_${hasta}`,
    resumen: [
      { etiqueta: 'Controles revisados', valor: datos.length, tipo: 'numero' },
      { etiqueta: 'Con excepciones', valor: conCasos.length, tipo: 'numero' },
      { etiqueta: 'Casos a atender', valor: conCasos.reduce((t, e) => t + e.filas.length, 0), tipo: 'numero' },
    ],
    secciones: [
      { titulo: 'Resumen de controles', columnas: [col('Control', 'titulo', 'texto', 46), col('Umbral', 'umbral', 'texto', 36), col('Responsable', 'responsable', 'texto', 22), col('Casos', 'casos', 'numero')],
        filas: datos.map((e) => ({ ...e, casos: e.filas.length })) },
      ...conCasos.map((e) => ({ titulo: `${e.titulo} (${e.filas.length})`, columnas: COLUMNAS_EXCEPCION[e.codigo], filas: e.filas,
        nota: `Umbral: ${e.umbral} · Responsable: ${e.responsable}` })),
    ],
    calidad: {
      relevante: 'Gerencia y responsables de cada área: muestra únicamente lo que requiere acción (gestión por excepción).',
      oportunidad: 'Calculado al momento de la consulta sobre datos al día.',
      comprensible: 'Un resumen de controles con su umbral y responsable, y el detalle solo de los que tienen casos.',
      fuente: 'Facturas, notas, cartera, inventario, compras y bitácora de la tasa BCV.',
    },
  };
}

// ---------------------------------------------------------------------------
// Proyección y pronóstico
// ---------------------------------------------------------------------------
export function modeloProyecciones(datos) {
  const fc = datos.flujo_caja;
  const empresa = datos.cierre_mes.find((m) => !m.vendedor_id);
  return {
    titulo: 'Proyecciones y pronósticos',
    subtitulo: `Calculado el ${new Date().toLocaleDateString('es-VE')} · ventas por regresión lineal de las últimas 8 semanas`,
    moneda: 'USD',
    archivo: `Proyecciones_${new Date().toLocaleDateString('en-CA')}`,
    resumen: [
      { etiqueta: 'Efectivo disponible hoy', valor: fc.efectivo_actual },
      { etiqueta: 'Saldo proyectado en 4 semanas', valor: fc.semanas.at(-1)?.saldo_final },
      { etiqueta: 'Cierre de mes proyectado', valor: empresa?.proyeccion_cierre, detalle: empresa?.meta ? `${empresa.proyeccion_pct} % de la meta` : 'Sin meta asignada' },
      { etiqueta: 'Productos que se agotan en 15 días', valor: datos.inventario.filter((p) => p.dias_cobertura !== null && p.dias_cobertura <= 15).length, tipo: 'numero' },
    ],
    secciones: [
      { titulo: 'Pronóstico de ventas semanales', columnas: [col('Semana del', 'semana', 'fecha'), col('Ventas netas', 'ventas', 'usd'), col('Tipo', 'tipo')],
        filas: datos.ventas.map((v) => ({ ...v, tipo: v.tipo === 'REAL' ? 'Real' : 'Proyección' })) },
      { titulo: 'Flujo de caja proyectado (4 semanas)', columnas: [col('Semana del', 'semana', 'fecha'), col('Ventas de contado', 'ventas_contado', 'usd'),
        col('Cobros de crédito', 'cobros_cxc', 'usd'), col('Pagos a proveedores', 'pagos_proveedores', 'usd'), col('Gastos operativos', 'gastos_operativos', 'usd'),
        col('Saldo final', 'saldo_final', 'usd')], filas: fc.semanas,
        nota: `Supuestos: ${fc.porcentaje_contado} % de las ventas se cobra al contado; gasto operativo semanal promedio de $ ${Number(fc.gasto_semanal_promedio).toFixed(2)}; las ventas proyectadas incluyen IVA.` },
      { titulo: 'Cierre de mes proyectado contra la meta', columnas: [col('Responsable', 'nombre', 'texto', 24), col('Meta', 'meta', 'usd'), col('Vendido', 'vendido', 'usd'),
        col('Proyección al cierre', 'proyeccion_cierre', 'usd'), col('% de la meta', 'proyeccion_pct', 'porcentaje')], filas: datos.cierre_mes },
      { titulo: 'Agotamiento de inventario y sugerencia de compra', columnas: [col('SKU', 'sku', 'codigo'), col('Producto', 'producto', 'texto', 30),
        col('Stock', 'stock', 'numero'), col('Venta diaria', 'venta_diaria', 'numero'), col('Días de cobertura', 'dias_cobertura', 'numero'),
        col('Se agota el', 'fecha_agotamiento', 'fecha'), col('Comprar (30 días)', 'sugerencia_compra', 'numero')], filas: datos.inventario,
        nota: 'Venta diaria = promedio de los últimos 30 días. Sugerencia = unidades para cubrir 30 días menos el stock actual.' },
    ],
    calidad: {
      relevante: 'Dirección, tesorería y compras: anticipar faltantes de caja e inventario y el resultado del mes.',
      oportunidad: 'Recalculado cada vez que se abre, con los datos de hoy.',
      comprensible: 'Cada proyección indica sus supuestos; lo real y lo proyectado se distinguen explícitamente.',
      fuente: 'Ventas históricas, cartera y cuentas por pagar con su vencimiento, gastos contabilizados y kardex.',
    },
  };
}

// ---------------------------------------------------------------------------
// A solicitud
// ---------------------------------------------------------------------------
export const DIMENSIONES = {
  producto: 'Producto', categoria: 'Categoría', vendedor: 'Vendedor', cliente: 'Cliente',
  dia: 'Día', semana: 'Semana', mes: 'Mes', dia_semana: 'Día de la semana', hora: 'Hora del día',
};

export function modeloSolicitud(filas, desde, hasta, dimension) {
  const etiqueta = DIMENSIONES[dimension];
  const total = filas.reduce((t, f) => t + Number(f.ventas), 0);
  const conParticipacion = filas.map((f) => ({ ...f, grupo: ['dia', 'semana'].includes(dimension) ? formatFecha(f.grupo) : f.grupo,
    participacion: total ? (100 * f.ventas) / total : 0 }));
  return {
    titulo: `Ventas por ${etiqueta.toLowerCase()}`,
    subtitulo: `Reporte a solicitud · del ${formatFecha(desde)} al ${formatFecha(hasta)}`,
    moneda: 'USD',
    archivo: `Ventas_por_${dimension}_${desde}_al_${hasta}`,
    resumen: [
      { etiqueta: 'Ventas netas', valor: total },
      { etiqueta: `${etiqueta}s con ventas`, valor: filas.length, tipo: 'numero' },
      { etiqueta: 'Mayor participación', valor: conParticipacion[0]?.grupo ?? '—', tipo: 'texto',
        detalle: conParticipacion[0] ? `${conParticipacion[0].participacion.toFixed(1)} % de las ventas` : '' },
    ],
    secciones: [{ columnas: [...ventasCols(etiqueta), col('Participación', 'participacion', 'porcentaje')],
      filas: [...conParticipacion, ...conTotal(filas).slice(-1).map((t) => ({ ...t, participacion: 100 }))] }],
    calidad: {
      relevante: 'Responde la pregunta puntual que formula el usuario (quién, qué, cuándo se vende).',
      oportunidad: 'Generado al instante con los datos al día.',
      comprensible: 'Ordenado de mayor a menor venta, con margen y participación de cada grupo.',
      fuente: 'Detalle de facturas emitidas (excluye anuladas) con su costo histórico.',
    },
  };
}
