import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

export const ORIGENES_CONTABLES = [
  { value: 'Manual', label: 'Manual' },
  { value: 'Ventas', label: 'Ventas' },
  { value: 'Compras', label: 'Compras' },
  { value: 'Tesorería', label: 'Tesorería' },
  { value: 'Gastos', label: 'Gastos' },
  { value: 'Ajuste', label: 'Ajuste' },
  { value: 'Nómina', label: 'Nómina' },
];

function mapearLinea(linea) {
  return {
    id: linea.id,
    debe: linea.debe,
    haber: linea.haber,
    debeVes: linea.debe_ves,
    haberVes: linea.haber_ves,
    plan_cuentas: linea.plan_cuentas,
  };
}

function mapearAsiento(asiento) {
  const lineas = (asiento.lineas_asiento || []).map(mapearLinea);
  const totalDebeCentimos = lineas.reduce((total, linea) =>
    total + Math.round(Number(linea.debe || 0) * 100), 0);
  const totalHaberCentimos = lineas.reduce((total, linea) =>
    total + Math.round(Number(linea.haber || 0) * 100), 0);

  return {
    ...asiento,
    numero: asiento.numero,
    glosa: asiento.glosa,
    modulo: asiento.modulo,
    total_debe: totalDebeCentimos / 100,
    total_haber: totalHaberCentimos / 100,
    total_debe_ves: lineas.reduce((total, linea) => total + Number(linea.debeVes || 0), 0),
    total_haber_ves: lineas.reduce((total, linea) => total + Number(linea.haberVes || 0), 0),
    balanceado: totalDebeCentimos === totalHaberCentimos,
    lineas_asiento: lineas,
  };
}

function escaparBusqueda(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

function crearConsultaAsientos({ modulo, search, buscarNumero }) {
  let query = supabase
    .from('asientos_contables')
    .select(`
      id, numero, fecha, glosa, modulo, registrado_por, total_debe, total_haber,
      balanceado, tasa_cambio, created_at,
      lineas_asiento (
        id, debe, haber, debe_ves, haber_ves,
        plan_cuentas ( id, codigo, nombre, tipo )
      )
    `)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });

  if (modulo && modulo !== 'todos') query = query.eq('modulo', modulo);
  if (search) {
    query = query.ilike(
      buscarNumero ? 'numero' : 'glosa',
      `%${escaparBusqueda(search)}%`
    );
  }
  return query;
}

async function cargarAsientos(filtros, buscarNumero) {
  const asientos = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await crearConsultaAsientos({ ...filtros, buscarNumero })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    asientos.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return asientos;
}

/**
 * Obtiene cuentas activas que aceptan movimientos.
 */
export async function fetchCuentasOperativas() {
  const { data, error } = await supabase
    .from('plan_cuentas')
    .select('id, codigo, nombre, tipo, naturaleza, es_padre')
    .eq('activo', true)
    .eq('es_padre', false)
    .order('codigo');
  if (error) throw error;
  return data || [];
}

/**
 * Obtiene todas las cuentas activas del plan contable.
 */
export async function fetchPlanCuentas() {
  const { data, error } = await supabase
    .from('plan_cuentas')
    .select('id, codigo, nombre, tipo, naturaleza, es_padre, cuenta_padre_id, activo')
    .eq('activo', true)
    .order('codigo');
  if (error) throw error;
  return data || [];
}

/**
 * Obtiene TODAS las cuentas (activas e inactivas) para gestión.
 */
export async function fetchPlanCuentasCompleto() {
  const { data, error } = await supabase
    .from('plan_cuentas')
    .select('id, codigo, nombre, tipo, naturaleza, es_padre, cuenta_padre_id, activo')
    .order('codigo');
  if (error) throw error;
  return data || [];
}

/**
 * Crea una nueva cuenta contable.
 */
