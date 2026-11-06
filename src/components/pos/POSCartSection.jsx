import { HiOutlineTrash } from 'react-icons/hi2';
import { formatMonto } from '../../utils/formatters';

export default function POSCartSection({
  carrito,
  tasa,
  clienteSeleccionado,
  onActualizarCantidad,
  onQuitarDelCarrito,
  onLimpiarCaja,
}) {
  const tieneContenido = carrito.length > 0 || !!clienteSeleccionado;

  return (
    <div className="card pos-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '0.5rem' }}>
        <h3 className="card__title" style={{ margin: 0 }}>
          Carrito ({carrito.length})
        </h3>
        {tieneContenido && (
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            onClick={onLimpiarCaja}
            title="Limpiar cuenta y vaciar carrito"
            style={{
              color: 'var(--danger, #EF4444)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontWeight: 500,
            }}
          >
            <HiOutlineTrash /> Limpiar Caja
          </button>
        )}
      </div>

      {carrito.length === 0 ? (
        <p className="card__empty">Agregue productos para comenzar</p>
      ) : (
        <div className="pos-cart">
          {carrito.map((item) => (
            <div key={item.producto_id} className="pos-cart-item">
              <div className="pos-cart-item__main">
                <div className="pos-cart-item__info">
                  <span className="pos-cart-item__name">{item.producto_nombre}</span>
                  <span className="pos-cart-item__price">{formatMonto(item.precio_unitario, tasa)} c/u</span>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--xs text-danger pos-cart-item__trash"
                  onClick={() => onQuitarDelCarrito(item.producto_id)}
                  title="Eliminar producto"
                >
                  <HiOutlineTrash />
                </button>
              </div>

              <div className="pos-cart-item__actions">
                <div className="pos-cart-item__controls">
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs pos-qty-btn"
                    onClick={() => onActualizarCantidad(item.producto_id, item.cantidad - 1)}
                    title="Disminuir cantidad"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    className="pos-cart-item__qty"
                    value={item.cantidad}
                    min={1}
                    max={item.stock_disponible}
                    onChange={(e) => onActualizarCantidad(item.producto_id, parseInt(e.target.value) || 1)}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs pos-qty-btn"
                    onClick={() => onActualizarCantidad(item.producto_id, item.cantidad + 1)}
                    title="Aumentar cantidad"
                  >
                    +
                  </button>
                </div>
                <span className="pos-cart-item__subtotal">{formatMonto(item.subtotal, tasa)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
