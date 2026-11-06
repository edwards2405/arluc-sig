import React, { useState, useMemo } from 'react';
import { formatMonto, formatDolares, formatFecha } from '../../../utils/formatters';
import { HiOutlineCreditCard } from 'react-icons/hi2';
import Pagination from '../../common/Pagination';

export default function CxCCreditsReport({ cuentas = [], tasaValor = 0 }) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  const totalOtorgadoUSD = cuentas.reduce((s, c) => s + c.montoOriginalUSD, 0);
  const totalAbonadoUSD = cuentas.reduce((s, c) => s + c.totalAbonadoUSD, 0);
  const totalRiesgoPendienteUSD = cuentas.reduce((s, c) => s + c.saldoTotalUSD, 0);

  const totalItems = cuentas.length;
  const cuentasPaginadas = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return cuentas.slice(start, start + pageSize);
  }, [cuentas, currentPage, pageSize]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Resumen de Exposición Crediticia */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
        <div className="card" style={{ padding: '1rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Crédito Total Otorgado (Directo)</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
            {formatMonto(totalOtorgadoUSD)}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {cuentas.length} transacciones a crédito
          </span>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <span style={{ fontSize: '0.78rem', color: '#10B981' }}>Crédito Recuperado (Cobrado)</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10B981', marginTop: '0.2rem' }}>
            {formatMonto(totalAbonadoUSD)}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {totalOtorgadoUSD > 0 ? ((totalAbonadoUSD / totalOtorgadoUSD) * 100).toFixed(1) : 0}% recuperado
          </span>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <span style={{ fontSize: '0.78rem', color: '#6366F1' }}>Exposición Neta Pendiente</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#6366F1', marginTop: '0.2rem' }}>
            {formatMonto(totalRiesgoPendienteUSD)}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {tasaValor > 0 ? `Ref. ${formatDolares(totalRiesgoPendienteUSD)}` : 'Capital en calle'}
          </span>
        </div>
      </div>

      {/* Tabla de Créditos */}
      <div className="card">
        <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HiOutlineCreditCard style={{ color: '#6366F1' }} />
            Listado de Créditos Directos Otorgados a Clientes
          </h3>
          <span className="badge badge--primary">{cuentas.length} créditos</span>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Fecha Emisión</th>
                <th>Cliente</th>
                <th style={{ textAlign: 'right' }}>Monto Financiado</th>
                <th style={{ textAlign: 'right' }}>Total Abonado</th>
                <th style={{ textAlign: 'right' }}>Saldo Pendiente</th>
                <th style={{ textAlign: 'center' }}>Días</th>
                <th style={{ textAlign: 'center' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {cuentasPaginadas.length === 0 ? (
                <tr>
                  <td colSpan="8" className="table__empty">No se han emitido facturas con crédito directo</td>
                </tr>
              ) : (
                cuentasPaginadas.map((c) => (
                  <tr key={c.id}>
                    <td><code>{c.numero_factura}</code></td>
                    <td>{formatFecha(c.fecha_emision, false)}</td>
                    <td>
                      <strong>{c.cliente?.nombre || 'Sin cliente'}</strong>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {c.cliente?.documento_identidad || 'N/A'}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMonto(c.montoOriginalUSD)}</td>
                    <td style={{ textAlign: 'right', color: '#10B981' }}>
                      {c.totalAbonadoUSD > 0 ? formatMonto(c.totalAbonadoUSD) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: c.saldoTotalUSD > 0 ? '#6366F1' : '#10B981' }}>
                      {formatMonto(c.saldoTotalUSD)}
                    </td>
                    <td style={{ textAlign: 'center' }}>{c.diasTranscurridos} d</td>
                    <td style={{ textAlign: 'center' }}>
                      {c.saldoTotalUSD === 0 ? (
                        <span className="badge badge--success">Solvente</span>
                      ) : (
                        <span className="badge badge--warning">En Cobro</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
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

