import React, { useMemo } from 'react';
import { formatMonto, formatDolares } from '../../../utils/formatters';
import {
  HiOutlineBanknotes,
  HiOutlineExclamationTriangle,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineUserGroup,
  HiOutlineArrowTrendingUp,
} from 'react-icons/hi2';

export default function CxCExecutiveSummary({ cuentas = [], tasaValor = 0, config = {} }) {
  const metrics = useMemo(() => {
    let totalCreditoOtorgado = 0;
    let totalRecargo = 0;
    let totalAbonado = 0;
    let totalPendiente = 0;
    let cuentasVencidas = 0;
    let cuentasVigentes = 0;
    let cuentasSolventes = 0;
    let totalDias = 0;

    const deudoresMap = {};

    cuentas.forEach((c) => {
      totalCreditoOtorgado += c.montoOriginalUSD;
      totalRecargo += c.recargoUSD;
      totalAbonado += c.totalAbonadoUSD;
      totalPendiente += c.saldoTotalUSD;

      if (c.saldoTotalUSD === 0) {
        cuentasSolventes++;
      } else {
        totalDias += c.diasTranscurridos;
        if (c.diasTranscurridos >= config.diasGracia) {
          cuentasVencidas++;
        } else {
          cuentasVigentes++;
        }

        const idCl = c.cliente?.id || c.cliente?.nombre || 'desconocido';
        if (!deudoresMap[idCl]) {
          deudoresMap[idCl] = {
            nombre: c.cliente?.nombre || 'Sin Nombre',
            documento: c.cliente?.documento_identidad || 'N/A',
            telefono: c.cliente?.telefono || '',
            totalDeuda: 0,
            facturas: 0,
            maxDias: 0,
          };
        }
        deudoresMap[idCl].totalDeuda += c.saldoTotalUSD;
        deudoresMap[idCl].facturas++;
        deudoresMap[idCl].maxDias = Math.max(deudoresMap[idCl].maxDias, c.diasTranscurridos);
      }
    });

    const activasCount = cuentasVigentes + cuentasVencidas;
    const promedioDias = activasCount > 0 ? Math.round(totalDias / activasCount) : 0;
    const tasaRecuperacion = totalCreditoOtorgado > 0 ? (totalAbonado / (totalCreditoOtorgado + totalRecargo)) * 100 : 0;
    const porcentajeVencido = totalPendiente > 0 ? (cuentas.filter(c => c.saldoTotalUSD > 0 && c.diasTranscurridos >= config.diasGracia).reduce((s, c) => s + c.saldoTotalUSD, 0) / totalPendiente) * 100 : 0;

    const top5Deudores = Object.values(deudoresMap)
      .sort((a, b) => b.totalDeuda - a.totalDeuda)
      .slice(0, 5);

    return {
      totalCreditoOtorgado,
      totalRecargo,
      totalAbonado,
      totalPendiente,
      cuentasVencidas,
      cuentasVigentes,
      cuentasSolventes,
      promedioDias,
      tasaRecuperacion,
      porcentajeVencido,
      top5Deudores,
    };
  }, [cuentas, config]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* KPIs Principales */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366F1' }}>
            <HiOutlineBanknotes />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Cartera Activa por Cobrar</span>
            <span className="stat-card__value" style={{ color: '#6366F1' }}>
              {formatMonto(metrics.totalPendiente)}
            </span>
            <span className="stat-card__sub">
              {tasaValor > 0 ? `Ref. ${formatDolares(metrics.totalPendiente)}` : `${cuentas.length} cuentas registradas`}
            </span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444' }}>
            <HiOutlineExclamationTriangle />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Cartera en Mora ({metrics.porcentajeVencido.toFixed(1)}%)</span>
            <span className="stat-card__value" style={{ color: '#EF4444' }}>
              {metrics.cuentasVencidas} <span style={{ fontSize: '1rem', fontWeight: 500 }}>cuentas</span>
            </span>
            <span className="stat-card__sub">
              Superan {config.diasGracia || 15} días de gracia
            </span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}>
            <HiOutlineArrowTrendingUp />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Tasa de Recuperación</span>
            <span className="stat-card__value" style={{ color: '#10B981' }}>
              {metrics.tasaRecuperacion.toFixed(1)}%
            </span>
            <span className="stat-card__sub">
              {formatMonto(metrics.totalAbonado)} recaudados
            </span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B' }}>
            <HiOutlineClock />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Antigüedad Promedio</span>
            <span className="stat-card__value" style={{ color: '#F59E0B' }}>
              {metrics.promedioDias} <span style={{ fontSize: '1rem', fontWeight: 500 }}>días</span>
            </span>
            <span className="stat-card__sub">Tiempo medio de rotación</span>
          </div>
        </div>
      </div>

      {/* Grid: Salud de la Cartera + Top 5 Deudores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {/* Salud de Cartera */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 className="card__title" style={{ marginBottom: '1rem' }}>
            <HiOutlineCheckCircle style={{ color: '#10B981', marginRight: '0.5rem' }} />
            Estado General de la Cartera
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                <span>Cuentas Vigentes (Al día)</span>
                <strong>{metrics.cuentasVigentes} cuentas</strong>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${cuentas.length > 0 ? (metrics.cuentasVigentes / cuentas.length) * 100 : 0}%`,
                    height: '100%',
                    background: '#10B981',
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                <span>Cuentas Vencidas (Con Mora)</span>
                <strong style={{ color: '#EF4444' }}>{metrics.cuentasVencidas} cuentas</strong>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${cuentas.length > 0 ? (metrics.cuentasVencidas / cuentas.length) * 100 : 0}%`,
                    height: '100%',
                    background: '#EF4444',
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                <span>Cuentas Totalmente Liquidadas</span>
                <strong style={{ color: '#3B82F6' }}>{metrics.cuentasSolventes} cuentas</strong>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${cuentas.length > 0 ? (metrics.cuentasSolventes / cuentas.length) * 100 : 0}%`,
                    height: '100%',
                    background: '#3B82F6',
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '0.82rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Crédito Bruto Colocado:</span>
                <strong>{formatMonto(metrics.totalCreditoOtorgado)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Intereses / Recargos generados:</span>
                <strong style={{ color: '#EF4444' }}>+{formatMonto(metrics.totalRecargo)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total Cobrado a la fecha:</span>
                <strong style={{ color: '#10B981' }}>{formatMonto(metrics.totalAbonado)}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Top 5 Deudores */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 className="card__title" style={{ marginBottom: '1rem' }}>
            <HiOutlineUserGroup style={{ color: '#6366F1', marginRight: '0.5rem' }} />
            Top 5 Mayores Deudores
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {metrics.top5Deudores.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>
                No hay deudas activas
              </div>
            ) : (
              metrics.top5Deudores.map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.6rem 0.8rem',
                    background: 'var(--bg-elevated)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <span style={{ fontWeight: 800, color: i === 0 ? '#EF4444' : 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      #{i + 1}
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{d.nombre}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {d.facturas} factura(s) • Máx: {d.maxDias} días
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, color: '#EF4444', fontSize: '0.95rem' }}>
                      {formatMonto(d.totalDeuda)}
                    </div>
                    {tasaValor > 0 && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        Ref. {formatDolares(d.totalDeuda)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

