import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, Bar, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts';
import {
  HiOutlineArrowTrendingUp, HiOutlineArrowTrendingDown, HiOutlineExclamationTriangle, HiOutlineXCircle,
  HiOutlineInformationCircle, HiOutlineCheckCircle, HiOutlineArrowPath, HiOutlinePencilSquare,
} from 'react-icons/hi2';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatUSD, formatBs, formatFecha } from '../utils/formatters';
import Pagination from '../components/common/Pagination';
import usePaginacion from '../hooks/usePaginacion';

// Paleta categórica validada (ver skill de visualización): ventas, margen, 3er slot.
const ESTILOS = `
.sig { --serie-1: #3987e5; --serie-2: #d95926; --serie-3: #199e70; --grid: #2c3440; --eje: #94A3B8;
  --estado-bien: #0ca30c; --estado-alerta: #fab219; --estado-serio: #ec835a; --estado-critico: #d03b3b;
  --seq-0: rgba(57,135,229,0.06); --seq-1: #cde2fb; --seq-2: #86b6ef; --seq-3: #3987e5; --seq-4: #1c5cab; --seq-5: #0d366b; }
[data-theme="light"] .sig { --serie-1: #2a78d6; --serie-2: #eb6834; --serie-3: #1baf7a; --grid: #e1e0d9; --eje: #52514e; }
.sig-fila { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin-bottom: 1rem; }
.sig-fila--2 { grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); }
.sig-kpi { padding: 1rem; }
.sig-kpi__label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); }
.sig-kpi__valor { font-size: 1.6rem; font-weight: 800; color: var(--text-primary); margin: 0.25rem 0; font-variant-numeric: tabular-nums; }
.sig-kpi__sub { font-size: 0.78rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
.sig-delta--sube { color: var(--success); } .sig-delta--baja { color: var(--danger); }
.sig-filtros { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 1rem; }
.sig-filtros input { width: auto; }
.sig-estado { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 700; font-size: 0.78rem; }
.sig-alerta { display: flex; gap: 0.6rem; align-items: flex-start; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); text-decoration: none; color: inherit; }
.sig-alerta:last-child { border-bottom: none; }
.sig-alerta small { color: var(--text-secondary); display: block; }
.sig-barra { height: 8px; border-radius: 4px; background: var(--grid); overflow: hidden; margin: 0.4rem 0; position: relative; }
.sig-barra__real { height: 100%; border-radius: 4px; background: var(--serie-1); }
.sig-barra__proy { position: absolute; top: 0; height: 100%; border-right: 2px dashed var(--text-primary); }
.sig-mapa { display: grid; grid-template-columns: 2.5rem repeat(var(--horas), minmax(22px, 1fr)); gap: 2px; font-size: 0.68rem; overflow-x: auto; }
.sig-mapa__celda { aspect-ratio: 1.4; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
.sig-mapa__eje { color: var(--text-secondary); display: flex; align-items: center; justify-content: center; }
.sig-clase { display: inline-block; min-width: 1.6rem; text-align: center; border-radius: 4px; padding: 0.1rem 0.35rem; font-weight: 800; color: #fff; }
.sig-indicador { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.55rem 0; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
.sig-indicador:last-child { border-bottom: none; }
.sig-indicador strong { font-variant-numeric: tabular-nums; }
.sig-indicador small { display: block; color: var(--text-secondary); font-size: 0.72rem; }
`;

const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const COLOR_CLASE = { A: 'var(--serie-1)', B: 'var(--serie-2)', C: 'var(--serie-3)' };
const ESTADO = {
  CRITICA: { color: 'var(--estado-critico)', icono: HiOutlineXCircle, etiqueta: 'Crítica' },
  ADVERTENCIA: { color: 'var(--estado-serio)', icono: HiOutlineExclamationTriangle, etiqueta: 'Advertencia' },
  INFO: { color: 'var(--info)', icono: HiOutlineInformationCircle, etiqueta: 'Información' },
};
const SEMAFORO = {
  VERDE: { color: 'var(--estado-bien)', icono: HiOutlineCheckCircle, etiqueta: 'En camino a la meta' },
  AMARILLO: { color: 'var(--estado-alerta)', icono: HiOutlineExclamationTriangle, etiqueta: 'En riesgo (85–99 %)' },
  ROJO: { color: 'var(--estado-critico)', icono: HiOutlineXCircle, etiqueta: 'No alcanzará la meta' },
  SIN_META: { color: 'var(--text-secondary)', icono: HiOutlineInformationCircle, etiqueta: 'Sin meta asignada' },
};

