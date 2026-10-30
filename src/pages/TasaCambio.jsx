import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatTasa, formatFecha, parseFecha } from '../utils/formatters';
import { fetchTasaBCV, sincronizarTasaBCV } from '../services/bcvService';
import toast from 'react-hot-toast';
import Pagination from '../components/common/Pagination';
import {
  HiOutlinePlus,
  HiOutlineCurrencyDollar,
  HiOutlineArrowPath,
  HiOutlineCheckBadge,
  HiOutlineGlobeAlt,
} from 'react-icons/hi2';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function TasaCambio() {
  const { profile } = useAuth();
  const esAdmin = profile?.rol === 'admin';
  const [tasas, setTasas] = useState([]);
  const [bitacora, setBitacora] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncingBCV, setSyncingBCV] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [nuevaTasa, setNuevaTasa] = useState('');
  const [fechaManual, setFechaManual] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [bcvData, setBcvData] = useState(null);

  useEffect(() => {
    loadTasas();
    checkBCVRate();
    window.addEventListener('arluc_tasa_actualizada', loadTasas);
    return () => window.removeEventListener('arluc_tasa_actualizada', loadTasas);
  }, []);

  async function checkBCVRate() {
    try {
      const data = await fetchTasaBCV();
      setBcvData(data);
    } catch (e) {
      console.warn('Could not auto-fetch BCV:', e);
    }
  }

  async function loadTasas() {
    setLoading(true);
    const [{ data, error }, { data: sync }] = await Promise.all([
      supabase
        .from('tasas_cambio')
        .select('*, usuarios!tasas_cambio_registrado_por_fkey(nombre_completo)')
        .order('fecha_registro', { ascending: false })
        .limit(90),
      supabase.from('sincronizaciones_bcv').select('*').order('fecha', { ascending: false }).limit(8),
    ]);

    if (error) {
      console.error('Error loading tasas:', error);
    }
    setTasas(data || []);
    setBitacora(sync || []);
    setLoading(false);
  }

  function informarResultado(resultado) {
    const mensajes = {
      CREADA: `Tasa registrada: ${formatTasa(resultado.tasa_usd)}`,
      ACTUALIZADA: `Tasa actualizada a ${formatTasa(resultado.tasa_usd)}`,
      SIN_CAMBIOS: 'La tasa ya estaba al día',
      RECIENTE: 'La tasa se sincronizó hace menos de un minuto',
    };
    if (mensajes[resultado.estado]) toast.success(mensajes[resultado.estado]);
    else toast.error(resultado.detalle || 'No se pudo actualizar la tasa');
  }

  // El servidor consulta la API, valida la variación y registra la tasa.
  async function handleSincronizarBCV() {
    setSyncingBCV(true);
    try {
      informarResultado(await sincronizarTasaBCV());
      await Promise.all([loadTasas(), checkBCVRate()]);
    } catch (error) {
      toast.error(`Error al sincronizar BCV: ${error.message}`);
    } finally {
      setSyncingBCV(false);
    }
  }

  // Corrección manual (solo admin), validada por el servidor.
  async function handleSubmit(e) {
    e.preventDefault();
    if (!nuevaTasa || parseFloat(nuevaTasa) <= 0) {
      toast.error('Ingrese una tasa válida');
      return;
    }
    const { data, error } = await supabase.rpc('registrar_tasa_manual', {
      p_fecha: fechaManual,
      p_usd: parseFloat(nuevaTasa),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    informarResultado(data);
    setShowForm(false);
    setNuevaTasa('');
    loadTasas();
    window.dispatchEvent(new CustomEvent('arluc_tasa_actualizada'));
  }

  const hoyFecha = new Date().toLocaleDateString('en-CA');
  const tasaHoy = tasas.find(t => t.fecha_registro === hoyFecha);
  const tasaAnterior = tasas.find(t => t.fecha_registro < hoyFecha);
  const chartData = [...tasas].reverse().map(t => ({
    fecha: parseFecha(t.fecha_registro).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }),
    tasa: parseFloat(t.tasa_usd_bs),
  }));

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Cargando tasas...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Tasa de Cambio</h1>
          <p className="page__subtitle">La tasa oficial se sincroniza sola desde el BCV cada 30 minutos y al abrir el sistema</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn--outline"
            onClick={handleSincronizarBCV}
            disabled={syncingBCV}
            title="Consumir API del Banco Central de Venezuela"
          >
            <HiOutlineArrowPath className={syncingBCV ? 'spin' : ''} />
            {syncingBCV ? 'Sincronizando...' : 'Sincronizar con BCV'}
          </button>
          {esAdmin && (
            <button className="btn btn--primary" onClick={() => { setNuevaTasa(tasaHoy ? tasaHoy.tasa_usd_bs : (bcvData?.tasa_usd || '')); setShowForm(true); }}>
              <HiOutlinePlus /> Corrección manual
            </button>
          )}
        </div>
      </div>

      {/* BCV Live Status banner */}
      {bcvData && (
        <div className="card" style={{ marginBottom: '1.5rem', background: 'linear-gradient(135deg, var(--primary-bg) 0%, var(--bg-card) 100%)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', fontSize: '1.25rem' }}>
                <HiOutlineGlobeAlt />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>API Banco Central de Venezuela</span>
                  <span className="badge badge--success" style={{ fontSize: '0.75rem' }}>En Línea</span>
                </div>
                <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Última actualización oficial: {bcvData.updated_at ? formatFecha(bcvData.updated_at, true) : 'Reciente'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tasa Oficial BCV</div>
                <div style={{ fontSize: '1.35rem', fontWeight: '800', color: '#22C55E' }}>
                  {formatTasa(bcvData.tasa_usd)}
                </div>
              </div>
              {bcvData.tasa_eur > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Euro BCV</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: '700', color: '#E5E5E5' }}>
                    {formatTasa(bcvData.tasa_eur)}
                  </div>
                </div>
              )}
              <button
                className="btn btn--primary btn--sm"
                onClick={handleSincronizarBCV}
                disabled={syncingBCV}
              >
                Sincronizar ahora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Current Rate Card */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        <div className={`stat-card ${!tasaHoy ? 'stat-card--warning' : ''}`}>
          <div className="stat-card__icon stat-card__icon--primary">
            <HiOutlineCurrencyDollar />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Tasa del Sistema Hoy</span>
            <span className="stat-card__value">
              {tasaHoy ? `${formatTasa(tasaHoy.tasa_usd_bs)}` : '⚠️ Sin registrar'}
            </span>
            <span className="stat-card__sub">{formatFecha(new Date())}{tasaHoy && ` · ${tasaHoy.fuente}`}</span>
          </div>
        </div>

        {tasaAnterior && (
          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--info">
              <HiOutlineCurrencyDollar />
            </div>
            <div className="stat-card__content">
              <span className="stat-card__label">Tasa Anterior</span>
              <span className="stat-card__value">{formatTasa(tasaAnterior.tasa_usd_bs)}</span>
              <span className="stat-card__sub">{formatFecha(tasaAnterior.fecha_registro)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 className="card__title">Historial de Tasas</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorTasa" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="fecha" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
              <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickFormatter={v => `Bs ${v}`} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }} labelStyle={{ color: 'var(--text-primary)' }} formatter={(v) => [`Bs ${v}`, 'Tasa']} />
              <Area type="monotone" dataKey="tasa" stroke="#22C55E" fill="url(#colorTasa)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* History Table */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 className="card__title">Registro Histórico Inmutable</h3>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tasa (Bs/$)</th>
                <th>Fuente</th>
                <th>Registrado por</th>
                <th>Equivalencia $100</th>
              </tr>
            </thead>
            <tbody>
              {tasas.slice((currentPage - 1) * 20, currentPage * 20).map(t => (
                <tr key={t.id}>
                  <td>{formatFecha(t.fecha_registro)}</td>
                  <td><strong>{formatTasa(t.tasa_usd_bs)}</strong></td>
                  <td>{t.fuente}</td>
                  <td>{t.usuarios?.nombre_completo || 'Sistema (automático)'}</td>
                  <td>Bs {(parseFloat(t.tasa_usd_bs) * 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {tasas.length === 0 && <tr><td colSpan="5" className="table__empty">Sin registros</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={tasas.length}
          pageSize={20}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Bitácora de sincronización */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 className="card__title">Bitácora de sincronización automática</h3>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr><th>Momento</th><th>Origen</th><th>Resultado</th><th>Tasa</th><th>Detalle</th></tr>
            </thead>
            <tbody>
              {bitacora.map(b => (
                <tr key={b.id}>
                  <td>{formatFecha(b.fecha, true)}</td>
                  <td>{b.origen === 'CRON' ? 'Servidor (cada 30 min)' : b.origen === 'APP' ? 'Al abrir la app' : 'Manual'}</td>
                  <td>
                    <span className={`badge ${['ERROR', 'BLOQUEADA'].includes(b.estado) ? 'badge--danger' : 'badge--success'}`}>
                      {b.estado.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{b.tasa_usd ? formatTasa(b.tasa_usd) : '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{b.detalle || '—'}</td>
                </tr>
              ))}
              {bitacora.length === 0 && <tr><td colSpan="5" className="table__empty">Aún no hay sincronizaciones</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Rate Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal--sm" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Corrección manual de tasa</h2>
            </div>
            <form onSubmit={handleSubmit} className="modal__form">
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Úsela solo si la sincronización automática falla. No se puede cambiar la tasa de un día con facturas emitidas.
              </p>
              <div className="form-group">
                <label>Fecha valor</label>
                <input type="date" value={fechaManual} max={hoyFecha} onChange={e => setFechaManual(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Tasa USD → Bs</label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={nuevaTasa}
                  onChange={e => setNuevaTasa(e.target.value)}
                  placeholder="Ej: 520.50"
                  autoFocus
                  required
                />
              </div>
              {bcvData?.tasa_usd && (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => setNuevaTasa(bcvData.tasa_usd)}
                >
                  Usar valor oficial BCV (Bs {bcvData.tasa_usd})
                </button>
              )}
              {nuevaTasa && parseFloat(nuevaTasa) > 0 && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  $1.00 = Bs {parseFloat(nuevaTasa).toFixed(4)} | $10 = Bs {(parseFloat(nuevaTasa) * 10).toFixed(2)}
                </p>
              )}
              <button type="submit" className="btn btn--primary btn--full">
                Guardar tasa
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
