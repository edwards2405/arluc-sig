import { HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import { formatMonto } from '../../utils/formatters';

export default function POSProductSection({
  productoSearchRef,
  productoSearch,
  productoResults,
  tasa,
  onSearchChange,
  onSelectProducto,
}) {
  return (
    <div className="card pos-section">
      <h3 className="card__title">Agregar Productos</h3>
      <div className="search-box">
        <HiOutlineMagnifyingGlass className="search-box__icon" />
        <input
          ref={productoSearchRef}
          type="text"
          placeholder="Buscar por nombre o SKU..."
          value={productoSearch}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {productoResults.length > 0 && (
        <div className="search-results">
          {productoResults.map((p) => (
            <button
              key={p.id}
              type="button"
              className="search-result-item"
              onClick={() => onSelectProducto(p)}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="search-result-item__name">{p.nombre}</span>
                </div>
                <span className="search-result-item__sub">
                  {p.sku} — Stock: {p.stock}
                </span>
              </div>
              <span className="search-result-item__price">{formatMonto(p.precio_usd, tasa)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
