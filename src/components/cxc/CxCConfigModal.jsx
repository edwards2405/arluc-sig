import React, { useState } from 'react';
import { HiOutlineCog6Tooth, HiOutlineCheck } from 'react-icons/hi2';
import toast from 'react-hot-toast';

export default function CxCConfigModal({ isOpen, config, onSave, onClose }) {
  const [form, setForm] = useState({
    diasGracia: config?.diasGracia ?? 15,
    porcentajeRecargo: config?.porcentajeRecargo ?? 5,
    aplicarRecargoAutomatico: config?.aplicarRecargoAutomatico ?? true,
  });

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const dias = parseInt(form.diasGracia, 10);
    const porcentaje = parseFloat(form.porcentajeRecargo);

    if (isNaN(dias) || dias < 0) {
      toast.error('Ingrese un número de días válido (mínimo 0)');
      return;
    }
    if (isNaN(porcentaje) || porcentaje < 0) {
      toast.error('Ingrese un porcentaje válido (mínimo 0%)');
      return;
    }

    // El aviso de éxito o error lo da onSave; solo se cierra si se guardó.
    const guardado = await onSave({
      diasGracia: dias,
      porcentajeRecargo: porcentaje,
      aplicarRecargoAutomatico: form.aplicarRecargoAutomatico,
    });
    if (guardado) onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 350 }}>
      <div
        className="modal modal--sm"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '480px' }}
      >
        <div className="modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#6366F1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
              }}
            >
              <HiOutlineCog6Tooth />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Parámetros de Recargo por Días</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Configura cuándo y cuánto recargar a clientes con cuentas vencidas
              </p>
            </div>
          </div>
          <button type="button" className="modal__close" onClick={onClose}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Días de Gracia desde la Venta (Salida de Tienda)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={form.diasGracia}
                onChange={(e) => setForm({ ...form, diasGracia: e.target.value })}
                placeholder="Ej. 15"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
                A partir de este número de días transcurridos desde que la mercancía salió de la tienda, se aplicará el porcentaje de mora.
              </span>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Porcentaje de Recargo (%)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  required
                  value={form.porcentajeRecargo}
                  onChange={(e) => setForm({ ...form, porcentajeRecargo: e.target.value })}
                  placeholder="Ej. 5"
                  style={{ paddingRight: '2rem' }}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontWeight: 'bold',
                    color: 'var(--text-secondary)',
                  }}
                >
                  %
                </span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
                Porcentaje que se sumará al saldo pendiente de la cuenta una vez superados los días de gracia.
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'rgba(99, 102, 241, 0.08)',
                padding: '0.85rem',
                borderRadius: '8px',
                border: '1px solid rgba(99, 102, 241, 0.2)',
              }}
            >
              <input
                type="checkbox"
                id="check-recargo-auto"
                checked={form.aplicarRecargoAutomatico}
                onChange={(e) => setForm({ ...form, aplicarRecargoAutomatico: e.target.checked })}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label
                htmlFor="check-recargo-auto"
                style={{ fontSize: '0.82rem', cursor: 'pointer', margin: 0, color: 'var(--text-primary)', fontWeight: 500 }}
              >
                Activar cálculo automático del recargo en el saldo deudor
              </label>
            </div>
          </div>

          <div
            style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              background: 'rgba(0,0,0,0.05)',
            }}
          >
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary">
              <HiOutlineCheck /> Guardar Configuración
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
