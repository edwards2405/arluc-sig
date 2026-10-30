import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import {
  HiOutlineCalendarDays, HiOutlineExclamationTriangle, HiOutlinePresentationChartLine, HiOutlineAdjustmentsHorizontal,
  HiOutlineArrowPath, HiOutlineCheckCircle,
} from 'react-icons/hi2';
import { supabase } from '../lib/supabase';
import { formatUSD, formatFecha } from '../utils/formatters';
import VistaReporte from '../components/reportes/VistaReporte';
import {
  TIPOS_PROGRAMADOS, DIMENSIONES, modeloProgramado, modeloExcepciones, modeloProyecciones, modeloSolicitud,
} from '../utils/modelosReportes';

const TIPOS = [
  { id: 'programados', titulo: 'Programados', icono: HiOutlineCalendarDays,
    texto: 'Se generan solos en horarios fijos: cierre diario, resumen semanal y mensual.' },
  { id: 'excepcion', titulo: 'De excepción', icono: HiOutlineExclamationTriangle,
    texto: 'Solo lo que se sale de lo normal según umbrales, con su responsable.' },
  { id: 'proyeccion', titulo: 'Proyección y pronóstico', icono: HiOutlinePresentationChartLine,
    texto: 'Ventas, flujo de caja, cierre de mes e inventario hacia adelante.' },
  { id: 'solicitud', titulo: 'A solicitud', icono: HiOutlineAdjustmentsHorizontal,
    texto: 'El usuario elige el período y cómo agrupar la información.' },
];

const hoy = () => new Date().toLocaleDateString('en-CA');
const haceDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};
const tooltipStyle = {
  contentStyle: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' },
};

