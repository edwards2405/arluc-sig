import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatMonto } from '../utils/formatters';
import toast from 'react-hot-toast';
import Pagination from '../components/common/Pagination';
import {
  HiOutlinePlus, HiOutlinePencilSquare, HiOutlineTrash,
  HiOutlineMagnifyingGlass, HiOutlineTag, HiOutlineDocumentChartBar,
} from 'react-icons/hi2';
import ConfirmModal from '../components/common/ConfirmModal';
import ModalImprimirEtiquetas from '../components/print/ModalImprimirEtiquetas';
import { useDialogo } from '../components/common/DialogoProvider';
import { tieneTexto, validarMonto } from '../utils/validaciones';
import { useAuth } from '../contexts/AuthContext';
import { puede } from '../utils/permisos';
import { mensajeError, exigirFilas } from '../utils/errores';

/** SKU normalizado: mayúsculas y sin espacios. */
const normalizarSku = (valor) => String(valor ?? '').toUpperCase().replace(/\s+/g, '');
/** Clave para comparar nombres sin distinguir mayúsculas ni espacios sobrantes. */
const claveTexto = (valor) => String(valor ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export default function Inventario() {
  const { confirmar } = useDialogo();
  const { profile } = useAuth();
  const rol = profile?.rol;
  const puedeEditarProducto = puede(rol, 'producto.editar');
  const puedeEditarCategoria = puede(rol, 'categoria.editar');
  const puedeExento = puede(rol, 'producto.exento');
  const [errores, setErrores] = useState({});
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);
  const [showEtiquetasModal, setShowEtiquetasModal] = useState(false);
  const [productoParaEtiqueta, setProductoParaEtiqueta] = useState(null);
  const [editando, setEditando] = useState(null);
  const [catEditando, setCatEditando] = useState(null);
  const [form, setForm] = useState({
    sku: '', nombre: '', descripcion: '', precio_usd: '', costo_usd: '', stock: '', stock_minimo: '5', categoria_id: '', exento_iva: false, activo: true
  });
  const [catForm, setCatForm] = useState({ nombre: '', descripcion: '' });
  const [prodToDelete, setProdToDelete] = useState(null);
  const [catToDelete, setCatToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [prodRes, catRes] = await Promise.all([
      supabase.from('productos').select('*, categorias(nombre)').order('nombre'),
      supabase.from('categorias').select('*').order('nombre'),
    ]);
    if (prodRes.error) toast.error(mensajeError(prodRes.error, 'No se pudieron cargar los productos'));
    if (catRes.error) toast.error(mensajeError(catRes.error, 'No se pudieron cargar las categorías'));
    setProductos(prodRes.data || []);
    setCategorias(catRes.data || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const sku = normalizarSku(form.sku);
    const precio = Number(String(form.precio_usd).replace(',', '.'));
    const costo = tieneTexto(form.costo_usd) ? Number(String(form.costo_usd).replace(',', '.')) : 0;
    const stock = Number(form.stock);
    const stockMinimo = Number(form.stock_minimo);

    const errs = {};
    if (!sku) errs.sku = 'El SKU es obligatorio';
    else if (productos.some(p => p.id !== editando?.id && normalizarSku(p.sku) === sku)) errs.sku = `Ya existe un producto con el SKU ${sku}`;
    if (!tieneTexto(form.nombre)) errs.nombre = 'El nombre es obligatorio';
    const errPrecio = validarMonto(form.precio_usd, { etiqueta: 'El precio', min: 0 });
    if (errPrecio) errs.precio_usd = errPrecio;
    const errCosto = tieneTexto(form.costo_usd) ? validarMonto(form.costo_usd, { etiqueta: 'El costo', min: 0, mayorQue: false }) : null;
    if (errCosto) errs.costo_usd = errCosto;
    if (!Number.isInteger(stock) || stock < 0) errs.stock = 'El stock debe ser un número entero mayor o igual a 0';
    if (!Number.isInteger(stockMinimo) || stockMinimo < 0) errs.stock_minimo = 'El stock mínimo debe ser un número entero mayor o igual a 0';
    if (!errCosto && !errs.stock && stock > 0 && !(costo > 0)) {
      errs.costo_usd = 'Si el producto tiene stock, el costo debe ser mayor que 0';
    }
    setErrores(errs);
    if (Object.keys(errs).length) return;

    if (costo > 0 && precio < costo) {
      const seguir = await confirmar({
        titulo: 'Precio por debajo del costo',
        mensaje: `El precio (${precio.toFixed(2)} USD) es menor que el costo (${costo.toFixed(2)} USD): cada venta dará pérdida. ¿Desea guardarlo así?`,
        variante: 'warning',
        textoConfirmar: 'Sí, guardar',
      });
      if (!seguir) return;
    }

    const payload = {
      sku,
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      precio_usd: precio,
      costo_usd: costo,
      stock,
      stock_minimo: stockMinimo,
      categoria_id: form.categoria_id || null,
      exento_iva: !!form.exento_iva,
      activo: form.activo,
    };

    try {
      if (editando) {
        const { data, error } = await supabase.from('productos').update(payload).eq('id', editando.id).select('id');
        if (error) throw error;
        exigirFilas(data);
        toast.success('Producto actualizado');
      } else {
        const { error } = await supabase.from('productos').insert(payload);
        if (error) throw error;
        toast.success('Producto creado');
      }
      setShowModal(false);
      setEditando(null);
      resetForm();
      loadData();
    } catch (error) {
      toast.error(mensajeError(error, 'Error al guardar'));
    }
  }

  async function handleConfirmDeleteProduct() {
    if (!prodToDelete) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.from('productos').delete().eq('id', prodToDelete.id).select('id');
      if (error) {
        // Fallback defensivo a desactivación si tiene dependencias críticas
        const { data: desactivado, error: updateError } = await supabase.from('productos').update({ activo: false }).eq('id', prodToDelete.id).select('id');
        if (updateError) throw updateError;
        exigirFilas(desactivado);
        toast.success(`Producto marcado como INACTIVO debido a dependencias en base de datos.`);
      } else {
        exigirFilas(data);
        toast.success(`Producto "${prodToDelete.nombre}" eliminado`);
      }
      setProdToDelete(null);
      loadData();
    } catch (err) {
      toast.error(mensajeError(err, 'Error al eliminar producto'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleCatSubmit(e) {
    e.preventDefault();
    const nombre = String(catForm.nombre ?? '').trim().replace(/\s+/g, ' ');
    if (!nombre) { toast.error('El nombre de la categoría es obligatorio'); return; }
    if (categorias.some(c => c.id !== catEditando?.id && claveTexto(c.nombre) === claveTexto(nombre))) {
      toast.error(`Ya existe la categoría "${nombre}"`);
      return;
    }
    const catPayload = { nombre, descripcion: String(catForm.descripcion ?? '').trim() || null };
    try {
      if (catEditando) {
        const { data, error } = await supabase.from('categorias').update(catPayload).eq('id', catEditando.id).select('id');
        if (error) throw error;
        exigirFilas(data);
        toast.success('Categoría actualizada');
      } else {
        const { error } = await supabase.from('categorias').insert(catPayload);
        if (error) throw error;
        toast.success('Categoría creada');
      }
      setCatEditando(null);
      setCatForm({ nombre: '', descripcion: '' });
      loadData();
    } catch (error) {
      toast.error(mensajeError(error, 'Error al guardar categoría'));
    }
  }

  async function handleConfirmDeleteCat() {
    if (!catToDelete) return;
    setDeleting(true);
    try {
      const { error: errorProductos } = await supabase.from('productos').update({ categoria_id: null }).eq('categoria_id', catToDelete.id);
      if (errorProductos) throw errorProductos;
      const { data, error } = await supabase.from('categorias').delete().eq('id', catToDelete.id).select('id');
      if (error) throw error;
      exigirFilas(data);
      toast.success(`Categoría "${catToDelete.nombre}" eliminada`);
      if (catEditando?.id === catToDelete.id) {
        setCatEditando(null);
        setCatForm({ nombre: '', descripcion: '' });
      }
      setCatToDelete(null);
      loadData();
    } catch (error) {
      toast.error(mensajeError(error, 'Error al eliminar categoría'));
    } finally {
      setDeleting(false);
    }
  }

  function editarProducto(producto) {
    setEditando(producto);
    setErrores({});
    setForm({
      sku: producto.sku, nombre: producto.nombre, descripcion: producto.descripcion || '',
      precio_usd: producto.precio_usd.toString(), costo_usd: String(producto.costo_usd ?? 0),
      stock: producto.stock.toString(),
      stock_minimo: producto.stock_minimo.toString(), categoria_id: producto.categoria_id || '',
      exento_iva: !!producto.exento_iva, activo: producto.activo,
    });
    setShowModal(true);
  }

  function resetForm() {
    setErrores({});
    setForm({
      sku: '', nombre: '', descripcion: '', precio_usd: '', costo_usd: '', stock: '', stock_minimo: '5',
      categoria_id: '', exento_iva: false, activo: true
    });
  }

  function abrirModalEtiquetas(producto = null) {
    setProductoParaEtiqueta(producto);
    setShowEtiquetasModal(true);
  }

  const productosFiltrados = productos.filter(p => {
    const matchSearch = !search ||
      p.nombre.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCat = !filtroCategoria || p.categoria_id === filtroCategoria;
    return matchSearch && matchCat;
  });

  const pageSize = 20;
  const productosPaginados = productosFiltrados.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Reset page to 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filtroCategoria]);

  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando inventario...</p></div>;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Inventario de Productos</h1>
          <p className="page__subtitle">{productos.length} productos registrados</p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--secondary" to="/inventario/reportes">
            <HiOutlineDocumentChartBar /> Reportes
          </Link>
          <button className="btn btn--secondary" onClick={() => abrirModalEtiquetas(null)}>
            <HiOutlineTag /> Imprimir Etiquetas
          </button>
          {puedeEditarCategoria && (
            <button className="btn btn--secondary" onClick={() => { setCatEditando(null); setCatForm({ nombre: '', descripcion: '' }); setShowCatModal(true); }}>
              <HiOutlinePlus /> Categorías
            </button>
          )}
          {puedeEditarProducto && (
            <button className="btn btn--primary" onClick={() => { setEditando(null); resetForm(); setShowModal(true); }}>
              <HiOutlinePlus /> Nuevo Producto
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="search-box">
          <HiOutlineMagnifyingGlass className="search-box__icon" />
          <input
            type="text"
            placeholder="Buscar por nombre o SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>

      {/* Products Table */}
      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Precio (Bs)</th>
                <th>Stock</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {productosPaginados.map(p => (
                <tr key={p.id}>
                  <td><code>{p.sku}</code></td>
                  <td>{p.nombre}</td>
                  <td>{p.categorias?.nombre || '—'}</td>
                  <td>{formatMonto(p.precio_usd)}</td>
                  <td>
                    <span className={`badge ${p.stock <= p.stock_minimo ? (p.stock === 0 ? 'badge--danger' : 'badge--warning') : 'badge--success'}`}>
                      {p.stock}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${p.activo ? 'badge--success' : 'badge--ghost'}`}>
                      {p.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="table__actions">
                      <button
                        className="btn btn--ghost btn--xs"
                        onClick={() => abrirModalEtiquetas(p)}
                        title="Imprimir Código de Barras"
                      >
                        <HiOutlineTag />
                      </button>
                      {puedeEditarProducto && (
                        <>
                          <button className="btn btn--ghost btn--xs" onClick={() => editarProducto(p)} title="Editar">
                            <HiOutlinePencilSquare />
                          </button>
                          <button className="btn btn--ghost btn--xs text-danger" onClick={() => setProdToDelete(p)} title="Eliminar Producto">
                            <HiOutlineTrash />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {productosFiltrados.length === 0 && (
                <tr><td colSpan="7" className="table__empty">No se encontraron productos</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={productosFiltrados.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Product Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>{editando ? 'Editar Producto' : 'Nuevo Producto'}</h2>
              <button className="modal__close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit} className="modal__body">
              <div className="form-row">
                <div className="form-group">
                  <label>SKU / Código</label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={e => setForm({...form, sku: e.target.value})}
                    onBlur={() => setForm(f => ({ ...f, sku: normalizarSku(f.sku) }))}
                    placeholder="Ej. PROD-001"
                    required
                  />
                  {errores.sku && <small style={{ color: '#ef4444' }}>{errores.sku}</small>}
                </div>
                <div className="form-group">
                  <label>Nombre del Producto</label>
                  <input
                    type="text"
                    value={form.nombre}
                    onChange={e => setForm({...form, nombre: e.target.value})}
                    placeholder="Ej. Altavoz Bluetooth 15''"
                    required
                  />
                  {errores.nombre && <small style={{ color: '#ef4444' }}>{errores.nombre}</small>}
                </div>
              </div>
              <div className="form-group">
                <label>Descripción</label>
                <textarea
                  value={form.descripcion}
                  onChange={e => setForm({...form, descripcion: e.target.value})}
                  rows="2"
                  placeholder="Detalles técnicos, especificaciones..."
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Precio (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={form.precio_usd}
                    onChange={e => setForm({...form, precio_usd: e.target.value})}
                    placeholder="0.00"
                    required
                  />
                  {Number(form.precio_usd) > 0 && <small>≈ {formatMonto(form.precio_usd)}</small>}
                  {errores.precio_usd && <small style={{ color: '#ef4444' }}>{errores.precio_usd}</small>}
                </div>
                <div className="form-group">
                  <label>Costo (USD)</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={form.costo_usd}
                    onChange={e => setForm({...form, costo_usd: e.target.value})}
                    placeholder="0.00"
                    disabled={!!editando}
                  />
                  {Number(form.costo_usd) > 0 && <small>≈ {formatMonto(form.costo_usd)}</small>}
                  {editando && <small style={{ color: 'var(--text-secondary)' }}>El costo promedio lo actualizan las compras; no se edita aquí.</small>}
                  {errores.costo_usd && <small style={{ color: '#ef4444' }}>{errores.costo_usd}</small>}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{editando ? 'Stock Actual' : 'Stock Inicial'}</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.stock}
                    onChange={e => setForm({...form, stock: e.target.value})}
                    required
                  />
                  {errores.stock && <small style={{ color: '#ef4444' }}>{errores.stock}</small>}
                </div>
                <div className="form-group">
                  <label>Stock Mínimo (Alerta)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.stock_minimo}
                    onChange={e => setForm({...form, stock_minimo: e.target.value})}
                    required
                  />
                  {errores.stock_minimo && <small style={{ color: '#ef4444' }}>{errores.stock_minimo}</small>}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Categoría</label>
                  <select value={form.categoria_id} onChange={e => setForm({...form, categoria_id: e.target.value})}>
                    <option value="">Sin categoría</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={form.activo} onChange={e => setForm({...form, activo: e.target.checked})} />
                    Producto activo
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={form.exento_iva} disabled={!puedeExento} onChange={e => setForm({...form, exento_iva: e.target.checked})} />
                    Exento de IVA
                  </label>
                  {!puedeExento && <small style={{ color: 'var(--text-secondary)' }}>Solo el administrador cambia la exención de IVA.</small>}
                </div>
              </div>
              <button type="submit" className="btn btn--primary btn--full">{editando ? 'Guardar Cambios' : 'Crear Producto'}</button>
            </form>
          </div>
        </div>
      )}

      {/* Category Modal with Management */}
      {showCatModal && (
        <div className="modal-overlay" onClick={() => { setShowCatModal(false); setCatEditando(null); }}>
          <div className="modal modal--md" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Gestión de Categorías</h2>
              <button className="modal__close" onClick={() => { setShowCatModal(false); setCatEditando(null); }}>×</button>
            </div>

            <div className="modal__body">
              {/* Form to create/edit */}
              <form onSubmit={handleCatSubmit} style={{ marginBottom: '1.5rem', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>{catEditando ? 'Editar Categoría' : 'Nueva Categoría'}</h4>
                <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                  <label>Nombre</label>
                  <input
                    value={catForm.nombre}
                    onChange={e => setCatForm({...catForm, nombre: e.target.value})}
                    placeholder="Ej. Audio y Sonido"
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label>Descripción</label>
                  <input
                    value={catForm.descripcion}
                    onChange={e => setCatForm({...catForm, descripcion: e.target.value})}
                    placeholder="Descripción de la categoría..."
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="submit" className="btn btn--primary btn--sm" style={{ flex: 1 }}>
                    {catEditando ? 'Guardar Cambios' : 'Crear Categoría'}
                  </button>
                  {catEditando && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => { setCatEditando(null); setCatForm({ nombre: '', descripcion: '' }); }}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>

              {/* Existing Categories List */}
              <h4>Categorías Existentes ({categorias.length})</h4>
              {categorias.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No hay categorías registradas.</p>
              ) : (
                <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                  {categorias.map(cat => (
                    <div
                      key={cat.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.5rem 0.75rem',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)'
                      }}
                    >
                      <div>
                        <strong>{cat.nombre}</strong>
                        {cat.descripcion && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cat.descripcion}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          className="btn btn--ghost btn--xs"
                          onClick={() => {
                            setCatEditando(cat);
                            setCatForm({ nombre: cat.nombre, descripcion: cat.descripcion || '' });
                          }}
                          title="Editar categoría"
                        >
                          <HiOutlinePencilSquare />
                        </button>
                        <button
                          className="btn btn--ghost btn--xs text-danger"
                          onClick={() => setCatToDelete(cat)}
                          title="Eliminar categoría"
                        >
                          <HiOutlineTrash />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Product Deletion */}
      <ConfirmModal
        isOpen={!!prodToDelete}
        title={`¿Eliminar el producto "${prodToDelete?.nombre}"?`}
        message="Se eliminará el producto del catálogo. Si posee historial contable o ventas, el sistema lo desactivará de forma segura preservando la integridad de las facturas."
        confirmText="Sí, Eliminar Producto"
        cancelText="Cancelar"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDeleteProduct}
        onCancel={() => !deleting && setProdToDelete(null)}
      />

      {/* Confirmation Modal for Category Deletion */}
      <ConfirmModal
        isOpen={!!catToDelete}
        title={`¿Eliminar la categoría "${catToDelete?.nombre}"?`}
        message="Los productos asociados a esta categoría no se borrarán, solo quedarán sin categoría asignada."
        confirmText="Sí, Eliminar Categoría"
        cancelText="Cancelar"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDeleteCat}
        onCancel={() => !deleting && setCatToDelete(null)}
      />

      {/* Modal para Imprimir Etiquetas de Código de Barras */}
      {showEtiquetasModal && (
        <ModalImprimirEtiquetas
          productos={productos}
          productoInicial={productoParaEtiqueta}
          onClose={() => {
            setShowEtiquetasModal(false);
            setProductoParaEtiqueta(null);
          }}
        />
      )}
    </div>
  );
}
