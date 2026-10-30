import { puedeAcceder } from '../../../utils/permisos';
import {
  HiOutlineHome,
  HiOutlineShoppingCart,
  HiOutlineCube,
  HiOutlineTruck,
  HiOutlineCurrencyDollar,
  HiOutlineCog6Tooth,
  HiOutlineBookOpen,
  HiOutlinePresentationChartLine,
} from 'react-icons/hi2';

/**
 * Estructura de departamentos y módulos del ERP ARLUC.
 * - Los elementos individuales (Dashboard, Inventario) son enlaces directos sin acordeón.
 * - Los departamentos con múltiples funciones (Ventas, Compras, Contabilidad, etc.) se despliegan de forma ramificada.
 * - Cada rol ve solo lo que permite la matriz de utils/permisos.js.
 */
const navigationGroups = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: HiOutlineHome,
    to: '/dashboard',
  },
  {
    id: 'panel-gerencial',
    label: 'Panel Gerencial (SIG)',
    icon: HiOutlinePresentationChartLine,
    to: '/panel-gerencial',
  },
  {
    id: 'ventas',
    label: 'Ventas y Facturación',
    icon: HiOutlineShoppingCart,
    items: [
      { to: '/pos', label: 'Punto de Venta (Caja)' },
      { to: '/historial', label: 'Historial de Facturas' },
      { to: '/clientes', label: 'Directorio de Clientes' },
      { to: '/cuentas-por-cobrar', label: 'Cuentas por Cobrar' },
    ],
  },
  {
    id: 'inventario',
    label: 'Inventario',
    icon: HiOutlineCube,
    to: '/inventario',
  },
  {
    id: 'compras',
    label: 'Compras y Proveedores',
    icon: HiOutlineTruck,
    items: [
      { to: '/proveedores', label: 'Proveedores' },
      { to: '/ordenes-compra', label: 'Órdenes de Compra' },
      { to: '/cuentas-por-pagar', label: 'Cuentas por Pagar' },
    ],
  },
  {
    id: 'contabilidad',
    label: 'Contabilidad General',
    icon: HiOutlineBookOpen,
    items: [
      { to: '/contabilidad/plan-cuentas', label: 'Plan de Cuentas' },
      { to: '/contabilidad/libro-diario', label: 'Libro Diario' },
      { to: '/contabilidad/libro-mayor', label: 'Libro Mayor' },
      { to: '/contabilidad/balance-comprobacion', label: 'Balance de Comprobación' },
      { to: '/contabilidad/estados-financieros', label: 'Estados Financieros' },
      { to: '/contabilidad/libros-fiscales', label: 'Libros Fiscales (IVA)' },
    ],
  },
  {
    id: 'finanzas',
    label: 'Finanzas y Tesorería',
    icon: HiOutlineCurrencyDollar,
    items: [
      { to: '/tasa-cambio', label: 'Tasa de Cambio' },
      { to: '/reportes', label: 'Reportes Financieros' },
    ],
  },
  {
    id: 'administracion',
    label: 'Administración',
    icon: HiOutlineCog6Tooth,
    items: [
      { to: '/usuarios', label: 'Gestión de Usuarios' },
      { to: '/configuracion', label: 'Configuración Empresa' },
    ],
  },
];

/**
 * Menú visible para un rol: grupos y enlaces permitidos.
 */
export function navegacionParaRol(rol) {
  return navigationGroups
    .map((grupo) => (grupo.items ? { ...grupo, items: grupo.items.filter((item) => puedeAcceder(rol, item.to)) } : grupo))
    .filter((grupo) => (grupo.items ? grupo.items.length > 0 : puedeAcceder(rol, grupo.to)));
}
