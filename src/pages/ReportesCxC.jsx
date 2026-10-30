import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DEFAULT_CXC_CONFIG, fetchCxCConfig, fetchCuentasPorCobrar } from '../services/cuentasCobrarService';

import CxCAgingReport from '../components/cxc/reportes/CxCAgingReport';
import CxCClientStatement from '../components/cxc/reportes/CxCClientStatement';
import CxCExecutiveSummary from '../components/cxc/reportes/CxCExecutiveSummary';
import CxCPaymentsReport from '../components/cxc/reportes/CxCPaymentsReport';
import CxCOverdueReport from '../components/cxc/reportes/CxCOverdueReport';
import CxCCreditsReport from '../components/cxc/reportes/CxCCreditsReport';
import { exportarCxCExcel } from '../components/cxc/reportes/cxcReportExport';

import {
  HiOutlineCreditCard,
  HiOutlineArrowLeft,
  HiOutlineArrowDownTray,
  HiOutlineArrowPath,
  HiOutlineClock,
  HiOutlineUser,
  HiOutlineChartPie,
  HiOutlineBanknotes,
  HiOutlineExclamationTriangle,
  HiOutlineReceiptPercent,
} from 'react-icons/hi2';

export default function ReportesCxC() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cuentas, setCuentas] = useState([]);
  const [tasaHoy, setTasaHoy] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CXC_CONFIG);
  const [subTab, setSubTab] = useState('aging'); // 'aging' | 'cliente' | 'resumen' | 'abonos' | 'vencidas' | 'creditos'

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    setLoading(true);
    try {
      const [cuentasData, cfg, { data: tasaData }] = await Promise.all([
        fetchCuentasPorCobrar(),
        fetchCxCConfig(),
        supabase.from('tasas_cambio').select('*').order('fecha_registro', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setCuentas(cuentasData);
      setConfig(cfg);
      if (tasaData) setTasaHoy(tasaData);
    } catch (e) {
      console.error('Error cargando datos para reportes de CxC:', e);
    } finally {
      setLoading(false);
    }
  }

  // Historial plano de todos los abonos
  const abonosHistorico = useMemo(() => {
    const lista = [];
    cuentas.forEach((c) => {
      (c.abonos || []).forEach((a) => {
        lista.push({
          ...a,
          facturaNumero: c.numero_factura,
          clienteNombre: c.cliente?.nombre,
          clienteDoc: c.cliente?.documento_identidad,
        });
      });
    });
    return lista;
  }, [cuentas]);

  const tasaValor = tasaHoy?.tasa_usd_bs || 0;

  function handleExportarExcel() {
    exportarCxCExcel({ cuentas, abonosHistorico, config, tasaValor });
  }

  const TABS_CONFIG = [
    { id: 'aging', label: 'Antigüedad de Saldos', icon: <HiOutlineClock /> },
    { id: 'cliente', label: 'Estado por Cliente', icon: <HiOutlineUser /> },
    { id: 'resumen', label: 'Resumen Ejecutivo', icon: <HiOutlineChartPie /> },
    { id: 'abonos', label: 'Historial de Abonos', icon: <HiOutlineBanknotes /> },
    { id: 'vencidas', label: 'Cuentas en Mora', icon: <HiOutlineExclamationTriangle /> },
    { id: 'creditos', label: 'Créditos Otorgados', icon: <HiOutlineReceiptPercent /> },
  ];

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Cargando reportes de Cuentas por Cobrar...</p>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="page__header no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate('/cuentas-por-cobrar')}
            style={{ width: '42px', height: '42px', padding: 0, justifyContent: 'center' }}
            title="Volver a Cuentas por Cobrar"
          >
            <HiOutlineArrowLeft style={{ fontSize: '1.25rem' }} />
          </button>
          <div>
            <h1 className="page__title" style={{ margin: 0 }}>Reportes de Cuentas por Cobrar</h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Auditoría financiera, mora, antigüedad y estados de cuenta para cobros
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={cargarDatos}
            title="Refrescar datos"
          >
            <HiOutlineArrowPath /> Refrescar
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={handleExportarExcel}
            style={{ borderColor: '#10B981', color: '#10B981', fontWeight: 'bold' }}
            title="Descargar libro Excel con todos los reportes de CxC"
          >
            <HiOutlineArrowDownTray /> Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Navegación por Pestañas */}
      <div
        className="card no-print"
        style={{
          padding: '0.5rem',
          display: 'flex',
          gap: '0.35rem',
          overflowX: 'auto',
          scrollbarWidth: 'thin',
        }}
      >
        {TABS_CONFIG.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.6rem 0.95rem',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              minHeight: '44px',
              background: subTab === tab.id ? 'var(--primary)' : 'transparent',
              color: subTab === tab.id ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Contenido del Reporte Activo */}
      {subTab === 'aging' && <CxCAgingReport cuentas={cuentas} tasaValor={tasaValor} config={config} />}
      {subTab === 'cliente' && <CxCClientStatement cuentas={cuentas} tasaValor={tasaValor} />}
      {subTab === 'resumen' && <CxCExecutiveSummary cuentas={cuentas} tasaValor={tasaValor} config={config} />}
      {subTab === 'abonos' && <CxCPaymentsReport abonosHistorico={abonosHistorico} tasaValor={tasaValor} />}
      {subTab === 'vencidas' && <CxCOverdueReport cuentas={cuentas} config={config} tasaValor={tasaValor} />}
      {subTab === 'creditos' && <CxCCreditsReport cuentas={cuentas} tasaValor={tasaValor} />}
    </div>
  );
}