// Semáforo de los indicadores financieros (distinto al de metas).
const SALUD = {
  VERDE: { color: 'var(--estado-bien)', icono: HiOutlineCheckCircle, etiqueta: 'Saludable' },
  AMARILLO: { color: 'var(--estado-alerta)', icono: HiOutlineExclamationTriangle, etiqueta: 'Vigilar' },
  ROJO: { color: 'var(--estado-critico)', icono: HiOutlineXCircle, etiqueta: 'Crítico' },
};

const fechaISO = (d) => d.toLocaleDateString('en-CA');
function rangoPreset(preset) {
  const hoy = new Date();
  const desde = new Date(hoy);
  if (preset === 'mes') desde.setDate(1);
  if (preset === '30d') desde.setDate(hoy.getDate() - 29);
  if (preset === 'trimestre') desde.setDate(hoy.getDate() - 89);
  if (preset === 'anio') desde.setMonth(0, 1);
  return { desde: fechaISO(desde), hasta: fechaISO(hoy) };
}

const num = (v, d = 2) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });

function Delta({ valor, sufijo = '% vs. período anterior' }) {
  if (valor === null || valor === undefined) return <span>Sin período anterior comparable</span>;
  const sube = valor >= 0;
  const Icono = sube ? HiOutlineArrowTrendingUp : HiOutlineArrowTrendingDown;
  return (
    <span className={sube ? 'sig-delta--sube' : 'sig-delta--baja'}>
      <Icono /> {sube ? '+' : ''}{num(valor, 1)}{sufijo}
    </span>
  );
}

function Kpi({ label, valor, children }) {
  return (
    <div className="card sig-kpi">
      <div className="sig-kpi__label">{label}</div>
      <div className="sig-kpi__valor">{valor}</div>
      <div className="sig-kpi__sub">{children}</div>
    </div>
  );
}

