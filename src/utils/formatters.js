// Tasa BCV vigente para mostrar en Bs los montos que el sistema guarda en USD.
// La carga AppLayout antes de mostrar las pantallas.
let tasaPantalla = 0;

export function setTasaPantalla(tasa) {
  tasaPantalla = Number(tasa) || 0;
}

export function getTasaPantalla() {
  return tasaPantalla;
}

/**
 * Muestra en Bs un monto guardado en USD. Sin `tasa` usa la vigente; un
 * documento pasa la suya para no revalorizar lo ya emitido.
 */
export function formatMonto(amountUSD, tasa = tasaPantalla) {
  const t = Number(tasa) || 0;
  return t > 0 ? formatBs((Number(amountUSD) || 0) * t) : formatDolares(amountUSD);
}

/** Pasa a Bs los montos que vienen escritos en USD dentro de un texto de la base de datos. */
export function montosEnBs(texto) {
  // La BD escribe miles con coma (4,612.58 USD) y a veces "A vs B USD" (el USD vale para los dos)
  const numero = '-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?';
  const aBs = (n) => formatMonto(Number(n.replace(/,/g, '')));
  return String(texto ?? '')
    .replace(new RegExp(`(${numero}) vs (${numero}) USD`, 'g'), (_, a, b) => `${aBs(a)} vs ${aBs(b)}`)
    .replace(new RegExp(`(${numero}) USD`, 'g'), (_, n) => aBs(n));
}

/** Etiqueta corta de un eje de gráfico cuyos datos están en USD. */
export function ejeBs(usd) {
  return (Number(usd) * (tasaPantalla || 1)).toLocaleString('es-VE', { notation: 'compact', maximumFractionDigits: 1 });
}

/**
 * Format a number as USD currency: solo referencias y operaciones en divisas
 */
export function formatDolares(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

/**
 * Format a number as Bolivares
 */
export function formatBs(amount) {
  return `Bs ${new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0)}`;
}

/**
 * Convert to Date. Date-only strings (YYYY-MM-DD) are read as a local day:
 * new Date('2026-10-30') is UTC midnight, which in Venezuela is the day before.
 */
export function parseFecha(fecha) {
  if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    return new Date(anio, mes - 1, dia);
  }
  return new Date(fecha);
}

/**
 * Format a date to locale string
 */
export function formatFecha(fecha, includeTime = false) {
  if (!fecha) return '';
  const options = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime && { hour: '2-digit', minute: '2-digit' }),
  };
  return parseFecha(fecha).toLocaleDateString('es-VE', options);
}

/**
 * Format exchange rate
 */
export function formatTasa(tasa) {
  return `Bs ${new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(tasa || 0)}/$`;
}

/**
 * Format phone number for WhatsApp wa.me link
 */
export function getWhatsAppUrl(tel) {
  if (!tel) return '';
  let clean = tel.replace(/\D/g, '');
  if (clean.startsWith('0') && clean.length === 11) {
    clean = '58' + clean.slice(1);
  } else if (!clean.startsWith('58') && clean.length === 10) {
    clean = '58' + clean;
  }
  return `https://wa.me/${clean}`;
}

/**
 * Format phone number for tel: link
 */
export function getPhoneCallUrl(tel) {
  if (!tel) return '';
  const clean = tel.replace(/[^0-9+]/g, '');
  return `tel:${clean}`;
}

