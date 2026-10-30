import React, { useState } from 'react';
import { HiOutlineBanknotes, HiOutlineTrash, HiOutlineCheck } from 'react-icons/hi2';
import { formatUSD, formatBs, formatFecha } from '../../utils/formatters';
import toast from 'react-hot-toast';

export default function CxCAbonoModal({
  isOpen,
  cuenta,
  tasaValor,
  onRegistrarAbono,
  onEliminarAbono,
  onClose,
}) {
  const [form, setForm] = useState({
    monto_usd: '',
    metodo: 'efectivo_usd',
    notas: '',
  });
  const [loading, setLoading] = useState(false);

  if (!isOpen || !cuenta) return null;

  const abonos = cuenta.abonos || [];
  const saldoActualUSD = cuenta.saldoTotalUSD;
  const saldoActualBs = tasaValor > 0 ? saldoActualUSD * tasaValor : 0;

  async function handleSubmit(e) {
    e.preventDefault();
    const monto = parseFloat(form.monto_usd);
    if (isNaN(monto) || monto <= 0) {
      toast.error('Ingrese un monto de abono válido mayor a 0');
      return;
    }
    if (monto > saldoActualUSD + 0.05) {
      toast.error(`El monto supera el saldo deudor pendiente ($${saldoActualUSD.toFixed(2)})`);
      return;
    }

    setLoading(true);
    try {
      await onRegistrarAbono(cuenta.id, {
        monto_usd: monto,
        metodo: form.metodo,
        notas: form.notas.trim(),
      });
      toast.success('Abono registrado exitosamente');
      setForm({ monto_usd: '', metodo: 'efectivo_usd', notas: '' });
    } catch (err) {
      toast.error('Error al guardar abono: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 350 }}>
      <div
        className="modal modal--md"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '580px' }}
      >
        <div className="modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10B981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
              }}
            >
              <HiOutlineBanknotes />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Gestión de Cobros y Abonos</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Factura #{cuenta.numero_factura} — {cuenta.cliente?.nombre || 'Cliente'}
              </p>
            </div>
          </div>
          <button type="button" className="modal__close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Tarjeta de Saldo */}
          <div
            style={{
              padding: '0.9rem 1.1rem',
              background: 'var(--bg-elevated)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Deuda Original</div>
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{formatUSD(cuenta.montoOriginalUSD)}</div>
              {cuenta.recargoUSD > 0 && (
                <div style={{ fontSize: '0.75rem', color: '#EF4444' }}>
                  +{formatUSD(cuenta.recargoUSD)} ({cuenta.porcentajeAplicado}% recargo)
                </div>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Saldo Deudor Pendiente</div>
              <div style={{ fontWeight: 800, fontSize: '1.25rem', color: saldoActualUSD > 0 ? '#EF4444' : '#10B981' }}>
                {formatUSD(saldoActualUSD)}
              </div>
              {tasaValor > 0 && saldoActualUSD > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{formatBs(saldoActualBs)}</div>
              )}
            </div>
          </div>

          {/* Formulario de registro de abono */}
          {saldoActualUSD > 0 ? (
            <form onSubmit={handleSubmit} style={{ background: 'rgba(0,0,0,0.05)', padding: '1rem', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                Registrar Nuevo Abono / Pago
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.75rem' }}>Monto a Abonar ($ USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={saldoActualUSD}
                    required
                    value={form.monto_usd}
                    onChange={(e) => setForm({ ...form, monto_usd: e.target.value })}
                    placeholder="0.00"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.75rem' }}>Método de Pago</label>
                  <select
                    value={form.metodo}
                    onChange={(e) => setForm({ ...form, metodo: e.target.value })}
                  >
                    <option value="efectivo_usd">Efectivo USD</option>
                    <option value="efectivo_bs">Efectivo Bs</option>
                    <option value="pago_movil">Pago Móvil</option>
                    <option value="punto_venta">Punto de Venta</option>
                    <option value="zelle">Zelle</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.75rem' }}>Referencia o Notas del Pago</label>
                <input
                  type="text"
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  placeholder="Ej. Ref #4812 o Comprobante"
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setForm({ ...form, monto_usd: saldoActualUSD.toFixed(2) })}
                >
                  Pagar Deuda Total
                </button>
                <button type="submit" className="btn btn--primary btn--sm" disabled={loading}>
                  <HiOutlineCheck /> Registrar Abono
                </button>
              </div>
            </form>
          ) : (
            <div
              style={{
                padding: '0.75rem',
                borderRadius: '6px',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#10B981',
                fontSize: '0.85rem',
                textAlign: 'center',
                fontWeight: 600,
              }}
            >
              ✓ Esta cuenta se encuentra completamente solvente (Saldo $0.00)
            </div>
          )}

          {/* Historial de abonos previos */}
          <div>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Historial de Abonos Recibidos ({abonos.length})
            </h4>
            {abonos.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, fontStyle: 'italic' }}>
                No se han registrado abonos previos para esta cuenta.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                {abonos.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.5rem 0.75rem',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#10B981' }}>+{formatUSD(a.monto_usd)}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                        {formatFecha(a.fecha, true)} • {a.metodo?.toUpperCase()} {a.notas ? `(${a.notas})` : ''}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                        Capital {formatUSD(a.aplicado_capital_usd)}
                        {a.aplicado_recargo_usd > 0 && ` · Recargo ${formatUSD(a.aplicado_recargo_usd)}`}
                        {a.igtf_usd > 0 && ` · IGTF ${formatUSD(a.igtf_usd)}`}
                        {a.diferencial_bs !== 0 &&
                          ` · Dif. cambiario ${a.diferencial_bs > 0 ? '+' : ''}${a.diferencial_bs.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs`}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--xs text-danger"
                      onClick={() => onEliminarAbono(cuenta.id, a.id)}
                      title="Anular este abono (requiere admin o gerente)"
                    >
                      <HiOutlineTrash />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: '0.85rem 1.5rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
