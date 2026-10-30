/**
 * Servicio de Cuentas por Cobrar a Clientes.
 *
 * Toda la información vive en la base de datos:
 * - Cartera, antigüedad, recargo por mora y saldo: vista v_cuentas_por_cobrar.
 * - Abonos: tabla abonos_cxc (RPC registrar_abono / anular_abono, con asiento
 *   contable, IGTF y diferencial cambiario calculados en el servidor).
 * - Política de crédito y mora: configuracion_empresa.
 */

import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

export const DEFAULT_CXC_CONFIG = {
  diasGracia: 15,
  porcentajeRecargo: 5,
  aplicarRecargoAutomatico: true,
};

/**
 * Obtiene la política de crédito y mora de la empresa.
 */
export async function fetchCxCConfig() {
  const { data, error } = await supabase
    .from('configuracion_empresa')
    .select('dias_credito, porcentaje_recargo_mora, aplicar_recargo_mora')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_CXC_CONFIG;
  return {
    diasGracia: data.dias_credito,
    porcentajeRecargo: Number(data.porcentaje_recargo_mora),
    aplicarRecargoAutomatico: data.aplicar_recargo_mora,
  };
}

/**
 * Guarda la política de crédito y mora (aplica a créditos nuevos el plazo;
 * el porcentaje se usa al fijar el recargo de las cuentas vencidas).
 */
export async function saveCxCConfig(cfg) {
  const { error } = await supabase
    .from('configuracion_empresa')
    .update({
      dias_credito: parseInt(cfg.diasGracia, 10),
      porcentaje_recargo_mora: parseFloat(cfg.porcentajeRecargo),
      aplicar_recargo_mora: !!cfg.aplicarRecargoAutomatico,
    })
    .eq('id', 'default');
  if (error) throw error;
  return fetchCxCConfig();
}

async function cargarPaginado(crearConsulta) {
  const filas = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await crearConsulta().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return filas;
}

function mapearAbono(a) {
  return {
    id: a.id,
    fecha: a.fecha,
    metodo: a.metodo_id,
    monto_usd: Number(a.monto_usd),
    monto_bs: Number(a.monto_bs),
    igtf_usd: Number(a.igtf_usd),
    aplicado_recargo_usd: Number(a.aplicado_recargo_usd),
    aplicado_capital_usd: Number(a.aplicado_capital_usd),
    diferencial_bs: Number(a.diferencial_bs),
    referencia: a.referencia,
    notas: a.notas,
  };
}

/**
 * Cartera de crédito directo con sus abonos vigentes y artículos entregados.
 * Devuelve la estructura que consumen la pantalla de CxC y sus reportes.
 */
