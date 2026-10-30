/**
 * Motor común de reportes: el mismo modelo de datos genera
 *   - un Excel con formato (membrete, encabezados, números, totales, pie), y
 *   - una versión imprimible en A4 (o PDF desde el diálogo de impresión).
 *
 * Modelo de un reporte:
 * {
 *   titulo: 'Balance General',
 *   subtitulo: 'Al 30/10/2026',                // opcional
 *   moneda: 'USD' | 'VES',                     // formato de las columnas 'monto'
 *   archivo: 'Balance_General_2026-10-30',     // sin extensión
 *   resumen: [{ etiqueta, valor, tipo }],      // tarjetas de cifras clave (opcional)
 *   secciones: [{
 *     titulo: 'Activos',                       // opcional
 *     columnas: [{ titulo, clave, tipo: 'texto'|'monto'|'usd'|'bs'|'numero'|'porcentaje'|'fecha'|'codigo', ancho }],
 *     filas: [{ ...valores, _estilo: 'subtotal'|'total'|'grupo' }],
 *     nota: 'texto al pie de la sección',      // opcional
 *   }],
 *   notas: ['Fuente: ...'],                    // al pie del reporte (opcional)
 *   calidad: { fuente, confiabilidad, oportunidad }  // ficha de calidad de la información (opcional)
 * }
 */
import { getEmpresaConfig } from './constants';

const VERDE = 'FF15803D';
const VERDE_CLARO = 'FFE8F5EC';
const GRIS = 'FFF4F5F7';
const BORDE = 'FFD9DEE5';

const fechaHora = () => new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });

// Formato de número para Excel y para impresión según el tipo de columna
function formatoExcel(tipo, moneda) {
  if (tipo === 'usd' || (tipo === 'monto' && moneda !== 'VES')) return '"$"#,##0.00;[Red]-"$"#,##0.00';
  if (tipo === 'bs' || (tipo === 'monto' && moneda === 'VES')) return '"Bs "#,##0.00;[Red]-"Bs "#,##0.00';
  if (tipo === 'numero') return '#,##0';
  if (tipo === 'porcentaje') return '0.0"%"';
  return null;
}

