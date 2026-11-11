// Métodos de pago disponibles en el sistema
export const METODOS_PAGO = [
  { id: 'efectivo_usd', label: 'Efectivo USD', enBs: false },
  { id: 'efectivo_bs', label: 'Efectivo Bs', enBs: true },
  { id: 'zelle', label: 'Zelle', enBs: false, isZelle: true },
  { id: 'pago_movil', label: 'Pago Móvil', enBs: true, requiereReferencia: true },
  { id: 'punto_venta', label: 'Punto de Venta', enBs: true, requiereReferencia: true },
  { id: 'transferencia', label: 'Transferencia', enBs: true, requiereReferencia: true },
  { id: 'cashea', label: 'Cashea', enBs: true, isCashea: true, requiereReferencia: true },
  { id: 'credito', label: 'Crédito', enBs: false, isCredito: true },
];

// Métodos para pagar la inicial de Cashea
export const METODOS_INICIAL_CASHEA = [
  { id: 'punto_venta', label: 'Punto de Venta', requiereReferencia: true },
  { id: 'pago_movil', label: 'Pago Móvil', requiereReferencia: true },
  { id: 'efectivo_usd', label: 'Efectivo USD', requiereReferencia: false },
  { id: 'efectivo_bs', label: 'Efectivo Bs', requiereReferencia: false },
  { id: 'transferencia', label: 'Transferencia', requiereReferencia: true },
  { id: 'zelle', label: 'Zelle', requiereReferencia: true },
];

// Configuración de impresión
export const PRINT_WIDTHS = {
  '58mm': { width: '58mm', chars: 32, pixelWidth: '164px' },
  '80mm': { width: '80mm', chars: 48, pixelWidth: '302px' },
};

// Configuración por defecto de la empresa
export const DEFAULT_EMPRESA = {
  nombre: 'COMERCIALIZADORA ARLUC C.A.',
  rif: 'J-50123456-7',
  direccion: 'Caracas, Venezuela',
  telefono: '0414-1234567',
  logo: '/logo-arluc.jpg',
  slogan: '¡Gracias por su compra!',
};

// Clave y evento de la configuración guardada en el navegador. La clave
// anterior (dj7_empresa_config) se sigue leyendo para no perder lo ya guardado.
const CLAVE_EMPRESA = 'arluc_empresa_config';
const CLAVE_EMPRESA_ANTERIOR = 'dj7_empresa_config';
export const EVENTO_EMPRESA_ACTUALIZADA = 'arluc_empresa_config_updated';

export function getEmpresaConfig() {
  try {
    const saved = localStorage.getItem(CLAVE_EMPRESA) || localStorage.getItem(CLAVE_EMPRESA_ANTERIOR);
    if (saved) {
      return { ...DEFAULT_EMPRESA, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Error leyendo config de empresa:', e);
  }
  return DEFAULT_EMPRESA;
}

export function saveEmpresaConfig(config) {
  try {
    localStorage.setItem(CLAVE_EMPRESA, JSON.stringify(config));
    // Ya guardada con la clave nueva: la anterior deja de hacer falta
    localStorage.removeItem(CLAVE_EMPRESA_ANTERIOR);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(EVENTO_EMPRESA_ACTUALIZADA, { detail: config }));
    }
  } catch (e) {
    console.error('Error guardando config de empresa:', e);
  }
}