export async function fetchCuentasPorCobrar() {
  const filas = await cargarPaginado(() =>
    supabase
      .from('v_cuentas_por_cobrar')
      .select('*')
      .eq('tipo', 'CREDITO_DIRECTO')
      .neq('estado', 'ANULADA')
      .order('fecha_emision', { ascending: false })
  );

  const abonos = await cargarPaginado(() =>
    supabase.from('abonos_cxc').select('*').eq('estado', 'VIGENTE').order('fecha')
  );
  const abonosPorCuenta = {};
  for (const a of abonos) {
    (abonosPorCuenta[a.cxc_id] ||= []).push(mapearAbono(a));
  }

  // Artículos entregados, por lotes de facturas para no exceder el largo de la URL.
  const facturaIds = [...new Set(filas.map((f) => f.factura_id))];
  const detallesPorFactura = {};
  for (let i = 0; i < facturaIds.length; i += 150) {
    const { data, error } = await supabase
      .from('detalles_factura')
      .select('id, factura_id, producto_nombre, cantidad, precio_unitario_usd, subtotal_usd')
      .in('factura_id', facturaIds.slice(i, i + 150));
    if (error) throw error;
    for (const d of data || []) {
      (detallesPorFactura[d.factura_id] ||= []).push(d);
    }
  }

  return filas.map((c) => ({
    id: c.id,
    factura_id: c.factura_id,
    numero_factura: c.numero_factura,
    fecha_emision: c.fecha_emision,
    fecha_vencimiento: c.fecha_vencimiento,
    cliente: {
      id: c.cliente_id,
      nombre: c.cliente_nombre,
      documento_identidad: c.documento_identidad,
      telefono: c.telefono,
      email: c.email,
      direccion: c.direccion,
    },
    detalles_factura: detallesPorFactura[c.factura_id] || [],
    totalFacturaUSD: Number(c.total_factura_usd),
    tipoCredito: 'directo',
    montoOriginalUSD: Number(c.monto_usd),
    montoOriginalBs: Number((Number(c.monto_usd) * Number(c.tasa_origen)).toFixed(2)),
    tasaOrigen: Number(c.tasa_origen),
    diasTranscurridos: c.dias_transcurridos,
    diasVencida: c.dias_vencida,
    capitalPendienteUSD: Number(c.capital_pendiente_usd),
    recargoUSD: Number(c.recargo_usd),
    recargoPendienteUSD: Number(c.recargo_pendiente_usd),
    abonos: abonosPorCuenta[c.id] || [],
    totalAbonadoUSD: Number(c.total_abonado_usd),
    saldoTotalUSD: Number(c.saldo_total_usd),
    esSolvente: c.estado === 'PAGADA',
    esVencida: c.vencida,
    estado: c.estado,
  }));
}

/**
 * Registra un abono. El servidor imputa primero al recargo y luego al capital,
 * calcula IGTF y diferencial cambiario y genera el asiento contable.
 */
export async function registrarAbono(cxcId, { monto_usd, metodo, referencia, notas }) {
  const { data, error } = await supabase.rpc('registrar_abono', {
    p_cxc_id: cxcId,
    p_monto_usd: monto_usd,
    p_metodo_id: metodo,
    p_referencia: referencia || null,
    p_notas: notas || null,
  });
  if (error) throw error;
  return mapearAbono(data);
}

/**
 * Anula un abono (solo admin/gerente): restituye el saldo y revierte el asiento.
 */
export async function anularAbono(abonoId, motivo) {
  const { error } = await supabase.rpc('anular_abono', { p_abono_id: abonoId, p_motivo: motivo });
  if (error) throw error;
}

/**
 * Construye el mensaje personalizado para WhatsApp
 */
export function generarMensajeCobroWhatsApp({ cliente, cuenta, saldoTotalUSD, saldoTotalBs, dias, recargoUSD, porcentajeRecargo, empresa }) {
  const nombreCliente = cliente?.nombre || 'Estimado(a) Cliente';
  const nombreEmpresa = empresa?.nombre || 'Comercializadora ARLUC';
  const telefonoEmpresa = empresa?.telefono ? ` al ${empresa.telefono}` : '';

  let msg = `Hola *${nombreCliente}*, le saludamos cordialmente de *${nombreEmpresa}*.\n\n`;
  msg += `Le recordamos que posee una cuenta pendiente por cobrar asociada a su compra (Factura *${cuenta.numero_factura}*).\n`;
  msg += `⏳ Han transcurrido *${dias} día(s)* desde su emisión.\n`;

  if (recargoUSD > 0) {
    msg += `⚠️ Su saldo incluye un recargo por mora del *${porcentajeRecargo}%* ($${recargoUSD.toFixed(2)} USD).\n`;
  }

  msg += `💰 *Saldo Pendiente a la fecha:* $${saldoTotalUSD.toFixed(2)} USD`;
  if (saldoTotalBs > 0) {
    msg += ` (Aprox. Bs. ${saldoTotalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
  }
  msg += `\n\nPor favor comuníquese con nosotros${telefonoEmpresa} para coordinar su pago o reporte de abono. ¡Muchas gracias!`;

  return encodeURIComponent(msg);
}
