import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { exportarExcel, imprimirReporte } from '../../utils/reportes';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { formatBs, formatFecha } from '../../utils/formatters';
import { getEmpresaConfig } from '../../utils/constants';
import {
  HiOutlineArrowDownTray, HiOutlinePrinter, HiOutlineDocumentCheck, HiOutlineBanknotes, HiOutlineArrowPath,
} from 'react-icons/hi2';

const PESTANAS = [
  { id: 'resumen', label: 'Resumen de IVA' },
  { id: 'ventas', label: 'Libro de Ventas' },
  { id: 'compras', label: 'Libro de Compras' },
  { id: 'retenciones', label: 'Retenciones de IVA' },
];

const fechaHoy = () => new Date().toLocaleDateString('en-CA');
const mesActual = () => fechaHoy().slice(0, 7);
const num = (v) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Fila({ etiqueta, valor, fuerte, signo }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 0', borderBottom: '1px solid var(--border)', fontWeight: fuerte ? 700 : 400 }}>
      <span>{signo && <span style={{ color: 'var(--text-secondary)', marginRight: '0.4rem' }}>{signo}</span>}{etiqueta}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBs(valor)}</span>
    </div>
  );
}

// Comprobante de retención imprimible (formato de la normativa del SENIAT)
function imprimirComprobante(r) {
  const empresa = getEmpresaConfig();
  const ventana = window.open('', '_blank', 'width=900,height=650');
  if (!ventana) {
    toast.error('Permita las ventanas emergentes para imprimir');
    return;
  }
  const celda = 'border:1px solid #333;padding:6px;font-size:12px';
  ventana.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Comprobante ${r.numero_comprobante}</title></head>
<body style="font-family:Arial,sans-serif;padding:24px">
<h2 style="text-align:center;margin:0">COMPROBANTE DE RETENCIÓN DEL IMPUESTO AL VALOR AGREGADO</h2>
<p style="text-align:center;font-size:12px">Régimen de retenciones de IVA para contribuyentes especiales</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="${celda}"><b>N° de comprobante</b><br>${r.numero_comprobante}</td>
<td style="${celda}"><b>Fecha de emisión</b><br>${formatFecha(r.fecha)}</td>
<td style="${celda}"><b>Período fiscal</b><br>Año ${r.anio} / Mes ${String(r.mes).padStart(2, '0')}</td></tr>
<tr><td style="${celda}" colspan="2"><b>Agente de retención</b><br>${empresa.nombre}</td><td style="${celda}"><b>RIF del agente</b><br>${empresa.rif}</td></tr>
<tr><td style="${celda}" colspan="3"><b>Dirección fiscal del agente</b><br>${empresa.direccion}</td></tr>
<tr><td style="${celda}" colspan="2"><b>Sujeto retenido</b><br>${r.tercero_nombre}</td><td style="${celda}"><b>RIF del sujeto retenido</b><br>${r.tercero_rif}</td></tr>
</table>
<table style="width:100%;border-collapse:collapse">
<tr>${['Fecha factura', 'N° factura', 'N° control', 'Total con IVA (Bs)', 'Base imponible (Bs)', '% Alícuota', 'IVA (Bs)', '% Retención', 'IVA retenido (Bs)']
    .map((t) => `<th style="${celda};background:#eee">${t}</th>`).join('')}</tr>
<tr>${[formatFecha(r.fecha), r.numero_factura || 'S/N', r.numero_control || 'S/N',
    num((Number(r.base_usd) + Number(r.iva_usd)) * r.tasa), num(r.base_usd * r.tasa), '16,00',
    num(r.iva_usd * r.tasa), num(r.porcentaje), num(r.monto_retenido_bs)]
    .map((v) => `<td style="${celda};text-align:right">${v}</td>`).join('')}</tr>
</table>
<p style="font-size:11px;margin-top:8px">Montos en bolívares a la tasa oficial BCV del ${formatFecha(r.fecha)}: Bs ${num(r.tasa)} por USD.</p>
<table style="width:100%;margin-top:60px;font-size:12px"><tr>
<td style="text-align:center;border-top:1px solid #333;width:40%">Firma y sello del agente de retención</td><td></td>
<td style="text-align:center;border-top:1px solid #333;width:40%">Recibido por el sujeto retenido</td></tr></table>
<script>window.onload = () => window.print();</script>
</body></html>`);
  ventana.document.close();
}

export default function LibrosFiscales() {
  const { profile } = useAuth();
  const puedeOperar = ['admin', 'contador'].includes(profile?.rol);
  const [periodo, setPeriodo] = useState(mesActual);
  const [pestana, setPestana] = useState('resumen');
  const [datos, setDatos] = useState({ resumen: null, ventas: [], compras: [], retenciones: [] });
  const [loading, setLoading] = useState(true);

  const [anio, mes] = periodo.split('-').map(Number);

  const cargar = useCallback(async () => {
    setLoading(true);
    const [resumen, ventas, compras, retenciones] = await Promise.all([
      supabase.rpc('resumen_iva', { p_anio: anio, p_mes: mes }),
      supabase.rpc('libro_ventas', { p_anio: anio, p_mes: mes }),
      supabase.rpc('libro_compras', { p_anio: anio, p_mes: mes }),
      supabase.from('retenciones_iva').select('*').eq('anio', anio).eq('mes', mes).order('fecha'),
    ]);
    const error = [resumen, ventas, compras, retenciones].find((r) => r.error)?.error;
    if (error) toast.error(error.message);
    setDatos({ resumen: resumen.data, ventas: ventas.data || [], compras: compras.data || [], retenciones: retenciones.data || [] });
    setLoading(false);
  }, [anio, mes]);

  useEffect(() => { cargar(); }, [cargar]);

  // Libros y resumen en el motor común de reportes (Excel con formato e impresión)
  function construirLibro(tipo) {
    const suma = (lista, k) => lista.reduce((t, x) => t + Number(x[k] || 0), 0);
    const lista = tipo === 'ventas' ? datos.ventas : datos.compras;
    const filas = lista.map((x, i) => ({ ...x, op: i + 1 }));
    const columnas = [
      { titulo: 'N°', clave: 'op', tipo: 'numero', ancho: 6 },
      { titulo: 'Fecha', clave: 'fecha', tipo: 'fecha', ancho: 11 },
      ...(tipo === 'ventas' ? [{ titulo: 'Tipo', clave: 'tipo_documento', tipo: 'texto', ancho: 6 }] : []),
      { titulo: 'RIF / C.I.', clave: 'rif', tipo: 'texto', ancho: 14 },
      { titulo: 'Nombre o razón social', clave: 'nombre', tipo: 'texto', ancho: 30 },
      { titulo: tipo === 'ventas' ? 'N° documento' : 'N° factura', clave: 'numero_factura', tipo: 'codigo', ancho: 15 },
      { titulo: 'N° control', clave: 'numero_control', tipo: 'codigo', ancho: 13 },
      ...(tipo === 'ventas' ? [{ titulo: 'Factura afectada', clave: 'factura_afectada', tipo: 'codigo', ancho: 15 }] : []),
      { titulo: 'Total con IVA', clave: 'total_bs', tipo: 'bs' },
      { titulo: 'Exento', clave: 'exento_bs', tipo: 'bs' },
      { titulo: 'Base imponible', clave: 'base_bs', tipo: 'bs' },
      { titulo: '% IVA', clave: 'alicuota', tipo: 'porcentaje', ancho: 7 },
      { titulo: tipo === 'ventas' ? 'Débito fiscal' : 'Crédito fiscal', clave: 'iva_bs', tipo: 'bs' },
      { titulo: 'IVA retenido', clave: 'iva_retenido_bs', tipo: 'bs' },
      { titulo: 'Comprobante', clave: 'comprobante_retencion', tipo: 'codigo', ancho: 16 },
      ...(tipo === 'ventas' ? [{ titulo: 'IGTF', clave: 'igtf_bs', tipo: 'bs' }] : []),
    ];
    const totales = { nombre: 'Totales del período', total_bs: suma(lista, 'total_bs'), exento_bs: suma(lista, 'exento_bs'),
      base_bs: suma(lista, 'base_bs'), iva_bs: suma(lista, 'iva_bs'), iva_retenido_bs: suma(lista, 'iva_retenido_bs'),
      igtf_bs: suma(lista, 'igtf_bs'), _estilo: 'total' };
    return {
      titulo: tipo === 'ventas' ? 'Libro de Ventas' : 'Libro de Compras',
      subtitulo: `Período fiscal ${String(mes).padStart(2, '0')}/${anio} · Montos en Bs a la tasa BCV de cada documento`,
      moneda: 'VES',
      archivo: `Libro_de_${tipo === 'ventas' ? 'Ventas' : 'Compras'}_${periodo}`,
      resumen: [
        { etiqueta: 'Documentos', valor: lista.length, tipo: 'numero' },
        { etiqueta: 'Base imponible', valor: totales.base_bs, tipo: 'bs' },
        { etiqueta: tipo === 'ventas' ? 'Débito fiscal' : 'Crédito fiscal', valor: totales.iva_bs, tipo: 'bs' },
        { etiqueta: 'IVA retenido', valor: totales.iva_retenido_bs, tipo: 'bs' },
      ],
      secciones: [{ columnas, filas: [...filas, totales] }],
      notas: tipo === 'ventas'
        ? ['Las facturas anuladas se listan en cero. Las notas de crédito (NC) restan y las de débito (ND) suman.']
        : ['Las compras se registran a la tasa BCV del día de recepción de la factura del proveedor.'],
      calidad: {
        fuente: 'Facturas, notas fiscales, compras y retenciones registradas en el sistema.',
        confiabilidad: 'El IVA del libro concilia con el saldo contable de IVA débito/crédito fiscal.',
        oportunidad: 'Generado al momento; el libro del mes se cierra al cerrar el período contable.',
      },
    };
  }

  function construirResumen() {
    const r = datos.resumen;
    const fila = (concepto, monto, estilo) => ({ concepto, monto, _estilo: estilo });
    const columnas = [{ titulo: 'Concepto', clave: 'concepto', tipo: 'texto', ancho: 58 }, { titulo: 'Monto', clave: 'monto', tipo: 'bs' }];
    return {
      titulo: 'Resumen de IVA para la declaración',
      subtitulo: `Período fiscal ${r.periodo} · Contribuyente especial`,
      moneda: 'VES',
      archivo: `Resumen_IVA_${periodo}`,
      resumen: [{ etiqueta: 'Cuota de IVA a pagar', valor: r.cuota_a_pagar_bs, tipo: 'bs' },
        { etiqueta: 'Retenciones por enterar', valor: r.retenciones_practicadas.pendientes_bs, tipo: 'bs' }],
      secciones: [
        { titulo: 'Declaración mensual de IVA', columnas, filas: [
          fila(`Débito fiscal neto (${r.ventas.documentos} facturas, ${r.ventas.notas_credito ?? 0} NC, ${r.ventas.notas_debito ?? 0} ND)`, r.ventas.debito_fiscal_bs),
          fila(`(−) Crédito fiscal (${r.compras.documentos} compras)`, -r.compras.credito_fiscal_bs),
          fila('(−) Retenciones soportadas con comprobante', -r.retenciones_soportadas_bs),
          fila('Cuota de IVA a pagar', r.cuota_a_pagar_bs, 'total'),
          fila('Excedente de crédito fiscal para el mes siguiente', r.excedente_credito_bs),
        ] },
        { titulo: 'Obligaciones quincenales', columnas, filas: [
          fila('Retenciones practicadas · 1ra quincena', r.retenciones_practicadas.quincena_1_bs),
          fila('Retenciones practicadas · 2da quincena', r.retenciones_practicadas.quincena_2_bs),
          fila('Ya enteradas al SENIAT', r.retenciones_practicadas.enteradas_bs),
          fila('Pendientes por enterar', r.retenciones_practicadas.pendientes_bs, 'subtotal'),
          fila('IGTF percibido · 1ra quincena', r.igtf_percibido.quincena_1_bs),
          fila('IGTF percibido · 2da quincena', r.igtf_percibido.quincena_2_bs),
        ] },
      ],
      notas: ['Verifique las fechas de pago en el calendario de contribuyentes especiales del SENIAT.'],
    };
  }

  async function exportar(tipo) {
    try {
      await exportarExcel(tipo === 'resumen' ? construirResumen() : construirLibro(tipo));
    } catch (e) {
      toast.error('No se pudo generar el Excel: ' + e.message);
    }
  }

  const imprimir = (tipo) => imprimirReporte(tipo === 'resumen' ? construirResumen() : construirLibro(tipo));

  async function registrarComprobante(r) {
    const numero = window.prompt(`Comprobante de retención entregado por ${r.tercero_nombre} (14 dígitos: AAAAMM + 8):`,
      `${anio}${String(mes).padStart(2, '0')}`);
    if (!numero) return;
    const { error } = await supabase.rpc('registrar_comprobante_recibido', { p_retencion_id: r.id, p_numero: numero.trim() });
    if (error) { toast.error(error.message); return; }
    toast.success('Comprobante registrado: la retención ya se puede descontar en la declaración');
    cargar();
  }

  async function enterar(quincena) {
    if (!window.confirm(`¿Registrar el pago al SENIAT de las retenciones de la ${quincena === 1 ? '1ra' : '2da'} quincena ${String(mes).padStart(2, '0')}/${anio}?`)) return;
    const { data, error } = await supabase.rpc('enterar_retenciones_iva', { p_anio: anio, p_mes: mes, p_quincena: quincena });
    if (error) { toast.error(error.message); return; }
    const dif = Number(data.diferencial_usd);
    toast.success(`Enterados ${formatBs(data.total_bs)} (${data.comprobantes} comprobantes)` +
      (dif !== 0 ? ` · diferencial ${dif > 0 ? '+' : ''}${dif.toFixed(2)} USD` : ''));
    cargar();
  }

  const r = datos.resumen;
  const emitidas = datos.retenciones.filter((x) => x.tipo === 'EMITIDA');
  const recibidas = datos.retenciones.filter((x) => x.tipo === 'RECIBIDA');
  const porEnterar = (q) => emitidas.filter((x) => x.quincena === q && x.estado === 'REGISTRADA');
  // Solo se entera una quincena cerrada: después del día 15 o del último día del mes
  const quincenaCerrada = (q) => {
    const cierre = q === 1 ? new Date(anio, mes - 1, 15) : new Date(anio, mes, 0);
    return fechaHoy() > cierre.toLocaleDateString('en-CA');
  };

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Libros Fiscales</h1>
          <p className="page__subtitle">Libros de compras y ventas, retenciones de IVA y resumen para la declaración (montos en Bs a la tasa de cada documento)</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="month" value={periodo} max={mesActual()} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período fiscal"
            style={{ padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          <button className="btn btn--secondary" onClick={cargar} disabled={loading}><HiOutlineArrowPath /> Actualizar</button>
        </div>
      </div>

      <div className="filters-bar">
        {PESTANAS.map((p) => (
          <button key={p.id} className={`btn btn--sm ${pestana === p.id ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setPestana(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {loading && <div className="page-loading"><div className="loading-spinner" /><p>Generando libros...</p></div>}

      {!loading && pestana === 'resumen' && r && (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button className="btn btn--secondary btn--sm" onClick={() => exportar('resumen')}><HiOutlineArrowDownTray /> Excel</button>
          <button className="btn btn--secondary btn--sm" onClick={() => imprimir('resumen')}><HiOutlinePrinter /> Imprimir</button>
        </div>
      )}

      {!loading && pestana === 'resumen' && r && (
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
          <div className="card">
            <h3 className="card__title">Declaración de IVA · {r.periodo}</h3>
            <Fila etiqueta={`Débito fiscal neto (${r.ventas.documentos} facturas, ${r.ventas.anuladas} anuladas, ${r.ventas.notas_credito ?? 0} NC, ${r.ventas.notas_debito ?? 0} ND)`} valor={r.ventas.debito_fiscal_bs} />
            {Number(r.ventas.iva_rebajado_nc_bs) > 0 && (
              <p className="stat-card__sub" style={{ margin: '0.25rem 0' }}>Incluye {formatBs(r.ventas.iva_rebajado_nc_bs)} de IVA rebajado por notas de crédito.</p>
            )}
            <Fila signo="−" etiqueta={`Crédito fiscal (${r.compras.documentos} compras)`} valor={r.compras.credito_fiscal_bs} />
            <Fila signo="−" etiqueta="Retenciones que nos practicaron (con comprobante)" valor={r.retenciones_soportadas_bs} />
            <Fila etiqueta="Cuota de IVA a pagar" valor={r.cuota_a_pagar_bs} fuerte />
            {Number(r.excedente_credito_bs) > 0 && <Fila etiqueta="Excedente de crédito fiscal (traslada al mes siguiente)" valor={r.excedente_credito_bs} />}
            {Number(r.retenciones_sin_comprobante_bs) > 0 && (
              <p className="stat-card__sub" style={{ color: 'var(--warning)', marginTop: '0.6rem' }}>
                {formatBs(r.retenciones_sin_comprobante_bs)} retenidos por clientes aún sin comprobante: no se pueden descontar hasta recibirlo.
              </p>
            )}
            <p className="stat-card__sub" style={{ marginTop: '0.6rem' }}>
              Ventas: base {formatBs(r.ventas.base_bs)} · exento {formatBs(r.ventas.exento_bs)} · Compras: base {formatBs(r.compras.base_bs)}
            </p>
          </div>
          <div className="card">
            <h3 className="card__title">Obligaciones quincenales (contribuyente especial)</h3>
            <Fila etiqueta="Retenciones practicadas · 1ra quincena" valor={r.retenciones_practicadas.quincena_1_bs} />
            <Fila etiqueta="Retenciones practicadas · 2da quincena" valor={r.retenciones_practicadas.quincena_2_bs} />
            <Fila etiqueta="Ya enteradas al SENIAT" valor={r.retenciones_practicadas.enteradas_bs} />
            <Fila etiqueta="Pendientes por enterar" valor={r.retenciones_practicadas.pendientes_bs} fuerte />
            <Fila etiqueta="IGTF percibido · 1ra quincena" valor={r.igtf_percibido.quincena_1_bs} />
            <Fila etiqueta="IGTF percibido · 2da quincena" valor={r.igtf_percibido.quincena_2_bs} />
            <p className="stat-card__sub" style={{ marginTop: '0.6rem' }}>Verifique las fechas de pago en el calendario de contribuyentes especiales del SENIAT para el año en curso.</p>
          </div>
        </div>
      )}

      {!loading && (pestana === 'ventas' || pestana === 'compras') && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <h3 className="card__title" style={{ margin: 0 }}>
              {pestana === 'ventas' ? 'Libro de Ventas' : 'Libro de Compras'} · {String(mes).padStart(2, '0')}/{anio}
            </h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn--secondary btn--sm" onClick={() => exportar(pestana)}><HiOutlineArrowDownTray /> Excel</button>
              <button className="btn btn--secondary btn--sm" onClick={() => imprimir(pestana)}><HiOutlinePrinter /> Imprimir</button>
            </div>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>{pestana === 'ventas' && <th>Tipo</th>}<th>RIF / C.I.</th><th>Nombre</th><th>Documento</th><th>Control</th>
                  <th style={{ textAlign: 'right' }}>Total Bs</th><th style={{ textAlign: 'right' }}>Base Bs</th>
                  <th style={{ textAlign: 'right' }}>IVA Bs</th><th style={{ textAlign: 'right' }}>Retenido Bs</th><th>Comprobante</th>
                  {pestana === 'ventas' && <th style={{ textAlign: 'right' }}>IGTF Bs</th>}
                </tr>
              </thead>
              <tbody>
                {(pestana === 'ventas' ? datos.ventas : datos.compras).map((x) => (
                  <tr key={(x.tipo_documento || '') + x.numero_factura + (x.numero_orden || '')} className={x.estado === 'ANULADA' ? 'table__row--muted' : ''}>
                    <td>{formatFecha(x.fecha)}</td>
                    {pestana === 'ventas' && (
                      <td><span className={`badge ${x.tipo_documento === 'NC' ? 'badge--warning' : x.tipo_documento === 'ND' ? 'badge--info' : 'badge--ghost'}`}>{x.tipo_documento}</span></td>
                    )}
                    <td>{x.rif}</td>
                    <td>{x.nombre}{x.estado === 'ANULADA' && <span className="badge badge--danger" style={{ marginLeft: 6 }}>Anulada</span>}</td>
                    <td><code>{x.numero_factura}</code>{x.factura_afectada && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Afecta {x.factura_afectada}</div>}</td>
                    <td>{x.numero_control}</td>
                    <td style={{ textAlign: 'right' }}>{num(x.total_bs)}</td>
                    <td style={{ textAlign: 'right' }}>{num(x.base_bs)}</td>
                    <td style={{ textAlign: 'right' }}>{num(x.iva_bs)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(x.iva_retenido_bs) > 0 ? num(x.iva_retenido_bs) : '—'}</td>
                    <td>{x.comprobante_retencion || '—'}</td>
                    {pestana === 'ventas' && <td style={{ textAlign: 'right' }}>{Number(x.igtf_bs) > 0 ? num(x.igtf_bs) : '—'}</td>}
                  </tr>
                ))}
                {(pestana === 'ventas' ? datos.ventas : datos.compras).length === 0 && (
                  <tr><td colSpan="11" className="table__empty">Sin documentos en el período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && pestana === 'retenciones' && (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <h3 className="card__title" style={{ margin: 0 }}>Retenciones practicadas a proveedores ({emitidas.length})</h3>
              {puedeOperar && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {[1, 2].map((q) => porEnterar(q).length > 0 && quincenaCerrada(q) && (
                    <button key={q} className="btn btn--primary btn--sm" onClick={() => enterar(q)}>
                      <HiOutlineBanknotes /> Enterar {q === 1 ? '1ra' : '2da'} quincena ({porEnterar(q).length})
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr><th>Comprobante</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th style={{ textAlign: 'right' }}>IVA Bs</th>
                    <th>%</th><th style={{ textAlign: 'right' }}>Retenido Bs</th><th>Estado</th><th /></tr>
                </thead>
                <tbody>
                  {emitidas.map((x) => (
                    <tr key={x.id}>
                      <td><code>{x.numero_comprobante}</code></td>
                      <td>{formatFecha(x.fecha)} · Q{x.quincena}</td>
                      <td>{x.tercero_nombre}<div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{x.tercero_rif}</div></td>
                      <td>{x.numero_factura || 'S/N'}</td>
                      <td style={{ textAlign: 'right' }}>{num(x.iva_usd * x.tasa)}</td>
                      <td>{num(x.porcentaje)}</td>
                      <td style={{ textAlign: 'right' }}>{num(x.monto_retenido_bs)}</td>
                      <td><span className={`badge ${x.estado === 'ENTERADA' ? 'badge--success' : 'badge--warning'}`}>
                        {x.estado === 'ENTERADA' ? `Enterada ${formatFecha(x.enterada_en)}` : 'Por enterar'}</span></td>
                      <td><button className="btn btn--ghost btn--xs" onClick={() => imprimirComprobante(x)} title="Imprimir comprobante para el proveedor"><HiOutlinePrinter /></button></td>
                    </tr>
                  ))}
                  {emitidas.length === 0 && <tr><td colSpan="9" className="table__empty">Sin retenciones practicadas en el período</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3 className="card__title">Retenciones que nos practicaron clientes ({recibidas.length})</h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr><th>Fecha</th><th>Cliente</th><th>Nuestra factura</th><th style={{ textAlign: 'right' }}>IVA Bs</th>
                    <th>%</th><th style={{ textAlign: 'right' }}>Retenido Bs</th><th>Comprobante</th><th /></tr>
                </thead>
                <tbody>
                  {recibidas.map((x) => (
                    <tr key={x.id} className={x.estado === 'ANULADA' ? 'table__row--muted' : ''}>
                      <td>{formatFecha(x.fecha)}</td>
                      <td>{x.tercero_nombre}<div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{x.tercero_rif}</div></td>
                      <td><code>{x.numero_factura}</code></td>
                      <td style={{ textAlign: 'right' }}>{num(x.iva_usd * x.tasa)}</td>
                      <td>{num(x.porcentaje)}</td>
                      <td style={{ textAlign: 'right' }}>{num(x.monto_retenido_bs)}</td>
                      <td>{x.numero_comprobante ? <code>{x.numero_comprobante}</code>
                        : <span className={`badge ${x.estado === 'ANULADA' ? 'badge--danger' : 'badge--warning'}`}>{x.estado === 'ANULADA' ? 'Anulada' : 'Pendiente'}</span>}</td>
                      <td>
                        {x.estado === 'PENDIENTE' && (
                          <button className="btn btn--secondary btn--xs" onClick={() => registrarComprobante(x)}>
                            <HiOutlineDocumentCheck /> Registrar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recibidas.length === 0 && <tr><td colSpan="8" className="table__empty">Ningún cliente nos retuvo IVA en el período</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
