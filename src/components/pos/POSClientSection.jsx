import { HiOutlineMagnifyingGlass, HiOutlineUserPlus, HiOutlineXMark, HiOutlineCreditCard } from 'react-icons/hi2';
import { useEffect, useRef, useState } from 'react';
import { formatMonto } from '../../utils/formatters';
import { CampoDocumento, CampoTelefono } from '../common/CamposVenezuela';
import { tieneTexto, normalizarDocumento, validarDocumento, normalizarTelefono, validarTelefono } from '../../utils/validaciones';

/**
 * Formulario de cliente rápido: valida y normaliza (documento, teléfono, nombre)
 * antes de entregar el envío a onCrear. Si hubo que normalizar, actualiza los
 * datos y reenvía el formulario en el siguiente render con los valores ya limpios.
 */
function FormNuevoCliente({ nuevoCliente, onChange, onCrear, onCerrar }) {
  const [errores, setErrores] = useState({});
  const reenviarRef = useRef(false);
  const formRef = useRef(null);

  // Tras normalizar los datos, reenvía el formulario cuando llegan los valores limpios
  useEffect(() => {
    if (!reenviarRef.current) return;
    reenviarRef.current = false;
    formRef.current?.requestSubmit();
  }, [nuevoCliente]);

  function normalizado(datos) {
    return {
      ...datos,
      nombre: String(datos.nombre ?? '').trim().replace(/\s+/g, ' '),
      documento_identidad: normalizarDocumento(datos.documento_identidad),
      telefono: tieneTexto(datos.telefono) ? normalizarTelefono(datos.telefono) : '',
    };
  }

  function handleSubmit(e) {
    const errs = {};
    if (!tieneTexto(nuevoCliente.nombre)) errs.nombre = 'El nombre es obligatorio';
    const errDoc = validarDocumento(nuevoCliente.documento_identidad);
    if (errDoc) errs.documento_identidad = errDoc;
    const errTel = validarTelefono(nuevoCliente.telefono);
    if (errTel) errs.telefono = errTel;
    setErrores(errs);
    if (Object.keys(errs).length) { e.preventDefault(); return; }

    const limpio = normalizado(nuevoCliente);
    const cambio = ['nombre', 'documento_identidad', 'telefono'].some(k => (limpio[k] ?? '') !== (nuevoCliente[k] ?? ''));
    if (cambio) {
      e.preventDefault();
      reenviarRef.current = true;
      onChange(limpio);
      return;
    }
    onCrear(e);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <h4>Nuevo Cliente</h4>
      <input
        placeholder="Nombre completo"
        value={nuevoCliente.nombre}
        onChange={(e) => onChange({ ...nuevoCliente, nombre: e.target.value })}
        required
      />
      {errores.nombre && <small style={{ color: '#ef4444' }}>{errores.nombre}</small>}
      <CampoDocumento
        value={nuevoCliente.documento_identidad}
        onChange={(v) => onChange({ ...nuevoCliente, documento_identidad: v })}
        required
      />
      {errores.documento_identidad && <small style={{ color: '#ef4444' }}>{errores.documento_identidad}</small>}
      <CampoTelefono
        value={nuevoCliente.telefono}
        onChange={(v) => onChange({ ...nuevoCliente, telefono: v })}
      />
      {errores.telefono && <small style={{ color: '#ef4444' }}>{errores.telefono}</small>}
      <div className="pos-nuevo-cliente__actions">
        <button type="submit" className="btn btn--primary btn--sm">Guardar</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCerrar}>Cancelar</button>
      </div>
    </form>
  );
}

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
      <h3 className="card__title">Cliente <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>(obligatorio: cédula o RIF)</span></h3>

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
          <FormNuevoCliente
            nuevoCliente={nuevoCliente}
            onChange={onNuevoClienteChange}
            onCrear={onCrearCliente}
            onCerrar={onCloseNuevoCliente}
          />
        </div>
      )}
    </div>
  );
}
