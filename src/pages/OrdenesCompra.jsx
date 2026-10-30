import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatUSD, formatFecha } from '../utils/formatters';
import { ESTADOS_ORDEN } from '../utils/constants';
import toast from 'react-hot-toast';
import Pagination from '../components/common/Pagination';
import {
  HiOutlinePlus, HiOutlineCheckCircle, HiOutlineXCircle,
  HiOutlineEye, HiOutlineTrash, HiOutlineMagnifyingGlass,
} from 'react-icons/hi2';

export default function OrdenesCompra() {
  const { profile } = useAuth();
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
    if (form.items.some(i => !i.producto_id || !i.precio_unitario_usd)) { toast.error('Complete todos los items'); return; }

    try {
      const { data: numData } = await supabase.rpc('generar_numero_orden');
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
      if (detError) throw detError;

      toast.success(`Orden ${numData} creada`);
      setShowModal(false);
      setForm({ proveedor_id: '', notas: '', items: [{ producto_id: '', cantidad: 1, precio_unitario_usd: '' }] });
      loadData();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function cambiarEstado(id, estado) {
    const cambios = { estado };
    if (estado === 'recibida') {
      // Datos de la factura del proveedor: los exige el Libro de Compras
      const factura = prompt('N° de factura del proveedor:');
      if (!factura?.trim()) return;
      const control = prompt('N° de control de la factura del proveedor:');
      if (!control?.trim()) return;
      if (!confirm('¿Registrar la recepción? Se actualizará el inventario, la cuenta por pagar y la retención de IVA.')) return;
      cambios.numero_factura_proveedor = factura.trim();
      cambios.numero_control_proveedor = control.trim();
    } else if (!confirm('¿Cancelar esta orden?')) {
      return;
    }
    try {
      const { error } = await supabase.from('ordenes_compra').update(cambios).eq('id', id);
      if (error) throw error;
      toast.success(`Orden ${estado}`);
      loadData();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function verDetalle(orden) {
    const { data } = await supabase.from('detalles_orden_compra').select('*, productos(nombre, sku)').eq('orden_id', orden.id);
    setShowDetalle({ ...orden, detalles: data || [] });
  }

  const pageSize = 20;
  const ordenesPaginadas = ordenes.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando órdenes...</p></div>;

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Órdenes de Compra</h1>
        <button className="btn btn--primary" onClick={() => setShowModal(true)}><HiOutlinePlus /> Nueva Orden</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr><th>N° Orden</th><th>Proveedor</th><th>Total USD</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {ordenesPaginadas.map(o => (
                <tr key={o.id}>
                  <td><code>{o.numero_orden}</code></td>
                  <td>{o.proveedores?.nombre}</td>
                  <td>{formatUSD(o.total_usd)}</td>
                  <td>
                    <span className={`badge badge--${o.estado === 'recibida' ? 'success' : o.estado === 'cancelada' ? 'danger' : 'warning'}`}>
                      {o.estado.charAt(0).toUpperCase() + o.estado.slice(1)}
                    </span>
                  </td>
                  <td>{formatFecha(o.fecha_orden)}</td>
                  <td>
                    <div className="table__actions">
                      <button className="btn btn--ghost btn--xs" onClick={() => verDetalle(o)}><HiOutlineEye /></button>
                      {o.estado === 'pendiente' && (
                        <>
                          <button className="btn btn--ghost btn--xs text-success" onClick={() => cambiarEstado(o.id, 'recibida')} title="Marcar recibida"><HiOutlineCheckCircle /></button>
                          <button className="btn btn--ghost btn--xs text-danger" onClick={() => cambiarEstado(o.id, 'cancelada')} title="Cancelar"><HiOutlineXCircle /></button>
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
            <div className="modal__header"><h2>Orden {showDetalle.numero_orden}</h2></div>
            <div className="modal__form">
              <p><strong>Proveedor:</strong> {showDetalle.proveedores?.nombre}</p>
              <p><strong>Estado:</strong> {showDetalle.estado}</p>
              <p><strong>Notas:</strong> {showDetalle.notas || '—'}</p>
              <table className="table">
                <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
                <tbody>
                  {showDetalle.detalles.map(d => (
                    <tr key={d.id}>
                      <td>{d.productos?.nombre}</td>
                      <td>{d.cantidad}</td>
                      <td>{formatUSD(d.precio_unitario_usd)}</td>
                      <td>{formatUSD(d.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pos-totals__row pos-totals__row--total" style={{ marginTop: '1rem' }}>
                <span>Total:</span><span>{formatUSD(showDetalle.total_usd)}</span>
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
                    <input type="number" min="1" value={item.cantidad} onChange={e => updateItem(index, 'cantidad', e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label>Precio USD</label>
                    <input type="number" step="0.01" min="0" value={item.precio_unitario_usd} onChange={e => updateItem(index, 'precio_unitario_usd', e.target.value)} required />
                  </div>
                  {form.items.length > 1 && (
                    <button type="button" className="btn btn--ghost btn--xs text-danger" onClick={() => removeItem(index)}><HiOutlineTrash /></button>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn--ghost btn--sm" onClick={addItem}><HiOutlinePlus /> Agregar producto</button>

              <div className="pos-totals__row pos-totals__row--total" style={{ marginTop: '1rem' }}>
                <span>Total:</span><span>{formatUSD(totalOrden)}</span>
              </div>

              <button type="submit" className="btn btn--primary btn--full" style={{ marginTop: '1rem' }}>Crear Orden de Compra</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
