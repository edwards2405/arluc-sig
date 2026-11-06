import { HiOutlinePlus } from 'react-icons/hi2';
import { formatMonto } from '../../utils/formatters';

export default function POSCuentasBar({
  cuentas,
  tasa,
  cuentaActivaId,
  onSelectCuenta,
  onAgregarCuenta,
  onCerrarCuenta,
}) {
  return (
    <div className="pos-cuentas-bar">
      <div className="pos-cuentas-list">
        {cuentas.map((c, index) => {
          const totalUSD = (c.carrito || []).reduce((sum, item) => sum + item.subtotal, 0);
          const itemsCount = (c.carrito || []).reduce((sum, item) => sum + item.cantidad, 0);
          const isActive = c.id === cuentaActivaId;
          const labelCliente = c.clienteSeleccionado ? c.clienteSeleccionado.nombre.split(' ')[0] : null;

          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectCuenta(c.id)}
              className={`pos-cuenta-tab ${isActive ? 'pos-cuenta-tab--active' : ''}`}
              title={`Cambiar a ${c.nombre || `Cuenta #${index + 1}`}`}
            >
              <span className="pos-cuenta-tab__num">#{index + 1}</span>
              <span className="pos-cuenta-tab__label">
                {labelCliente ? `Cliente: ${labelCliente}` : `Cuenta ${index + 1}`}
              </span>
              {itemsCount > 0 ? (
                <span className="pos-cuenta-tab__badge">
                  {itemsCount} art. • {formatMonto(totalUSD, tasa)}
                </span>
              ) : (
                <span className="pos-cuenta-tab__badge" style={{ opacity: 0.6 }}>Vacía</span>
              )}
              {cuentas.length > 1 && (
                <span
                  className="pos-cuenta-tab__close"
                  onClick={(e) => onCerrarCuenta(c.id, e)}
                  title="Cerrar esta cuenta"
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAgregarCuenta}
          className="pos-cuenta-tab-add"
          title="Atender a otro cliente simultáneamente (Nueva Cuenta)"
        >
          <HiOutlinePlus /> Nueva Cuenta
        </button>
      </div>
    </div>
  );
}
