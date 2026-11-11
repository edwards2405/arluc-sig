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
  '/reportes-gerenciales': DIRECCION,
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
  '/contabilidad/cierre': DIRECCION,
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

/**
 * Acciones dentro de las pantallas: quién puede ejecutarlas. Replica las
 * políticas y funciones de la base de datos para no mostrar botones que la
 * BD rechazaría (un UPDATE o DELETE rechazado por RLS no da error: afecta 0 filas).
 */
export const ACCIONES = {
  'producto.editar': ['admin', 'almacenista'],
  'producto.exento': ['admin'],
  'categoria.editar': ['admin', 'almacenista'],
  'proveedor.editar': ['admin', 'almacenista'],
  'orden.gestionar': ['admin', 'almacenista'],
  'cliente.editar': ['admin', 'gerente', 'vendedor'],
  'cliente.eliminar': ['admin'],
  'cliente.credito': ['admin', 'gerente'],
  'cliente.contribuyente': ['admin', 'gerente', 'contador'],
  'factura.anular': ['admin', 'gerente'],
  'nota.emitir': ['admin', 'gerente'],
  'abono.registrar': ['admin', 'gerente', 'vendedor'],
  'abono.anular': ['admin', 'gerente'],
  'cxc.configurar': ['admin', 'gerente'],
  'cxp.pagar': ['admin', 'gerente', 'contador'],
  'cuenta.editar': ['admin', 'contador'],
  'asiento.crear': ['admin', 'contador'],
  'asiento.anular': ['admin', 'contador'],
  'retencion.gestionar': ['admin', 'contador'],
  'cierre.mes': ['admin', 'contador'],
  'cierre.reabrir': ['admin'],
  'cierre.ejercicio': ['admin', 'contador'],
  'meta.editar': ['admin', 'gerente'],
  'empresa.editar': ['admin', 'gerente'],
  'empresa.fiscal': ['admin'],
  'tasa.manual': ['admin'],
  'usuario.gestionar': ['admin'],
};

export function puede(rol, accion) {
  return (ACCIONES[accion] || []).includes(rol);
}
