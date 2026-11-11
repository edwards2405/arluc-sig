import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatMonto, formatFecha } from '../utils/formatters';
import toast from 'react-hot-toast';
import { puede } from '../utils/permisos';
import { mensajeError, exigirFilas } from '../utils/errores';
import { validarMonto } from '../utils/validaciones';
import { useDialogo } from '../components/common/DialogoProvider';
import Pagination from '../components/common/Pagination';
import {
  HiOutlinePlus, HiOutlineCheckCircle, HiOutlineXCircle,
  HiOutlineEye, HiOutlineTrash,
} from 'react-icons/hi2';

const ETIQUETA_ESTADO = { pendiente: 'Pendiente', recibida: 'Recibida', cancelada: 'Cancelada' };

export default function OrdenesCompra() {
  const { confirmar, pedirDatos } = useDialogo();
  const { profile } = useAuth();
  const puedeGestionar = puede(profile?.rol, 'orden.gestionar');
  const [ordenes, setOrdenes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showDetalle, setShowDetalle] = useState(null);
  const [form, setForm] = useState({ proveedor_id: '', notas: '', items: [{ producto_id: '', cantidad: 1, precio_unitario_usd: '' }] });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [ordRes, provRes, prodRes] = await Promise.all([
      supabase.from('ordenes_compra').select('*, proveedores(nombre), usuarios!ordenes_compra_registrado_por_fkey(nombre_completo)').order('created_at', { ascending: false }),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('productos').select('id, nombre, sku').eq('activo', true).order('nombre'),
    ]);
    const fallida = [ordRes, provRes, prodRes].find(r => r.error);
    if (fallida) toast.error(mensajeError(fallida.error, 'No se pudieron cargar las órdenes de compra'));
    setOrdenes(ordRes.data || []);
    setProveedores(provRes.data || []);
    setProductos(prodRes.data || []);
    setLoading(false);
  }

  function addItem() {
    setForm({ ...form, items: [...form.items, { producto_id: '', cantidad: 1, precio_unitario_usd: '' }] });
  }

  function updateItem(index, field, value) {
    const items = [...form.items];
    items[index] = { ...items[index], [field]: value };
    setForm({ ...form, items });
  }

  function removeItem(index) {
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) });
  }

  const totalOrden = form.items.reduce((sum, item) => sum + (parseFloat(item.cantidad || 0) * parseFloat(item.precio_unitario_usd || 0)), 0);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.proveedor_id) { toast.error('Seleccione un proveedor'); return; }
    if (form.items.length === 0) { toast.error('Agregue al menos un producto'); return; }
    for (const [i, item] of form.items.entries()) {
      const linea = `Línea ${i + 1}`;
      if (!item.producto_id) { toast.error(`${linea}: seleccione el producto`); return; }
      const cantidad = Number(item.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        toast.error(`${linea}: la cantidad debe ser un número entero mayor que 0`);
        return;
      }
      const errorCosto = validarMonto(item.precio_unitario_usd, { etiqueta: `${linea}: el costo unitario` });
      if (errorCosto) { toast.error(errorCosto); return; }
    }

    try {
      const { data: numData, error: numError } = await supabase.rpc('generar_numero_orden');
      if (numError) throw numError;
      if (!numData) throw new Error('No se pudo generar el número de la orden');
      const { data: orden, error } = await supabase.from('ordenes_compra').insert({
        numero_orden: numData,
        proveedor_id: form.proveedor_id,
        registrado_por: profile.id,
        total_usd: totalOrden,
        notas: form.notas,
      }).select().single();
      if (error) throw error;

      const detalles = form.items.map(item => ({
        orden_id: orden.id,
        producto_id: item.producto_id,
        cantidad: parseInt(item.cantidad),
        precio_unitario_usd: parseFloat(item.precio_unitario_usd),
      }));
      const { error: detError } = await supabase.from('detalles_orden_compra').insert(detalles);
      if (detError) {
        // Sin líneas la orden no sirve: se borra la cabecera recién creada
        await supabase.from('ordenes_compra').delete().eq('id', orden.id).select('id');
        throw detError;
      }

      toast.success(`Orden ${numData} creada`);
      setShowModal(false);
      setForm({ proveedor_id: '', notas: '', items: [{ producto_id: '', cantidad: 1, precio_unitario_usd: '' }] });
      loadData();
    } catch (error) {
      toast.error(mensajeError(error, 'Error al crear la orden de compra'));
    }
  }

  async function cambiarEstado(orden, estado) {
    const cambios = { estado };
    if (estado === 'recibida') {
      // Datos de la factura del proveedor: los exige el Libro de Compras
      const datos = await pedirDatos({
        titulo: 'Recibir mercancía',
        mensaje: 'Se actualizará el inventario, la cuenta por pagar y la retención de IVA. Los datos de la factura del proveedor van al Libro de Compras.',
        textoConfirmar: 'Registrar recepción',
        campos: [
          { clave: 'factura', etiqueta: 'N° de factura del proveedor', maximo: 30, placeholder: 'Ej.: 000123',
            patron: /^[A-Za-z0-9-]+$/, mensajePatron: 'Solo letras, números y guiones' },
          { clave: 'control', etiqueta: 'N° de control', maximo: 30, placeholder: 'Ej.: 00-000123',
            patron: /^[A-Za-z0-9-]+$/, mensajePatron: 'Solo letras, números y guiones' },
        ],
      });
      if (!datos) return;
      cambios.numero_factura_proveedor = datos.factura;
      cambios.numero_control_proveedor = datos.control;
    } else if (!(await confirmar({ titulo: 'Cancelar orden', mensaje: '¿Seguro que desea cancelar esta orden de compra?', variante: 'danger', textoConfirmar: 'Cancelar orden', textoCancelar: 'Volver' }))) {
      return;
    }
    try {
      const { data, error } = await supabase.from('ordenes_compra').update(cambios).eq('id', orden.id).select('id');
      if (error) throw error;
      exigirFilas(data);
      toast.success(`Orden ${orden.numero_orden} ${estado}`);
      loadData();
    } catch (error) {
      toast.error(mensajeError(error, 'Error al actualizar la orden'));
    }
  }

  async function verDetalle(orden) {
    const { data, error } = await supabase.from('detalles_orden_compra').select('*, productos(nombre, sku)').eq('orden_id', orden.id);
    if (error) { toast.error(mensajeError(error, 'No se pudo cargar el detalle de la orden')); return; }
    setShowDetalle({ ...orden, detalles: data || [] });
  }

  const pageSize = 20;
  const ordenesPaginadas = ordenes.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando órdenes...</p></div>;

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Órdenes de Compra</h1>
        {puedeGestionar && (
          <button className="btn btn--primary" onClick={() => setShowModal(true)}><HiOutlinePlus /> Nueva Orden</button>
        )}
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr><th>N° Orden</th><th>Proveedor</th><th>Total</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {ordenesPaginadas.map(o => (
                <tr key={o.id}>
                  <td><code>{o.numero_orden}</code></td>
                  <td>{o.proveedores?.nombre}</td>
                  <td>{formatMonto(o.total_usd)}</td>
                  <td>
                    <span className={`badge badge--${o.estado === 'recibida' ? 'success' : o.estado === 'cancelada' ? 'danger' : 'warning'}`}>
                      {ETIQUETA_ESTADO[o.estado] || o.estado}
                    </span>
                  </td>
                  <td>{formatFecha(o.fecha_orden)}</td>
                  <td>
                    <div className="table__actions">
                      <button className="btn btn--ghost btn--xs" onClick={() => verDetalle(o)}><HiOutlineEye /></button>
                      {puedeGestionar && o.estado === 'pendiente' && (
                        <>
                          <button className="btn btn--ghost btn--xs text-success" onClick={() => cambiarEstado(o, 'recibida')} title="Marcar recibida"><HiOutlineCheckCircle /></button>
                          <button className="btn btn--ghost btn--xs text-danger" onClick={() => cambiarEstado(o, 'cancelada')} title="Cancelar"><HiOutlineXCircle /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {ordenes.length === 0 && <tr><td colSpan="6" className="table__empty">No hay órdenes de compra</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={ordenes.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Detail Modal */}
      {showDetalle && (
        <div className="modal-overlay" onClick={() => setShowDetalle(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Orden {showDetalle.numero_orden}</h2>
              <button className="modal__close" onClick={() => setShowDetalle(null)}>×</button>
            </div>
            <div className="modal__form">
              <p><strong>Proveedor:</strong> {showDetalle.proveedores?.nombre}</p>
              <p><strong>Estado:</strong> {ETIQUETA_ESTADO[showDetalle.estado] || showDetalle.estado}</p>
              <p><strong>Notas:</strong> {showDetalle.notas || '—'}</p>
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
                  <tbody>
                    {showDetalle.detalles.map(d => (
                      <tr key={d.id}>
                        <td>{d.productos?.nombre}</td>
                        <td>{d.cantidad}</td>
                        <td>{formatMonto(d.precio_unitario_usd)}</td>
                        <td>{formatMonto(d.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pos-totals__row pos-totals__row--total" style={{ marginTop: '1rem' }}>
                <span>Total:</span><span>{formatMonto(showDetalle.total_usd)}</span>
              </div>
              <button className="btn btn--ghost btn--full" onClick={() => setShowDetalle(null)} style={{ marginTop: '1rem' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal--lg" onClick={e => e.stopPropagation()}>
            <div className="modal__header"><h2>Nueva Orden de Compra</h2></div>
            <form onSubmit={handleSubmit} className="modal__form">
              <div className="form-row">
                <div className="form-group">
                  <label>Proveedor</label>
                  <select value={form.proveedor_id} onChange={e => setForm({...form, proveedor_id: e.target.value})} required>
                    <option value="">Seleccionar...</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.rif}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Notas</label>
                  <input value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} placeholder="Notas opcionales..." />
                </div>
              </div>

              <h4>Productos</h4>
              {form.items.map((item, index) => (
                <div key={index} className="form-row" style={{ alignItems: 'end' }}>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label>Producto</label>
                    <select value={item.producto_id} onChange={e => updateItem(index, 'producto_id', e.target.value)} required>
                      <option value="">Seleccionar...</option>
                      {productos.map(p => <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Cantidad</label>
                    <input type="number" min="1" step="1" value={item.cantidad} onChange={e => updateItem(index, 'cantidad', e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label>Precio USD</label>
                    <input type="number" step="0.01" min="0.01" value={item.precio_unitario_usd} onChange={e => updateItem(index, 'precio_unitario_usd', e.target.value)} required />
                  </div>
                  {form.items.length > 1 && (
                    <button type="button" className="btn btn--ghost btn--xs text-danger" onClick={() => removeItem(index)}><HiOutlineTrash /></button>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn--ghost btn--sm" onClick={addItem}><HiOutlinePlus /> Agregar producto</button>

              <div className="pos-totals__row pos-totals__row--total" style={{ marginTop: '1rem' }}>
                <span>Total:</span><span>{formatMonto(totalOrden)}</span>
              </div>

              <button type="submit" className="btn btn--primary btn--full" style={{ marginTop: '1rem' }}>Crear Orden de Compra</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
