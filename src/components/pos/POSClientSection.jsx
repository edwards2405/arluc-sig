import { HiOutlineMagnifyingGlass, HiOutlineUserPlus, HiOutlineXMark, HiOutlineCreditCard } from 'react-icons/hi2';
import { formatMonto } from '../../utils/formatters';

function CreditoBadge({ cliente }) {
  if (!cliente) return null;
  const tieneCredito = (cliente.linea_credito || 0) > 0;
  const activo = cliente.credito_activo;

  if (!tieneCredito && !activo) return null;

  const moneda = cliente.moneda_credito || 'usd';
  const limite = parseFloat(cliente.linea_credito || 0);
  const limiteStr = moneda === 'usd'
    ? formatMonto(limite)
    : `Bs ${limite.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.4rem',
      marginTop: '0.4rem', padding: '0.35rem 0.6rem',
      borderRadius: '0.4rem',
      background: activo ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
      border: `1px solid ${activo ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`,
    }}>
      <HiOutlineCreditCard style={{ fontSize: '0.95rem', color: activo ? 'var(--success,#10B981)' : 'var(--danger,#EF4444)', flexShrink: 0 }} />
      <div style={{ fontSize: '0.75rem', lineHeight: 1.3 }}>
        {activo ? (
          <>
            <span style={{ fontWeight: 600, color: 'var(--success,#10B981)' }}>Crédito activo</span>
            {limite > 0
              ? <span style={{ color: 'var(--text-secondary)' }}> · Límite: {limiteStr}</span>
              : <span style={{ color: 'var(--text-secondary)' }}> · Sin límite asignado</span>
            }
          </>
        ) : (
          <span style={{ fontWeight: 600, color: 'var(--danger,#EF4444)' }}>Crédito suspendido</span>
        )}
      </div>
    </div>
  );
}

export default function POSClientSection({
  clienteSeleccionado,
  clienteSearch,
  clienteResults,
  showNuevoCliente,
  nuevoCliente,
  onSearchChange,
  onSelectCliente,
  onClearCliente,
  onOpenNuevoCliente,
  onCloseNuevoCliente,
  onNuevoClienteChange,
  onCrearCliente,
}) {
  return (
    <div className="card pos-section">
      <h3 className="card__title">Cliente <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>(opcional en ventas de contado)</span></h3>

      {clienteSeleccionado ? (
        <div>
          <div className="pos-cliente-selected">
            <div>
              <strong>{clienteSeleccionado.nombre}</strong>
              <span>{clienteSeleccionado.documento_identidad}</span>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onClearCliente}
              title="Quitar cliente seleccionado"
            >
              <HiOutlineXMark />
            </button>
          </div>
          <CreditoBadge cliente={clienteSeleccionado} />
        </div>
      ) : (
        <>
          <div className="search-box">
            <HiOutlineMagnifyingGlass className="search-box__icon" />
            <input
              type="text"
              placeholder="Buscar por nombre o cédula..."
              value={clienteSearch}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onOpenNuevoCliente}
              title="Registrar nuevo cliente"
            >
              <HiOutlineUserPlus />
            </button>
          </div>

          {clienteResults.length > 0 && (
            <div className="search-results">
              {clienteResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="search-result-item"
                  onClick={() => onSelectCliente(c)}
                >
                  <span className="search-result-item__name">{c.nombre}</span>
                  <span className="search-result-item__sub">
                    {c.documento_identidad}
                    {c.credito_activo && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--success,#10B981)', fontWeight: 600 }}>
                        · Crédito activo
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Formulario nuevo cliente inline */}
      {showNuevoCliente && (
        <div className="pos-nuevo-cliente">
          <form onSubmit={onCrearCliente}>
            <h4>Nuevo Cliente</h4>
            <input
              placeholder="Nombre completo"
              value={nuevoCliente.nombre}
              onChange={(e) => onNuevoClienteChange({ ...nuevoCliente, nombre: e.target.value })}
              required
            />
            <input
              placeholder="Cédula / RIF"
              value={nuevoCliente.documento_identidad}
              onChange={(e) => onNuevoClienteChange({ ...nuevoCliente, documento_identidad: e.target.value })}
              required
            />
            <input
              placeholder="Teléfono"
              value={nuevoCliente.telefono}
              onChange={(e) => onNuevoClienteChange({ ...nuevoCliente, telefono: e.target.value })}
            />
            <div className="pos-nuevo-cliente__actions">
              <button type="submit" className="btn btn--primary btn--sm">Guardar</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onCloseNuevoCliente}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
