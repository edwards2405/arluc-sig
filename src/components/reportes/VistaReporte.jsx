import { HiOutlineArrowDownTray, HiOutlinePrinter, HiOutlineCheckCircle, HiOutlineExclamationTriangle } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { exportarExcel, imprimirReporte } from '../../utils/reportes';
import { formatFecha } from '../../utils/formatters';

const esNumerico = (tipo) => ['monto', 'usd', 'bs', 'numero', 'porcentaje'].includes(tipo);

function formato(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = Number(valor);
  const dos = (x) => x.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (tipo === 'usd' || tipo === 'monto') return `${n < 0 ? '−' : ''}$ ${dos(Math.abs(n))}`;
  if (tipo === 'bs') return `${n < 0 ? '−' : ''}Bs ${dos(Math.abs(n))}`;
  if (tipo === 'numero') return n.toLocaleString('es-VE');
  if (tipo === 'porcentaje') return `${n.toLocaleString('es-VE', { maximumFractionDigits: 1 })} %`;
  if (tipo === 'fecha') return formatFecha(valor);
  return String(valor);
}

/**
 * Ficha de calidad de la información: los atributos que debe cumplir un
 * reporte gerencial (relevante, legible y comprensible, oportuno, confiable).
 */
export function FichaCalidad({ calidad, verificaciones = [] }) {
  if (!calidad && !verificaciones.length) return null;
  const item = (titulo, texto) => texto && (
    <div style={{ minWidth: 0 }}>
      <div className="stat-card__label">{titulo}</div>
      <div style={{ fontSize: '0.83rem', marginTop: '0.2rem' }}>{texto}</div>
    </div>
  );
  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: '4px solid var(--primary)', borderRadius: 10, padding: '0.9rem 1.1rem',
      background: 'var(--bg-elevated)', display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', marginBottom: '1.25rem' }}>
      {item('Relevante · para quién y para qué', calidad?.relevante)}
      {item('Oportuno', calidad?.oportunidad)}
      {item('Legible y comprensible', calidad?.comprensible)}
      <div>
        <div className="stat-card__label">Confiable · controles automáticos</div>
        {calidad?.fuente && <div style={{ fontSize: '0.83rem', marginTop: '0.2rem' }}>{calidad.fuente}</div>}
        {verificaciones.map((v) => {
          const info = v.tipo === 'info';
          const color = info ? 'var(--info)' : v.ok ? 'var(--success)' : 'var(--warning)';
          return (
            <div key={v.control} style={{ fontSize: '0.8rem', display: 'flex', gap: '0.35rem', alignItems: 'flex-start', marginTop: '0.25rem', color }} title={v.detalle}>
              {v.ok || info ? <HiOutlineCheckCircle style={{ flexShrink: 0, marginTop: 2 }} /> : <HiOutlineExclamationTriangle style={{ flexShrink: 0, marginTop: 2 }} />}
              <span>{v.control}{!v.ok && !info && v.detalle ? ` (${v.detalle})` : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Muestra en pantalla un reporte del motor común, con exportación e impresión. */
export default function VistaReporte({ reporte, verificaciones = [], extra }) {
  if (!reporte) return null;
  const calidadParaArchivo = {
    ...reporte.calidad,
    confiabilidad: verificaciones.length
      ? verificaciones.map((v) => `${v.ok || v.tipo === 'info' ? '✓' : '⚠'} ${v.control}`).join(' · ')
      : reporte.calidad?.confiabilidad,
  };
  const paraArchivo = { ...reporte, calidad: calidadParaArchivo };

  async function excel() {
    try {
      await exportarExcel(paraArchivo);
      toast.success('Excel generado');
    } catch (e) {
      toast.error('No se pudo generar el Excel: ' + e.message);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{reporte.titulo}</h2>
          {reporte.subtitulo && <p className="page__subtitle" style={{ marginTop: '0.25rem' }}>{reporte.subtitulo}</p>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn--secondary btn--sm" onClick={excel}><HiOutlineArrowDownTray /> Excel</button>
          <button className="btn btn--secondary btn--sm" onClick={() => imprimirReporte(paraArchivo)}><HiOutlinePrinter /> Imprimir / PDF</button>
        </div>
      </div>

      <FichaCalidad calidad={reporte.calidad} verificaciones={verificaciones} />

      {reporte.resumen?.length > 0 && (
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {reporte.resumen.map((r) => (
            <div key={r.etiqueta} className="stat-card" style={{ padding: '0.9rem 1rem' }}>
              <div className="stat-card__content">
                <span className="stat-card__label">{r.etiqueta}</span>
                <span className="stat-card__value" style={{ fontSize: '1.2rem' }}>{formato(r.valor, r.tipo || 'usd')}</span>
                {r.detalle && <span className="stat-card__sub">{r.detalle}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {extra}

      {(reporte.hojas ? reporte.hojas.flatMap((h) => h.secciones) : reporte.secciones).map((s, i) => (
        <div key={i} style={{ marginBottom: '1.5rem' }}>
          {s.titulo && <h3 className="card__title" style={{ marginBottom: '0.6rem' }}>{s.titulo}</h3>}
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>{s.columnas.map((c) => <th key={c.clave} style={{ textAlign: esNumerico(c.tipo) ? 'right' : 'left' }}>{c.titulo}</th>)}</tr>
              </thead>
              <tbody>
                {s.filas.map((f, j) => (
                  <tr key={j} style={f._estilo === 'total' || f._estilo === 'subtotal'
                    ? { fontWeight: 700, background: 'var(--primary-bg)' } : undefined}>
                    {s.columnas.map((c) => (
                      <td key={c.clave} style={{ textAlign: esNumerico(c.tipo) ? 'right' : 'left', whiteSpace: c.tipo === 'codigo' || esNumerico(c.tipo) ? 'nowrap' : undefined,
                        fontVariantNumeric: 'tabular-nums' }}>
                        {formato(f[c.clave], c.tipo)}
                      </td>
                    ))}
                  </tr>
                ))}
                {s.filas.length === 0 && <tr><td colSpan={s.columnas.length} className="table__empty">Sin datos</td></tr>}
              </tbody>
            </table>
          </div>
          {s.nota && <p className="stat-card__sub" style={{ marginTop: '0.5rem' }}>{s.nota}</p>}
        </div>
      ))}

      {reporte.notas?.map((n) => <p key={n} className="stat-card__sub" style={{ marginTop: '0.35rem' }}>{n}</p>)}
    </div>
  );
}
