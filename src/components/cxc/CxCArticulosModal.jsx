import React from 'react';
import { formatMonto, formatDolares, formatFecha } from '../../utils/formatters';
import { HiOutlineXMark, HiOutlineShoppingBag } from 'react-icons/hi2';

export default function CxCArticulosModal({ isOpen, cuenta, tasaValor, onClose }) {
  if (!isOpen || !cuenta) return null;

  const articulos = cuenta.detalles_factura || [];
  const cliente = cuenta.cliente;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: '650px', width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#6366F1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
              }}
            >
              <HiOutlineShoppingBag />
            </div>
            <div>
              <h2 className="modal__title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Artículos a Crédito
              </h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Factura #{cuenta.numero_factura} • {formatFecha(cuenta.fecha_emision, true)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            onClick={onClose}
            style={{ fontSize: '1.25rem', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <HiOutlineXMark />
          </button>
        </div>

        {/* Info del Cliente */}
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'var(--bg-elevated)',
            borderRadius: '8px',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Cliente:</div>
            <strong style={{ fontSize: '0.95rem' }}>{cliente?.nombre || 'Consumidor Final'}</strong>
            {cliente?.documento_identidad && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                ({cliente.documento_identidad})
              </span>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Crédito Otorgado:</div>
            <strong style={{ fontSize: '1.1rem', color: '#6366F1' }}>{formatMonto(cuenta.montoOriginalUSD)}</strong>
          </div>
        </div>

        {/* Tabla de Artículos */}
        <div className="table-container" style={{ maxHeight: '320px', overflowY: 'auto', marginBottom: '1rem' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Producto / Artículo</th>
                <th style={{ textAlign: 'center' }}>Cant.</th>
                <th style={{ textAlign: 'right' }}>P. Unit. (Bs)</th>
                <th style={{ textAlign: 'right' }}>Subtotal (Bs)</th>
              </tr>
            </thead>
            <tbody>
              {articulos.length === 0 ? (
                <tr>
                  <td colSpan="4" className="table__empty">
                    No se encontraron detalles de artículos para esta factura.
                  </td>
                </tr>
              ) : (
                articulos.map((art, index) => (
                  <tr key={art.id || index}>
                    <td>
                      <strong>{art.producto_nombre || 'Producto'}</strong>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="badge badge--primary" style={{ fontWeight: 700 }}>
                        {art.cantidad}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {formatMonto(art.precio_unitario_usd)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {formatMonto(art.subtotal_usd || art.cantidad * art.precio_unitario_usd)}
                      </strong>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {articulos.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg-elevated)', borderTop: '2px solid var(--border)' }}>
                  <td colSpan="3">
                    <strong>TOTAL COMPRA FACTURADA</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong style={{ fontSize: '1rem', color: 'var(--primary)' }}>
                      {formatMonto(cuenta.totalFacturaUSD || cuenta.montoOriginalUSD)}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Resumen del Crédito */}
        <div
          style={{
            padding: '0.75rem 1rem',
            background: cuenta.saldoTotalUSD === 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(99, 102, 241, 0.08)',
            border: `1px solid ${cuenta.saldoTotalUSD === 0 ? '#10B981' : '#6366F1'}44`,
            borderRadius: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Estado Actual:</span>
            <div style={{ fontWeight: 700, color: cuenta.saldoTotalUSD === 0 ? '#10B981' : '#EF4444' }}>
              {cuenta.saldoTotalUSD === 0 ? '✓ Totalmente Pagado / Solvente' : `Pendiente por cobrar (${cuenta.diasTranscurridos} días)`}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Saldo Restante:</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: cuenta.saldoTotalUSD === 0 ? '#10B981' : '#6366F1' }}>
              {formatMonto(cuenta.saldoTotalUSD)}
            </div>
            {tasaValor > 0 && cuenta.saldoTotalUSD > 0 && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Ref. {formatDolares(cuenta.saldoTotalUSD)}
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal__footer" style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--secondary" onClick={onClose} style={{ minHeight: '44px', minWidth: '100px' }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

