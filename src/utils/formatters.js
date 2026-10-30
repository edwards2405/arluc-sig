/**
 * Format a number as USD currency
 */
export function formatUSD(amount) {
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
 * Format a date for display in short format
 */
export function formatFechaCorta(fecha) {
  if (!fecha) return '';
  return parseFecha(fecha).toLocaleDateString('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
 * Truncate text with ellipsis
 */
export function truncate(text, length = 30) {
  if (!text) return '';
  return text.length > length ? text.substring(0, length) + '...' : text;
}

/**
 * Generate a SKU suggestion from product name
 */
export function generarSKU(nombre) {
  if (!nombre) return '';
  return nombre
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 6)
    + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
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