function formatoTexto(valor, tipo, moneda) {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  const dos = (x) => x.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (tipo === 'usd' || (tipo === 'monto' && moneda !== 'VES')) return `${n < 0 ? '−' : ''}$ ${dos(Math.abs(n))}`;
  if (tipo === 'bs' || (tipo === 'monto' && moneda === 'VES')) return `${n < 0 ? '−' : ''}Bs ${dos(Math.abs(n))}`;
  if (tipo === 'numero') return n.toLocaleString('es-VE');
  if (tipo === 'porcentaje') return `${n.toLocaleString('es-VE', { maximumFractionDigits: 1 })} %`;
  if (tipo === 'fecha') {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T00:00:00`) : new Date(valor);
    return isNaN(d) ? String(valor) : d.toLocaleDateString('es-VE');
  }
  return String(valor);
}

const esNumerico = (tipo) => ['monto', 'usd', 'bs', 'numero', 'porcentaje'].includes(tipo);

/**
 * Columnas a partir de filas sueltas (objetos con claves en español): infiere
 * el tipo por el nombre y el valor. Útil para migrar exportaciones existentes.
 */
export function columnasDesdeFilas(filas) {
  const claves = [...new Set(filas.flatMap((f) => Object.keys(f).filter((k) => !k.startsWith('_'))))];
  return claves.map((clave) => {
    const ejemplo = filas.find((f) => f[clave] !== null && f[clave] !== undefined && f[clave] !== '')?.[clave];
    const k = clave.toLowerCase();
    let tipo = 'texto';
    if (typeof ejemplo === 'number') {
      if (k.includes('%') || k.includes('porcentaje') || k.includes('margen %') || k.includes('participación')) tipo = 'porcentaje';
      else if (k.includes('bs') || k.includes('bolívar') || k.includes('ves')) tipo = 'bs';
      else if (k.includes('usd') || k.includes('$') || k.includes('monto') || k.includes('total') || k.includes('precio')
        || k.includes('saldo') || k.includes('costo') || k.includes('valor') || k.includes('venta') || k.includes('abono')
        || k.includes('recargo') || k.includes('deuda') || k.includes('ticket')) tipo = 'usd';
      else tipo = 'numero';
    } else if (k.includes('fecha') && !k.includes('hora')) tipo = 'fecha';
    else if (/n°|nro|rif|c\.i|sku|código|codigo|factura|control|referencia|comprobante/.test(k)) tipo = 'codigo';
    return { titulo: clave, clave, tipo };
  });
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
export async function exportarExcel(reporte) {
  const { default: ExcelJS } = await import('exceljs');
  const empresa = getEmpresaConfig();
  const libro = new ExcelJS.Workbook();
  libro.creator = empresa.nombre;
  libro.created = new Date();

  // Cada sección puede ir en su propia hoja (hojas) o todas juntas en una
  const hojas = reporte.hojas || [{ nombre: reporte.titulo, secciones: reporte.secciones, resumen: reporte.resumen }];

  for (const hojaDef of hojas) {
    const anchoMax = Math.max(...hojaDef.secciones.map((s) => s.columnas.length), 2);
    const hoja = libro.addWorksheet(hojaDef.nombre.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'), {
      pageSetup: { paperSize: 9, orientation: anchoMax > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
      headerFooter: { oddFooter: `&L${empresa.nombre}&C${reporte.titulo}&RPágina &P de &N` },
      views: [{ showGridLines: false }],
    });

    // Membrete
    const fila = (valores, estilo) => {
      const r = hoja.addRow(valores);
      if (estilo) estilo(r);
      return r;
    };
    const unir = (r) => hoja.mergeCells(r.number, 1, r.number, anchoMax);
    unir(fila([empresa.nombre], (r) => { r.font = { bold: true, size: 14, color: { argb: VERDE } }; }));
    unir(fila([`RIF ${empresa.rif} · ${empresa.direccion}`], (r) => { r.font = { size: 9, color: { argb: 'FF5B6472' } }; }));
    unir(fila([hojaDef.titulo || reporte.titulo], (r) => { r.font = { bold: true, size: 13 }; r.height = 22; }));
    if (reporte.subtitulo) unir(fila([reporte.subtitulo], (r) => { r.font = { size: 10, color: { argb: 'FF374151' } }; }));
    unir(fila([`${reporte.moneda ? `Moneda: ${reporte.moneda === 'VES' ? 'Bolívares (Bs)' : 'Dólares (USD)'} · ` : ''}Generado: ${fechaHora()}`],
      (r) => { r.font = { size: 9, italic: true, color: { argb: 'FF6B7280' } }; }));
    hoja.addRow([]);

    // Cifras clave
    for (const item of hojaDef.resumen || []) {
      const r = hoja.addRow([item.etiqueta, item.valor]);
      r.getCell(1).font = { bold: true };
      const fmt = formatoExcel(item.tipo || 'monto', reporte.moneda);
      if (fmt) r.getCell(2).numFmt = fmt;
      r.getCell(2).font = { bold: true, color: { argb: VERDE } };
    }
    if ((hojaDef.resumen || []).length) hoja.addRow([]);

    let filaCongelada = null;
    for (const seccion of hojaDef.secciones) {
      if (seccion.titulo) {
        const t = hoja.addRow([seccion.titulo.toUpperCase()]);
        hoja.mergeCells(t.number, 1, t.number, seccion.columnas.length);
        t.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        t.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
        t.height = 20;
      }
      const enc = hoja.addRow(seccion.columnas.map((c) => c.titulo));
      enc.height = 22;
      enc.eachCell((celda, i) => {
        celda.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } };
        celda.alignment = { vertical: 'middle', horizontal: esNumerico(seccion.columnas[i - 1].tipo) ? 'right' : 'left', wrapText: true };
        celda.border = { bottom: { style: 'thin', color: { argb: BORDE } } };
      });
      if (!filaCongelada && hojaDef.secciones.length === 1) filaCongelada = enc.number;

      seccion.filas.forEach((f, idx) => {
        const r = hoja.addRow(seccion.columnas.map((c) => {
          const v = f[c.clave];
          if (esNumerico(c.tipo) && v !== '' && v !== null && v !== undefined) return Number(v);
          if (c.tipo === 'fecha' && v) return formatoTexto(v, 'fecha');
          return v ?? '';
        }));
        r.eachCell({ includeEmpty: true }, (celda, i) => {
          const col = seccion.columnas[i - 1];
          if (!col) return;
          const fmt = formatoExcel(col.tipo, reporte.moneda);
          if (fmt) celda.numFmt = fmt;
          celda.alignment = { vertical: 'middle', horizontal: esNumerico(col.tipo) ? 'right' : 'left' };
          celda.border = { bottom: { style: 'hair', color: { argb: BORDE } } };
          if (f._estilo === 'total' || f._estilo === 'subtotal') {
            celda.font = { bold: true, size: f._estilo === 'total' ? 11 : 10 };
            celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_CLARO } };
            celda.border = { top: { style: 'thin', color: { argb: VERDE } }, bottom: { style: f._estilo === 'total' ? 'double' : 'thin', color: { argb: VERDE } } };
          } else if (f._estilo === 'grupo') {
            celda.font = { bold: true };
            celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
          } else if (idx % 2 === 1) {
            celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFC' } };
          }
        });
      });
      if (seccion.nota) {
        const n = hoja.addRow([seccion.nota]);
        hoja.mergeCells(n.number, 1, n.number, seccion.columnas.length);
        n.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
      }
      hoja.addRow([]);
    }

    for (const nota of [...(reporte.notas || []), ...fichaCalidad(reporte.calidad)]) {
      const n = hoja.addRow([nota]);
      hoja.mergeCells(n.number, 1, n.number, anchoMax);
      n.font = { size: 9, color: { argb: 'FF6B7280' } };
    }

    // Anchos de columna según contenido (sin tocar el membrete)
    const primeraSeccion = hojaDef.secciones[0];
    hoja.columns.forEach((col, i) => {
      const def = hojaDef.secciones.map((s) => s.columnas[i]).find(Boolean);
      if (!def) { col.width = 14; return; }
      const largos = hojaDef.secciones.flatMap((s) => s.filas.map((f) => String(formatoTexto(f[s.columnas[i]?.clave], def.tipo, reporte.moneda)).length));
      col.width = def.ancho || Math.min(Math.max(def.titulo.length + 2, ...largos.map((l) => l + 2), 10), 48);
    });
    if (filaCongelada) hoja.views = [{ state: 'frozen', ySplit: filaCongelada, showGridLines: false }];
    if (primeraSeccion && hojaDef.secciones.length === 1 && primeraSeccion.filas.length > 1 && filaCongelada) {
      hoja.autoFilter = { from: { row: filaCongelada, column: 1 }, to: { row: filaCongelada, column: primeraSeccion.columnas.length } };
    }
  }

  const buffer = await libro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(reporte.archivo || reporte.titulo).replace(/[\\/:*?"<>|]/g, '-')}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fichaCalidad(calidad) {
  if (!calidad) return [];
  return [
    calidad.fuente && `Fuente: ${calidad.fuente}`,
    calidad.confiabilidad && `Confiabilidad: ${calidad.confiabilidad}`,
    calidad.oportunidad && `Oportunidad: ${calidad.oportunidad}`,
  ].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Impresión / PDF (iframe oculto: no lo bloquea el navegador)
// ---------------------------------------------------------------------------
const escapar = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function htmlReporte(reporte) {
  const empresa = getEmpresaConfig();
  const hojas = reporte.hojas || [{ secciones: reporte.secciones, resumen: reporte.resumen }];
  const tabla = (s) => `
    <section>
      ${s.titulo ? `<h3>${escapar(s.titulo)}</h3>` : ''}
      <table>
        <thead><tr>${s.columnas.map((c) => `<th class="${esNumerico(c.tipo) ? 'num' : ''}">${escapar(c.titulo)}</th>`).join('')}</tr></thead>
        <tbody>${s.filas.map((f) => `<tr class="${f._estilo || ''}">${s.columnas.map((c) =>
          `<td class="${esNumerico(c.tipo) ? 'num' : ''} ${c.tipo === 'codigo' ? 'cod' : ''}">${escapar(formatoTexto(f[c.clave], c.tipo, reporte.moneda))}</td>`).join('')}</tr>`).join('')}
          ${s.filas.length === 0 ? `<tr><td colspan="${s.columnas.length}" class="vacio">Sin datos para el período</td></tr>` : ''}
        </tbody>
      </table>
      ${s.nota ? `<p class="nota">${escapar(s.nota)}</p>` : ''}
    </section>`;
  const resumen = (items) => (items?.length ? `<div class="resumen">${items.map((i) =>
    `<div class="kpi"><span>${escapar(i.etiqueta)}</span><strong>${escapar(formatoTexto(i.valor, i.tipo || 'monto', reporte.moneda))}</strong>${i.detalle ? `<small>${escapar(i.detalle)}</small>` : ''}</div>`).join('')}</div>` : '');
  const muchasColumnas = hojas.some((h) => h.secciones.some((s) => s.columnas.length > 6));

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(reporte.titulo)}</title>
<style>
  @page { size: A4 ${muchasColumnas ? 'landscape' : 'portrait'}; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; font-size: 11px; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #15803d; padding-bottom: 10px; margin-bottom: 16px; }
  header .empresa { font-size: 15px; font-weight: 800; color: #15803d; }
  header .datos { color: #6b7280; font-size: 10px; margin-top: 2px; }
  header .titulo { text-align: right; }
  header h1 { font-size: 17px; margin: 0 0 3px; }
  header .sub { color: #374151; font-size: 11px; }
  .resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 18px; }
  .kpi { border: 1px solid #d9dee5; border-left: 4px solid #15803d; border-radius: 6px; padding: 9px 12px; }
  .kpi span { display: block; color: #6b7280; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
  .kpi strong { display: block; font-size: 14px; margin-top: 3px; }
  .kpi small { color: #6b7280; }
  section { margin-bottom: 18px; break-inside: auto; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; background: #1f2937; color: #fff; padding: 6px 10px; margin: 0; border-radius: 4px 4px 0 0; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { background: #15803d; color: #fff; font-weight: 600; text-align: left; padding: 7px 10px; font-size: 10.5px; }
  td { padding: 6px 10px; border-bottom: 1px solid #edf0f3; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  tr { break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .cod { font-family: Consolas, monospace; font-size: 10.5px; color: #374151; white-space: nowrap; }
  tr.grupo td { background: #f4f5f7 !important; font-weight: 700; }
  tr.subtotal td { background: #e8f5ec !important; font-weight: 700; border-top: 1px solid #15803d; }
  tr.total td { background: #e8f5ec !important; font-weight: 800; font-size: 12px; border-top: 2px solid #15803d; border-bottom: 3px double #15803d; }
  .vacio { text-align: center; color: #9ca3af; padding: 14px; }
  .nota { color: #6b7280; font-size: 9.5px; margin: 5px 2px 0; }
  footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #d9dee5; color: #6b7280; font-size: 9px; }
  footer p { margin: 2px 0; }
</style></head><body>
<header>
  <div><div class="empresa">${escapar(empresa.nombre)}</div><div class="datos">RIF ${escapar(empresa.rif)} · ${escapar(empresa.direccion)}</div></div>
  <div class="titulo"><h1>${escapar(reporte.titulo)}</h1>
    <div class="sub">${escapar(reporte.subtitulo || '')}${reporte.moneda ? ` · ${reporte.moneda === 'VES' ? 'Bolívares (Bs)' : 'Dólares (USD)'}` : ''}</div></div>
</header>
${hojas.map((h) => `${h.titulo && hojas.length > 1 ? `<h2 style="font-size:14px;margin:18px 0 8px">${escapar(h.titulo)}</h2>` : ''}${resumen(h.resumen)}${h.secciones.map(tabla).join('')}`).join('')}
<footer>
  ${[...(reporte.notas || []), ...fichaCalidad(reporte.calidad)].map((n) => `<p>${escapar(n)}</p>`).join('')}
  <p>Generado el ${escapar(fechaHora())} · ARLUC SIG</p>
</footer>
</body></html>`;
}

export function imprimirReporte(reporte) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(htmlReporte(reporte));
  doc.close();
  iframe.onload = null;
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1500);
  }, 300);
}

/** Convierte filas sueltas (objetos) en una sección del motor. */
export function seccionDesdeFilas(titulo, filas, nota) {
  return { titulo, columnas: columnasDesdeFilas(filas), filas, nota };
}
