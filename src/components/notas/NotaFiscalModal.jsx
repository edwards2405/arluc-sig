import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { formatUSD, formatFecha } from '../../utils/formatters';
import { getEmpresaConfig } from '../../utils/constants';

const REINTEGROS = [
  { id: 'efectivo_usd', label: 'Efectivo USD' },
  { id: 'efectivo_bs', label: 'Efectivo Bs' },
  { id: 'pago_movil', label: 'Pago Móvil' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'zelle', label: 'Zelle' },
  { id: 'saldo_favor', label: 'Saldo a favor del cliente' },
  { id: 'credito_cxc', label: 'Rebajar su cuenta por cobrar' },
];
const COBROS = [
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'pago_movil', label: 'Pago Móvil' },
  { id: 'punto_venta', label: 'Punto de Venta' },
  { id: 'efectivo_usd', label: 'Efectivo USD' },
  { id: 'efectivo_bs', label: 'Efectivo Bs' },
  { id: 'zelle', label: 'Zelle' },
  { id: 'credito', label: 'A crédito (nueva cuenta por cobrar)' },
];

const redondear = (n) => Math.round(n * 100) / 100;

/** Impresión de la nota de crédito o débito con referencia a la factura afectada. */
export function imprimirNota(nota, factura) {
  const empresa = getEmpresaConfig();
  const ventana = window.open('', '_blank', 'width=720,height=640');
  if (!ventana) {
    toast.error('Permita las ventanas emergentes para imprimir');
    return;
  }
  const fila = (a, b) => `<tr><td style="padding:4px 0">${a}</td><td style="text-align:right">${b}</td></tr>`;
  ventana.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${nota.numero}</title></head>
<body style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px">
<h3 style="text-align:center;margin:0">${empresa.nombre}</h3><p style="text-align:center;margin:4px 0">RIF ${empresa.rif} · ${empresa.direccion}</p>
<h2 style="text-align:center">NOTA DE ${nota.tipo === 'CREDITO' ? 'CRÉDITO' : 'DÉBITO'} N° ${nota.numero}</h2>
<table style="width:100%;font-size:13px">
${fila('N° de control', nota.numero_control)}${fila('Fecha', formatFecha(nota.fecha_emision, true))}
${fila('Factura afectada', `${factura.numero_factura} (control ${factura.numero_control || 'S/N'}) del ${formatFecha(factura.fecha_emision)}`)}
${fila('Cliente', `${nota.cliente_nombre || 'Consumidor final'} ${nota.cliente_documento || ''}`)}
${fila('Concepto', nota.concepto.replace('_', ' '))}${fila('Motivo', nota.motivo)}
</table><hr>
<table style="width:100%;font-size:13px">
${fila('Base imponible', formatUSD(nota.base_imponible_usd))}${Number(nota.exento_usd) > 0 ? fila('Exento', formatUSD(nota.exento_usd)) : ''}
${fila(`IVA ${Number(nota.alicuota_iva)}%`, formatUSD(nota.iva_usd))}${fila('<b>Total</b>', `<b>${formatUSD(nota.total_usd)}</b>`)}
${Number(nota.iva_retenido_usd) > 0 ? fila('IVA retenido por el comprador', formatUSD(nota.iva_retenido_usd)) : ''}
${fila(nota.tipo === 'CREDITO' ? 'Reintegrado' : 'Cobrado', `${formatUSD(nota.monto_liquidado_usd)} (${nota.metodo})`)}
${fila('Total en Bs (tasa ' + Number(nota.tasa).toFixed(4) + ')', 'Bs ' + Number(nota.total_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 }))}
</table>
<script>window.onload = () => window.print();</script></body></html>`);
  ventana.document.close();
}

export default function NotaFiscalModal({ factura, tipo, onClose, onEmitida }) {
  const esCredito = tipo === 'CREDITO';
  const [saldo, setSaldo] = useState(null);
  const [concepto, setConcepto] = useState(esCredito ? 'DEVOLUCION' : 'CARGO_ADICIONAL');
  const [cantidades, setCantidades] = useState({});
  const [montoBase, setMontoBase] = useState('');
  const [motivo, setMotivo] = useState('');
  const [metodo, setMetodo] = useState('transferencia');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    supabase.rpc('saldo_notas_factura', { p_factura_id: factura.id }).then(({ data, error }) => {
      if (error) toast.error(error.message);
      setSaldo(data);
    });
  }, [factura.id]);

  if (!saldo) {
    return (
      <div className="modal-overlay"><div className="modal"><div className="modal__body"><p>Cargando la factura...</p></div></div></div>
    );
  }

  // Vista previa (el servidor recalcula y valida)
  const alicuota = Number(factura.alicuota_iva || 16);
  const pctRet = esCredito
    ? Number(saldo.porcentaje_retencion || 0)
    : factura.clientes?.contribuyente_especial ? Number(factura.clientes.porcentaje_retencion_iva || 75) : 0;
  let base = 0;
  if (esCredito && concepto === 'DEVOLUCION') {
    base = saldo.productos.reduce((s, p) => s + (Number(cantidades[p.producto_id]) || 0) * Number(p.precio_unitario_usd), 0);
  } else {
    base = Number(montoBase) || 0;
  }
  base = redondear(base);
  const iva = redondear(base * alicuota / 100);
  const retencion = redondear(iva * pctRet / 100);
  const total = redondear(base + iva);
  const liquidado = redondear(total - retencion);

  async function emitir(e) {
    e.preventDefault();
    setGuardando(true);
    const items = Object.entries(cantidades)
      .filter(([, c]) => Number(c) > 0)
      .map(([producto_id, cantidad]) => ({ producto_id, cantidad: Number(cantidad) }));
    const { data, error } = esCredito
      ? await supabase.rpc('emitir_nota_credito', {
          p_factura_id: factura.id, p_concepto: concepto, p_items: concepto === 'DEVOLUCION' ? items : null,
          p_monto_base: concepto === 'DESCUENTO' ? Number(montoBase) : null, p_motivo: motivo, p_metodo: metodo,
        })
      : await supabase.rpc('emitir_nota_debito', {
          p_factura_id: factura.id, p_concepto: concepto, p_monto_base: Number(montoBase), p_motivo: motivo, p_metodo: metodo,
        });
    setGuardando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${data.numero} emitida por ${formatUSD(data.total_usd)}`);
    imprimirNota(data, factura);
    onEmitida?.(data);
  }

  const metodos = esCredito ? REINTEGROS : COBROS;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 400 }}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Nota de {esCredito ? 'crédito' : 'débito'} · {factura.numero_factura}</h2>
          <button className="modal__close" onClick={onClose}>×</button>
        </div>
        <form className="modal__body" onSubmit={emitir}>
          <div className="form-row">
            <div className="form-group">
              <label>Concepto</label>
              <select value={concepto} onChange={(e) => setConcepto(e.target.value)}>
                {esCredito ? (
                  <>
                    <option value="DEVOLUCION">Devolución de mercancía</option>
                    <option value="DESCUENTO">Descuento o rebaja posterior</option>
                  </>
                ) : (
                  <>
                    <option value="CARGO_ADICIONAL">Cargo adicional (flete, instalación…)</option>
                    <option value="AJUSTE_PRECIO">Ajuste de precio</option>
                  </>
                )}
              </select>
            </div>
            <div className="form-group">
              <label>{esCredito ? 'Forma de reintegro' : 'Forma de cobro'}</label>
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                {metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              {metodo === 'credito_cxc' && <small>Saldo a crédito de la factura: {formatUSD(saldo.cxc_pendiente_usd)}</small>}
            </div>
          </div>

          {esCredito && concepto === 'DEVOLUCION' ? (
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Producto</th><th>Vendidos</th><th>Ya devueltos</th><th>Devolver</th></tr></thead>
                <tbody>
                  {saldo.productos.map((p) => (
                    <tr key={p.producto_id}>
                      <td>{p.producto_nombre}<div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatUSD(p.precio_unitario_usd)} c/u</div></td>
                      <td>{p.vendidos}</td>
                      <td>{p.devueltos}</td>
                      <td style={{ width: '6rem' }}>
                        <input type="number" min="0" max={p.disponibles} disabled={p.disponibles === 0}
                          value={cantidades[p.producto_id] || ''}
                          onChange={(e) => setCantidades({ ...cantidades, [p.producto_id]: Math.min(Number(e.target.value), p.disponibles) })}
                          style={{ width: '100%', padding: '0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="form-group">
              <label>Monto (base sin IVA, USD)</label>
              <input type="number" step="0.01" min="0.01" required value={montoBase} onChange={(e) => setMontoBase(e.target.value)} />
              {esCredito && <small>Disponible para rebajar: {formatUSD(saldo.base_disponible_usd)}</small>}
            </div>
          )}

          <div className="form-group">
            <label>Motivo (aparece en la nota)</label>
            <input required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Producto con falla de fábrica" />
          </div>

          <div className="pos-totals">
            <div className="pos-totals__row"><span>Base imponible</span><span>{formatUSD(base)}</span></div>
            <div className="pos-totals__row"><span>IVA {alicuota}%</span><span>{formatUSD(iva)}</span></div>
            <div className="pos-totals__row pos-totals__row--total"><span>Total de la nota</span><span>{formatUSD(total)}</span></div>
            {retencion > 0 && (
              <div className="pos-totals__row"><span>Retención IVA {pctRet}% del cliente</span><span>{formatUSD(retencion)}</span></div>
            )}
            <div className="pos-totals__row" style={{ fontWeight: 700 }}>
              <span>{esCredito ? 'A reintegrar' : 'A cobrar'}</span><span>{formatUSD(liquidado)}</span>
            </div>
          </div>
          <small style={{ color: 'var(--text-secondary)' }}>
            {esCredito
              ? 'La rebaja fiscal se valora a la tasa de la factura original; el reintegro, a la tasa de hoy. El IGTF de la venta no se devuelve.'
              : 'La nota de débito es una operación nueva: se valora a la tasa de hoy.'}
          </small>

          <button type="submit" className="btn btn--primary btn--full" disabled={guardando || base <= 0}>
            {guardando ? 'Emitiendo...' : `Emitir nota de ${esCredito ? 'crédito' : 'débito'}`}
          </button>
        </form>
      </div>
    </div>
  );
}
