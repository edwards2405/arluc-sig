import React, { useState, useMemo } from 'react';
import { formatMonto, formatDolares, formatBs, formatFecha, getWhatsAppUrl, getPhoneCallUrl } from '../../../utils/formatters';
import { HiOutlineUser, HiOutlinePhone, HiOutlineDocumentText, HiOutlinePrinter } from 'react-icons/hi2';
import { FaWhatsapp, FaPhone } from 'react-icons/fa';

export default function CxCClientStatement({ cuentas = [], tasaValor = 0 }) {
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [busqueda, setBusqueda] = useState('');

  // Agrupar clientes únicos con sus cuentas
  const clientesMap = useMemo(() => {
    const map = {};
    cuentas.forEach((c) => {
      const id = c.cliente?.id || c.cliente?.documento_identidad || c.cliente?.nombre || 'sin_id';
      if (!map[id]) {
        map[id] = {
          id,
          nombre: c.cliente?.nombre || 'Sin Nombre',
          documento: c.cliente?.documento_identidad || 'N/A',
          telefono: c.cliente?.telefono || '',
          email: c.cliente?.email || '',
          direccion: c.cliente?.direccion || '',
          cuentas: [],
        };
      }
      map[id].cuentas.push(c);
    });
    return map;
  }, [cuentas]);

  const listaClientes = useMemo(() => {
    const list = Object.values(clientesMap);
    return list.filter((cl) => {
      const q = busqueda.toLowerCase().trim();
      if (!q) return true;
      return (
        cl.nombre.toLowerCase().includes(q) ||
        cl.documento.toLowerCase().includes(q) ||
        cl.telefono.includes(q)
      );
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [clientesMap, busqueda]);

  const clienteSeleccionado = selectedClienteId ? clientesMap[selectedClienteId] : listaClientes[0] || null;

  const totalesCliente = useMemo(() => {
    if (!clienteSeleccionado) return { original: 0, recargo: 0, abonado: 0, saldo: 0 };
    return clienteSeleccionado.cuentas.reduce(
      (acc, c) => ({
        original: acc.original + c.montoOriginalUSD,
        recargo: acc.recargo + c.recargoUSD,
        abonado: acc.abonado + c.totalAbonadoUSD,
        saldo: acc.saldo + c.saldoTotalUSD,
      }),
      { original: 0, recargo: 0, abonado: 0, saldo: 0 }
    );
  }, [clienteSeleccionado]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Selector de Cliente */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
              Buscar y Seleccionar Cliente:
            </label>
            <input
              type="text"
              placeholder="Filtrar por nombre o cédula..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border)' }}
            />
          </div>
          <div style={{ flex: '2 1 300px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
              Cliente Activo ({listaClientes.length} encontrados):
            </label>
            <select
              value={clienteSeleccionado?.id || ''}
              onChange={(e) => setSelectedClienteId(e.target.value)}
              style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)' }}
            >
              {listaClientes.map((cl) => (
                <option key={cl.id} value={cl.id}>
                  {cl.nombre} — {cl.documento} ({cl.cuentas.length} facturas)
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => window.print()}
            style={{ alignSelf: 'flex-end', height: '38px', minWidth: '44px' }}
            title="Imprimir estado de cuenta"
          >
            <HiOutlinePrinter /> Imprimir
          </button>
        </div>
      </div>

      {clienteSeleccionado ? (
        <div className="card" style={{ padding: '1.25rem' }}>
          {/* Header del Estado de Cuenta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1rem' }}>
            <div>
              <span className="badge badge--primary" style={{ marginBottom: '0.35rem' }}>Estado de Cuenta Individual</span>
              <h2 style={{ margin: '0.2rem 0', fontSize: '1.35rem', color: 'var(--text-primary)' }}>
                {clienteSeleccionado.nombre}
              </h2>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span><strong>Doc:</strong> {clienteSeleccionado.documento}</span>
                {clienteSeleccionado.telefono && <span><strong>Tel:</strong> {clienteSeleccionado.telefono}</span>}
                {clienteSeleccionado.direccion && <span><strong>Dir:</strong> {clienteSeleccionado.direccion}</span>}
              </div>
            </div>

            {clienteSeleccionado.telefono && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <a
                  href={getPhoneCallUrl(clienteSeleccionado.telefono)}
                  className="btn btn--secondary btn--sm"
                  style={{ color: '#3B82F6' }}
                >
                  <FaPhone /> Llamar
                </a>
                <a
                  href={getWhatsAppUrl(clienteSeleccionado.telefono)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--secondary btn--sm"
                  style={{ color: '#25D366' }}
                >
                  <FaWhatsapp /> WhatsApp
                </a>
              </div>
            )}
          </div>

          {/* Tarjetas Resumen del Cliente */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Otorgado</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{formatMonto(totalesCliente.original)}</div>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: '#EF4444' }}>Recargos Aplicados</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#EF4444' }}>{formatMonto(totalesCliente.recargo)}</div>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: '#10B981' }}>Total Abonado</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#10B981' }}>{formatMonto(totalesCliente.abonado)}</div>
            </div>
            <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.1)', borderRadius: '8px', border: '1px solid #6366F1' }}>
              <div style={{ fontSize: '0.75rem', color: '#6366F1', fontWeight: 700 }}>SALDO NETO PENDIENTE</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#6366F1' }}>{formatMonto(totalesCliente.saldo)}</div>
              {tasaValor > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ref. {formatDolares(totalesCliente.saldo)}</div>}
            </div>
          </div>

          {/* Tabla de Facturas del Cliente */}
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Emisión</th>
                  <th style={{ textAlign: 'center' }}>Días</th>
                  <th style={{ textAlign: 'right' }}>Monto Orig.</th>
                  <th style={{ textAlign: 'right' }}>Recargo</th>
                  <th style={{ textAlign: 'right' }}>Abonado</th>
                  <th style={{ textAlign: 'right' }}>Saldo Pendiente</th>
                  <th style={{ textAlign: 'center' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {clienteSeleccionado.cuentas.map((c) => (
                  <React.Fragment key={c.id}>
                    <tr>
                      <td><code>{c.numero_factura}</code></td>
                      <td>{formatFecha(c.fecha_emision, false)}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>{c.diasTranscurridos} d</td>
                      <td style={{ textAlign: 'right' }}>{formatMonto(c.montoOriginalUSD)}</td>
                      <td style={{ textAlign: 'right', color: c.recargoUSD > 0 ? '#EF4444' : 'inherit' }}>
                        {c.recargoUSD > 0 ? `+${formatMonto(c.recargoUSD)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: '#10B981' }}>
                        {c.totalAbonadoUSD > 0 ? formatMonto(c.totalAbonadoUSD) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 800 }}>{formatMonto(c.saldoTotalUSD)}</td>
                      <td style={{ textAlign: 'center' }}>
                        {c.saldoTotalUSD === 0 ? (
                          <span className="badge badge--success">Solvente</span>
                        ) : (
                          <span className="badge badge--warning">Pendiente</span>
                        )}
                      </td>
                    </tr>
                    {/* Subtabla de abonos si existen */}
                    {c.abonos && c.abonos.length > 0 && (
                      <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                        <td colSpan="8" style={{ padding: '0.5rem 1rem' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                            Abonos registrados a esta factura ({c.abonos.length}):
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {c.abonos.map((a, i) => (
                              <div
                                key={a.id || i}
                                style={{
                                  padding: '0.35rem 0.6rem',
                                  background: 'var(--bg-elevated)',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border)',
                                  fontSize: '0.75rem',
                                }}
                              >
                                <span>📅 {formatFecha(a.fecha, false)}</span> |{' '}
                                <strong style={{ color: '#10B981' }}>{formatBs(a.monto_bs)}</strong> ({a.metodo})
                                {a.notas && <em> — "{a.notas}"</em>}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          No hay clientes con cuentas por cobrar registradas.
        </div>
      )}
    </div>
  );
}