function Programados() {
  const [lista, setLista] = useState([]);
  const [filtro, setFiltro] = useState('CIERRE_DIARIO');
  const [seleccionado, setSeleccionado] = useState(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('reportes_generados')
      .select('id, codigo, titulo, periodo_desde, periodo_hasta, generado_en, origen, verificaciones')
      .eq('codigo', filtro).order('periodo_desde', { ascending: false }).limit(60);
    if (error) toast.error(error.message);
    setLista(data || []);
    setLoading(false);
  }, [filtro]);

  useEffect(() => { cargar(); setSeleccionado(null); }, [cargar]);

  async function abrir(r) {
    const { data, error } = await supabase.from('reportes_generados').select('*').eq('id', r.id).single();
    if (error) { toast.error(error.message); return; }
    setSeleccionado(data);
  }

  async function regenerar() {
    const { error } = await supabase.rpc('generar_reporte_programado', { p_codigo: seleccionado.codigo, p_fecha: seleccionado.periodo_hasta });
    if (error) { toast.error(error.message); return; }
    toast.success('Reporte regenerado con los datos actuales');
    await cargar();
    abrir(seleccionado);
  }

  return (
    <>
      <div className="filters-bar">
        {Object.entries(TIPOS_PROGRAMADOS).map(([codigo, t]) => (
          <button key={codigo} className={`btn btn--sm ${filtro === codigo ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setFiltro(codigo)}>
            {t.etiqueta}
          </button>
        ))}
      </div>
      <p className="stat-card__sub" style={{ marginBottom: '1rem' }}>
        {TIPOS_PROGRAMADOS[filtro].frecuencia} · {TIPOS_PROGRAMADOS[filtro].para}
      </p>

      {seleccionado ? (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setSeleccionado(null)}>← Volver a la lista</button>
            <button className="btn btn--ghost btn--sm" onClick={regenerar} title="Vuelve a generar el reporte con los datos actuales">
              <HiOutlineArrowPath /> Regenerar
            </button>
          </div>
          <VistaReporte reporte={modeloProgramado(seleccionado)} verificaciones={seleccionado.verificaciones} />
        </>
      ) : (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Reporte</th><th>Período</th><th>Generado</th><th>Controles</th><th /></tr></thead>
              <tbody>
                {lista.map((r) => {
                  const fallas = (r.verificaciones || []).filter((v) => !v.ok && v.tipo !== 'info');
                  const provisional = (r.verificaciones || []).some((v) => v.tipo === 'info' && !v.ok);
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.titulo}</strong></td>
                      <td>{formatFecha(r.periodo_desde)}{r.periodo_hasta !== r.periodo_desde && ` – ${formatFecha(r.periodo_hasta)}`}</td>
                      <td>{new Date(r.generado_en).toLocaleString('es-VE')}<div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.origen === 'CRON' ? 'Automático' : 'Regenerado'}</div></td>
                      <td>
                        {fallas.length === 0
                          ? <span className={`badge ${provisional ? 'badge--info' : 'badge--success'}`}><HiOutlineCheckCircle /> {provisional ? 'OK · provisional' : 'OK · definitivo'}</span>
                          : <span className="badge badge--warning" title={fallas.map((f) => f.control).join(', ')}>{fallas.length} a revisar</span>}
                      </td>
                      <td><button className="btn btn--secondary btn--xs" onClick={() => abrir(r)}>Ver reporte</button></td>
                    </tr>
                  );
                })}
                {!loading && lista.length === 0 && <tr><td colSpan="5" className="table__empty">Aún no se han generado reportes de este tipo</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Excepciones() {
  const [desde, setDesde] = useState(haceDias(30));
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('reporte_excepciones', { p_desde: desde, p_hasta: hasta });
    if (error) { toast.error(error.message); return; }
    setDatos(data);
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <div className="filters-bar" style={{ alignItems: 'center' }}>
        <label>Desde <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta <input type="date" value={hasta} min={desde} max={hoy()} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      {datos && <VistaReporte reporte={modeloExcepciones(datos, desde, hasta)} />}
    </>
  );
}

function Proyecciones() {
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    supabase.rpc('reporte_proyecciones').then(({ data, error }) => (error ? toast.error(error.message) : setDatos(data)));
  }, []);
  if (!datos) return <div className="page-loading"><div className="loading-spinner" /><p>Calculando proyecciones...</p></div>;
  const serie = datos.ventas.map((v) => ({ semana: formatFecha(v.semana).slice(0, 5), ventas: Number(v.ventas), tipo: v.tipo }));
  return (
    <VistaReporte
      reporte={modeloProyecciones(datos)}
      extra={(
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 className="card__title" style={{ marginBottom: '0.6rem' }}>Ventas semanales: reales y pronóstico</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="semana" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
              <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} width={56} />
              <Tooltip {...tooltipStyle} formatter={(v, _n, item) => [formatUSD(v), item.payload.tipo === 'REAL' ? 'Venta real' : 'Proyección']} />
              <Bar dataKey="ventas" radius={[4, 4, 0, 0]} maxBarSize={38}>
                {serie.map((s, i) => (
                  <Cell key={i} fill="#2a78d6" fillOpacity={s.tipo === 'REAL' ? 1 : 0.35} stroke="#2a78d6" strokeDasharray={s.tipo === 'REAL' ? undefined : '4 3'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="stat-card__sub">Barras sólidas: semanas cerradas · barras claras punteadas: pronóstico.</p>
        </div>
      )}
    />
  );
}

function Solicitud() {
  const [desde, setDesde] = useState(new Date().toLocaleDateString('en-CA').slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy());
  const [dimension, setDimension] = useState('categoria');
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function generar(e) {
    e?.preventDefault();
    setCargando(true);
    const { data, error } = await supabase.rpc('reporte_a_solicitud', { p_desde: desde, p_hasta: hasta, p_dimension: dimension });
    setCargando(false);
    if (error) { toast.error(error.message); return; }
    setResultado({ ...data, desde, hasta, dimension });
  }

  const grafico = (resultado?.filas || []).slice(0, 12).map((f) => ({
    grupo: ['dia', 'semana'].includes(resultado.dimension) ? formatFecha(f.grupo).slice(0, 5) : String(f.grupo).slice(0, 22), ventas: Number(f.ventas),
  }));

  return (
    <>
      <form className="card" onSubmit={generar} style={{ marginBottom: '1.25rem' }}>
        <h3 className="card__title">¿Qué quiere consultar?</h3>
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group"><label>Desde</label><input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} required /></div>
          <div className="form-group"><label>Hasta</label><input type="date" value={hasta} min={desde} max={hoy()} onChange={(e) => setHasta(e.target.value)} required /></div>
          <div className="form-group">
            <label>Agrupar ventas por</label>
            <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
              {Object.entries(DIMENSIONES).map(([id, t]) => <option key={id} value={id}>{t}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: '0 0 auto' }}>
            <button type="submit" className="btn btn--primary" disabled={cargando}>{cargando ? 'Generando...' : 'Generar reporte'}</button>
          </div>
        </div>
      </form>
      {resultado && (
        <VistaReporte
          reporte={modeloSolicitud(resultado.filas, resultado.desde, resultado.hasta, resultado.dimension)}
          verificaciones={resultado.verificaciones}
          extra={grafico.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <ResponsiveContainer width="100%" height={Math.max(200, grafico.length * 30)}>
                <BarChart data={grafico} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="grupo" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} width={150} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [formatUSD(v), 'Ventas netas']} />
                  <Bar dataKey="ventas" fill="#2a78d6" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        />
      )}
    </>
  );
}

export default function ReportesGerenciales() {
  const [tipo, setTipo] = useState('programados');
  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Reportes Gerenciales</h1>
          <p className="page__subtitle">Información relevante, legible, comprensible, oportuna y confiable para la toma de decisiones</p>
        </div>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {TIPOS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTipo(t.id)} className="stat-card"
            style={{ textAlign: 'left', cursor: 'pointer', borderColor: tipo === t.id ? 'var(--primary)' : undefined,
              boxShadow: tipo === t.id ? '0 0 0 2px var(--primary-glow)' : undefined, font: 'inherit', color: 'inherit' }}>
            <div className="stat-card__icon stat-card__icon--primary"><t.icono /></div>
            <div className="stat-card__content">
              <span className="stat-card__value" style={{ fontSize: '1.05rem' }}>{t.titulo}</span>
              <span className="stat-card__sub">{t.texto}</span>
            </div>
          </button>
        ))}
      </div>

      {tipo === 'programados' && <Programados />}
      {tipo === 'excepcion' && <Excepciones />}
      {tipo === 'proyeccion' && <Proyecciones />}
      {tipo === 'solicitud' && <Solicitud />}
    </div>
  );
}