function Indicador({ nombre, valor, ayuda, estado }) {
  const e = estado ? SALUD[estado] : null;
  return (
    <div className="sig-indicador">
      <div>{nombre}<small>{ayuda}</small></div>
      <div style={{ textAlign: 'right' }}>
        <strong>{valor}</strong>
        {e && <small className="sig-estado" style={{ color: e.color, justifyContent: 'flex-end' }}><e.icono /> {e.etiqueta}</small>}
      </div>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' },
  labelStyle: { color: 'var(--text-secondary)' },
};

export default function PanelGerencial() {
  const { profile } = useAuth();
  const puedeEditarMetas = ['admin', 'gerente'].includes(profile?.rol);
  const [preset, setPreset] = useState('mes');
  const [rango, setRango] = useState(() => rangoPreset('mes'));
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vistaAbc, setVistaAbc] = useState(false);
  const pagAbc = usePaginacion(datos?.abc, 15);
  const pagRfm = usePaginacion(datos?.rfm, 10);

  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;

  const cargar = useCallback(async () => {
    setLoading(true);
    const args = { p_desde: rango.desde, p_hasta: rango.hasta };
    const llamadas = await Promise.all([
      supabase.rpc('sig_resumen', args),
      supabase.rpc('sig_ventas_diarias', args),
      supabase.rpc('sig_metas', { p_anio: anio, p_mes: mes }),
      supabase.rpc('sig_proyeccion', { p_semanas_historia: 8, p_semanas_futuras: 4 }),
      supabase.rpc('sig_alertas'),
      supabase.rpc('sig_mapa_ventas', args),
      supabase.rpc('sig_analisis_abc', args),
      supabase.rpc('sig_clientes_rfm', { p_hasta: rango.hasta }),
      supabase.rpc('sig_alertas_tasa'),
    ]);
    const error = llamadas.find((r) => r.error)?.error;
    if (error) toast.error('Error cargando indicadores: ' + error.message);
    const [resumen, diarias, metas, proyeccion, alertas, mapa, abc, rfm, alertasTasa] = llamadas.map((r) => r.data);
    setDatos({ resumen, diarias: diarias || [], metas: metas || [], proyeccion: proyeccion || [],
      alertas: [...(alertasTasa || []), ...(alertas || [])], mapa: mapa || [], abc: abc || [], rfm: rfm || [] });
    setLoading(false);
  }, [rango.desde, rango.hasta, anio, mes]);

  useEffect(() => { cargar(); }, [cargar]);

  function elegirPreset(p) {
    setPreset(p);
    setRango(rangoPreset(p));
  }

  async function editarMeta(fila) {
    const valor = window.prompt(`Meta de ventas netas (USD, sin IVA) de ${fila.nombre} para ${String(mes).padStart(2, '0')}/${anio}:`,
      fila.meta ?? '');
    if (valor === null) return;
    const monto = parseFloat(valor);
    if (!(monto > 0)) { toast.error('Ingrese un monto mayor a cero'); return; }
    let consulta = supabase.from('metas_ventas').select('id').eq('anio', anio).eq('mes', mes);
    consulta = fila.vendedor_id ? consulta.eq('vendedor_id', fila.vendedor_id) : consulta.is('vendedor_id', null);
    const { data: existente } = await consulta.maybeSingle();
    const { error } = existente
      ? await supabase.from('metas_ventas').update({ monto_usd: monto }).eq('id', existente.id)
      : await supabase.from('metas_ventas').insert({ anio, mes, vendedor_id: fila.vendedor_id, monto_usd: monto });
    if (error) { toast.error(error.message); return; }
    toast.success('Meta actualizada');
    cargar();
  }

  if (loading && !datos) {
    return <div className="page-loading"><div className="loading-spinner" /><p>Calculando indicadores gerenciales...</p></div>;
  }

  const r = datos.resumen || {};
  const act = r.actual || {};
  const ant = r.anterior || {};
  const varPct = r.variacion_pct || {};
  const fin = r.financiero || {};
  const cart = r.cartera || {};
  const inv = r.inventario || {};
  const res = r.resultado || {};

  const metodos = Object.entries(r.metodos_pago || {})
    .map(([metodo, monto]) => ({ metodo, monto: Number(monto) }))
    .filter((m) => m.monto > 0)
    .sort((a, b) => b.monto - a.monto);
  const totalMetodos = metodos.reduce((s, m) => s + m.monto, 0);

  const serieDiaria = datos.diarias.map((d) => ({
    dia: formatFecha(d.dia).slice(0, 5), ventas: Number(d.ventas), margen: Number(d.margen), facturas: d.facturas,
  }));
  const serieProyeccion = datos.proyeccion.map((p) => ({
    semana: formatFecha(p.semana).slice(0, 5), ventas: Number(p.ventas), tipo: p.tipo,
  }));

  // Mapa de calor: escala secuencial de un solo tono por cantidad de facturas.
  const horas = [...new Set(datos.mapa.map((c) => c.hora))].sort((a, b) => a - b);
  const maxFacturas = Math.max(1, ...datos.mapa.map((c) => Number(c.facturas)));
  const celda = (dia, hora) => datos.mapa.find((c) => c.dia_semana === dia && c.hora === hora);
  const tonoSecuencial = (n) => (n ? `var(--seq-${Math.min(5, Math.ceil((5 * n) / maxFacturas))})` : 'var(--seq-0)');

  const resumenAbc = ['A', 'B', 'C'].map((clase) => {
    const productos = datos.abc.filter((p) => p.clase === clase);
    return { clase, productos: productos.length, margen: productos.reduce((s, p) => s + Number(p.margen), 0) };
  });
  const margenTotalAbc = resumenAbc.reduce((s, c) => s + c.margen, 0);

  const segmentos = datos.rfm.reduce((acc, c) => ({ ...acc, [c.segmento]: (acc[c.segmento] || 0) + 1 }), {});

  return (
    <div className="page sig">
      <style>{ESTILOS}</style>
      <div className="page__header">
        <div>
          <h1 className="page__title">Panel Gerencial</h1>
          <p className="page__subtitle">
            Indicadores del {formatFecha(rango.desde)} al {formatFecha(rango.hasta)} comparados con el
            período anterior equivalente ({formatFecha(r.periodo?.anterior_desde)} – {formatFecha(r.periodo?.anterior_hasta)})
          </p>
        </div>
        <button className="btn btn--secondary" onClick={cargar} disabled={loading}>
          <HiOutlineArrowPath /> {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {/* Filtros de período: una sola fila sobre todo el panel */}
      <div className="sig-filtros">
        {[['mes', 'Este mes'], ['30d', 'Últimos 30 días'], ['trimestre', 'Últimos 90 días'], ['anio', 'Este año']].map(([id, etiqueta]) => (
          <button key={id} className={`btn btn--sm ${preset === id ? 'btn--primary' : 'btn--ghost'}`} onClick={() => elegirPreset(id)}>
            {etiqueta}
          </button>
        ))}
        <input type="date" value={rango.desde} max={rango.hasta} aria-label="Desde"
          onChange={(e) => { setPreset('custom'); setRango({ ...rango, desde: e.target.value }); }} />
        <input type="date" value={rango.hasta} min={rango.desde} aria-label="Hasta"
          onChange={(e) => { setPreset('custom'); setRango({ ...rango, hasta: e.target.value }); }} />
      </div>

      {/* KPIs principales */}
      <div className="sig-fila">
        <Kpi label="Ventas netas (sin IVA)" valor={formatUSD(act.ventas_netas)}>
          <Delta valor={varPct.ventas_netas} />
        </Kpi>
        <Kpi label="Margen bruto" valor={formatUSD(act.margen_bruto)}>
          <span>{num(act.margen_pct, 1)} % de margen</span> · <Delta valor={varPct.margen_bruto} sufijo="%" />
        </Kpi>
        <Kpi label="Utilidad neta contable" valor={formatUSD(res.utilidad_neta)}>
          <span>Gastos {formatUSD(res.gastos)}</span>
          <span>· Dif. cambiario {formatBs(res.diferencial_cambiario_bs)}</span>
        </Kpi>
        <Kpi label="Ticket promedio" valor={formatUSD(act.ticket_promedio)}>
          <Delta valor={varPct.ticket_promedio} />
        </Kpi>
        <Kpi label="Facturas emitidas" valor={num(act.facturas, 0)}>
          <span>{num(act.unidades, 0)} unidades · antes {num(ant.facturas, 0)}</span>
        </Kpi>
      </div>

      <div className="sig-fila sig-fila--2">
        {/* Alertas */}
        <div className="card">
          <h3 className="card__title">Alertas de gestión ({datos.alertas.length})</h3>
          {datos.alertas.length === 0 && <p className="sig-estado" style={{ color: 'var(--estado-bien)' }}><HiOutlineCheckCircle /> Sin alertas</p>}
          {datos.alertas.map((a, i) => {
            const e = ESTADO[a.nivel] || ESTADO.INFO;
            return (
              <Link key={i} to={a.ruta || '#'} className="sig-alerta">
                <span className="sig-estado" style={{ color: e.color, minWidth: '7.5rem' }}><e.icono /> {e.etiqueta}</span>
                <span><strong>{a.categoria}:</strong> {a.mensaje}<small>{a.detalle}</small></span>
              </Link>
            );
          })}
        </div>

        {/* Metas del mes */}
        <div className="card">
          <h3 className="card__title">Metas de {hoy.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })}</h3>
          {datos.metas.map((m) => {
            const s = SEMAFORO[m.semaforo];
            const real = Math.min(100, Number(m.cumplimiento_pct || 0));
            const proy = Math.min(100, Number(m.proyeccion_pct || 0));
            return (
              <div key={m.vendedor_id || 'empresa'} style={{ marginBottom: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                  <strong>{m.nombre}</strong>
                  <span className="sig-estado" style={{ color: s.color }}><s.icono /> {s.etiqueta}</span>
                </div>
                {m.meta && (
                  <div className="sig-barra" title={`Vendido ${num(m.cumplimiento_pct, 1)} % · proyección al cierre ${num(m.proyeccion_pct, 1)} %`}>
                    <div className="sig-barra__real" style={{ width: `${real}%` }} />
                    <div className="sig-barra__proy" style={{ width: `${proy}%` }} />
                  </div>
                )}
                <div className="sig-kpi__sub">
                  Vendido {formatUSD(m.vendido)}{m.meta && <> de {formatUSD(m.meta)} ({num(m.cumplimiento_pct, 1)} %)</>}
                  {' · '}Proyección al cierre {formatUSD(m.proyeccion_cierre)}
                  {puedeEditarMetas && (
                    <button className="btn btn--ghost btn--xs" onClick={() => editarMeta(m)} title="Asignar o cambiar la meta">
                      <HiOutlinePencilSquare /> Meta
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="sig-kpi__sub">Barra: vendido · línea punteada: proyección lineal al cierre según el ritmo diario actual.</p>
        </div>
      </div>

      <div className="sig-fila sig-fila--2">
        {/* Ventas y margen diarios: misma unidad (USD), un solo eje */}
        <div className="card">
          <h3 className="card__title">Ventas netas y margen bruto por día (USD)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={serieDiaria} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="dia" stroke="var(--eje)" tick={{ fontSize: 11 }} minTickGap={18} />
              <YAxis stroke="var(--eje)" tick={{ fontSize: 11 }} width={56} />
              <Tooltip {...tooltipStyle} formatter={(v, n) => [formatUSD(v), n]} />
              <Legend />
              <Line type="monotone" dataKey="ventas" name="Ventas netas" stroke="var(--serie-1)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="margen" name="Margen bruto" stroke="var(--serie-2)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Pronóstico semanal */}
        <div className="card">
          <h3 className="card__title">Ventas semanales y pronóstico (regresión lineal)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={serieProyeccion} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="semana" stroke="var(--eje)" tick={{ fontSize: 11 }} />
              <YAxis stroke="var(--eje)" tick={{ fontSize: 11 }} width={56} />
              <Tooltip {...tooltipStyle}
                formatter={(v, _n, item) => [formatUSD(v), item.payload.tipo === 'REAL' ? 'Venta real' : 'Proyección']} />
              <Bar dataKey="ventas" name="Ventas netas por semana" radius={[4, 4, 0, 0]} maxBarSize={36}>
                {serieProyeccion.map((p, i) => (
                  <Cell key={i} fill="var(--serie-1)" fillOpacity={p.tipo === 'REAL' ? 1 : 0.35}
                    stroke="var(--serie-1)" strokeDasharray={p.tipo === 'REAL' ? undefined : '4 3'} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
          <p className="sig-kpi__sub">Barras sólidas: semanas cerradas · barras claras punteadas: proyección de la semana en curso y las 3 siguientes.</p>
        </div>
      </div>

      <div className="sig-fila sig-fila--2">
        {/* Indicadores financieros */}
        <div className="card">
          <h3 className="card__title">Salud financiera (al {formatFecha(rango.hasta)})</h3>
          <Indicador nombre="Liquidez corriente" valor={fin.liquidez_corriente ?? '—'}
            ayuda="Activo corriente / pasivo corriente. Sano entre 1,5 y 3."
            estado={fin.liquidez_corriente >= 1.5 ? 'VERDE' : fin.liquidez_corriente >= 1 ? 'AMARILLO' : 'ROJO'} />
          <Indicador nombre="Prueba ácida" valor={fin.prueba_acida ?? '—'}
            ayuda="Liquidez sin inventario. Deseable ≥ 1."
            estado={fin.prueba_acida >= 1 ? 'VERDE' : fin.prueba_acida >= 0.7 ? 'AMARILLO' : 'ROJO'} />
          <Indicador nombre="Endeudamiento" valor={`${num(fin.endeudamiento_pct, 1)} %`}
            ayuda="Pasivo / activo total. Deseable < 50 %."
            estado={fin.endeudamiento_pct < 50 ? 'VERDE' : fin.endeudamiento_pct < 65 ? 'AMARILLO' : 'ROJO'} />
          <Indicador nombre="Días promedio de cobro (DSO)" valor={`${num(cart.dso_dias, 1)} días`}
            ayuda={`Cartera / ventas a crédito diarias. El crédito es ${num(cart.credito_pct_ventas, 1)} % de lo facturado.`}
            estado={cart.dso_dias <= 20 ? 'VERDE' : cart.dso_dias <= 35 ? 'AMARILLO' : 'ROJO'} />
          <Indicador nombre="Morosidad" valor={`${num(cart.morosidad_pct, 1)} %`}
            ayuda={`${cart.cuentas_vencidas} cuenta(s) vencida(s) por ${formatUSD(cart.cxc_vencida)} de ${formatUSD(cart.cxc_pendiente)}.`}
            estado={cart.morosidad_pct <= 10 ? 'VERDE' : cart.morosidad_pct <= 25 ? 'AMARILLO' : 'ROJO'} />
          <Indicador nombre="Rotación de inventario" valor={`${num(inv.rotacion_anual, 1)} veces/año`}
            ayuda={`Inventario a costo ${formatUSD(inv.valor_costo)} · cubre ${num(inv.dias_inventario, 0)} días de venta.`} />
          <Indicador nombre="Cuentas por pagar" valor={formatUSD(fin.cxp_pendiente)}
            ayuda={`Cashea por liquidar a la tienda: ${formatUSD(cart.cashea_por_cobrar)}.`} />
        </div>

        {/* Medios de cobro: una sola serie, magnitud */}
        <div className="card">
          <h3 className="card__title">Mezcla de medios de cobro (USD)</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, metodos.length * 34)}>
            <BarChart data={metodos} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" horizontal={false} />
              <XAxis type="number" stroke="var(--eje)" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="metodo" stroke="var(--eje)" tick={{ fontSize: 11 }} width={130} />
              <Tooltip {...tooltipStyle}
                formatter={(v) => [`${formatUSD(v)} (${num((100 * v) / totalMetodos, 1)} %)`, 'Cobrado']} />
              <Bar dataKey="monto" fill="var(--serie-1)" radius={[0, 4, 4, 0]} maxBarSize={22}
                label={{ position: 'right', fill: 'var(--text-secondary)', fontSize: 11,
                  formatter: (v) => `${num((100 * v) / totalMetodos, 0)} %` }} />
            </BarChart>
          </ResponsiveContainer>
          <p className="sig-kpi__sub">Efectivo USD y Zelle generan IGTF ({formatUSD(act.igtf)} en el período).</p>
        </div>
      </div>

      {/* Mapa de calor */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 className="card__title">¿Cuándo se vende? Facturas por día y hora</h3>
        <div className="sig-mapa" style={{ '--horas': horas.length }}>
          <div />
          {horas.map((h) => <div key={h} className="sig-mapa__eje">{h}h</div>)}
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            [<div key={`d${d}`} className="sig-mapa__eje">{DIAS[d]}</div>,
              ...horas.map((h) => {
                const c = celda(d, h);
                const n = Number(c?.facturas || 0);
                const oscuro = n && Math.ceil((5 * n) / maxFacturas) >= 3;
                return (
                  <div key={`${d}-${h}`} className="sig-mapa__celda"
                    style={{ background: tonoSecuencial(n), color: oscuro ? '#fff' : 'var(--text-secondary)' }}
                    title={`${DIAS[d]} ${h}:00 – ${n} factura(s) · ${formatUSD(c?.ventas || 0)}`}>
                    {n || ''}
                  </div>
                );
              })]
          ))}
        </div>
        <p className="sig-kpi__sub">Más oscuro = más facturas. Útil para planificar turnos de caja y reposición.</p>
      </div>

      <div className="sig-fila sig-fila--2">
        {/* ABC */}
        <div className="card">
          <h3 className="card__title">Análisis ABC de productos (Pareto por margen)</h3>
          <div className="sig-fila" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '0.5rem' }}>
            {resumenAbc.map((c) => (
              <div key={c.clase}>
                <span className="sig-clase" style={{ background: COLOR_CLASE[c.clase] }}>{c.clase}</span>
                <div className="sig-kpi__sub">{c.productos} producto(s) · {num(margenTotalAbc ? (100 * c.margen) / margenTotalAbc : 0, 0)} % del margen</div>
              </div>
            ))}
          </div>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Clase</th><th>Producto</th><th>Margen</th><th>% Acum.</th><th>Stock</th><th>Cobertura</th></tr></thead>
              <tbody>
                {(vistaAbc ? pagAbc.visibles : datos.abc.slice(0, 8)).map((p) => (
                  <tr key={p.producto_id}>
                    <td><span className="sig-clase" style={{ background: COLOR_CLASE[p.clase] }}>{p.clase}</span></td>
                    <td>{p.nombre}<div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.sku} · {num(p.margen_pct, 1)} % margen</div></td>
                    <td>{formatUSD(p.margen)}</td>
                    <td>{num(p.acumulado_pct, 1)} %</td>
                    <td>{p.stock}</td>
                    <td style={{ color: p.dias_cobertura !== null && p.dias_cobertura < 10 ? 'var(--danger)' : undefined }}>
                      {p.dias_cobertura === null ? 'Sin ventas' : `${num(p.dias_cobertura, 0)} días`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {vistaAbc && <Pagination {...pagAbc.paginacion} />}
          {datos.abc.length > 8 && (
            <button className="btn btn--ghost btn--sm" onClick={() => setVistaAbc(!vistaAbc)}>
              {vistaAbc ? 'Ver menos' : `Ver los ${datos.abc.length} productos`}
            </button>
          )}
          <p className="sig-kpi__sub">A: ~80 % del margen (nunca deben faltar) · B: siguiente 15 % · C: resto. Cobertura = días de venta que alcanza el stock.</p>
        </div>

        {/* RFM */}
        <div className="card">
          <h3 className="card__title">Segmentación de clientes (RFM)</h3>
          <div className="sig-kpi__sub" style={{ marginBottom: '0.5rem' }}>
            {Object.entries(segmentos).map(([s, n]) => <span key={s} className="badge badge--info">{s}: {n}</span>)}
          </div>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Cliente</th><th>Última compra</th><th>Compras</th><th>Monto</th><th>R-F-M</th><th>Segmento</th></tr></thead>
              <tbody>
                {pagRfm.visibles.map((c) => (
                  <tr key={c.cliente_id}>
                    <td>{c.nombre}{Number(c.saldo_pendiente) > 0 && <div className="text-xs" style={{ color: 'var(--warning)' }}>Debe {formatUSD(c.saldo_pendiente)}</div>}</td>
                    <td>hace {c.recencia_dias} d</td>
                    <td>{c.frecuencia}</td>
                    <td>{formatUSD(c.monto)}</td>
                    <td><code>{c.r}-{c.f}-{c.m}</code></td>
                    <td>{c.segmento}</td>
                  </tr>
                ))}
                {datos.rfm.length === 0 && <tr><td colSpan="6" className="table__empty">Sin compras de clientes identificados</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination {...pagRfm.paginacion} />
          <p className="sig-kpi__sub">R: días desde la última compra (5 = ≤7 días) · F y M: quintiles de frecuencia y monto. Las ventas a consumidor final no se segmentan.</p>
        </div>
      </div>
    </div>
  );
}
