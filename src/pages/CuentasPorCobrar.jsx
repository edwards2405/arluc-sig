import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useDialogo } from '../components/common/DialogoProvider';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getEmpresaConfig } from '../utils/constants';
import { puede } from '../utils/permisos';
import { mensajeError } from '../utils/errores';
import {
  DEFAULT_CXC_CONFIG,
  fetchCxCConfig,
  saveCxCConfig,
  fetchCuentasPorCobrar,
  registrarAbono,
  anularAbono,
} from '../services/cuentasCobrarService';

import CxCStats from '../components/cxc/CxCStats';
import CxCTable from '../components/cxc/CxCTable';
import CxCConfigModal from '../components/cxc/CxCConfigModal';
import CxCAbonoModal from '../components/cxc/CxCAbonoModal';
import CxCArticulosModal from '../components/cxc/CxCArticulosModal';
import Pagination from '../components/common/Pagination';

import {
  HiOutlineCreditCard,
  HiOutlineMagnifyingGlass,
  HiOutlineCog6Tooth,
  HiOutlineArrowPath,
  HiOutlineFunnel,
  HiOutlineDocumentChartBar,
} from 'react-icons/hi2';

export default function CuentasPorCobrar() {
  const { pedirTexto } = useDialogo();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const rol = profile?.rol;
  const puedeConfigurar = puede(rol, 'cxc.configurar');
  const [loading, setLoading] = useState(true);
  const [cuentasProcesadas, setCuentasProcesadas] = useState([]);
  const [tasaHoy, setTasaHoy] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CXC_CONFIG);
  const [empresa, setEmpresa] = useState(getEmpresaConfig);

  // Filtros
  const [search, setSearch] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('pendientes'); // 'todos' | 'pendientes' | 'vencidas' | 'solventes'
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Modales
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [cuentaParaAbonar, setCuentaParaAbonar] = useState(null);
  const [cuentaParaVerArticulos, setCuentaParaVerArticulos] = useState(null);

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    setLoading(true);
    try {
      // Cartera, mora y saldos calculados en la base de datos
      // Tasa vigente (la de hoy o la última anterior), igual que el POS
      const [cuentas, cfg, { data: tasaData, error: errorTasa }] = await Promise.all([
        fetchCuentasPorCobrar(),
        fetchCxCConfig(),
        supabase.rpc('tasa_vigente'),
      ]);

      setCuentasProcesadas(cuentas);
      setConfig(cfg);
      if (errorTasa) toast.error('No se pudo obtener la tasa vigente: ' + mensajeError(errorTasa));
      setTasaHoy(Number(tasaData) || null);
      setEmpresa(getEmpresaConfig());
      return cuentas;
    } catch (e) {
      console.error('Error cargando cuentas por cobrar:', e);
      toast.error('Error cargando cuentas por cobrar: ' + mensajeError(e));
      return [];
    } finally {
      setLoading(false);
    }
  }

  // Filtrado
  const cuentasFiltradas = useMemo(() => {
    return cuentasProcesadas.filter((c) => {
      // Búsqueda
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        c.numero_factura.toLowerCase().includes(q) ||
        c.cliente?.nombre?.toLowerCase().includes(q) ||
        c.cliente?.documento_identidad?.toLowerCase().includes(q) ||
        c.cliente?.telefono?.includes(q);

      // Estado
      let matchEstado = true;
      if (filtroEstado === 'pendientes') {
        matchEstado = !c.esSolvente;
      } else if (filtroEstado === 'vencidas') {
        matchEstado = c.esVencida;
      } else if (filtroEstado === 'solventes') {
        matchEstado = c.esSolvente;
      }

      return matchSearch && matchEstado;
    });
  }, [cuentasProcesadas, search, filtroEstado]);

  // Estadísticas globales
  const stats = useMemo(() => {
    let totalPendiente = 0;
    let vencidas = 0;
    let recargos = 0;
    let abonado = 0;
    let totalDias = 0;

    const activas = cuentasProcesadas.filter((c) => !c.esSolvente);

    activas.forEach((c) => {
      totalPendiente += c.saldoTotalUSD;
      abonado += c.totalAbonadoUSD;
      recargos += c.recargoUSD;
      totalDias += c.diasTranscurridos;
      if (c.esVencida) {
        vencidas++;
      }
    });

    const promedioDias = activas.length > 0 ? Math.round(totalDias / activas.length) : 0;

    return {
      totalSaldoPendienteUSD: parseFloat(totalPendiente.toFixed(2)),
      cuentasVencidas: vencidas,
      recargosGeneradosUSD: parseFloat(recargos.toFixed(2)),
      totalAbonadoUSD: parseFloat(abonado.toFixed(2)),
      promedioDias,
      totalCuentas: activas.length,
    };
  }, [cuentasProcesadas]);

  // Paginación
  const totalItems = cuentasFiltradas.length;
  const cuentasPaginadas = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return cuentasFiltradas.slice(start, start + pageSize);
  }, [cuentasFiltradas, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filtroEstado]);

  async function handleSaveConfig(newConfig) {
    try {
      setConfig(await saveCxCConfig(newConfig));
      toast.success('Política de crédito y mora actualizada');
      await cargarDatos();
      return true;
    } catch (e) {
      toast.error('Error al guardar la configuración: ' + mensajeError(e));
      return false;
    }
  }

  async function refrescarCuentaAbierta(cxcId) {
    const cuentas = await cargarDatos();
    const cuenta = cuentas.find((c) => c.id === cxcId);
    setCuentaParaAbonar(cuenta ? { ...cuenta, porcentajeAplicado: config.porcentajeRecargo } : null);
  }

  async function handleRegistrarAbono(cxcId, abono) {
    await registrarAbono(cxcId, abono);
    await refrescarCuentaAbierta(cxcId);
  }

  async function handleEliminarAbono(cxcId, abonoId) {
    const motivo = await pedirTexto({
      titulo: 'Anular abono',
      mensaje: 'El abono se anula, el saldo de la cuenta vuelve a subir y se revierte su asiento contable.',
      etiqueta: 'Motivo de la anulación', multilinea: true, minimo: 10, maximo: 300,
      variante: 'danger', textoConfirmar: 'Anular abono',
    });
    if (!motivo) return;
    try {
      await anularAbono(abonoId, motivo);
      toast.success('Abono anulado y asiento revertido');
      await refrescarCuentaAbierta(cxcId);
    } catch (e) {
      toast.error(mensajeError(e));
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Cargando módulo de Cuentas por Cobrar...</p>
      </div>
    );
  }

  const tasaValor = tasaHoy || 0;

  return (
    <div className="page">
      {/* Header */}
      <div className="page__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(168,85,247,0.2) 100%)',
              color: '#6366F1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4rem',
            }}
          >
            <HiOutlineCreditCard />
          </div>
          <div>
            <h1 className="page__title" style={{ margin: 0 }}>Cuentas por Cobrar</h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Monitoreo de días en calle, mora configurable y cobranza directa por llamada o WhatsApp
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={cargarDatos}
            title="Refrescar lista"
          >
            <HiOutlineArrowPath /> Refrescar
          </button>
          {puedeConfigurar && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setShowConfigModal(true)}
              title="Configurar regla de días de gracia y porcentaje de recargo"
            >
              <HiOutlineCog6Tooth /> Reglas
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => navigate('/cuentas-por-cobrar/reportes')}
            title="Ver reportes y auditoría de Cuentas por Cobrar"
          >
            <HiOutlineDocumentChartBar /> Reportes CxC
          </button>
        </div>
      </div>

      {/* Tarjetas KPI */}
      <CxCStats stats={stats} tasaValor={tasaValor} />

      {/* Barra de Filtros */}
      <div className="filters-bar" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-box" style={{ flex: 1, minWidth: '240px' }}>
          <HiOutlineMagnifyingGlass className="search-box__icon" />
          <input
            type="text"
            placeholder="Buscar por cliente, cédula/RIF, factura o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <HiOutlineFunnel style={{ color: 'var(--text-secondary)' }} />
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            style={{ minWidth: '170px' }}
          >
            <option value="pendientes">Pendientes por Cobrar ({stats.totalCuentas})</option>
            <option value="vencidas">Con Mora / Vencidas ({stats.cuentasVencidas})</option>
            <option value="solventes">Completamente Solventes</option>
            <option value="todos">Todas las Cuentas ({cuentasProcesadas.length})</option>
          </select>
        </div>
      </div>

      {/* Tabla Principal */}
      <CxCTable
        cuentas={cuentasPaginadas}
        tasaValor={tasaValor}
        config={config}
        empresa={empresa}
        onOpenAbonos={(c) => setCuentaParaAbonar(c)}
        onOpenConfig={puedeConfigurar ? () => setShowConfigModal(true) : null}
        onVerArticulos={(c) => setCuentaParaVerArticulos(c)}
        puedeAbonar={puede(rol, 'abono.registrar')}
      />

      {/* Paginación */}
      <Pagination
        currentPage={currentPage}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={(p) => setCurrentPage(p)}
      />

      {/* Modal de Artículos a Crédito */}
      <CxCArticulosModal
        isOpen={!!cuentaParaVerArticulos}
        cuenta={cuentaParaVerArticulos}
        tasaValor={tasaValor}
        onClose={() => setCuentaParaVerArticulos(null)}
      />

      {/* Modal de Configuración de Recargo y Días */}
      {showConfigModal && puedeConfigurar && (
        <CxCConfigModal
          isOpen
          config={config}
          onSave={handleSaveConfig}
          onClose={() => setShowConfigModal(false)}
        />
      )}

      {/* Modal de Abonos y Cobro */}
      <CxCAbonoModal
        isOpen={!!cuentaParaAbonar}
        cuenta={cuentaParaAbonar}
        tasaValor={tasaValor}
        onRegistrarAbono={puede(rol, 'abono.registrar') ? handleRegistrarAbono : null}
        onEliminarAbono={puede(rol, 'abono.anular') ? handleEliminarAbono : null}
        onClose={() => setCuentaParaAbonar(null)}
      />
    </div>
  );
}
