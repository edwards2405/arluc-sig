import React from 'react';
import {
  HiOutlineCreditCard,
  HiOutlineBanknotes,
  HiOutlineClock,
  HiOutlineExclamationTriangle,
  HiOutlineCog6Tooth,
  HiOutlineShoppingBag,
} from 'react-icons/hi2';
import { FaWhatsapp, FaPhone } from 'react-icons/fa';
import { formatUSD, formatBs, formatFecha, getWhatsAppUrl, getPhoneCallUrl } from '../../utils/formatters';
import { generarMensajeCobroWhatsApp } from '../../services/cuentasCobrarService';

export default function CxCTable({
  cuentas,
  tasaValor,
  config,
  empresa,
  onOpenAbonos,
  onOpenConfig,
  onVerArticulos,
}) {

  return (
    <div className="card">
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Cliente / Contacto</th>
              <th>Factura / Emisión</th>
              <th>Tiempo Transcurrido (Días)</th>
              <th>Deuda Original</th>
              <th>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span>Recargo por Días</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs"
                    onClick={onOpenConfig}
                    title="Configurar regla general de días y porcentaje"
                    style={{ padding: '2px', color: '#6366F1' }}
                  >
                    <HiOutlineCog6Tooth />
                  </button>
                </div>
              </th>
              <th>Saldo Pendiente</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acciones de Cobro</th>
            </tr>
          </thead>
          <tbody>
            {cuentas.length === 0 ? (
              <tr>
                <td colSpan="8" className="table__empty">
                  No se encontraron cuentas por cobrar con los filtros seleccionados
                </td>
              </tr>
            ) : (
              cuentas.map((c) => {
                const cliente = c.cliente;
                const dias = c.diasTranscurridos;

                // Mora, saldo y estado calculados por la base de datos
                const pctEfectivo = config.porcentajeRecargo;
                const recargoCalculadoUSD = c.recargoUSD;
                const saldoCalculadoUSD = c.saldoTotalUSD;
                const saldoCalculadoBs = tasaValor > 0 ? parseFloat((saldoCalculadoUSD * tasaValor).toFixed(2)) : 0;
                const esVencida = c.esVencida;
                const esSolvente = c.esSolvente;

                const msgWhatsAppEncoded = cliente?.telefono
                  ? generarMensajeCobroWhatsApp({
                      cliente,
                      cuenta: c,
                      saldoTotalUSD: saldoCalculadoUSD,
                      saldoTotalBs: saldoCalculadoBs,
                      dias,
                      recargoUSD: recargoCalculadoUSD,
                      porcentajeRecargo: pctEfectivo,
                      empresa,
                    })
                  : '';

                const whatsappUrl = cliente?.telefono
                  ? `${getWhatsAppUrl(cliente.telefono)}?text=${msgWhatsAppEncoded}`
                  : '';
                const phoneUrl = cliente?.telefono ? getPhoneCallUrl(cliente.telefono) : '';

                return (
                  <tr key={c.id} style={{ background: esVencida ? 'rgba(239,68,68,0.03)' : undefined }}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                          {cliente?.nombre || 'Cliente sin registrar'}
                        </strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {cliente?.documento_identidad || 'Sin documento'}
                        </span>
                        {cliente?.telefono && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {cliente.telefono}
                            </span>
                            <a
                              href={phoneUrl}
                              className="btn btn--ghost btn--xs"
                              style={{ color: '#3B82F6', padding: '1px 4px', fontSize: '0.75rem' }}
                              title="Llamar directamente"
                            >
                              <FaPhone />
                            </a>
                            <a
                              href={whatsappUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn--ghost btn--xs"
                              style={{ color: '#25D366', padding: '1px 4px', fontSize: '0.85rem' }}
                              title="Enviar mensaje de cobro por WhatsApp"
                            >
                              <FaWhatsapp />
                            </a>
                          </div>
                        )}
                      </div>
                    </td>

                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <code>{c.numero_factura}</code>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {formatFecha(c.fecha_emision, false)}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#6366F1' }}>
                          Crédito Directo en Tienda
                        </span>
                      </div>
                    </td>

                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <HiOutlineClock style={{ color: esVencida ? '#EF4444' : '#F59E0B' }} />
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            color: esVencida ? '#EF4444' : 'inherit',
                          }}
                        >
                          {dias} día{dias !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        {dias === 0 ? 'Salió hoy' : `Hace ${dias} d`}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontWeight: 600 }}>{formatUSD(c.montoOriginalUSD)}</div>
                      {c.totalAbonadoUSD > 0 && (
                        <div style={{ fontSize: '0.72rem', color: '#10B981' }}>
                          Abonado: {formatUSD(c.totalAbonadoUSD)}
                        </div>
                      )}
                    </td>

                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{pctEfectivo}</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>%</span>
                        </div>
                        {recargoCalculadoUSD > 0 ? (
                          <span style={{ fontSize: '0.75rem', color: '#EF4444', fontWeight: 600 }}>
                            +{formatUSD(recargoCalculadoUSD)}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                            {esVencida ? 'Sin recargo' : `Vence ${formatFecha(c.fecha_vencimiento)}`}
                          </span>
                        )}
                      </div>
                    </td>

                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: '0.95rem',
                            color: esSolvente ? '#10B981' : esVencida ? '#EF4444' : 'var(--text-primary)',
                          }}
                        >
                          {formatUSD(saldoCalculadoUSD)}
                        </span>
                        {tasaValor > 0 && saldoCalculadoUSD > 0 && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            {formatBs(saldoCalculadoBs)}
                          </span>
                        )}
                      </div>
                    </td>

                    <td>
                      {esSolvente ? (
                        <span className="badge badge--success" style={{ fontSize: '0.72rem' }}>
                          ✓ Solvente
                        </span>
                      ) : esVencida ? (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            color: '#EF4444',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            fontSize: '0.72rem',
                          }}
                        >
                          <HiOutlineExclamationTriangle style={{ marginRight: '2px' }} /> Vencida (+{c.diasVencida}d)
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(245, 158, 11, 0.15)',
                            color: '#F59E0B',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            fontSize: '0.72rem',
                          }}
                        >
                          Vigente ({dias}d)
                        </span>
                      )}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--xs"
                          onClick={() => onVerArticulos(c)}
                          title="Ver qué artículos se le entregaron a crédito ese día"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <HiOutlineShoppingBag /> <span className="hide-mobile">Artículos</span>
                        </button>

                        {cliente?.telefono && (
                          <>
                            <a
                              href={phoneUrl}
                              className="btn btn--secondary btn--xs"
                              style={{ color: '#3B82F6', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                              title="Llamar directamente al cliente"
                            >
                              <FaPhone /> <span className="hide-mobile">Llamar</span>
                            </a>
                            <a
                              href={whatsappUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn--secondary btn--xs"
                              style={{ color: '#25D366', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                              title="Enviar mensaje personalizado por WhatsApp con saldo y días"
                            >
                              <FaWhatsapp /> <span className="hide-mobile">WhatsApp</span>
                            </a>
                          </>
                        )}

                        <button
                          type="button"
                          className="btn btn--primary btn--xs"
                          onClick={() =>
                            onOpenAbonos({
                              ...c,
                              recargoUSD: recargoCalculadoUSD,
                              saldoTotalUSD: saldoCalculadoUSD,
                              porcentajeAplicado: pctEfectivo,
                            })
                          }
                          title="Gestionar abonos o liquidar cuenta"
                        >
                          <HiOutlineBanknotes /> Abonos
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
