import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { formatUSD, formatBs, formatFecha } from '../../utils/formatters';
import {
  HiOutlineLockClosed, HiOutlineLockOpen, HiOutlineEye, HiOutlineArrowPath, HiOutlineCheckCircle,
} from 'react-icons/hi2';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const finDeMes = (anio, mes) => new Date(anio, mes, 0).toLocaleDateString('en-CA');
const hoy = () => new Date().toLocaleDateString('en-CA');
const num = (v) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CierreContable() {
  const { profile } = useAuth();
  const puedeCerrar = ['admin', 'contador'].includes(profile?.rol);
  const esAdmin = profile?.rol === 'admin';
  const [loading, setLoading] = useState(true);
  const [meses, setMeses] = useState([]);
  const [ejercicios, setEjercicios] = useState([]);
  const [mesCierre, setMesCierre] = useState(12);
  const [vista, setVista] = useState(null);
  const [procesando, setProcesando] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    const [{ data: periodos }, { data: revals }, { data: ejer }, { data: config }, { data: primero }] = await Promise.all([
      supabase.from('periodos_contables').select('*').order('anio').order('mes'),
      supabase.from('asientos_contables').select('id, numero, fecha, referencia_id, total_debe, total_debe_ves, tasa_cambio')
        .eq('referencia_tipo', 'REVALUACION').eq('modulo', 'Ajuste').eq('estado', 'ASENTADO'),
      supabase.from('ejercicios_contables').select('*').order('anio', { ascending: false }),
      supabase.from('configuracion_empresa').select('mes_cierre_ejercicio').eq('id', 'default').maybeSingle(),
      supabase.from('asientos_contables').select('fecha').order('fecha').limit(1).maybeSingle(),
    ]);

    // Todos los meses desde el primer asiento hasta el mes en curso
    const lista = [];
    if (primero) {
      const [a0, m0] = primero.fecha.split('-').map(Number);
      const actual = new Date();
      for (let a = a0, m = m0; a < actual.getFullYear() || (a === actual.getFullYear() && m <= actual.getMonth() + 1); m === 12 ? (a++, m = 1) : m++) {
        const p = (periodos || []).find((x) => x.anio === a && x.mes === m);
        lista.push({
          anio: a, mes: m, fin: finDeMes(a, m), estado: p?.estado || 'ABIERTO', periodo: p,
          revaluacion: p ? (revals || []).find((r) => r.referencia_id === p.id) : null,
        });
      }
    }
    setMeses(lista.reverse());
    setEjercicios(ejer || []);
    setMesCierre(config?.mes_cierre_ejercicio || 12);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function verRevaluacion(m) {
    const { data, error } = await supabase.rpc('vista_revaluacion', { p_anio: m.anio, p_mes: m.mes });
    if (error) { toast.error(error.message); return; }
    setVista({ ...m, filas: data || [] });
  }

  async function cerrar(m) {
    if (!window.confirm(`¿Cerrar ${MESES[m.mes]} ${m.anio}? Se registrará la revaluación cambiaria al ${formatFecha(m.fin)} y el mes quedará bloqueado.`)) return;
    setProcesando(`${m.anio}-${m.mes}`);
    const { data, error } = await supabase.rpc('cerrar_mes', { p_anio: m.anio, p_mes: m.mes });
    setProcesando(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${MESES[m.mes]} ${m.anio} cerrado · tasa de cierre ${num(data.tasa_cierre)}`);
    setVista(null);
    cargar();
  }

  async function reabrir(m) {
    if (!window.confirm(`¿Reabrir ${MESES[m.mes]} ${m.anio}? Se revertirá su revaluación cambiaria.`)) return;
    const { error } = await supabase.rpc('reabrir_periodo', { p_anio: m.anio, p_mes: m.mes });
    if (error) { toast.error(error.message); return; }
    toast.success(`${MESES[m.mes]} ${m.anio} reabierto`);
    cargar();
  }

  async function cerrarEjercicio(anio) {
    if (!window.confirm(`¿Cerrar el ejercicio económico ${anio}? Se cancelan ingresos, costos y gastos contra el resultado, se traslada a utilidades no distribuidas y se constituye la reserva legal. No se puede deshacer.`)) return;
    const { data, error } = await supabase.rpc('cerrar_ejercicio', { p_anio: anio });
    if (error) { toast.error(error.message); return; }
    toast.success(`Ejercicio ${anio} cerrado · resultado ${formatUSD(data.utilidad_usd)} · reserva legal ${formatUSD(data.reserva_legal_usd)}`);
    cargar();
  }

  // Ejercicio candidato a cierre: el último que ya terminó y no está cerrado
  const anioActual = new Date().getFullYear();
  const candidato = [anioActual, anioActual - 1].find((a) => finDeMes(a, mesCierre) < hoy() && !ejercicios.some((e) => e.anio === a));

  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando períodos...</p></div>;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Cierre Contable</h1>
          <p className="page__subtitle">Revaluación cambiaria mensual, cierre de períodos y cierre del ejercicio económico</p>
        </div>
        <button className="btn btn--secondary" onClick={cargar}><HiOutlineArrowPath /> Actualizar</button>
      </div>

      <div className="card">
        <h3 className="card__title">Meses contables</h3>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr><th>Período</th><th>Estado</th><th>Tasa de cierre</th><th>Revaluación</th><th>Cerrado</th><th style={{ textAlign: 'right' }}>Acciones</th></tr>
            </thead>
            <tbody>
              {meses.map((m) => {
                const terminado = m.fin < hoy();
                return (
                  <tr key={`${m.anio}-${m.mes}`}>
                    <td><strong>{MESES[m.mes]} {m.anio}</strong><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>al {formatFecha(m.fin)}</div></td>
                    <td>
                      <span className={`badge ${m.estado === 'CERRADO' ? 'badge--success' : terminado ? 'badge--warning' : 'badge--info'}`}>
                        {m.estado === 'CERRADO' ? 'Cerrado' : terminado ? 'Pendiente de cierre' : 'En curso'}
                      </span>
                    </td>
                    <td>{m.revaluacion ? num(m.revaluacion.tasa_cambio) : '—'}</td>
                    <td>{m.revaluacion ? <><code>{m.revaluacion.numero}</code><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatUSD(m.revaluacion.total_debe)} · {formatBs(m.revaluacion.total_debe_ves)}</div></> : '—'}</td>
                    <td>{m.periodo?.cerrado_en ? formatFecha(m.periodo.cerrado_en, true) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {terminado && m.estado !== 'CERRADO' && (
                          <button className="btn btn--ghost btn--xs" onClick={() => verRevaluacion(m)}><HiOutlineEye /> Vista previa</button>
                        )}
                        {puedeCerrar && terminado && m.estado !== 'CERRADO' && (
                          <button className="btn btn--primary btn--xs" disabled={procesando === `${m.anio}-${m.mes}`} onClick={() => cerrar(m)}>
                            <HiOutlineLockClosed /> {procesando === `${m.anio}-${m.mes}` ? 'Cerrando...' : 'Revaluar y cerrar'}
                          </button>
                        )}
                        {esAdmin && m.estado === 'CERRADO' && (
                          <button className="btn btn--ghost btn--xs" onClick={() => reabrir(m)}><HiOutlineLockOpen /> Reabrir</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {meses.length === 0 && <tr><td colSpan="6" className="table__empty">Aún no hay asientos contables</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="stat-card__sub" style={{ marginTop: '0.85rem' }}>
          Al cerrar un mes, las partidas en divisas se llevan en Bs a la tasa BCV del último día y las partidas en bolívares se llevan en USD a esa misma tasa.
          La diferencia (no realizada) se revierte el día 1 del mes siguiente. Los meses se cierran en orden y un mes cerrado no admite asientos.
        </p>
      </div>

      {vista && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <h3 className="card__title" style={{ margin: 0 }}>Vista previa de la revaluación · {MESES[vista.mes]} {vista.anio} (tasa {num(vista.filas[0]?.tasa_cierre)})</h3>
            <button className="btn btn--ghost btn--sm" onClick={() => setVista(null)}>Cerrar vista</button>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr><th>Cuenta</th><th>Moneda de origen</th><th style={{ textAlign: 'right' }}>Saldo USD</th><th style={{ textAlign: 'right' }}>Saldo Bs</th>
                  <th style={{ textAlign: 'right' }}>Ajuste USD</th><th style={{ textAlign: 'right' }}>Ajuste Bs</th></tr>
              </thead>
              <tbody>
                {vista.filas.map((f) => (
                  <tr key={f.cuenta_id}>
                    <td><code>{f.codigo}</code> {f.nombre}</td>
                    <td>{f.moneda === 'USD' ? 'Divisas (se revalúan los Bs)' : 'Bolívares (se revalúan los USD)'}</td>
                    <td style={{ textAlign: 'right' }}>{num(f.saldo_usd)}</td>
                    <td style={{ textAlign: 'right' }}>{num(f.saldo_ves)}</td>
                    <td style={{ textAlign: 'right', color: Number(f.ajuste_usd) < 0 ? 'var(--danger)' : undefined }}>{Number(f.ajuste_usd) ? num(f.ajuste_usd) : '—'}</td>
                    <td style={{ textAlign: 'right', color: Number(f.ajuste_ves) < 0 ? 'var(--danger)' : undefined }}>{Number(f.ajuste_ves) ? num(f.ajuste_ves) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="stat-card__sub" style={{ marginTop: '0.85rem' }}>
            Saldos con convención deudora (negativo = saldo acreedor). Ajustes positivos aumentan el saldo deudor.
          </p>
        </div>
      )}

      <div className="card">
        <h3 className="card__title">Ejercicio económico</h3>
        <p style={{ marginBottom: '0.85rem' }}>
          El ejercicio termina el último día de <strong>{MESES[mesCierre]}</strong> (según los estatutos; se configura en la empresa).
        </p>
        {candidato && puedeCerrar && (
          <button className="btn btn--primary" style={{ marginBottom: '1rem' }} onClick={() => cerrarEjercicio(candidato)}>
            <HiOutlineCheckCircle /> Cerrar ejercicio {candidato} (al {formatFecha(finDeMes(candidato, mesCierre))})
          </button>
        )}
        <div className="table-container">
          <table className="table">
            <thead>
              <tr><th>Ejercicio</th><th>Desde</th><th>Hasta</th><th style={{ textAlign: 'right' }}>Resultado USD</th>
                <th style={{ textAlign: 'right' }}>Resultado Bs</th><th style={{ textAlign: 'right' }}>Reserva legal</th><th>Cerrado</th></tr>
            </thead>
            <tbody>
              {ejercicios.map((e) => (
                <tr key={e.anio}>
                  <td><strong>{e.anio}</strong></td>
                  <td>{formatFecha(e.fecha_inicio)}</td>
                  <td>{formatFecha(e.fecha_fin)}</td>
                  <td style={{ textAlign: 'right' }}>{formatUSD(e.utilidad_usd)}</td>
                  <td style={{ textAlign: 'right' }}>{formatBs(e.utilidad_ves)}</td>
                  <td style={{ textAlign: 'right' }}>{formatUSD(e.reserva_legal_usd)}</td>
                  <td>{formatFecha(e.cerrado_en, true)}</td>
                </tr>
              ))}
              {ejercicios.length === 0 && <tr><td colSpan="7" className="table__empty">Ningún ejercicio cerrado todavía</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="stat-card__sub" style={{ marginTop: '0.85rem' }}>
          El cierre cancela ingresos, costos y gastos contra Resultado del ejercicio. Al iniciar el ejercicio siguiente, el resultado pasa a Utilidades no distribuidas
          y se aparta el 5 % como reserva legal hasta alcanzar el 10 % del capital social (Código de Comercio).
        </p>
      </div>
    </div>
  );
}
