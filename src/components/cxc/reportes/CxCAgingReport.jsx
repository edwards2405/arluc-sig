import React, { useState, useMemo, useEffect } from 'react';
import { formatMonto, formatDolares, formatFecha } from '../../../utils/formatters';
import { HiOutlineClock, HiOutlineFunnel, HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import Pagination from '../../common/Pagination';

export default function CxCAgingReport({ cuentas = [], tasaValor = 0, config = {} }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [filtroBucket, setFiltroBucket] = useState('todos');
  const [busqueda, setBusqueda] = useState('');
  const pageSize = 15;

  const buckets = [
    { id: 'b1', label: '0 – 7 días', desc: 'Recientes / Al día', min: 0, max: 7, color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)' },
    { id: 'b2', label: '8 – 15 días', desc: 'En período de gracia', min: 8, max: 15, color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.1)' },
    { id: 'b3', label: '16 – 30 días', desc: 'Vencidas recientes', min: 16, max: 30, color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.1)' },
    { id: 'b4', label: '31 – 60 días', desc: 'Mora media', min: 31, max: 60, color: '#F97316', bg: 'rgba(249, 115, 22, 0.1)' },
    { id: 'b5', label: 'Más de 60 días', desc: 'Mora crítica / Alto riesgo', min: 61, max: 99999, color: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)' },
  ];

  const pendientes = useMemo(() => cuentas.filter((c) => c.saldoTotalUSD > 0), [cuentas]);
  const totalPendienteUSD = pendientes.reduce((acc, c) => acc + c.saldoTotalUSD, 0) || 1;

  const bucketStats = useMemo(() => {
    return buckets.map((b) => {
      const items = pendientes.filter((c) => c.diasTranscurridos >= b.min && c.diasTranscurridos <= b.max);
      const totalUSD = items.reduce((acc, c) => acc + c.saldoTotalUSD, 0);
      const porcentaje = totalPendienteUSD > 0 ? (totalUSD / totalPendienteUSD) * 100 : 0;
      return { ...b, items, totalUSD, porcentaje };
    });
  }, [buckets, pendientes, totalPendienteUSD]);

  // Filtrado
  const cuentasFiltradas = useMemo(() => {
    return pendientes.filter((c) => {
      const q = busqueda.toLowerCase().trim();
      const matchSearch =
        !q ||
        c.numero_factura.toLowerCase().includes(q) ||
        (c.cliente?.nombre && c.cliente.nombre.toLowerCase().includes(q)) ||
        (c.cliente?.documento_identidad && c.cliente.documento_identidad.toLowerCase().includes(q));

      let matchBucket = true;
      if (filtroBucket !== 'todos') {
        const b = buckets.find((item) => item.id === filtroBucket);
        if (b) {
          matchBucket = c.diasTranscurridos >= b.min && c.diasTranscurridos <= b.max;
        }
      }

      return matchSearch && matchBucket;
    }).sort((a, b) => b.diasTranscurridos - a.diasTranscurridos);
  }, [pendientes, busqueda, filtroBucket, buckets]);

  useEffect(() => {
    setCurrentPage(1);
  }, [busqueda, filtroBucket]);

  const totalItems = cuentasFiltradas.length;
  const cuentasPaginadas = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return cuentasFiltradas.slice(start, start + pageSize);
  }, [cuentasFiltradas, currentPage, pageSize]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Tarjetas por Rango (Interactivas para filtrar) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        {bucketStats.map((b) => {
          const isSelected = filtroBucket === b.id;
          return (
            <div
              key={b.id}
              className="card"
              onClick={() => setFiltroBucket(isSelected ? 'todos' : b.id)}
              style={{
                padding: '1rem',
                borderTop: `4px solid ${b.color}`,
                background: isSelected ? 'var(--bg-elevated)' : b.bg,
                boxShadow: isSelected ? `0 0 0 2px ${b.color}` : undefined,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                transition: 'all 0.15s ease',
              }}
              title={`Clic para filtrar solo facturas de ${b.label}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: b.color }}>{b.label}</span>
                <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  {b.items.length} {b.items.length === 1 ? 'cuenta' : 'cuentas'}
                </span>
              </div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {formatMonto(b.totalUSD)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {tasaValor > 0 && <span>Ref. {formatDolares(b.totalUSD)} • </span>}
                <span>{b.porcentaje.toFixed(1)}% de la cartera</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Barra de Distribución Visual */}
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Distribución Porcentual del Saldo en la Calle
        </h4>
        <div style={{ width: '100%', height: '14px', display: 'flex', borderRadius: '7px', overflow: 'hidden', background: 'var(--bg-elevated)' }}>
          {bucketStats.map((b) => (
            b.porcentaje > 0 && (
              <div
                key={b.id}
                title={`${b.label}: ${b.porcentaje.toFixed(1)}% (${formatMonto(b.totalUSD)})`}
                style={{
                  width: `${b.porcentaje}%`,
                  height: '100%',
                  background: b.color,
                  transition: 'width 0.4s ease',
                }}
              />
            )
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.75rem', fontSize: '0.75rem' }}>
          {bucketStats.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: b.color }} />
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{b.label}:</span>
              <span style={{ color: 'var(--text-secondary)' }}>{formatMonto(b.totalUSD)} ({b.porcentaje.toFixed(1)}%)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filtros de la Tabla */}
      <div className="card" style={{ padding: '0.85rem 1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="search-box" style={{ flex: '1 1 240px' }}>
            <HiOutlineMagnifyingGlass className="search-box__icon" />
            <input
              type="text"
              placeholder="Buscar por cliente, documento o factura..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HiOutlineFunnel style={{ color: 'var(--text-secondary)' }} />
            <select
              value={filtroBucket}
              onChange={(e) => setFiltroBucket(e.target.value)}
              style={{ minWidth: '180px', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border)' }}
            >
              <option value="todos">Todos los Rangos ({pendientes.length})</option>
              {buckets.map((b) => {
                const count = pendientes.filter((c) => c.diasTranscurridos >= b.min && c.diasTranscurridos <= b.max).length;
                return (
                  <option key={b.id} value={b.id}>
                    {b.label} ({count})
                  </option>
                );
              })}
            </select>
            {filtroBucket !== 'todos' && (
              <button
                type="button"
                className="btn btn--ghost btn--xs"
                onClick={() => setFiltroBucket('todos')}
              >
                Limpiar filtro
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabla Detallada con Paginación */}
      <div className="card">
        <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HiOutlineClock style={{ color: 'var(--primary)' }} />
            Detalle de Antigüedad por Factura
          </h3>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Mostrando {totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalItems)} de {totalItems} facturas
          </span>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Factura / Emisión</th>
                <th style={{ textAlign: 'center' }}>Días en Calle</th>
                <th>Rango de Antigüedad</th>
                <th style={{ textAlign: 'right' }}>Monto Orig.</th>
                <th style={{ textAlign: 'right' }}>Abonado</th>
                <th style={{ textAlign: 'right' }}>Saldo Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {cuentasPaginadas.length === 0 ? (
                <tr>
                  <td colSpan="7" className="table__empty">No se encontraron facturas pendientes con los filtros aplicados</td>
                </tr>
              ) : (
                cuentasPaginadas.map((c) => {
                  const bucket = buckets.find((b) => c.diasTranscurridos >= b.min && c.diasTranscurridos <= b.max) || buckets[buckets.length - 1];
                  const esVencida = c.diasTranscurridos >= config.diasGracia;

                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.cliente?.nombre || 'Cliente sin nombre'}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {c.cliente?.documento_identidad || 'Sin cédula'}
                        </div>
                      </td>
                      <td>
                        <code>{c.numero_factura}</code>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {formatFecha(c.fecha_emision, false)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ fontWeight: 800, color: esVencida ? '#EF4444' : 'inherit' }}>
                          {c.diasTranscurridos} d
                        </span>
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{ background: bucket.bg, color: bucket.color, border: `1px solid ${bucket.color}44` }}
                        >
                          {bucket.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatMonto(c.montoOriginalUSD)}</td>
                      <td style={{ textAlign: 'right', color: '#10B981' }}>
                        {c.totalAbonadoUSD > 0 ? formatMonto(c.totalAbonadoUSD) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: bucket.color, fontSize: '0.95rem' }}>
                          {formatMonto(c.saldoTotalUSD)}
                        </strong>
                        {tasaValor > 0 && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            Ref. {formatDolares(c.saldoTotalUSD)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
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
