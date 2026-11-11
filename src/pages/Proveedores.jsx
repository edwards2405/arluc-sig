import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getWhatsAppUrl, getPhoneCallUrl } from '../utils/formatters';
import toast from 'react-hot-toast';
import Pagination from '../components/common/Pagination';
import ConfirmModal from '../components/common/ConfirmModal';
import { CampoDocumento, CampoTelefono, CODIGOS_CELULAR, CODIGOS_FIJOS } from '../components/common/CamposVenezuela';
import { HiOutlinePlus, HiOutlinePencilSquare, HiOutlineMagnifyingGlass, HiOutlineTrash } from 'react-icons/hi2';
import { FaWhatsapp, FaPhone } from 'react-icons/fa';
import {
  tieneTexto, normalizarDocumento, validarDocumento, normalizarTelefono, validarTelefono, validarCorreo,
} from '../utils/validaciones';
import { useAuth } from '../contexts/AuthContext';
import { puede } from '../utils/permisos';
import { mensajeError, exigirFilas } from '../utils/errores';

export default function Proveedores() {
  const { profile } = useAuth();
  const puedeEditar = puede(profile?.rol, 'proveedor.editar');
  const [proveedores, setProveedores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nombre: '', rif: '', telefono: '', email: '', direccion: '', contacto_nombre: '', activo: true, porcentaje_retencion_iva: 75 });
  const [provToDelete, setProvToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [errores, setErrores] = useState({});

  useEffect(() => { loadProveedores(); }, []);

  async function loadProveedores() {
    setLoading(true);
    const { data, error } = await supabase.from('proveedores').select('*').order('nombre');
    if (error) toast.error(mensajeError(error, 'No se pudieron cargar los proveedores'));
    setProveedores(data || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (!tieneTexto(form.nombre)) errs.nombre = 'El nombre es obligatorio';
    const errRif = validarDocumento(form.rif, { soloRif: true });
    if (errRif) errs.rif = errRif;
    const errTel = validarTelefono(form.telefono);
    if (errTel) errs.telefono = errTel;
    const errCorreo = validarCorreo(form.email);
    if (errCorreo) errs.email = errCorreo;
    setErrores(errs);
    if (Object.keys(errs).length) return;

    const payload = {
      ...form,
      nombre: form.nombre.trim(),
      rif: normalizarDocumento(form.rif),
      telefono: tieneTexto(form.telefono) ? normalizarTelefono(form.telefono) : null,
      email: form.email.trim().toLowerCase() || null,
      direccion: form.direccion.trim() || null,
      contacto_nombre: form.contacto_nombre.trim() || null,
    };
    try {
      if (editando) {
        const { data, error } = await supabase.from('proveedores').update(payload).eq('id', editando.id).select('id');
        if (error) throw error;
        exigirFilas(data);
        toast.success('Proveedor actualizado');
      } else {
        const { error } = await supabase.from('proveedores').insert(payload);
        if (error) throw error;
        toast.success('Proveedor creado');
      }
      setShowModal(false);
      setEditando(null);
      resetForm();
      loadProveedores();
    } catch (error) {
      toast.error(mensajeError(error, 'Error al guardar proveedor'));
    }
  }

  async function handleConfirmDeleteProveedor() {
    if (!provToDelete) return;
    setDeleting(true);
    try {
      // La BD impide borrar un proveedor con órdenes de compra, facturas o cuentas por pagar
      const { data, error } = await supabase.from('proveedores').delete().eq('id', provToDelete.id).select('id');
      if (error) throw error;
      exigirFilas(data, 'No se eliminó el proveedor: no tiene permiso o ya no existe.');
      toast.success(`Proveedor "${provToDelete.nombre}" eliminado`);
      setProvToDelete(null);
      loadProveedores();
    } catch (err) {
      toast.error(err.code === '23503'
        ? `No se puede eliminar a "${provToDelete.nombre}": tiene órdenes de compra u otros documentos registrados. Puede marcarlo como inactivo.`
        : mensajeError(err, 'Error al eliminar proveedor'));
    } finally {
      setDeleting(false);
    }
  }

  function editarProveedor(p) {
    setEditando(p);
    setErrores({});
    setForm({ nombre: p.nombre, rif: p.rif, telefono: p.telefono || '', email: p.email || '', direccion: p.direccion || '', contacto_nombre: p.contacto_nombre || '', activo: p.activo, porcentaje_retencion_iva: p.porcentaje_retencion_iva ?? 75 });
    setShowModal(true);
  }

  function resetForm() {
    setErrores({});
    setForm({ nombre: '', rif: '', telefono: '', email: '', direccion: '', contacto_nombre: '', activo: true, porcentaje_retencion_iva: 75 });
  }

  const filtrados = proveedores.filter(p =>
    !search || p.nombre.toLowerCase().includes(search.toLowerCase()) || p.rif.toLowerCase().includes(search.toLowerCase())
  );

  const pageSize = 20;
  const paginados = filtrados.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando proveedores...</p></div>;

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Proveedores</h1>
        {puedeEditar && (
          <button className="btn btn--primary" onClick={() => { resetForm(); setEditando(null); setShowModal(true); }}>
            <HiOutlinePlus /> Nuevo Proveedor
          </button>
        )}
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <HiOutlineMagnifyingGlass className="search-box__icon" />
          <input placeholder="Buscar por nombre o RIF..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>RIF</th><th>Teléfono</th><th>Estado</th>{puedeEditar && <th>Acciones</th>}</tr>
            </thead>
            <tbody>
              {paginados.map(p => (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  <td><code>{p.rif}</code></td>
                  <td>
                    {p.telefono ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>{p.telefono}</span>
                        <a
                          href={getWhatsAppUrl(p.telefono)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn--ghost btn--xs"
                          style={{ color: '#25D366', padding: '2px 5px', fontSize: '0.9rem' }}
                          title="Enviar WhatsApp"
                        >
                          <FaWhatsapp />
                        </a>
                        <a
                          href={getPhoneCallUrl(p.telefono)}
                          className="btn btn--ghost btn--xs"
                          style={{ color: '#3B82F6', padding: '2px 5px', fontSize: '0.75rem' }}
                          title="Llamar"
                        >
                          <FaPhone />
                        </a>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td><span className={`badge ${p.activo ? 'badge--success' : 'badge--ghost'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                  {puedeEditar && (
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button className="btn btn--ghost btn--xs" onClick={() => editarProveedor(p)} title="Editar"><HiOutlinePencilSquare /></button>
                        <button className="btn btn--ghost btn--xs text-danger" onClick={() => setProvToDelete(p)} title="Eliminar Proveedor"><HiOutlineTrash /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filtrados.length === 0 && <tr><td colSpan={puedeEditar ? 5 : 4} className="table__empty">No se encontraron proveedores</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={filtrados.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header"><h2>{editando ? 'Editar' : 'Nuevo'} Proveedor</h2></div>
            <form onSubmit={handleSubmit} className="modal__form">
              <div className="form-row">
                <div className="form-group">
                  <label>Nombre</label>
                  <input value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} required />
                  {errores.nombre && <small style={{ color: '#ef4444' }}>{errores.nombre}</small>}
                </div>
                <div className="form-group">
                  <label>RIF</label>
                  <CampoDocumento
                    value={form.rif}
                    onChange={(v) => setForm(f => ({ ...f, rif: v }))}
                    letras={['J', 'G', 'V', 'E']}
                    placeholder="12345678-9"
                    required
                  />
                  {errores.rif && <small style={{ color: '#ef4444' }}>{errores.rif}</small>}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Teléfono</label>
                  <CampoTelefono
                    value={form.telefono}
                    onChange={(v) => setForm(f => ({ ...f, telefono: v }))}
                    codigos={[...CODIGOS_CELULAR, ...CODIGOS_FIJOS]}
                  />
                  {errores.telefono && <small style={{ color: '#ef4444' }}>{errores.telefono}</small>}
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
                  {errores.email && <small style={{ color: '#ef4444' }}>{errores.email}</small>}
                </div>
              </div>
              <div className="form-group">
                <label>Dirección</label>
                <input value={form.direccion} onChange={e => setForm({...form, direccion: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Retención de IVA que le practicamos</label>
                <select value={form.porcentaje_retencion_iva} onChange={e => setForm({...form, porcentaje_retencion_iva: Number(e.target.value)})}>
                  <option value={75}>75 % (general)</option>
                  <option value={100}>100 % (sin RIF o factura sin requisitos)</option>
                  <option value={0}>No aplica</option>
                </select>
              </div>
              <div className="form-group">
                <label className="checkbox-label"><input type="checkbox" checked={form.activo} onChange={e => setForm({...form, activo: e.target.checked})} /> Proveedor activo</label>
              </div>
              <button type="submit" className="btn btn--primary btn--full">{editando ? 'Guardar' : 'Crear Proveedor'}</button>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Supplier Deletion */}
      <ConfirmModal
        isOpen={!!provToDelete}
        title={`¿Eliminar al proveedor "${provToDelete?.nombre}"?`}
        message="Solo se puede eliminar un proveedor sin órdenes de compra, facturas ni cuentas por pagar. Si tiene documentos registrados, el sistema no permitirá eliminarlo; en ese caso márquelo como inactivo."
        confirmText="Sí, Eliminar Proveedor"
        cancelText="Cancelar"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDeleteProveedor}
        onCancel={() => !deleting && setProvToDelete(null)}
      />
    </div>
  );
}
