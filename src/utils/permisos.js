/**
 * Matriz de acceso por rol. Es la única fuente para las rutas y el menú.
 * La base de datos (RLS) aplica los mismos permisos sobre los datos; esta
 * matriz solo evita mostrar pantallas que el rol no podría usar.
 */

export const ROLES_LABEL = {
  admin: 'Administrador',
  gerente: 'Gerente',
  contador: 'Contador',
  vendedor: 'Vendedor',
  almacenista: 'Almacenista',
};

const TODOS = ['admin', 'gerente', 'contador', 'vendedor', 'almacenista'];
const DIRECCION = ['admin', 'gerente', 'contador'];

export const ACCESO_RUTAS = {
  '/dashboard': TODOS,
  '/panel-gerencial': DIRECCION,
  '/pos': ['admin', 'gerente', 'vendedor'],
  '/historial': DIRECCION,
  '/clientes': ['admin', 'gerente', 'vendedor'],
  '/cuentas-por-cobrar': ['admin', 'gerente', 'contador', 'vendedor'],
  '/cuentas-por-cobrar/reportes': ['admin', 'gerente', 'contador', 'vendedor'],
  '/cuentas-por-pagar': DIRECCION,
  '/inventario': ['admin', 'gerente', 'almacenista'],
  '/inventario/reportes': ['admin', 'gerente', 'almacenista'],
  '/proveedores': ['admin', 'gerente', 'contador', 'almacenista'],
  '/ordenes-compra': ['admin', 'gerente', 'contador', 'almacenista'],
  '/tasa-cambio': DIRECCION,
  '/reportes': DIRECCION,
  '/contabilidad/plan-cuentas': DIRECCION,
  '/contabilidad/libro-diario': DIRECCION,
  '/contabilidad/libro-mayor': DIRECCION,
  '/contabilidad/balance-comprobacion': DIRECCION,
  '/contabilidad/estados-financieros': DIRECCION,
  '/contabilidad/libros-fiscales': DIRECCION,
  '/usuarios': ['admin'],
  '/configuracion': ['admin', 'gerente'],
};

export function puedeAcceder(rol, ruta) {
  return (ACCESO_RUTAS[ruta] || []).includes(rol);
}

/** Pantalla inicial de cada rol. */
export function rutaInicio(rol) {
  if (rol === 'vendedor') return '/pos';
  if (rol === 'almacenista') return '/inventario';
  if (rol === 'gerente' || rol === 'contador') return '/panel-gerencial';
  return '/dashboard';
}
