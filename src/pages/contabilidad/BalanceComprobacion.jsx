import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HiOutlineBookOpen,
  HiOutlineScale,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineCalendar,
  HiOutlineMagnifyingGlass,
  HiOutlineDocumentArrowDown,
  HiOutlinePrinter,
  HiOutlineArrowPath,
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { exportarExcel, imprimirReporte } from '../../utils/reportes';
import { formatFecha as formatearFecha } from '../../utils/formatters';
import { fetchBalanceComprobacion } from '../../services/contabilidadService';

export default function BalanceComprobacion() {
  const [datos, setDatos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBalanceComprobacion({
        fechaDesde: fechaDesde || undefined,
        fechaHasta: fechaHasta || undefined,
      });
      setDatos(data);
    } catch (err) {
      toast.error('Error al cargar balance de comprobación: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [fechaDesde, fechaHasta]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatMoney = (amount) =>
    `$${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatBolivares = (amount) =>
    `Bs. ${Number(amount || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Filter by search
  const datosFiltrados = useMemo(() => {
    if (!searchTerm.trim()) return datos;
    const q = searchTerm.toLowerCase();
    return datos.filter(
      (c) => c.codigo.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q)
    );
  }, [datos, searchTerm]);

  // Totals
  const totales = useMemo(() => {
    let tDebe = 0, tHaber = 0, tSaldoDeudor = 0, tSaldoAcreedor = 0;
    let tDebeVes = 0, tHaberVes = 0, tSaldoDeudorVes = 0, tSaldoAcreedorVes = 0;

    for (const c of datosFiltrados) {
      tDebe += Math.round(c.totalDebe * 100);
      tHaber += Math.round(c.totalHaber * 100);
      tSaldoDeudor += Math.round(c.saldoDeudor * 100);
      tSaldoAcreedor += Math.round(c.saldoAcreedor * 100);
      tDebeVes += Math.round(c.totalDebeVes * 100);
      tHaberVes += Math.round(c.totalHaberVes * 100);
      tSaldoDeudorVes += Math.round(c.saldoDeudorVes * 100);
      tSaldoAcreedorVes += Math.round(c.saldoAcreedorVes * 100);
    }

    const sumasCuadran = tDebe === tHaber;
    const saldosCuadran = tSaldoDeudor === tSaldoAcreedor;

    return {
      totalDebe: tDebe / 100,
      totalHaber: tHaber / 100,
      totalSaldoDeudor: tSaldoDeudor / 100,
      totalSaldoAcreedor: tSaldoAcreedor / 100,
      totalDebeVes: tDebeVes / 100,
      totalHaberVes: tHaberVes / 100,
      totalSaldoDeudorVes: tSaldoDeudorVes / 100,
      totalSaldoAcreedorVes: tSaldoAcreedorVes / 100,
      sumasCuadran,
      saldosCuadran,
      balanceado: sumasCuadran && saldosCuadran,
    };
  }, [datosFiltrados]);

  // Modelo común para Excel e impresión
  const construirReporte = () => {
    const columnas = [
      { titulo: 'Código', clave: 'codigo', tipo: 'codigo' },
      { titulo: 'Cuenta', clave: 'nombre', tipo: 'texto', ancho: 40 },
      { titulo: 'Tipo', clave: 'tipo', tipo: 'texto' },
      { titulo: 'Debe', clave: 'totalDebe', tipo: 'usd' },
      { titulo: 'Haber', clave: 'totalHaber', tipo: 'usd' },
      { titulo: 'Saldo deudor', clave: 'saldoDeudor', tipo: 'usd' },
      { titulo: 'Saldo acreedor', clave: 'saldoAcreedor', tipo: 'usd' },
    ];
    const columnasBs = [
      { titulo: 'Código', clave: 'codigo', tipo: 'codigo' },
      { titulo: 'Cuenta', clave: 'nombre', tipo: 'texto', ancho: 40 },
      { titulo: 'Debe Bs', clave: 'totalDebeVes', tipo: 'bs' },
      { titulo: 'Haber Bs', clave: 'totalHaberVes', tipo: 'bs' },
      { titulo: 'Saldo deudor Bs', clave: 'saldoDeudorVes', tipo: 'bs' },
      { titulo: 'Saldo acreedor Bs', clave: 'saldoAcreedorVes', tipo: 'bs' },
    ];
    const periodo = `${fechaDesde ? formatearFecha(fechaDesde) : 'Inicio de operaciones'} al ${fechaHasta ? formatearFecha(fechaHasta) : 'día de hoy'}`;
    return {
      titulo: 'Balance de Comprobación',
      subtitulo: `Sumas y saldos del ${periodo}`,
      archivo: `Balance_de_Comprobacion_${fechaHasta || new Date().toLocaleDateString('en-CA')}`,
      resumen: [
        { etiqueta: 'Total debe', valor: totales.totalDebe, tipo: 'usd' },
        { etiqueta: 'Total haber', valor: totales.totalHaber, tipo: 'usd' },
        { etiqueta: 'Sumas iguales', valor: totales.sumasCuadran ? 'Sí' : 'No', tipo: 'texto' },
        { etiqueta: 'Saldos iguales', valor: totales.saldosCuadran ? 'Sí' : 'No', tipo: 'texto' },
      ],
      hojas: [
        {
          nombre: 'En USD', titulo: 'Balance de Comprobación (USD)',
          secciones: [{ columnas, filas: [...datosFiltrados, {
            codigo: '', nombre: 'Totales', tipo: '', totalDebe: totales.totalDebe, totalHaber: totales.totalHaber,
            saldoDeudor: totales.totalSaldoDeudor, saldoAcreedor: totales.totalSaldoAcreedor, _estilo: 'total' }] }],
        },
        {
          nombre: 'En Bs', titulo: 'Balance de Comprobación (Bs)',
          secciones: [{ columnas: columnasBs, filas: [...datosFiltrados, {
            codigo: '', nombre: 'Totales', totalDebeVes: totales.totalDebeVes, totalHaberVes: totales.totalHaberVes,
            saldoDeudorVes: totales.totalSaldoDeudorVes, saldoAcreedorVes: totales.totalSaldoAcreedorVes, _estilo: 'total' }] }],
        },
      ],
      calidad: {
        fuente: 'Libro mayor de todas las cuentas de detalle con movimiento.',
        confiabilidad: totales.sumasCuadran && totales.saldosCuadran ? 'Sumas y saldos iguales: la partida doble se cumple.' : 'Revise: sumas o saldos no cuadran.',
        oportunidad: 'Calculado al momento de la consulta.',
      },
    };
  };

  const handleExportCSV = async () => {
    if (datosFiltrados.length === 0) {
      toast.error('No hay datos para exportar');
      return;
    }
    await exportarExcel(construirReporte());
    toast.success('Balance de Comprobación exportado a Excel');
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Calculando Balance de Comprobación...</p>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="page__header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span className="badge badge--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <HiOutlineBookOpen /> Contabilidad General
            </span>
            {totales.balanceado ? (
              <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <HiOutlineCheckCircle /> Balance Cuadrado
              </span>
            ) : (
              <span className="badge badge--danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <HiOutlineExclamationTriangle /> Descuadrado
              </span>
            )}
          </div>
          <h1 className="page__title">Balance de Comprobación</h1>
          <p className="page__subtitle">
            Sumas y saldos de todas las cuentas con movimientos · {datosFiltrados.length} cuenta(s)
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn--secondary" onClick={loadData} title="Refrescar">
            <HiOutlineArrowPath /> Refrescar
          </button>
          <button className="btn btn--secondary" onClick={handleExportCSV} title="Exportar a Excel">
            <HiOutlineDocumentArrowDown /> Excel
          </button>
          <button className="btn btn--secondary" onClick={() => imprimirReporte(construirReporte())} title="Imprimir">
            <HiOutlinePrinter /> Imprimir
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid" style={{ marginBottom: '1.25rem' }}>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--primary">
            <HiOutlineScale />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Total Debe</span>
            <span className="stat-card__value" style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>{formatMoney(totales.totalDebe)}</span>
            <span className="stat-card__sub">{formatBolivares(totales.totalDebeVes)}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--info">
            <HiOutlineScale />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Total Haber</span>
            <span className="stat-card__value" style={{ color: 'var(--info)', fontSize: '1.2rem' }}>{formatMoney(totales.totalHaber)}</span>
            <span className="stat-card__sub">{formatBolivares(totales.totalHaberVes)}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--success">
            <HiOutlineCheckCircle />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Saldos Deudores</span>
            <span className="stat-card__value" style={{ color: '#22C55E', fontSize: '1.2rem' }}>{formatMoney(totales.totalSaldoDeudor)}</span>
            <span className="stat-card__sub">{formatBolivares(totales.totalSaldoDeudorVes)}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--warning">
            <HiOutlineCheckCircle />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Saldos Acreedores</span>
            <span className="stat-card__value" style={{ color: 'var(--warning)', fontSize: '1.2rem' }}>{formatMoney(totales.totalSaldoAcreedor)}</span>
            <span className="stat-card__sub">{formatBolivares(totales.totalSaldoAcreedorVes)}</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <input
              type="text"
              placeholder="Buscar cuenta por código o nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.85rem 0.6rem 2.2rem',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                minHeight: '44px',
              }}
            />
            <HiOutlineMagnifyingGlass
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <HiOutlineCalendar style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Desde:</span>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                style={{
                  padding: '0.4rem 0.6rem',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  minHeight: '40px',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Hasta:</span>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                style={{
                  padding: '0.4rem 0.6rem',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  minHeight: '40px',
                }}
              />
            </div>
            {(fechaDesde || fechaHasta) && (
              <button
                onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  minHeight: '44px',
                }}
              >
                Limpiar fechas
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(255, 255, 255, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HiOutlineScale style={{ color: 'var(--primary)' }} />
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Balance de Sumas y Saldos</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {totales.sumasCuadran ? (
              <span className="badge badge--success" style={{ fontSize: '0.7rem' }}>✓ Sumas iguales</span>
            ) : (
              <span className="badge badge--danger" style={{ fontSize: '0.7rem' }}>✗ Sumas no cuadran</span>
            )}
            {totales.saldosCuadran ? (
              <span className="badge badge--success" style={{ fontSize: '0.7rem' }}>✓ Saldos cuadran</span>
            ) : (
              <span className="badge badge--danger" style={{ fontSize: '0.7rem' }}>✗ Saldos no cuadran</span>
            )}
          </div>
        </div>

        {datosFiltrados.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <HiOutlineScale style={{ fontSize: '2.5rem', opacity: 0.4, marginBottom: '0.5rem' }} />
            <p style={{ fontWeight: 600 }}>Sin movimientos contables en el período</p>
            <p style={{ fontSize: '0.85rem' }}>Los asientos registrados en el Libro Diario se reflejarán aquí.</p>
          </div>
        ) : (
          <div className="table-container" style={{ margin: 0, overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, minWidth: '1100px' }}>
              <thead>
                <tr>
                  <th style={{ width: '100px' }}>Código</th>
                  <th>Cuenta Contable</th>
                  <th style={{ width: '80px', textAlign: 'center' }}>Tipo</th>
                  <th style={{ width: '130px', textAlign: 'right' }}>Debe (USD)</th>
                  <th style={{ width: '130px', textAlign: 'right' }}>Haber (USD)</th>
                  <th style={{ width: '130px', textAlign: 'right' }}>Saldo Deudor</th>
                  <th style={{ width: '130px', textAlign: 'right' }}>Saldo Acreedor</th>
                </tr>
              </thead>
              <tbody>
                {datosFiltrados.map((cuenta) => (
                  <tr key={cuenta.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--primary)' }}>
                      {cuenta.codigo}
                    </td>
                    <td>
                      <div>
                        <span style={{ fontWeight: 500 }}>{cuenta.nombre}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                          {cuenta.naturaleza}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${
                        cuenta.tipo === 'ACTIVO' ? 'badge--info' :
                        cuenta.tipo === 'PASIVO' ? 'badge--warning' :
                        cuenta.tipo === 'PATRIMONIO' ? 'badge--primary' :
                        cuenta.tipo === 'INGRESO' ? 'badge--success' :
                        cuenta.tipo === 'GASTO' ? 'badge--danger' :
                        'badge--ghost'
                      }`} style={{ fontSize: '0.7rem' }}>
                        {cuenta.tipo}
                      </span>
                    </td>
                    <td style={{
                      textAlign: 'right',
                      fontWeight: cuenta.totalDebe > 0 ? 600 : 400,
                      color: cuenta.totalDebe > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}>
                      {cuenta.totalDebe > 0 ? formatMoney(cuenta.totalDebe) : '—'}
                    </td>
                    <td style={{
                      textAlign: 'right',
                      fontWeight: cuenta.totalHaber > 0 ? 600 : 400,
                      color: cuenta.totalHaber > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}>
                      {cuenta.totalHaber > 0 ? formatMoney(cuenta.totalHaber) : '—'}
                    </td>
                    <td style={{
                      textAlign: 'right',
                      fontWeight: cuenta.saldoDeudor > 0 ? 700 : 400,
                      color: cuenta.saldoDeudor > 0 ? '#22C55E' : 'var(--text-muted)',
                    }}>
                      {cuenta.saldoDeudor > 0 ? formatMoney(cuenta.saldoDeudor) : '—'}
                    </td>
                    <td style={{
                      textAlign: 'right',
                      fontWeight: cuenta.saldoAcreedor > 0 ? 700 : 400,
                      color: cuenta.saldoAcreedor > 0 ? 'var(--warning)' : 'var(--text-muted)',
                    }}>
                      {cuenta.saldoAcreedor > 0 ? formatMoney(cuenta.saldoAcreedor) : '—'}
                    </td>
                  </tr>
                ))}

                {/* Totals row */}
                <tr style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  fontWeight: 700,
                  borderTop: '2px solid var(--border)',
                }}>
                  <td colSpan="3" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                    TOTALES ({datosFiltrados.length} cuentas):
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--primary)' }}>
                    {formatMoney(totales.totalDebe)}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--info)' }}>
                    {formatMoney(totales.totalHaber)}
                  </td>
                  <td style={{ textAlign: 'right', color: '#22C55E' }}>
                    {formatMoney(totales.totalSaldoDeudor)}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--warning)' }}>
                    {formatMoney(totales.totalSaldoAcreedor)}
                  </td>
                </tr>

                {/* Difference row */}
                <tr style={{ background: totales.balanceado ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
                  <td colSpan="3" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    DIFERENCIA:
                  </td>
                  <td colSpan="2" style={{
                    textAlign: 'center',
                    fontWeight: 700,
                    color: totales.sumasCuadran ? '#22C55E' : '#EF4444',
                  }}>
                    {totales.sumasCuadran ? '✓ Cuadrado' : formatMoney(Math.abs(totales.totalDebe - totales.totalHaber))}
                  </td>
                  <td colSpan="2" style={{
                    textAlign: 'center',
                    fontWeight: 700,
                    color: totales.saldosCuadran ? '#22C55E' : '#EF4444',
                  }}>
                    {totales.saldosCuadran ? '✓ Cuadrado' : formatMoney(Math.abs(totales.totalSaldoDeudor - totales.totalSaldoAcreedor))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
