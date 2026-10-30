import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HiOutlineDocumentChartBar,
  HiOutlineScale,
  HiOutlineArrowTrendingUp,
  HiOutlineArrowTrendingDown,
  HiOutlineCalendar,
  HiOutlinePrinter,
  HiOutlineDocumentArrowDown,
  HiOutlineArrowPath,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineBanknotes,
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { fetchEstadosFinancieros } from '../../services/contabilidadService';
import { exportarExcel, imprimirReporte } from '../../utils/reportes';
import { formatFecha as formatearFecha } from '../../utils/formatters';

export default function EstadosFinancieros() {
  const [activeTab, setActiveTab] = useState('resultados'); // 'resultados' | 'balance'
  const [moneda, setMoneda] = useState('USD'); // 'USD' | 'VES'
  const [loading, setLoading] = useState(true);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [data, setData] = useState({
    estadoResultados: {
      ingresos: [],
      costos: [],
      gastos: [],
      totalIngresos: 0,
      totalCostos: 0,
      utilidadBruta: 0,
      totalGastos: 0,
      utilidadNeta: 0,
      totalIngresosVes: 0,
      totalCostosVes: 0,
      utilidadBrutaVes: 0,
      totalGastosVes: 0,
      utilidadNetaVes: 0,
    },
    balanceGeneral: {
      activos: [],
      pasivos: [],
      patrimonio: [],
      totalActivos: 0,
      totalPasivos: 0,
      totalPatrimonioBase: 0,
      totalPatrimonio: 0,
      utilidadEjercicio: 0,
      totalPasivoPatrimonio: 0,
      totalActivosVes: 0,
      totalPasivosVes: 0,
      totalPatrimonioBaseVes: 0,
      totalPatrimonioVes: 0,
      utilidadEjercicioVes: 0,
      totalPasivoPatrimonioVes: 0,
      cuadrado: true,
      diferencia: 0,
    },
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchEstadosFinancieros({
        fechaDesde: fechaDesde || undefined,
        fechaHasta: fechaHasta || undefined,
      });
      setData(res);
    } catch (err) {
      toast.error('Error al generar estados financieros: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [fechaDesde, fechaHasta]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Formateadores
  const fmt = useCallback((val) => {
    const num = Number(val || 0);
    if (moneda === 'VES') {
      return `Bs. ${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, [moneda]);

  const esVes = moneda === 'VES';
  const er = data.estadoResultados;
  const bg = data.balanceGeneral;

  // Valores según moneda
  const tIngresos = esVes ? er.totalIngresosVes : er.totalIngresos;
  const tCostos = esVes ? er.totalCostosVes : er.totalCostos;
  const uBruta = esVes ? er.utilidadBrutaVes : er.utilidadBruta;
  const tGastos = esVes ? er.totalGastosVes : er.totalGastos;
  const uNeta = esVes ? er.utilidadNetaVes : er.utilidadNeta;

  const tActivos = esVes ? bg.totalActivosVes : bg.totalActivos;
  const tPasivos = esVes ? bg.totalPasivosVes : bg.totalPasivos;
  const tPatrimonio = esVes ? bg.totalPatrimonioVes : bg.totalPatrimonio;
  const tPasivoPatrimonio = esVes ? bg.totalPasivoPatrimonioVes : bg.totalPasivoPatrimonio;
  const uEjercicio = esVes ? bg.utilidadEjercicioVes : bg.utilidadEjercicio;

  // Filtros rápidos
  const setMesActual = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    setFechaDesde(`${y}-${m}-01`);
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    setFechaHasta(`${y}-${m}-${lastDay}`);
  };

  const setAnoActual = () => {
    const y = new Date().getFullYear();
    setFechaDesde(`${y}-01-01`);
    setFechaHasta(`${y}-12-31`);
  };

  const limpiarFiltros = () => {
    setFechaDesde('');
    setFechaHasta('');
  };

  // Modelo común para Excel e impresión
  const construirReporte = () => {
    const sal = (c) => (esVes ? c.saldoVes : c.saldo);
    const cuentas = (lista) => lista.map((c) => ({ codigo: c.codigo, cuenta: c.nombre, monto: sal(c) }));
    const columnas = [
      { titulo: 'Código', clave: 'codigo', tipo: 'codigo', ancho: 13 },
      { titulo: 'Cuenta', clave: 'cuenta', tipo: 'texto', ancho: 46 },
      { titulo: `Monto (${esVes ? 'Bs' : 'USD'})`, clave: 'monto', tipo: 'monto', ancho: 20 },
    ];
    const total = (texto, monto, estilo = 'subtotal') => ({ codigo: '', cuenta: texto, monto, _estilo: estilo });
    const periodo = `${fechaDesde ? formatearFecha(fechaDesde) : 'Inicio de operaciones'} al ${fechaHasta ? formatearFecha(fechaHasta) : 'día de hoy'}`;
    const calidad = {
      fuente: 'Libro mayor (asientos contables generados por la operación, inmutables).',
      confiabilidad: bg.cuadrado ? 'Partida doble verificada: Activo = Pasivo + Patrimonio.' : `Descuadre de ${fmt(bg.diferencia)}.`,
      oportunidad: 'Calculado en el momento de la consulta con los datos al día.',
    };

    if (activeTab === 'resultados') {
      return {
        titulo: 'Estado de Resultados',
        subtitulo: `Del ${periodo}`,
        moneda,
        archivo: `Estado_de_Resultados_${fechaHasta || new Date().toLocaleDateString('en-CA')}_${moneda}`,
        resumen: [
          { etiqueta: 'Ingresos', valor: tIngresos },
          { etiqueta: 'Utilidad bruta', valor: uBruta },
          { etiqueta: 'Gastos', valor: tGastos },
          { etiqueta: 'Utilidad neta', valor: uNeta, detalle: tIngresos ? `${((uNeta / tIngresos) * 100).toFixed(1)} % de margen neto` : '' },
        ],
        secciones: [
          { titulo: '1. Ingresos', columnas, filas: [...cuentas(er.ingresos), total('Total ingresos', tIngresos)] },
          { titulo: '2. Costos de venta', columnas, filas: [...cuentas(er.costos), total('Total costos', tCostos), total('Utilidad bruta (ingresos − costos)', uBruta)] },
          { titulo: '3. Gastos operacionales y financieros', columnas, filas: [...cuentas(er.gastos), total('Total gastos', tGastos), total('Utilidad neta del período', uNeta, 'total')] },
        ],
        calidad,
      };
    }
    return {
      titulo: 'Balance General',
      subtitulo: `Al ${fechaHasta ? formatearFecha(fechaHasta) : new Date().toLocaleDateString('es-VE')}`,
      moneda,
      archivo: `Balance_General_${fechaHasta || new Date().toLocaleDateString('en-CA')}_${moneda}`,
      resumen: [
        { etiqueta: 'Total activos', valor: tActivos },
        { etiqueta: 'Total pasivos', valor: tPasivos },
        { etiqueta: 'Patrimonio', valor: tPatrimonio },
        { etiqueta: 'Ecuación contable', valor: bg.cuadrado ? 'Cuadrada' : 'Descuadrada', tipo: 'texto' },
      ],
      secciones: [
        { titulo: 'Activos', columnas, filas: [...cuentas(bg.activos), total('Total activos', tActivos, 'total')] },
        { titulo: 'Pasivos', columnas, filas: [...cuentas(bg.pasivos), total('Total pasivos', tPasivos)] },
        {
          titulo: 'Patrimonio',
          columnas,
          filas: [...cuentas(bg.patrimonio), total('Resultado del ejercicio en curso', uEjercicio, 'grupo'),
            total('Total patrimonio', tPatrimonio), total('Total pasivo + patrimonio', tPasivoPatrimonio, 'total')],
        },
      ],
      calidad,
    };
  };

  const exportarExcelReporte = async () => {
    try {
      await exportarExcel(construirReporte());
      toast.success('Excel generado');
    } catch (e) {
      toast.error('No se pudo generar el Excel: ' + e.message);
    }
  };

  const imprimir = () => imprimirReporte(construirReporte());

  return (
    <div className="page" style={{ paddingBottom: 'env(safe-area-inset-bottom, 2rem)' }}>
      {/* Encabezado */}
      <div className="page__header flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: 'var(--primary-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
                flexShrink: 0,
              }}
            >
              <HiOutlineDocumentChartBar size={24} />
            </div>
            <div>
              <h1 className="page__title text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Estados Financieros
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Balance General y Estado de Resultados consolidado
              </p>
            </div>
          </div>
        </div>

        {/* Acciones principales / Selector de Moneda */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Moneda switch */}
          <div
            className="flex items-center gap-1 p-1 rounded-xl"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => setMoneda('USD')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
              style={{
                minHeight: 38,
                backgroundColor: moneda === 'USD' ? 'var(--primary)' : 'transparent',
                color: moneda === 'USD' ? '#000' : 'var(--text-secondary)',
              }}
            >
              USD ($)
            </button>
            <button
              type="button"
              onClick={() => setMoneda('VES')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
              style={{
                minHeight: 38,
                backgroundColor: moneda === 'VES' ? 'var(--primary)' : 'transparent',
                color: moneda === 'VES' ? '#000' : 'var(--text-secondary)',
              }}
            >
              VES (Bs.)
            </button>
          </div>

          <button
            type="button"
            onClick={exportarExcelReporte}
            className="btn btn--secondary flex items-center justify-center gap-1.5 text-xs"
            style={{ minHeight: 44, padding: '0 14px' }}
          >
            <HiOutlineDocumentArrowDown size={18} />
            <span className="hidden sm:inline">Excel</span>
          </button>

          <button
            type="button"
            onClick={imprimir}
            className="btn btn--secondary flex items-center justify-center gap-1.5 text-xs"
            style={{ minHeight: 44, padding: '0 14px' }}
          >
            <HiOutlinePrinter size={18} />
            <span className="hidden sm:inline">Imprimir</span>
          </button>

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="btn btn--secondary flex items-center justify-center gap-1.5 text-xs"
            style={{ minHeight: 44, padding: '0 14px' }}
            title="Recargar datos"
          >
            <HiOutlineArrowPath size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs Selector */}
      <div className="flex border-b mb-6 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={() => setActiveTab('resultados')}
          className="flex items-center gap-2 pb-3 px-4 font-semibold text-sm transition relative"
          style={{
            minHeight: 48,
            color: activeTab === 'resultados' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'resultados' ? '2px solid var(--primary)' : '2px solid transparent',
            whiteSpace: 'nowrap',
          }}
        >
          <HiOutlineArrowTrendingUp size={18} />
          <span>Estado de Resultados (P&L)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('balance')}
          className="flex items-center gap-2 pb-3 px-4 font-semibold text-sm transition relative"
          style={{
            minHeight: 48,
            color: activeTab === 'balance' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'balance' ? '2px solid var(--primary)' : '2px solid transparent',
            whiteSpace: 'nowrap',
          }}
        >
          <HiOutlineScale size={18} />
          <span>Balance General</span>
          {bg.cuadrado ? (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}
            >
              Cuadrado
            </span>
          ) : (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
            >
              Descuadre
            </span>
          )}
        </button>
      </div>

      {/* Barra de Filtros de Período */}
      <div
        className="card mb-6 p-4 rounded-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
              Desde:
            </label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="form-control text-sm w-full"
              style={{
                minHeight: 44,
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '0 10px',
              }}
            />
          </div>
          <div className="flex items-center gap-2 flex-1">
            <label className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
              Hasta:
            </label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="form-control text-sm w-full"
              style={{
                minHeight: 44,
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '0 10px',
              }}
            />
          </div>
        </div>

        {/* Botones de rango predeterminado */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          <button
            type="button"
            onClick={setMesActual}
            className="btn btn--secondary text-xs whitespace-nowrap"
            style={{ minHeight: 44, padding: '0 12px' }}
          >
            Este Mes
          </button>
          <button
            type="button"
            onClick={setAnoActual}
            className="btn btn--secondary text-xs whitespace-nowrap"
            style={{ minHeight: 44, padding: '0 12px' }}
          >
            Este Año
          </button>
          <button
            type="button"
            onClick={limpiarFiltros}
            className="btn btn--secondary text-xs whitespace-nowrap"
            style={{ minHeight: 44, padding: '0 12px' }}
          >
            Histórico Completo
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="loading-spinner mb-4" />
          <p style={{ color: 'var(--text-secondary)' }}>Generando estados financieros consolidados...</p>
        </div>
      ) : activeTab === 'resultados' ? (
        /* ================= VISTA ESTADO DE RESULTADOS ================= */
        <div>
          {/* KPI Cards de Resultados */}
          <div className="dashboard-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="kpi-card p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Total Ingresos
                </span>
                <span className="p-2 rounded-lg" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}>
                  <HiOutlineArrowTrendingUp size={20} />
                </span>
              </div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {fmt(tIngresos)}
              </div>
              <span className="text-xs" style={{ color: 'var(--success)' }}>Ventas y Otros Ingresos</span>
            </div>

            <div className="kpi-card p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Costos de Ventas
                </span>
                <span className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(249, 115, 22, 0.15)', color: '#F97316' }}>
                  <HiOutlineBanknotes size={20} />
                </span>
              </div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {fmt(tCostos)}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Costo Operativo Directo</span>
            </div>

            <div className="kpi-card p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Gastos Operativos
                </span>
                <span className="p-2 rounded-lg" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
                  <HiOutlineArrowTrendingDown size={20} />
                </span>
              </div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {fmt(tGastos)}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Administración y Ventas</span>
            </div>

            <div
              className="kpi-card p-4 rounded-xl"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: uNeta >= 0 ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Utilidad Neta
                </span>
                <span
                  className="p-2 rounded-lg"
                  style={{
                    backgroundColor: uNeta >= 0 ? 'var(--success-bg)' : 'var(--danger-bg)',
                    color: uNeta >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {uNeta >= 0 ? <HiOutlineCheckCircle size={20} /> : <HiOutlineExclamationTriangle size={20} />}
                </span>
              </div>
              <div
                className="text-xl font-bold"
                style={{ color: uNeta >= 0 ? 'var(--success)' : 'var(--danger)' }}
              >
                {fmt(uNeta)}
              </div>
              <span className="text-xs font-semibold" style={{ color: uNeta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {tIngresos > 0 ? `${((uNeta / tIngresos) * 100).toFixed(1)}% Margen Neto` : 'Resultado Neto'}
              </span>
            </div>
          </div>

          {/* Desglose Detallado del Estado de Resultados */}
          <div className="card rounded-xl p-5 mb-6" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Estructura Financiera (P&L)
            </h2>

            {/* SECCIÓN INGRESOS */}
            <div className="mb-6">
              <div
                className="flex items-center justify-between p-3 rounded-lg mb-2"
                style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid var(--success)' }}
              >
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  1. INGRESOS OPERACIONALES
                </span>
                <span className="font-bold text-sm" style={{ color: 'var(--success)' }}>
                  {fmt(tIngresos)}
                </span>
              </div>
              {er.ingresos.length === 0 ? (
                <p className="text-xs italic py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                  No se registraron movimientos en cuentas de ingresos.
                </p>
              ) : (
                <div className="space-y-1 pl-2">
                  {er.ingresos.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between py-2 px-3 rounded hover:bg-[var(--bg-hover)] transition text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          {c.codigo}
                        </span>
                        <span style={{ color: 'var(--text-primary)' }}>{c.nombre}</span>
                      </div>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {fmt(esVes ? c.saldoVes : c.saldo)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SECCIÓN COSTOS */}
            <div className="mb-6">
              <div
                className="flex items-center justify-between p-3 rounded-lg mb-2"
                style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid #F97316' }}
              >
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  2. COSTOS DE OPERACIÓN Y VENTAS
                </span>
                <span className="font-bold text-sm" style={{ color: '#F97316' }}>
                  {fmt(tCostos)}
                </span>
              </div>
              {er.costos.length === 0 ? (
                <p className="text-xs italic py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                  No se registraron movimientos en cuentas de costos.
                </p>
              ) : (
                <div className="space-y-1 pl-2">
                  {er.costos.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between py-2 px-3 rounded hover:bg-[var(--bg-hover)] transition text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          {c.codigo}
                        </span>
                        <span style={{ color: 'var(--text-primary)' }}>{c.nombre}</span>
                      </div>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {fmt(esVes ? c.saldoVes : c.saldo)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SUBTOTAL: UTILIDAD BRUTA */}
            <div
              className="flex items-center justify-between p-3 rounded-lg mb-6"
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              <span className="font-bold text-sm" style={{ color: 'var(--info)' }}>
                = UTILIDAD BRUTA (Ingresos - Costos)
              </span>
              <span className="font-bold text-base" style={{ color: 'var(--info)' }}>
                {fmt(uBruta)}
              </span>
            </div>

            {/* SECCIÓN GASTOS */}
            <div className="mb-6">
              <div
                className="flex items-center justify-between p-3 rounded-lg mb-2"
                style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid var(--danger)' }}
              >
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  3. GASTOS DE OPERACIÓN Y ADMINISTRACIÓN
                </span>
                <span className="font-bold text-sm" style={{ color: 'var(--danger)' }}>
                  {fmt(tGastos)}
                </span>
              </div>
              {er.gastos.length === 0 ? (
                <p className="text-xs italic py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                  No se registraron movimientos en cuentas de gastos.
                </p>
              ) : (
                <div className="space-y-1 pl-2">
                  {er.gastos.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between py-2 px-3 rounded hover:bg-[var(--bg-hover)] transition text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          {c.codigo}
                        </span>
                        <span style={{ color: 'var(--text-primary)' }}>{c.nombre}</span>
                      </div>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {fmt(esVes ? c.saldoVes : c.saldo)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* TOTAL FINAL: UTILIDAD NETA */}
            <div
              className="flex items-center justify-between p-4 rounded-xl"
              style={{
                backgroundColor: uNeta >= 0 ? 'var(--primary-bg)' : 'var(--danger-bg)',
                border: uNeta >= 0 ? '2px solid var(--primary)' : '2px solid var(--danger)',
              }}
            >
              <div>
                <span className="block font-bold text-base" style={{ color: uNeta >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                  UTILIDAD NETA DEL EJERCICIO
                </span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Utilidad Bruta - Gastos Totales
                </span>
              </div>
              <div className="text-xl md:text-2xl font-black" style={{ color: uNeta >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                {fmt(uNeta)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ================= VISTA BALANCE GENERAL ================= */
        <div>
          {/* KPI Cards de Balance */}
          <div className="dashboard-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="kpi-card p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Total Activos
                </span>
                <span className="p-2 rounded-lg" style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info)' }}>
                  <HiOutlineBanknotes size={20} />
                </span>
              </div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {fmt(tActivos)}
              </div>
              <span className="text-xs" style={{ color: 'var(--info)' }}>Bienes y Derechos</span>
            </div>

            <div className="kpi-card p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Total Pasivos
                </span>
                <span className="p-2 rounded-lg" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
                  <HiOutlineScale size={20} />
                </span>
              </div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {fmt(tPasivos)}
              </div>
              <span className="text-xs" style={{ color: 'var(--warning)' }}>Deudas y Obligaciones</span>
            </div>

            <div className="kpi-card p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Total Patrimonio
                </span>
                <span className="p-2 rounded-lg" style={{ backgroundColor: 'var(--primary-bg)', color: 'var(--primary)' }}>
                  <HiOutlineArrowTrendingUp size={20} />
                </span>
              </div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {fmt(tPatrimonio)}
              </div>
              <span className="text-xs" style={{ color: 'var(--primary)' }}>Capital + Utilidades</span>
            </div>

            <div
              className="kpi-card p-4 rounded-xl"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: bg.cuadrado ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Ecuación Contable
                </span>
                <span
                  className="p-2 rounded-lg"
                  style={{
                    backgroundColor: bg.cuadrado ? 'var(--success-bg)' : 'var(--danger-bg)',
                    color: bg.cuadrado ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {bg.cuadrado ? <HiOutlineCheckCircle size={20} /> : <HiOutlineExclamationTriangle size={20} />}
                </span>
              </div>
              <div
                className="text-lg font-bold"
                style={{ color: bg.cuadrado ? 'var(--success)' : 'var(--danger)' }}
              >
                {bg.cuadrado ? 'Balance Cuadrado' : 'Descuadrado'}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Activo = Pasivo + Patrimonio
              </span>
            </div>
          </div>

          {/* Desglose Detallado de Balance General: 2 Columnas en escritorio, 1 en móvil */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* COLUMNA 1: ACTIVOS */}
            <div className="card rounded-xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div
                className="flex items-center justify-between p-3 rounded-lg mb-4"
                style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid var(--info)' }}
              >
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  ACTIVOS
                </span>
                <span className="font-bold text-sm" style={{ color: 'var(--info)' }}>
                  {fmt(tActivos)}
                </span>
              </div>

              {bg.activos.length === 0 ? (
                <p className="text-xs italic py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                  No se registraron cuentas de activos con saldo.
                </p>
              ) : (
                <div className="space-y-1 mb-6">
                  {bg.activos.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between py-2 px-3 rounded hover:bg-[var(--bg-hover)] transition text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          {c.codigo}
                        </span>
                        <span style={{ color: 'var(--text-primary)' }}>{c.nombre}</span>
                      </div>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {fmt(esVes ? c.saldoVes : c.saldo)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Total Activo */}
              <div
                className="flex items-center justify-between p-3 rounded-lg"
                style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              >
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  TOTAL ACTIVOS
                </span>
                <span className="font-bold text-base" style={{ color: 'var(--info)' }}>
                  {fmt(tActivos)}
                </span>
              </div>
            </div>

            {/* COLUMNA 2: PASIVOS Y PATRIMONIO */}
            <div className="card rounded-xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              {/* PASIVOS */}
              <div
                className="flex items-center justify-between p-3 rounded-lg mb-4"
                style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid var(--warning)' }}
              >
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  PASIVOS
                </span>
                <span className="font-bold text-sm" style={{ color: 'var(--warning)' }}>
                  {fmt(tPasivos)}
                </span>
              </div>

              {bg.pasivos.length === 0 ? (
                <p className="text-xs italic py-2 text-center" style={{ color: 'var(--text-muted)' }}>
                  No hay pasivos registrados con saldo.
                </p>
              ) : (
                <div className="space-y-1 mb-4">
                  {bg.pasivos.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between py-2 px-3 rounded hover:bg-[var(--bg-hover)] transition text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          {c.codigo}
                        </span>
                        <span style={{ color: 'var(--text-primary)' }}>{c.nombre}</span>
                      </div>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {fmt(esVes ? c.saldoVes : c.saldo)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* PATRIMONIO */}
              <div
                className="flex items-center justify-between p-3 rounded-lg mb-4 mt-6"
                style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid var(--primary)' }}
              >
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  PATRIMONIO NETO
                </span>
                <span className="font-bold text-sm" style={{ color: 'var(--primary)' }}>
                  {fmt(tPatrimonio)}
                </span>
              </div>

              <div className="space-y-1 mb-4">
                {bg.patrimonio.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-2 px-3 rounded hover:bg-[var(--bg-hover)] transition text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                        {c.codigo}
                      </span>
                      <span style={{ color: 'var(--text-primary)' }}>{c.nombre}</span>
                    </div>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {fmt(esVes ? c.saldoVes : c.saldo)}
                    </span>
                  </div>
                ))}
                {/* Línea de Utilidad/Pérdida del Ejercicio */}
                <div
                  className="flex items-center justify-between py-2 px-3 rounded text-xs font-semibold"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>
                    Resultado del Ejercicio Actual (P&L)
                  </span>
                  <span style={{ color: uEjercicio >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {fmt(uEjercicio)}
                  </span>
                </div>
              </div>

              {/* TOTAL PASIVO + PATRIMONIO */}
              <div
                className="flex items-center justify-between p-3 rounded-lg mt-6"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                }}
              >
                <div>
                  <span className="block font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                    TOTAL PASIVO + PATRIMONIO
                  </span>
                  <span className="text-[11px]" style={{ color: bg.cuadrado ? 'var(--success)' : 'var(--danger)' }}>
                    {bg.cuadrado ? '✓ Coincide exactamente con el Activo' : `Descuadre: ${fmt(bg.diferencia)}`}
                  </span>
                </div>
                <span className="font-bold text-base" style={{ color: 'var(--primary)' }}>
                  {fmt(tPasivoPatrimonio)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
