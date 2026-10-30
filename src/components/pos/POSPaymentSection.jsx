import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';
import { METODOS_PAGO, METODOS_INICIAL_CASHEA } from '../../utils/constants';
import { formatUSD, formatBs } from '../../utils/formatters';

export default function POSPaymentSection({
  totalUSD,
  totalBs,
  baseGravada,
  montoExento,
  montoIva,
  montoIgtf,
  fiscal,
  tasaHoy,
  showPago,
  carrito,
  clienteSeleccionado,
  metodosPago,
  loading,
  tieneCashea,
  tieneCredito,
  montoCredito,
  totalPagadoEnTienda,
  casheaCreditoUSD,
  restante,
  onIniciarCobro,
  onAgregarMetodoPago,
  onActualizarMetodoPago,
  onQuitarMetodoPago,
  onEmitirFactura,
  onVolverAlCarrito,
  onLimpiarCaja,
}) {
  const tieneContenido = carrito.length > 0 || !!clienteSeleccionado;

  return (
    <div className="pos-summary">
      <div className="card">
        <h3 className="card__title">Resumen</h3>

        <div className="pos-totals">
          <div className="pos-totals__row">
            <span>Base imponible</span>
            <span>{formatUSD(baseGravada)}</span>
          </div>
          {montoExento > 0 && (
            <div className="pos-totals__row">
              <span>Exento</span>
              <span>{formatUSD(montoExento)}</span>
            </div>
          )}
          <div className="pos-totals__row">
            <span>IVA {Number(fiscal.alicuota_iva)}%</span>
            <span>{formatUSD(montoIva)}</span>
          </div>
          <div className="pos-totals__row pos-totals__row--total">
            <span>Total USD</span>
            <span>{formatUSD(totalUSD)}</span>
          </div>
          {tasaHoy && (
            <div className="pos-totals__row pos-totals__row--bs">
              <span>Total Bs</span>
              <span>{formatBs(totalBs)}</span>
            </div>
          )}
        </div>

        {!showPago ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <button
              type="button"
              className="btn btn--primary btn--full"
              onClick={onIniciarCobro}
              disabled={carrito.length === 0}
            >
              Cobrar {formatUSD(totalUSD)}
            </button>

            {tieneContenido && (
              <button
                type="button"
                className="btn btn--ghost btn--full"
                onClick={onLimpiarCaja}
                style={{
                  color: 'var(--danger, #EF4444)',
                  border: '1px dashed rgba(239, 68, 68, 0.4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                }}
                title="Limpiar cuenta y reiniciar venta"
              >
                <HiOutlineTrash /> Limpiar Caja / Cancelar Venta
              </button>
            )}
          </div>
        ) : (
          <div className="pos-payment">
            <h4>Métodos de Pago</h4>

            {metodosPago.map((mp, index) => {
              const metodoConfig = METODOS_PAGO.find((m) => m.id === mp.metodo);
              return (
                <div key={index} className="pos-payment-method">
                  <div className="pos-payment-method__header">
                    <select
                      value={mp.metodo}
                      onChange={(e) => onActualizarMetodoPago(index, 'metodo', e.target.value)}
                    >
                      <option value="">Seleccionar método...</option>
                      {METODOS_PAGO.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn--ghost btn--xs text-danger"
                      onClick={() => onQuitarMetodoPago(index)}
                      title="Eliminar método"
                    >
                      <HiOutlineTrash />
                    </button>
                  </div>

                  {mp.metodo && (
                    <>
                      <div className="pos-payment-method__amounts">
                        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                          <label
                            style={{
                              fontSize: '0.75rem',
                              color: metodoConfig?.isCashea ? '#EC4899' : undefined,
                              fontWeight: metodoConfig?.isCashea ? 'bold' : undefined,
                            }}
                          >
                          {metodoConfig?.isCashea ? 'Inicial Cashea ($ USD)' : metodoConfig?.isCredito ? 'Monto a Crédito ($ USD)' : 'Monto ($ USD)'}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={mp.monto_usd ?? ''}
                            onChange={(e) => onActualizarMetodoPago(index, 'monto_usd', e.target.value)}
                          />
                        </div>

                        {metodoConfig?.enBs && (
                          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>Monto (Bs)</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={mp.monto_bs ?? ''}
                              onChange={(e) => onActualizarMetodoPago(index, 'monto_bs', e.target.value)}
                            />
                          </div>
                        )}
                      </div>

                      {/* Crédito: nota informativa */}
                      {metodoConfig?.isCredito && (
                        <div style={{
                          marginTop: '0.5rem',
                          background: 'rgba(99,102,241,0.1)',
                          border: '1px solid rgba(99,102,241,0.3)',
                          borderRadius: '6px',
                          padding: '0.5rem 0.65rem',
                          fontSize: '0.78rem',
                          color: 'rgba(99,102,241,0.9)',
                        }}>
                          {clienteSeleccionado ? (
                            clienteSeleccionado.credito_activo ? (
                              <span>El monto quedará pendiente de cobro en la cuenta del cliente <strong>{clienteSeleccionado.nombre}</strong>.</span>
                            ) : (
                              <span style={{ color: 'var(--danger,#EF4444)', fontWeight: 600 }}>
                                ⚠️ Este cliente no tiene crédito activo. No se podrá emitir.
                              </span>
                            )
                          ) : (
                            <span style={{ color: 'var(--danger,#EF4444)', fontWeight: 600 }}>
                              ⚠️ Debe seleccionar un cliente para ventas a crédito.
                            </span>
                          )}
                        </div>
                      )}

                      {/* Zelle: Titular y Correo */}
                      {metodoConfig?.isZelle && (
                        <div className="pos-payment-method__zelle">
                          <div className="form-group" style={{ marginBottom: '0.35rem' }}>
                            <input
                              type="text"
                              placeholder="Nombre / Titular del Emisor Zelle"
                              value={mp.zelle_titular || ''}
                              onChange={(e) => onActualizarMetodoPago(index, 'zelle_titular', e.target.value)}
                              required
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <input
                              type="email"
                              placeholder="Correo del Emisor Zelle"
                              value={mp.zelle_email || ''}
                              onChange={(e) => onActualizarMetodoPago(index, 'zelle_email', e.target.value)}
                              required
                            />
                          </div>
                        </div>
                      )}

                      {/* Cashea: Inicial en tienda y resto a crédito */}
                      {metodoConfig?.isCashea && (
                        <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          <div
                            style={{
                              background: 'rgba(234, 179, 8, 0.1)',
                              border: '1px solid rgba(234, 179, 8, 0.3)',
                              borderRadius: '6px',
                              padding: '0.5rem 0.65rem',
                              fontSize: '0.78rem',
                              color: '#FACC15',
                            }}
                          >
                            <span>El cliente paga esta inicial en tienda. El resto queda a crédito Cashea.</span>
                          </div>

                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                              Método de Pago de la Inicial:
                            </label>
                            <select
                              value={mp.cashea_metodo_inicial || 'punto_venta'}
                              onChange={(e) => onActualizarMetodoPago(index, 'cashea_metodo_inicial', e.target.value)}
                              style={{ marginTop: '0.2rem' }}
                            >
                              {METODOS_INICIAL_CASHEA.map((mi) => (
                                <option key={mi.id} value={mi.id}>
                                  {mi.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {METODOS_INICIAL_CASHEA.find(
                            (mi) => mi.id === (mp.cashea_metodo_inicial || 'punto_venta')
                          )?.requiereReferencia && (
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <input
                                type="text"
                                placeholder="N° Referencia del Pago de la Inicial"
                                value={mp.cashea_referencia_inicial || ''}
                                onChange={(e) => onActualizarMetodoPago(index, 'cashea_referencia_inicial', e.target.value)}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Referencia general */}
                      {metodoConfig?.requiereReferencia && (
                        <div className="form-group" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
                          <input
                            type="text"
                            placeholder={
                              mp.metodo === 'pago_movil'
                                ? 'N° de Referencia Pago Móvil (ej. 4 últimos dígitos)'
                                : mp.metodo === 'cashea'
                                ? 'N° de Orden / Comprobante Cashea'
                                : 'N° de Referencia / Comprobante'
                            }
                            value={mp.referencia || ''}
                            onChange={(e) => onActualizarMetodoPago(index, 'referencia', e.target.value)}
                            required
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onAgregarMetodoPago()}>
              <HiOutlinePlus /> Agregar otro método (Pago Mixto)
            </button>

            <div className="pos-payment-summary">
              <div className="pos-totals__row">
                <span>{tieneCashea ? 'Total Cobrado hoy en Tienda' : 'Pagado'}</span>
                <span className="text-success">{formatUSD(totalPagadoEnTienda)}</span>
              </div>
              {tieneCashea && (
                <div className="pos-totals__row" style={{ color: '#EC4899', fontWeight: 'bold' }}>
                  <span>Monto Financiado Cashea (Crédito)</span>
                  <span>{formatUSD(casheaCreditoUSD)}</span>
                </div>
              )}
              {tieneCredito && montoCredito > 0 && (
                <div className="pos-totals__row" style={{ color: 'rgba(99,102,241,0.9)', fontWeight: 'bold' }}>
                  <span>Monto a Crédito Directo</span>
                  <span>{formatUSD(montoCredito)}</span>
                </div>
              )}
              {montoIgtf > 0 && (
                <>
                  <div className="pos-totals__row" style={{ color: 'var(--warning)', fontWeight: 'bold' }}>
                    <span>+ IGTF {Number(fiscal.alicuota_igtf)}% (pagos en divisas)</span>
                    <span>{formatUSD(montoIgtf)}</span>
                  </div>
                  <div className="pos-totals__row" style={{ fontWeight: 'bold' }}>
                    <span>Total a cobrar con IGTF</span>
                    <span>{formatUSD(totalUSD + montoIgtf)}</span>
                  </div>
                </>
              )}
              {restante > 0.01 && (
                <div className="pos-totals__row">
                  <span>Restante</span>
                  <span className="text-danger">{formatUSD(restante)}</span>
                </div>
              )}
            </div>

            <div className="pos-payment-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn--primary btn--full"
                onClick={onEmitirFactura}
                disabled={loading || restante > 0.01}
              >
                {loading ? 'Procesando...' : `Emitir Factura ${formatUSD(totalUSD + montoIgtf)}`}
              </button>
              <button type="button" className="btn btn--ghost btn--full" onClick={onVolverAlCarrito}>
                Volver al Carrito
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--full"
                onClick={onLimpiarCaja}
                style={{
                  color: 'var(--danger, #EF4444)',
                  border: '1px dashed rgba(239, 68, 68, 0.4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                }}
                title="Cancelar venta en curso y limpiar cuenta"
              >
                <HiOutlineTrash /> Cancelar Venta y Limpiar Caja
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
