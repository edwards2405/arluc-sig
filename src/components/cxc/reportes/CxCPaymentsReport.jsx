import React, { useState, useMemo, useEffect } from 'react';
import { formatDolares, formatBs, formatFecha } from '../../../utils/formatters';
import { HiOutlineBanknotes, HiOutlineFunnel, HiOutlineCalendar } from 'react-icons/hi2';
import Pagination from '../../common/Pagination';

export default function CxCPaymentsReport({ abonosHistorico = [], tasaValor = 0 }) {
  const [metodoFiltro, setMetodoFiltro] = useState('todos');
  const [busqueda, setBusqueda] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  const metodosDisponibles = useMemo(() => {
    const s = new Set();
    abonosHistorico.forEach((a) => {
      if (a.metodo) s.add(a.metodo);
    });
    return Array.from(s);
  }, [abonosHistorico]);

  const abonosFiltrados = useMemo(() => {
    return abonosHistorico.filter((a) => {
      const matchMetodo = metodoFiltro === 'todos' || a.metodo === metodoFiltro;
      const q = busqueda.toLowerCase().trim();
      const matchBusqueda =
        !q ||
        (a.clienteNombre && a.clienteNombre.toLowerCase().includes(q)) ||
        (a.facturaNumero && a.facturaNumero.toLowerCase().includes(q)) ||
        (a.notas && a.notas.toLowerCase().includes(q));

      return matchMetodo && matchBusqueda;
    }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }, [abonosHistorico, metodoFiltro, busqueda]);

  const totalUSD = abonosFiltrados.reduce((s, a) => s + (parseFloat(a.monto_usd) || 0), 0);
  const totalBs = abonosFiltrados.reduce((s, a) => s + (parseFloat(a.monto_bs) || 0), 0);

  useEffect(() => {
    setCurrentPage(1);
  }, [busqueda, metodoFiltro]);

  const totalItems = abonosFiltrados.length;
  const abonosPaginados = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return abonosFiltrados.slice(start, start + pageSize);
  }, [abonosFiltrados, currentPage, pageSize]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Barra de Filtros y Totales */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', flex: 1 }}>
            <input
              type="text"
              placeholder="Buscar por cliente, factura o notas..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ minWidth: '220px', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border)' }}
            />

            <select
              value={metodoFiltro}
              onChange={(e) => setMetodoFiltro(e.target.value)}
              style={{ padding: '0.45rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)' }}
            >
              <option value="todos">Todos los Métodos ({abonosHistorico.length})</option>
              {metodosDisponibles.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>Total Recaudado</span>
              <strong style={{ fontSize: '1.25rem', color: '#10B981' }}>{formatBs(totalBs)}</strong>
              {totalUSD > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>Ref. {formatDolares(totalUSD)}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Tabla de Abonos */}
      <div className="card">
        <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HiOutlineBanknotes style={{ color: '#10B981' }} />
            Cronología de Pagos y Abonos Recibidos
          </h3>
          <span className="badge badge--success">{abonosFiltrados.length} abonos</span>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha y Hora</th>
                <th>Cliente</th>
                <th>Factura Asoc.</th>
                <th>Método de Pago</th>
                <th>Notas / Referencia</th>
                <th style={{ textAlign: 'right' }}>Monto (Bs)</th>
                <th style={{ textAlign: 'right' }}>Ref. (USD)</th>
              </tr>
            </thead>
            <tbody>
              {abonosPaginados.length === 0 ? (
                <tr>
                  <td colSpan="7" className="table__empty">No se encontraron pagos con los filtros aplicados</td>
                </tr>
              ) : (
                abonosPaginados.map((a, i) => (
                  <tr key={a.id || i}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{formatFecha(a.fecha, true)}</div>
                    </td>
                    <td>
                      <strong>{a.clienteNombre || 'Sin cliente'}</strong>
                      {a.clienteDoc && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          {a.clienteDoc}
                        </div>
                      )}
                    </td>
                    <td>
                      <code>{a.facturaNumero || 'N/A'}</code>
                    </td>
                    <td>
                      <span className="badge" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                        {a.metodo || 'Efectivo'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {a.notas || '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong style={{ color: '#10B981', fontSize: '0.95rem' }}>
                        {a.monto_bs > 0 ? formatBs(a.monto_bs) : '—'}
                      </strong>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {formatDolares(a.monto_usd)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {abonosFiltrados.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg-elevated)', borderTop: '2px solid var(--border)' }}>
                  <td colSpan="5"><strong>TOTAL RECAUDADO EN ESTE PERÍODO</strong></td>
                  <td style={{ textAlign: 'right' }}><strong style={{ color: '#10B981', fontSize: '1.05rem' }}>{formatBs(totalBs)}</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{formatDolares(totalUSD)}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          totalItems={totalItems}
          pageSize={pageSize}
          onPageChange={(p) => setCurrentPage(p)}
        />
      </div>
    </div>
  );
}

