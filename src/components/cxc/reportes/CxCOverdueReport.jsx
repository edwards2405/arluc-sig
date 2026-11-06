import React, { useState, useMemo } from 'react';
import { formatMonto, formatDolares, formatFecha, getWhatsAppUrl, getPhoneCallUrl } from '../../../utils/formatters';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';
import { FaWhatsapp, FaPhone } from 'react-icons/fa';
import Pagination from '../../common/Pagination';

export default function CxCOverdueReport({ cuentas = [], config = {}, tasaValor = 0 }) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  const vencidas = useMemo(() => {
    return cuentas
      .filter((c) => c.saldoTotalUSD > 0 && c.diasTranscurridos >= config.diasGracia)
      .sort((a, b) => b.diasTranscurridos - a.diasTranscurridos);
  }, [cuentas, config.diasGracia]);

  const totalVencidoUSD = vencidas.reduce((s, c) => s + c.saldoTotalUSD, 0);
  const totalRecargosUSD = vencidas.reduce((s, c) => s + c.recargoUSD, 0);

  const totalItems = vencidas.length;
  const vencidasPaginadas = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return vencidas.slice(start, start + pageSize);
  }, [vencidas, currentPage, pageSize]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Banner de Advertencia */}
      <div className="card" style={{ borderLeft: '4px solid #EF4444', background: 'rgba(239,68,68,0.04)', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, color: '#EF4444', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
              <HiOutlineExclamationTriangle />
              Cartera en Mora Crítica ({vencidas.length} facturas)
            </h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Cuentas con más de {config.diasGracia || 15} días desde la salida de mercancía. Requieren gestión de cobro inmediata.
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Saldo en Mora:</span>
            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#EF4444' }}>{formatMonto(totalVencidoUSD)}</div>
            {totalRecargosUSD > 0 && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Incluye +{formatMonto(totalRecargosUSD)} de mora
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabla de Vencidas */}
      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente / Contacto</th>
                <th>Factura / Emisión</th>
                <th style={{ textAlign: 'center' }}>Días en Calle</th>
                <th style={{ textAlign: 'right' }}>Deuda Orig.</th>
                <th style={{ textAlign: 'right' }}>Recargo Aplicado</th>
                <th style={{ textAlign: 'right' }}>Abonado</th>
                <th style={{ textAlign: 'right' }}>Saldo Total Vencido</th>
                <th style={{ textAlign: 'center' }}>Cobro Rápido</th>
              </tr>
            </thead>
            <tbody>
              {vencidasPaginadas.length === 0 ? (
                <tr>
                  <td colSpan="8" className="table__empty" style={{ color: '#10B981' }}>
                    ¡Excelente! No hay cuentas vencidas fuera del límite de días de gracia.
                  </td>
                </tr>
              ) : (
                vencidasPaginadas.map((c) => {
                  const tel = c.cliente?.telefono;
                  const phoneUrl = tel ? getPhoneCallUrl(tel) : '';
                  const msgWa = encodeURIComponent(
                    `Estimado(a) ${c.cliente?.nombre || 'cliente'}, le saludamos de Comercializadora ARLUC. Le recordamos que su factura ${c.numero_factura} posee un saldo vencido de ${formatMonto(c.saldoTotalUSD)} con ${c.diasTranscurridos} días transcurridos. Agradecemos coordinar su pago a la brevedad.`
                  );
                  const whatsappUrl = tel ? `${getWhatsAppUrl(tel)}?text=${msgWa}` : '';

                  return (
                    <tr key={c.id} style={{ background: 'rgba(239,68,68,0.02)' }}>
                      <td>
                        <strong>{c.cliente?.nombre || 'Sin nombre'}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {c.cliente?.documento_identidad || 'N/A'}
                        </div>
                      </td>
                      <td>
                        <code>{c.numero_factura}</code>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          {formatFecha(c.fecha_emision, false)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge badge--danger" style={{ fontWeight: 800 }}>
                          +{c.diasTranscurridos} días
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatMonto(c.montoOriginalUSD)}</td>
                      <td style={{ textAlign: 'right', color: '#EF4444', fontWeight: 600 }}>
                        {c.recargoUSD > 0 ? `+${formatMonto(c.recargoUSD)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: '#10B981' }}>
                        {c.totalAbonadoUSD > 0 ? formatMonto(c.totalAbonadoUSD) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: '#EF4444', fontSize: '1rem' }}>
                          {formatMonto(c.saldoTotalUSD)}
                        </strong>
                        {tasaValor > 0 && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            Ref. {formatDolares(c.saldoTotalUSD)}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {tel ? (
                          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                            <a
                              href={phoneUrl}
                              className="btn btn--secondary btn--xs"
                              style={{ color: '#3B82F6', minWidth: '32px', minHeight: '32px', padding: '6px' }}
                              title="Llamar"
                            >
                              <FaPhone />
                            </a>
                            <a
                              href={whatsappUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn--secondary btn--xs"
                              style={{ color: '#25D366', minWidth: '32px', minHeight: '32px', padding: '6px' }}
                              title="Cobro vía WhatsApp"
                            >
                              <FaWhatsapp />
                            </a>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Sin teléfono</span>
                        )}
                      </td>
                    </tr>
                  );
                })
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

