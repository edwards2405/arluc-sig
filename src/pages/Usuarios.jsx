import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatFecha } from '../utils/formatters';
import toast from 'react-hot-toast';
import Pagination from '../components/common/Pagination';
import ConfirmModal from '../components/common/ConfirmModal';
import { ROLES_LABEL } from '../utils/permisos';
import { tieneTexto, validarCorreo } from '../utils/validaciones';
import { mensajeError, exigirFilas } from '../utils/errores';
import {
  HiOutlineUserPlus,
  HiOutlineLockClosed,
  HiOutlineLockOpen,
  HiOutlineTrash,
} from 'react-icons/hi2';

export default function Usuarios() {
  const { createUser, user } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', nombre_completo: '', rol: 'vendedor' });
  const [creando, setCreando] = useState(false);
  const [errores, setErrores] = useState({});

  // Confirm modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [usuarioAEliminar, setUsuarioAEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => { loadUsuarios(); }, []);

  async function loadUsuarios() {
    setLoading(true);
    const { data, error } = await supabase.from('usuarios').select('*').order('created_at', { ascending: false });
    if (error) toast.error(mensajeError(error, 'No se pudieron cargar los usuarios'));
    setUsuarios(data || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const nombre = form.nombre_completo.trim().replace(/\s+/g, ' ');
    const email = form.email.trim().toLowerCase();
    const errs = {};
    if (!tieneTexto(nombre)) errs.nombre_completo = 'El nombre es obligatorio';
    const errCorreo = validarCorreo(email, { opcional: false });
    if (errCorreo) errs.email = errCorreo;
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
      errs.password = 'La contraseña debe tener al menos 8 caracteres, con letras y números';
    }
    setErrores(errs);
    if (Object.keys(errs).length) return;

    setCreando(true);
    try {
      await createUser(email, form.password, nombre, form.rol);
      toast.success('Usuario creado correctamente');
      setShowModal(false);
      setForm({ email: '', password: '', nombre_completo: '', rol: 'vendedor' });
      // Wait a moment for the trigger to fire
      setTimeout(loadUsuarios, 1000);
    } catch (error) {
      toast.error(mensajeError(error, 'Error al crear el usuario'));
    } finally {
      setCreando(false);
    }
  }

  async function toggleActivo(usuario) {
    if (usuario.id === user?.id) {
      toast.error('No puedes desactivar tu propia cuenta actual.');
      return;
    }

    if (usuario.rol === 'admin' && usuario.activo) {
      const adminsActivos = usuarios.filter(u => u.rol === 'admin' && u.activo);
      if (adminsActivos.length <= 1) {
        toast.error('Debe existir al menos un administrador activo en el sistema.');
        return;
      }
    }

    try {
      const { data, error } = await supabase
        .from('usuarios')
        .update({ activo: !usuario.activo })
        .eq('id', usuario.id)
        .select('id');
      if (error) throw error;
      exigirFilas(data);
      toast.success(usuario.activo ? 'Usuario desactivado' : 'Usuario activado');
      loadUsuarios();
    } catch (error) {
      toast.error(mensajeError(error, 'Error al cambiar el estado del usuario'));
    }
  }

  async function cambiarRol(usuario, rol) {
    // La BD impide quitar el rol al último administrador activo
    const { data, error } = await supabase.from('usuarios').update({ rol }).eq('id', usuario.id).select('id');
    if (error) {
      toast.error(mensajeError(error, 'Error al cambiar el rol'));
      return;
    }
    if (!data?.length) {
      toast.error('No se cambió el rol: no tiene permiso o el usuario ya no existe.');
      loadUsuarios();
      return;
    }
    toast.success(`${usuario.nombre_completo} ahora es ${ROLES_LABEL[rol]}`);
    loadUsuarios();
  }

  function solicitarEliminacion(usuario) {
    if (usuario.id === user?.id) {
      toast.error('No puedes eliminar tu propia cuenta actual.');
      return;
    }

    if (usuario.rol === 'admin') {
      const adminsActivos = usuarios.filter(u => u.rol === 'admin' && u.activo);
      if (adminsActivos.length <= 1) {
        toast.error('No puedes eliminar al único administrador activo del sistema.');
        return;
      }
    }

    setUsuarioAEliminar(usuario);
    setConfirmOpen(true);
  }

  async function confirmarEliminacion() {
    if (!usuarioAEliminar) return;
    setEliminando(true);
    try {
      // La RPC eliminar_usuario rechaza a usuarios con operaciones registradas
      // (facturas, compras, movimientos...); en ese caso hay que desactivarlo.
      const { error } = await supabase.rpc('eliminar_usuario', { p_user_id: usuarioAEliminar.id });
      if (error) throw error;

      toast.success(`Usuario "${usuarioAEliminar.nombre_completo}" eliminado permanentemente`);
      setConfirmOpen(false);
      setUsuarioAEliminar(null);
      loadUsuarios();
    } catch (error) {
      toast.error(mensajeError(error, 'Error al eliminar usuario'));
    } finally {
      setEliminando(false);
    }
  }

  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando usuarios...</p></div>;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Gestión de Usuarios</h1>
          <p className="page__subtitle">{usuarios.length} usuario(s) registrado(s)</p>
        </div>
        <button className="btn btn--primary" onClick={() => { setErrores({}); setShowModal(true); }}>
          <HiOutlineUserPlus /> Nuevo Usuario
        </button>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Registrado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.slice((currentPage - 1) * 20, currentPage * 20).map(u => (
                <tr key={u.id} className={!u.activo ? 'table__row--muted' : ''}>
                  <td><strong>{u.nombre_completo}</strong></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                  <td>
                    {u.id === user?.id ? (
                      <span className="badge badge--primary">{ROLES_LABEL[u.rol]}</span>
                    ) : (
                      <select value={u.rol} onChange={e => cambiarRol(u, e.target.value)} title="Cambiar rol">
                        {Object.entries(ROLES_LABEL).map(([valor, etiqueta]) => (
                          <option key={valor} value={valor}>{etiqueta}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.activo ? 'badge--success' : 'badge--danger'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{formatFecha(u.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {u.id === user?.id ? (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '0.25rem 0.5rem' }}>
                          (Tu cuenta)
                        </span>
                      ) : (
                        <>
                          <button
                            className={`btn btn--ghost btn--xs ${u.activo ? 'text-danger' : 'text-success'}`}
                            onClick={() => toggleActivo(u)}
                            title={u.activo ? 'Desactivar acceso' : 'Activar acceso'}
                            style={{ minWidth: '36px', minHeight: '36px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            {u.activo ? <HiOutlineLockClosed /> : <HiOutlineLockOpen />}
                          </button>
                          <button
                            className="btn btn--ghost btn--xs text-danger"
                            onClick={() => solicitarEliminacion(u)}
                            title={u.rol === 'admin' ? 'Eliminar administrador' : 'Eliminar usuario'}
                            style={{ color: '#EF4444', minWidth: '36px', minHeight: '36px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <HiOutlineTrash />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {usuarios.length === 0 && (
                <tr><td colSpan="6" className="table__empty">No hay usuarios registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={usuarios.length}
          pageSize={20}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Modal crear usuario */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal--sm" onClick={e => e.stopPropagation()}>
            <div className="modal__header"><h2>Crear Usuario</h2></div>
            <form onSubmit={handleSubmit} className="modal__form">
              <div className="form-group">
                <label>Nombre Completo</label>
                <input value={form.nombre_completo} onChange={e => setForm({...form, nombre_completo: e.target.value})} required />
                {errores.nombre_completo && <small style={{ color: '#ef4444' }}>{errores.nombre_completo}</small>}
              </div>
              <div className="form-group">
                <label>Correo Electrónico</label>
                <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
                {errores.email && <small style={{ color: '#ef4444' }}>{errores.email}</small>}
              </div>
              <div className="form-group">
                <label>Contraseña</label>
                <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} minLength={8} required />
                {errores.password
                  ? <small style={{ color: '#ef4444' }}>{errores.password}</small>
                  : <small>Mínimo 8 caracteres, con letras y números.</small>}
              </div>
              <div className="form-group">
                <label>Rol</label>
                <select value={form.rol} onChange={e => setForm({...form, rol: e.target.value})}>
                  {Object.entries(ROLES_LABEL).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>{etiqueta}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn--primary btn--full" disabled={creando}>
                {creando ? 'Creando...' : 'Crear Usuario'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal confirmar eliminación */}
      <ConfirmModal
        isOpen={confirmOpen}
        title="¿Eliminar Usuario Permanentemente?"
        message={
          usuarioAEliminar
            ? `¿Estás seguro de eliminar permanentemente al usuario "${usuarioAEliminar.nombre_completo}" (${usuarioAEliminar.email})?\n\nEsta acción borrará al usuario del sistema y de Supabase Auth. Solo se puede eliminar un usuario sin operaciones registradas (facturas, compras, movimientos); si las tiene, el sistema no lo permitirá y deberá desactivarlo.`
            : ''
        }
        confirmText="Sí, Eliminar Permanentemente"
        cancelText="Cancelar"
        variant="danger"
        loading={eliminando}
        onConfirm={confirmarEliminacion}
        onCancel={() => {
          if (!eliminando) {
            setConfirmOpen(false);
            setUsuarioAEliminar(null);
          }
        }}
      />
    </div>
  );
}
