import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatUSD, formatBs, formatFecha, formatTasa } from '../utils/formatters';
import toast from 'react-hot-toast';
import TicketFactura from '../components/print/TicketFactura';
import Pagination from '../components/common/Pagination';
import {
  HiOutlineMagnifyingGlass, HiOutlinePrinter, HiOutlineEye,
  HiOutlineXCircle, HiOutlineFunnel,
} from 'react-icons/hi2';

import ConfirmModal from '../components/common/ConfirmModal';
import NotaFiscalModal, { imprimirNota } from '../components/notas/NotaFiscalModal';
import { useAuth } from '../contexts/AuthContext';

// Una factura solo se anula el mismo día; después se corrige con nota de crédito
const esDeHoy = (f) => new Date(f.fecha_emision).toLocaleDateString('en-CA') === new Date().toLocaleDateString('en-CA');

export default function HistorialFacturas() {
  const { profile } = useAuth();
  const puedeEmitirNotas = ['admin', 'gerente'].includes(profile?.rol);
  const [notaAEmitir, setNotaAEmitir] = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('');
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showDetalle, setShowDetalle] = useState(null);
  const [showTicket, setShowTicket] = useState(null);
  const [facturaToAnular, setFacturaToAnular] = useState(null);
  const [anulando, setAnulando] = useState(false);

  useEffect(() => { loadFacturas(); }, []);

  async function loadFacturas() {
    setLoading(true);
    try {
      let allData = [];
      const step = 1000;
      let from = 0;
      let hasMore = true;

      // PostgREST/Supabase limita cada petición a 1000 registros.
      // Iteramos con .range() para traer la totalidad del historial sin truncar.
      while (hasMore) {
        const { data, error } = await supabase
          .from('facturas')
          .select(`
            *,
            clientes(nombre, documento_identidad, contribuyente_especial, porcentaje_retencion_iva),
            usuarios!facturas_vendedor_id_fkey(nombre_completo),
            tasas_cambio(tasa_usd_bs, fecha_registro)
          `)
          .order('fecha_emision', { ascending: false })
          .range(from, from + step - 1);

        if (error) throw error;
        if (data && data.length > 0) {
          allData = allData.concat(data);
          from += step;
          if (data.length < step) hasMore = false;
        } else {
          hasMore = false;
        }
      }

      setFacturas(allData);
    } catch (e) {
      console.error('Error cargando historial de facturas:', e);
      toast.error('Error al cargar historial completo');
    } finally {
      setLoading(false);
    }
  }

  async function verDetalle(factura) {
    const [{ data: detalles }, { data: notas }] = await Promise.all([
      supabase.from('detalles_factura').select('*').eq('factura_id', factura.id),
      supabase.from('notas_fiscales').select('*').eq('factura_id', factura.id).order('fecha_emision'),
    ]);
    setShowDetalle({ ...factura, detalles: detalles || [], notas: notas || [] });
  }

  async function handleConfirmAnular() {
    if (!facturaToAnular) return;
    const motivo = window.prompt(`Motivo de la anulación de ${facturaToAnular.numero_factura}:`);
    if (!motivo?.trim()) {
      toast.error('Debe indicar el motivo de la anulación');
      return;
    }
    setAnulando(true);
    try {
      // Anula, devuelve stock, anula la CxC y registra el contra-asiento.
      const { error } = await supabase.rpc('anular_factura', {
        p_factura_id: facturaToAnular.id,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      toast.success(`Factura ${facturaToAnular.numero_factura} anulada. El inventario ha sido revertido.`);
      await loadFacturas();
      if (showDetalle && showDetalle.id === facturaToAnular.id) {
        setShowDetalle(prev => prev ? { ...prev, estado: 'anulada' } : null);
      }
      setFacturaToAnular(null);
    } catch (error) {
      toast.error('Error al anular la factura: ' + error.message);
    } finally {
      setAnulando(false);
    }
  }

  async function imprimirFactura(factura) {
    try {
      let detalles = factura.detalles;
      if (!detalles || detalles.length === 0) {
        const { data } = await supabase
          .from('detalles_factura')
          .select('*')
          .eq('factura_id', factura.id);
        detalles = data || [];
      }
      const ticketData = {
        ...factura,
        cliente: factura.clientes || factura.cliente,
        vendedor: factura.usuarios || factura.vendedor,
        tasa: factura.tasas_cambio || factura.tasa,
        detalles: detalles,
        metodos_pago_detalle: factura.metodos_pago,
      };
      setShowTicket(ticketData);
    } catch (e) {
      toast.error('Error al preparar impresión: ' + e.message);
    }
  }

  const facturasFiltradas = facturas.filter(f => {
    const matchSearch = !search ||
      f.numero_factura.toLowerCase().includes(search.toLowerCase()) ||
      f.clientes?.nombre?.toLowerCase().includes(search.toLowerCase()) ||
      f.usuarios?.nombre_completo?.toLowerCase().includes(search.toLowerCase()) ||
      (f.metodos_pago || []).some(m =>
        (m.metodo && m.metodo.toLowerCase().includes(search.toLowerCase())) ||
        (m.referencia && m.referencia.toLowerCase().includes(search.toLowerCase()))
      );
    const matchEstado = !filtroEstado || f.estado === filtroEstado;
    const matchDesde = !filtroFechaDesde || new Date(f.fecha_emision) >= new Date(filtroFechaDesde);
    const matchHasta = !filtroFechaHasta || new Date(f.fecha_emision) <= new Date(filtroFechaHasta + 'T23:59:59');
    return matchSearch && matchEstado && matchDesde && matchHasta;
  });

  const pageSize = 20;
  const facturasPaginadas = facturasFiltradas.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filtroEstado, filtroFechaDesde, filtroFechaHasta]);

  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando historial...</p></div>;

  return (
    <div className="page">
      {showTicket && (
        <TicketFactura factura={showTicket} onClose={() => setShowTicket(null)} />
      )}

      <div className="page__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 className="page__title" style={{ margin: 0 }}>Historial de Facturas</h1>
          <span className="badge badge--primary" style={{ fontSize: '0.85rem' }}>
            {facturasFiltradas.length} {facturasFiltradas.length === 1 ? 'factura' : 'facturas'}
          </span>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <HiOutlineMagnifyingGlass className="search-box__icon" />
          <input placeholder="Buscar por número, cliente o vendedor..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="emitida">Emitida</option>
          <option value="anulada">Anulada</option>
        </select>
        <input type="date" value={filtroFechaDesde} onChange={e => setFiltroFechaDesde(e.target.value)} />
        <input type="date" value={filtroFechaHasta} onChange={e => setFiltroFechaHasta(e.target.value)} />
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>N° Factura</th>
                <th>Cliente</th>
                <th>Vendedor</th>
                <th>Total USD</th>
                <th>Total Bs</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {facturasPaginadas.map(f => {
                const hasCashea = (f.metodos_pago || []).some(mp => mp.metodo_id === 'cashea' || mp.metodo?.toLowerCase?.().includes('cashea'));
                return (
                  <tr key={f.id} className={f.estado === 'anulada' ? 'table__row--muted' : ''}>
                    <td>
                      <code>{f.numero_factura}</code>
                      {hasCashea && (
                        <span className="badge" style={{ marginLeft: '6px', fontSize: '0.65rem', background: 'rgba(236, 72, 153, 0.15)', color: '#EC4899', border: '1px solid rgba(236, 72, 153, 0.35)', verticalAlign: 'middle', fontWeight: 600 }}>
                          Cashea
                        </span>
                      )}
                    </td>
                    <td>{f.clientes?.nombre}</td>
                    <td>{f.usuarios?.nombre_completo}</td>
                    <td>{formatUSD(f.total_usd)}</td>
                    <td>{formatBs(f.total_bs)}</td>
                    <td>
                      <span className={`badge badge--${f.estado === 'emitida' ? 'success' : 'danger'}`}>
                        {f.estado.charAt(0).toUpperCase() + f.estado.slice(1)}
                      </span>
                    </td>
                    <td>{formatFecha(f.fecha_emision, true)}</td>
                    <td>
                      <div className="table__actions">
                        <button className="btn btn--ghost btn--xs" onClick={() => verDetalle(f)} title="Ver detalle"><HiOutlineEye /></button>
                        {f.estado === 'emitida' && (
                          <>
                            <button className="btn btn--ghost btn--xs" onClick={() => imprimirFactura(f)} title="Imprimir Ticket"><HiOutlinePrinter /></button>
                            {esDeHoy(f) && (
                              <button className="btn btn--ghost btn--xs text-danger" onClick={() => setFacturaToAnular(f)} title="Anular Factura (solo el mismo día)"><HiOutlineXCircle /></button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {facturasFiltradas.length === 0 && <tr><td colSpan="8" className="table__empty">No se encontraron facturas</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={facturasFiltradas.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Detail Modal */}
      {showDetalle && (
        <div className="modal-overlay" onClick={() => setShowDetalle(null)}>
          <div className="modal modal--lg" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Factura {showDetalle.numero_factura}</h2>
              <span className={`badge badge--${showDetalle.estado === 'emitida' ? 'success' : 'danger'}`}>
                {showDetalle.estado}
              </span>
            </div>
            <div className="modal__form">
              <div className="form-row">
                <p><strong>Cliente:</strong> {showDetalle.clientes?.nombre} ({showDetalle.clientes?.documento_identidad})</p>
                <p><strong>Vendedor:</strong> {showDetalle.usuarios?.nombre_completo}</p>
              </div>
              <p><strong>Fecha:</strong> {formatFecha(showDetalle.fecha_emision, true)}</p>
              <p><strong>Tasa:</strong> {formatTasa(showDetalle.tasas_cambio?.tasa_usd_bs)}</p>

              <h4 style={{ marginTop: '1rem' }}>Productos</h4>
              <table className="table">
                <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
                <tbody>
                  {(showDetalle.detalles || []).map(d => (
                    <tr key={d.id}>
                      <td>{d.producto_nombre}</td>
                      <td>{d.cantidad}</td>
                      <td>{formatUSD(d.precio_unitario_usd)}</td>
                      <td>{formatUSD(d.subtotal_usd || d.cantidad * d.precio_unitario_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pos-totals" style={{ marginTop: '1rem' }}>
                <div className="pos-totals__row pos-totals__row--total"><span>Total USD:</span><span>{formatUSD(showDetalle.total_usd)}</span></div>
                <div className="pos-totals__row pos-totals__row--bs"><span>Total Bs:</span><span>{formatBs(showDetalle.total_bs)}</span></div>
              </div>

              <h4 style={{ marginTop: '1rem' }}>Métodos de Pago</h4>
              {(() => {
                const esMetodoEnBs = (mp) => {
                  if (!mp) return false;
                  const id = (mp.metodo_id || mp.id || '').toLowerCase();
                  const nombre = (mp.metodo || mp.label || '').toLowerCase();
                  return (
                    id === 'punto_venta' ||
                    id === 'pago_movil' ||
                    id === 'efectivo_bs' ||
                    id === 'transferencia' ||
                    nombre.includes('punto') ||
                    nombre.includes('pago móvil') ||
                    nombre.includes('pago movil') ||
                    nombre.includes('efectivo bs') ||
                    nombre.includes('transferencia') ||
                    nombre.includes('bolívares') ||
                    nombre.includes('bolivares') ||
                    mp.enBs === true
                  );
                };

                const metodosPago = showDetalle.metodos_pago || [];
                const casheaItem = metodosPago.find(mp => mp.metodo_id === 'cashea' || mp.metodo?.toLowerCase?.().includes('cashea'));
                const tasaValor = showDetalle.tasas_cambio?.tasa_usd_bs || (showDetalle.total_usd > 0 ? (showDetalle.total_bs / showDetalle.total_usd) : 0);

                if (casheaItem) {
                  const otrosMetodos = metodosPago.filter(mp => mp !== casheaItem);
                  
                  let desgloseInicial = [];
                  if (Array.isArray(casheaItem.desglose_inicial) && casheaItem.desglose_inicial.length > 0) {
                    desgloseInicial = casheaItem.desglose_inicial;
                  } else {
                    const casheaPropio = parseFloat(casheaItem.inicial_usd ?? casheaItem.monto_usd ?? 0);
                    if (casheaPropio > 0 || otrosMetodos.length === 0) {
                      desgloseInicial.push({
                        metodo: casheaItem.cashea_metodo_inicial_label || casheaItem.cashea_metodo_inicial || 'Punto de Venta',
                        metodo_id: casheaItem.cashea_metodo_inicial || 'punto_venta',
                        monto_usd: casheaPropio,
                        monto_bs: casheaItem.inicial_bs || (tasaValor > 0 ? parseFloat((casheaPropio * tasaValor).toFixed(2)) : 0),
                        referencia: casheaItem.cashea_referencia_inicial,
                      });
                    }
                    otrosMetodos.forEach(om => {
                      const omUSD = parseFloat(om.monto_usd || 0);
                      desgloseInicial.push({
                        metodo: om.metodo,
                        metodo_id: om.metodo_id,
                        monto_usd: omUSD,
                        monto_bs: om.monto_bs || (tasaValor > 0 ? parseFloat((omUSD * tasaValor).toFixed(2)) : 0),
                        referencia: om.referencia,
                        titular: om.zelle_titular,
                      });
                    });
                  }

                  const totalInicialUSD = desgloseInicial.reduce((s, d) => s + (parseFloat(d.monto_usd) || 0), 0);
                  const totalInicialBs = tasaValor > 0 ? parseFloat((totalInicialUSD * tasaValor).toFixed(2)) : 0;

                  let debiendoUSD = 0;
                  if (casheaItem.credito_cashea_usd !== undefined && casheaItem.credito_cashea_usd !== null && !isNaN(Number(casheaItem.credito_cashea_usd))) {
                    debiendoUSD = parseFloat(casheaItem.credito_cashea_usd);
                  } else {
                    debiendoUSD = Math.max(0, parseFloat(((parseFloat(showDetalle.total_usd) || 0) - totalInicialUSD).toFixed(2)));
                  }

                  let debiendoBs = 0;
                  if (casheaItem.credito_cashea_bs !== undefined && casheaItem.credito_cashea_bs !== null && !isNaN(Number(casheaItem.credito_cashea_bs)) && Number(casheaItem.credito_cashea_bs) > 0) {
                    debiendoBs = parseFloat(casheaItem.credito_cashea_bs);
                  } else if (tasaValor > 0 && debiendoUSD > 0) {
                    debiendoBs = parseFloat((debiendoUSD * tasaValor).toFixed(2));
                  }

                  return (
                    <div
                      style={{
                        margin: '0.75rem 0',
                        padding: '0.85rem',
                        background: 'rgba(236, 72, 153, 0.07)',
                        border: '1px solid rgba(236, 72, 153, 0.35)',
                        borderRadius: '8px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                        <span style={{ fontWeight: 'bold', color: '#EC4899', fontSize: '0.95rem' }}>
                          Pago Financiado Cashea
                        </span>
                        {casheaItem.referencia && (
                          <span className="badge" style={{ background: '#EC4899', color: '#fff', fontSize: '0.75rem' }}>
                            N° Orden Cashea: {casheaItem.referencia}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
                        {/* Tarjeta Inicial */}
                        <div style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                          <div style={{ fontSize: '0.72rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Inicial Pagada (en Tienda)
                          </div>
                          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10B981', marginTop: '2px' }}>
                            {formatUSD(totalInicialUSD)}
                          </div>
                          {totalInicialBs > 0 && (
                            <div style={{ fontSize: '0.75rem', color: '#aaa' }}>
                              Ref. {formatBs(totalInicialBs)}
                            </div>
                          )}
                          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                            <strong style={{ color: '#ddd' }}>Métodos de la Inicial:</strong>
                            {desgloseInicial.map((di, idx) => {
                              const diUSD = parseFloat(di.monto_usd || 0);
                              const diBs = di.monto_bs !== undefined && di.monto_bs !== null && Number(di.monto_bs) > 0
                                ? Number(di.monto_bs)
                                : (tasaValor > 0 ? diUSD * tasaValor : 0);
                              const isBs = esMetodoEnBs(di);

                              return (
                                <div key={idx} style={{ color: '#ccc', marginTop: '2px' }}>
                                  • <strong>{di.metodo}:</strong> {isBs ? `${formatBs(diBs)} (Ref. ${formatUSD(diUSD)})` : `${formatUSD(diUSD)}`}
                                  {di.referencia ? ` (N° Op: ${di.referencia})` : ''}
                                  {di.titular ? ` (Emisor: ${di.titular})` : ''}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Tarjeta Monto Financiado Cashea */}
                        <div style={{ background: 'rgba(236, 72, 153, 0.1)', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(236, 72, 153, 0.3)' }}>
                          <div style={{ fontSize: '0.72rem', color: '#EC4899', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Monto Financiado Cashea
                          </div>
                          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#EC4899', marginTop: '2px' }}>
                            {formatUSD(debiendoUSD)}
                          </div>
                          {debiendoBs > 0 && (
                            <div style={{ fontSize: '0.75rem', color: '#aaa' }}>
                              Ref. {formatBs(debiendoBs)}
                            </div>
                          )}
                          <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', color: '#aaa', fontStyle: 'italic' }}>
                            * Saldo por pagar en cuotas mediante App Cashea
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return metodosPago.map((mp, i) => {
                  const extraInfo = [];
                  if (mp.zelle_titular) extraInfo.push(`Emisor: ${mp.zelle_titular}`);
                  if (mp.zelle_email) extraInfo.push(`Correo: ${mp.zelle_email}`);
                  if (mp.referencia) extraInfo.push(`N° Op: ${mp.referencia}`);

                  const montoUSD = parseFloat(mp.monto_usd || 0);
                  const montoBs = mp.monto_bs !== undefined && mp.monto_bs !== null && Number(mp.monto_bs) > 0
                    ? Number(mp.monto_bs)
                    : (tasaValor > 0 ? (montoUSD * tasaValor) : 0);
                  const isBs = esMetodoEnBs(mp);

                  if (isBs) {
                    return (
                      <div key={i} className="pos-totals__row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{mp.metodo} {extraInfo.length > 0 ? `(${extraInfo.join(' | ')})` : ''}</span>
                        <span style={{ fontWeight: 'bold' }}>
                          {formatBs(montoBs)} <small style={{ color: '#aaa', fontWeight: 'normal' }}>(Ref. {formatUSD(montoUSD)})</small>
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div key={i} className="pos-totals__row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{mp.metodo} {extraInfo.length > 0 ? `(${extraInfo.join(' | ')})` : ''}</span>
                      <span style={{ fontWeight: 'bold' }}>
                        {formatUSD(montoUSD)} {montoBs > 0 ? <small style={{ color: '#aaa', fontWeight: 'normal' }}>(Ref. {formatBs(montoBs)})</small> : ''}
                      </span>
                    </div>
                  );
                });
              })()}

              {(showDetalle.notas || []).length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <h4 style={{ marginBottom: '0.5rem' }}>Notas de crédito y débito</h4>
                  {showDetalle.notas.map((n) => (
                    <div key={n.id} className="pos-totals__row" style={{ alignItems: 'center' }}>
                      <span>
                        <span className={`badge ${n.tipo === 'CREDITO' ? 'badge--warning' : 'badge--info'}`}>{n.tipo === 'CREDITO' ? 'NC' : 'ND'}</span>{' '}
                        <code>{n.numero}</code> · {formatFecha(n.fecha_emision)} · {n.motivo}
                      </span>
                      <span>
                        {n.tipo === 'CREDITO' ? '−' : '+'}{formatUSD(n.total_usd)}
                        <button className="btn btn--ghost btn--xs" onClick={() => imprimirNota(n, showDetalle)} title="Imprimir nota"><HiOutlinePrinter /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pos-payment-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {showDetalle.estado === 'emitida' && (
                  <>
                    <button className="btn btn--primary" onClick={() => imprimirFactura(showDetalle)}>
                      <HiOutlinePrinter /> Imprimir Ticket
                    </button>
                    {puedeEmitirNotas && (
                      <>
                        <button className="btn btn--secondary" onClick={() => setNotaAEmitir('CREDITO')}>Nota de crédito</button>
                        <button className="btn btn--secondary" onClick={() => setNotaAEmitir('DEBITO')}>Nota de débito</button>
                      </>
                    )}
                    {esDeHoy(showDetalle) && (showDetalle.notas || []).length === 0 && (
                      <button className="btn btn--ghost text-danger" onClick={() => setFacturaToAnular(showDetalle)}>
                        <HiOutlineXCircle /> Anular Factura
                      </button>
                    )}
                  </>
                )}
                <button className="btn btn--ghost" onClick={() => setShowDetalle(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {notaAEmitir && showDetalle && (
        <NotaFiscalModal
          factura={showDetalle}
          tipo={notaAEmitir}
          onClose={() => setNotaAEmitir(null)}
          onEmitida={() => {
            setNotaAEmitir(null);
            verDetalle(showDetalle);
          }}
        />
      )}

      {/* Confirmation Modal for Voiding Invoices */}
      <ConfirmModal
        isOpen={!!facturaToAnular}
        title={`¿Anular Factura ${facturaToAnular?.numero_factura}?`}
        message="El estado de la factura pasará a ANULADA y el stock de todos los productos incluidos será devuelto automáticamente al inventario. Esta acción es irreversible."
        confirmText="Sí, Anular Factura"
        cancelText="Volver"
        variant="danger"
        loading={anulando}
        onConfirm={handleConfirmAnular}
        onCancel={() => !anulando && setFacturaToAnular(null)}
      />
    </div>
  );
}