export async function crearCuenta({ codigo, nombre, tipo, naturaleza, es_padre, cuenta_padre_id }) {
  const { data, error } = await supabase
    .from('plan_cuentas')
    .insert({
      codigo: codigo.trim(),
      nombre: nombre.trim(),
      tipo,
      naturaleza,
      es_padre: es_padre || false,
      cuenta_padre_id: cuenta_padre_id || null,
      activo: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Activa/desactiva una cuenta contable.
 */
export async function toggleCuentaActiva(cuentaId, activo) {
  const { error } = await supabase
    .from('plan_cuentas')
    .update({ activo })
    .eq('id', cuentaId);
  if (error) throw error;
}

/**
 * Actualiza datos de una cuenta contable.
 */
export async function actualizarCuenta(cuentaId, { nombre, tipo, naturaleza, es_padre }) {
  const { error } = await supabase
    .from('plan_cuentas')
    .update({
      nombre: nombre.trim(),
      tipo,
      naturaleza,
      es_padre: es_padre || false,
    })
    .eq('id', cuentaId);
  if (error) throw error;
}

/**
 * Saldos por cuenta calculados en PostgreSQL (sin límite de filas).
 * Con fechaDesde vacío se obtiene el saldo acumulado al corte.
 */
async function fetchSaldos(fechaDesde, fechaHasta) {
  const { data, error } = await supabase.rpc('saldos_cuentas', {
    p_desde: fechaDesde || null,
    p_hasta: fechaHasta || null,
  });
  if (error) throw error;
  return (data || []).map((c) => ({
    id: c.cuenta_id,
    codigo: c.codigo,
    nombre: c.nombre,
    tipo: c.tipo,
    naturaleza: c.naturaleza,
    debe: Number(c.debe),
    haber: Number(c.haber),
    debeVes: Number(c.debe_ves),
    haberVes: Number(c.haber_ves),
    saldo: Number(c.saldo),
    saldoVes: Number(c.saldo_ves),
  }));
}

const centimos = (n) => Math.round(Number(n || 0) * 100);

/**
 * Balance de comprobación: sumas y saldos de las cuentas con movimiento.
 * El saldo deudor/acreedor se determina por el lado que predomina
 * (Debe > Haber = deudor), independientemente de la naturaleza de la cuenta.
 */
export async function fetchBalanceComprobacion({ fechaDesde, fechaHasta } = {}) {
  const cuentas = await fetchSaldos(fechaDesde, fechaHasta);
  return cuentas.map((c) => {
    const neto = centimos(c.debe) - centimos(c.haber);
    const netoVes = centimos(c.debeVes) - centimos(c.haberVes);
    return {
      ...c,
      totalDebe: c.debe,
      totalHaber: c.haber,
      totalDebeVes: c.debeVes,
      totalHaberVes: c.haberVes,
      saldoDeudor: neto > 0 ? neto / 100 : 0,
      saldoAcreedor: neto < 0 ? -neto / 100 : 0,
      saldoDeudorVes: netoVes > 0 ? netoVes / 100 : 0,
      saldoAcreedorVes: netoVes < 0 ? -netoVes / 100 : 0,
    };
  });
}

/**
 * Obtiene asientos y sus lineas del esquema contable actualmente desplegado.
 */
export async function fetchAsientos({ modulo = 'todos', search = '' } = {}) {
  const filtros = { modulo, search: search.trim() };
  if (!filtros.search) {
    return (await cargarAsientos(filtros, false)).map(mapearAsiento);
  }

  const [porNumero, porGlosa] = await Promise.all([
    cargarAsientos(filtros, true),
    cargarAsientos(filtros, false),
  ]);
  const unicos = new Map([...porNumero, ...porGlosa].map(asiento => [asiento.id, asiento]));
  return [...unicos.values()].map(mapearAsiento);
}

/**
 * Crea un asiento usando la tasa y validaciones transaccionales de PostgreSQL.
 */
export async function crearAsiento(fecha, glosa, modulo, lineas) {
  if (!fecha || !glosa?.trim()) {
    throw new Error('La fecha y el concepto del asiento son obligatorios.');
  }

  const origenValido = ORIGENES_CONTABLES.some(origen => origen.value === modulo);
  if (!origenValido) throw new Error('El tipo de asiento seleccionado no es válido.');

  const lineasLimpias = lineas.map(linea => ({
    cuenta_id: linea.cuenta_id,
    debe: Math.round(Number(linea.debe || 0) * 100) / 100,
    haber: Math.round(Number(linea.haber || 0) * 100) / 100,
  }));
  if (lineasLimpias.length < 2 || lineasLimpias.some(linea =>
    !linea.cuenta_id
    || !Number.isFinite(linea.debe)
    || !Number.isFinite(linea.haber)
    || linea.debe < 0
    || linea.haber < 0
    || (linea.debe > 0 && linea.haber > 0)
    || (linea.debe === 0 && linea.haber === 0)
  )) {
    throw new Error('Cada asiento requiere dos o más líneas válidas con un monto positivo en un solo lado.');
  }

  const totalDebeCentimos = lineasLimpias.reduce((total, linea) =>
    total + Math.round(linea.debe * 100), 0);
  const totalHaberCentimos = lineasLimpias.reduce((total, linea) =>
    total + Math.round(linea.haber * 100), 0);
  if (totalDebeCentimos === 0 || totalDebeCentimos !== totalHaberCentimos) {
    throw new Error('El asiento debe cuadrar exactamente antes de registrarse.');
  }

  const { data, error } = await supabase.rpc('crear_asiento', {
    p_fecha: fecha,
    p_glosa: glosa.trim(),
    p_modulo: modulo,
    p_lineas: lineasLimpias,
  });
  if (error) throw error;
  return data;
}

/**
 * Obtiene movimientos de una cuenta en orden cronológico.
 */
export async function fetchMovimientosCuenta(cuentaId) {
  const movimientos = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('lineas_asiento')
      .select(`
        id, debe, haber, debe_ves, haber_ves,
        asientos_contables ( id, numero, fecha, glosa, modulo, tasa_cambio )
      `)
      .eq('cuenta_id', cuentaId)
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    movimientos.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return movimientos.sort((a, b) => {
    const fecha = (a.asientos_contables?.fecha || '').localeCompare(b.asientos_contables?.fecha || '');
    return fecha || (a.asientos_contables?.numero || '').localeCompare(b.asientos_contables?.numero || '');
  });
}

/**
 * Estados Financieros.
 * - Estado de Resultados: movimientos del período [fechaDesde, fechaHasta].
 * - Balance General: saldos ACUMULADOS al corte (fechaHasta), sin importar
 *   fechaDesde. Mientras no exista asiento de cierre, el resultado acumulado
 *   de ingresos, costos y gastos se presenta como utilidad del ejercicio.
 */
export async function fetchEstadosFinancieros({ fechaDesde, fechaHasta } = {}) {
  const [periodo, acumulado] = await Promise.all([
    fetchSaldos(fechaDesde, fechaHasta),
    fetchSaldos(null, fechaHasta),
  ]);

  const conCentimos = (c) => ({ ...c, saldoCentimos: centimos(c.saldo), saldoVesCentimos: centimos(c.saldoVes) });
  const deTipo = (lista, tipo) => lista.filter((c) => c.tipo === tipo).map(conCentimos);
  const suma = (lista, campo) => lista.reduce((acc, c) => acc + c[campo], 0);

  function resultado(lista) {
    const ingresos = deTipo(lista, 'INGRESO');
    const costos = deTipo(lista, 'COSTO');
    const gastos = deTipo(lista, 'GASTO');
    const r = { ingresos, costos, gastos };
    for (const sufijo of ['', 'Ves']) {
      const campo = `saldo${sufijo}Centimos`;
      const tIng = suma(ingresos, campo);
      const tCos = suma(costos, campo);
      const tGas = suma(gastos, campo);
      r[`totalIngresos${sufijo}`] = tIng / 100;
      r[`totalCostos${sufijo}`] = tCos / 100;
      r[`utilidadBruta${sufijo}`] = (tIng - tCos) / 100;
      r[`totalGastos${sufijo}`] = tGas / 100;
      r[`utilidadNeta${sufijo}`] = (tIng - tCos - tGas) / 100;
    }
    return r;
  }

  const estadoResultados = resultado(periodo);
  const resultadoAcumulado = resultado(acumulado);

  const activos = deTipo(acumulado, 'ACTIVO');
  const pasivos = deTipo(acumulado, 'PASIVO');
  const patrimonio = deTipo(acumulado, 'PATRIMONIO');
  const balanceGeneral = { activos, pasivos, patrimonio };

  for (const sufijo of ['', 'Ves']) {
    const campo = `saldo${sufijo}Centimos`;
    const tAct = suma(activos, campo);
    const tPas = suma(pasivos, campo);
    const tPatBase = suma(patrimonio, campo);
    const utilidad = Math.round(resultadoAcumulado[`utilidadNeta${sufijo}`] * 100);
    balanceGeneral[`totalActivos${sufijo}`] = tAct / 100;
    balanceGeneral[`totalPasivos${sufijo}`] = tPas / 100;
    balanceGeneral[`totalPatrimonioBase${sufijo}`] = tPatBase / 100;
    balanceGeneral[`utilidadEjercicio${sufijo}`] = utilidad / 100;
    balanceGeneral[`totalPatrimonio${sufijo}`] = (tPatBase + utilidad) / 100;
    balanceGeneral[`totalPasivoPatrimonio${sufijo}`] = (tPas + tPatBase + utilidad) / 100;
    if (!sufijo) {
      balanceGeneral.diferencia = (tAct - tPas - tPatBase - utilidad) / 100;
      balanceGeneral.cuadrado = Math.abs(tAct - tPas - tPatBase - utilidad) <= 1;
    }
  }

  return { estadoResultados, balanceGeneral };
}
