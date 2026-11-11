/**
 * Reglas de validación comunes de los formularios. La base de datos aplica las
 * mismas reglas (supabase/migrations/*_validaciones.sql): el formulario solo
 * avisa antes y con un mensaje claro.
 */

/** Texto con contenido real (no vacío ni solo espacios). */
export const tieneTexto = (valor) => String(valor ?? '').trim().length > 0;

/**
 * Normaliza una cédula o RIF venezolano: mayúsculas, sin espacios ni puntos y
 * con guiones. "v12.345.678" → "V-12345678"; "j501234567" → "J-50123456-7".
 */
export function normalizarDocumento(valor) {
  const limpio = String(valor ?? '').toUpperCase().replace(/[\s.\-_]/g, '');
  const m = limpio.match(/^([VEJGP])(\d+)$/);
  if (!m) return String(valor ?? '').trim().toUpperCase();
  const [, letra, numeros] = m;
  // 9 dígitos = RIF: 8 dígitos + dígito verificador
  if (numeros.length === 9) return `${letra}-${numeros.slice(0, 8)}-${numeros.slice(8)}`;
  return `${letra}-${numeros}`;
}

/** Cédula (V/E + 6 a 8 dígitos) o RIF (V/E/J/G/P + 8 dígitos + verificador). */
export const PATRON_DOCUMENTO = /^[VEJGP]-\d{6,9}(-\d)?$/;

export function validarDocumento(valor, { soloRif = false } = {}) {
  const doc = normalizarDocumento(valor);
  if (!tieneTexto(doc)) return 'La cédula o RIF es obligatorio';
  if (!PATRON_DOCUMENTO.test(doc)) return 'Formato inválido. Ej.: V-12345678 o J-12345678-9';
  if (soloRif && !/^[VEJGP]-\d{8}-\d$/.test(doc)) return 'El RIF debe tener 8 dígitos y el verificador. Ej.: J-12345678-9';
  return null;
}

/** Teléfono venezolano: 0412-1234567, 0212-1234567 o +58 412 1234567. */
export function normalizarTelefono(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  const local = digitos.startsWith('58') && digitos.length === 12 ? `0${digitos.slice(2)}` : digitos;
  return /^0\d{10}$/.test(local) ? `${local.slice(0, 4)}-${local.slice(4)}` : String(valor ?? '').trim();
}

export function validarTelefono(valor, { opcional = true } = {}) {
  if (!tieneTexto(valor)) return opcional ? null : 'El teléfono es obligatorio';
  return /^0\d{3}-\d{7}$/.test(normalizarTelefono(valor)) ? null : 'Teléfono inválido. Ej.: 0414-1234567';
}

export function validarCorreo(valor, { opcional = true } = {}) {
  if (!tieneTexto(valor)) return opcional ? null : 'El correo es obligatorio';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(valor).trim()) ? null : 'Correo inválido';
}

/** Monto numérico: obligatorio, finito y con mínimo (excluyente si se pide). */
export function validarMonto(valor, { etiqueta = 'El monto', min = 0, mayorQue = true } = {}) {
  const n = Number(String(valor ?? '').replace(',', '.'));
  if (!tieneTexto(valor) || !Number.isFinite(n)) return `${etiqueta} es obligatorio`;
  if (mayorQue ? n <= min : n < min) return `${etiqueta} debe ser ${mayorQue ? 'mayor que' : 'mayor o igual a'} ${min}`;
  return null;
}

/** Fecha local de hoy en AAAA-MM-DD (toISOString usa UTC y adelanta el día después de las 20:00). */
export const hoyLocal = () => new Date().toLocaleDateString('en-CA');

/** Rango de fechas: desde ≤ hasta y, si se pide, sin fechas futuras. */
export function validarRango(desde, hasta, { permitirFuturo = false } = {}) {
  if (desde && hasta && desde > hasta) return 'La fecha «desde» no puede ser posterior a «hasta»';
  if (!permitirFuturo && ((desde && desde > hoyLocal()) || (hasta && hasta > hoyLocal()))) return 'No se permiten fechas futuras';
  return null;
}

/** Referencia bancaria (transferencia, pago móvil, punto, Zelle): 4 a 30 caracteres alfanuméricos. */
export function validarReferencia(valor) {
  if (!tieneTexto(valor)) return 'La referencia es obligatoria';
  return /^[A-Za-z0-9-]{4,30}$/.test(String(valor).trim()) ? null : 'Referencia inválida (4 a 30 letras o números)';
}
