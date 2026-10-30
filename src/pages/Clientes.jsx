import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatFecha, getWhatsAppUrl, getPhoneCallUrl } from '../utils/formatters';
import toast from 'react-hot-toast';
import Pagination from '../components/common/Pagination';
import { useAuth } from '../contexts/AuthContext';
import {
  HiOutlinePlus, HiOutlinePencilSquare, HiOutlineMagnifyingGlass,
  HiOutlineTrash, HiOutlineCreditCard, HiOutlineLockClosed, HiOutlineLockOpen,
} from 'react-icons/hi2';
import { FaWhatsapp, FaPhone } from 'react-icons/fa';
import ConfirmModal from '../components/common/ConfirmModal';

const MONEDAS_CREDITO = [
  { id: 'usd', label: 'USD (Dólares)' },
  { id: 'bs', label: 'Bs (Bolívares)' },
];

export default function Clientes() {
  const { profile } = useAuth();
  // Las condiciones de crédito las gestionan admin y gerente (la BD lo valida)
  const isAdmin = ['admin', 'gerente'].includes(profile?.rol);

  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({
    nombre: '', documento_identidad: '', telefono: '', direccion: '', email: '',
    linea_credito: 0, credito_activo: false, moneda_credito: 'usd',
    contribuyente_especial: false, porcentaje_retencion_iva: 75,
  });
  const [clienteToDelete, setClienteToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreditoModal, setShowCreditoModal] = useState(false);
  const [creditoCliente, setCreditoCliente] = useState(null);
  const [creditoForm, setCreditoForm] = useState({
    linea_credito: 0, credito_activo: false, moneda_credito: 'usd',
    contribuyente_especial: false, porcentaje_retencion_iva: 75,
  });
  const [savingCredito, setSavingCredito] = useState(false);

  useEffect(() => { loadClientes(); }, []);

  async function loadClientes() {
    setLoading(true);
    const { data, error } = await supabase.from('clientes').select('*').order('nombre');
    if (error) toast.error('Error cargando clientes: ' + error.message);
    setClientes(data || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const payload = {
        nombre: form.nombre,
        documento_identidad: form.documento_identidad,
        telefono: form.telefono,
        direccion: form.direccion,
        email: form.email,
        contribuyente_especial: !!form.contribuyente_especial,
        porcentaje_retencion_iva: Number(form.porcentaje_retencion_iva) || 75,
        // Las condiciones de crédito solo las fija admin/gerente (la BD lo valida)
        ...(isAdmin && {
          linea_credito: parseFloat(form.linea_credito) || 0,
          credito_activo: !!form.credito_activo,
          moneda_credito: form.moneda_credito,
        }),
      };

      if (editando) {
        const { error } = await supabase.from('clientes').update(payload).eq('id', editando.id);
        if (error) throw error;
        toast.success('Cliente actualizado');
      } else {
        const { error } = await supabase.from('clientes').insert(payload);
        if (error) throw error;
        toast.success('Cliente creado');
      }
      setShowModal(false);
      setEditando(null);
      resetForm();
      loadClientes();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handleSaveCredito(e) {
    e.preventDefault();
    if (!creditoCliente || !isAdmin) return;
    setSavingCredito(true);
    try {
      const { error } = await supabase.from('clientes').update({
        linea_credito: parseFloat(creditoForm.linea_credito) || 0,
        credito_activo: creditoForm.credito_activo,
        moneda_credito: creditoForm.moneda_credito,
      }).eq('id', creditoCliente.id);
      if (error) throw error;

      toast.success('Línea de crédito actualizada');
      setShowCreditoModal(false);
      setCreditoCliente(null);
      loadClientes();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingCredito(false);
    }
  }

  async function toggleCreditoRapido(cliente) {
    if (!isAdmin) return;
    try {
      const nuevoEstado = !cliente.credito_activo;
      const { error } = await supabase.from('clientes')
        .update({ credito_activo: nuevoEstado })
        .eq('id', cliente.id);
      if (error) throw error;

      toast.success(nuevoEstado ? `Crédito activado para ${cliente.nombre}` : `Crédito desactivado para ${cliente.nombre}`);
      loadClientes();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleConfirmDeleteCliente() {
    if (!clienteToDelete) return;
    setDeleting(true);
    try {
      await supabase.from('facturas').update({ cliente_id: null }).eq('cliente_id', clienteToDelete.id);
      const { error } = await supabase.from('clientes').delete().eq('id', clienteToDelete.id);
      if (error) throw error;
      toast.success(`Cliente "${clienteToDelete.nombre}" eliminado`);
      setClienteToDelete(null);
      loadClientes();
    } catch (err) {
      toast.error(err.message || 'Error al eliminar el cliente');
    } finally {
      setDeleting(false);
    }
  }

  function resetForm() {
    setForm({ nombre: '', documento_identidad: '', telefono: '', direccion: '', email: '', linea_credito: 0, credito_activo: false, moneda_credito: 'usd', contribuyente_especial: false, porcentaje_retencion_iva: 75 });
  }

  function editarCliente(cliente) {
    setEditando(cliente);
    setForm({
      nombre: cliente.nombre,
      documento_identidad: cliente.documento_identidad,
      telefono: cliente.telefono || '',
      direccion: cliente.direccion || '',
      email: cliente.email || '',
      linea_credito: cliente.linea_credito || 0,
      credito_activo: cliente.credito_activo || false,
      moneda_credito: cliente.moneda_credito || 'usd',
      contribuyente_especial: !!cliente.contribuyente_especial,
      porcentaje_retencion_iva: cliente.porcentaje_retencion_iva || 75,
    });
    setShowModal(true);
  }

  function abrirCreditoModal(cliente) {
    setCreditoCliente(cliente);
    setCreditoForm({
      linea_credito: cliente.linea_credito || 0,
      credito_activo: cliente.credito_activo || false,
      moneda_credito: cliente.moneda_credito || 'usd',
    });
    setShowCreditoModal(true);
  }

  const clientesFiltrados = clientes.filter(c =>
    !search || c.nombre.toLowerCase().includes(search.toLowerCase()) || c.documento_identidad.toLowerCase().includes(search.toLowerCase())
  );

  const pageSize = 20;
  const clientesPaginados = clientesFiltrados.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => { setCurrentPage(1); }, [search]);

  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando clientes...</p></div>;

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Clientes</h1>
        <button className="btn btn--primary" onClick={() => { setEditando(null); resetForm(); setShowModal(true); }}>
          <HiOutlinePlus /> Nuevo Cliente
        </button>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <HiOutlineMagnifyingGlass className="search-box__icon" />
          <input placeholder="Buscar por nombre o cédula..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                <th>Teléfono</th>
                <th>Email</th>
                {isAdmin && <th>Línea de Crédito</th>}
                <th>Registrado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clientesPaginados.map(c => (
                <tr key={c.id}>
                  <td>{c.nombre}</td>
                  <td><code>{c.documento_identidad}</code></td>
                  <td>
                    {c.telefono ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>{c.telefono}</span>
                        <a href={getWhatsAppUrl(c.telefono)} target="_blank" rel="noopener noreferrer" className="btn btn--ghost btn--xs" style={{ color: '#25D366', padding: '2px 5px', fontSize: '0.9rem' }} title="Enviar WhatsApp"><FaWhatsapp /></a>
                        <a href={getPhoneCallUrl(c.telefono)} className="btn btn--ghost btn--xs" style={{ color: '#3B82F6', padding: '2px 5px', fontSize: '0.75rem' }} title="Llamar"><FaPhone /></a>
                      </div>
                    ) : '—'}
                  </td>
                  <td>{c.email || '—'}</td>
                  {isAdmin && (
                    <td>
                      {c.linea_credito > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '9999px',
                              background: c.credito_activo ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)',
                              color: c.credito_activo ? 'var(--success, #10B981)' : 'var(--danger, #EF4444)',
                              border: `1px solid ${c.credito_activo ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                            }}
                          >
                            {c.credito_activo ? '✓ Activo' : '✗ Inactivo'}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {c.moneda_credito === 'usd' ? `$${Number(c.linea_credito).toFixed(2)}` : `Bs ${Number(c.linea_credito).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Sin crédito</span>
                      )}
                    </td>
                  )}
                  <td>{formatFecha(c.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      <button className="btn btn--ghost btn--xs" onClick={() => editarCliente(c)} title="Editar"><HiOutlinePencilSquare /></button>
                      {isAdmin && (
                        <>
                          <button
                            className="btn btn--ghost btn--xs"
                            onClick={() => abrirCreditoModal(c)}
                            title="Gestionar línea de crédito"
                            style={{ color: 'var(--accent, #6366F1)' }}
                          >
                            <HiOutlineCreditCard />
                          </button>
                          <button
                            className="btn btn--ghost btn--xs"
                            onClick={() => toggleCreditoRapido(c)}
                            title={c.credito_activo ? 'Desactivar crédito' : 'Activar crédito'}
                            style={{ color: c.credito_activo ? 'var(--success, #10B981)' : 'var(--text-secondary)' }}
                          >
                            {c.credito_activo ? <HiOutlineLockOpen /> : <HiOutlineLockClosed />}
                          </button>
                        </>
                      )}
                      <button className="btn btn--ghost btn--xs text-danger" onClick={() => setClienteToDelete(c)} title="Eliminar Cliente"><HiOutlineTrash /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {clientesFiltrados.length === 0 && (
                <tr><td colSpan={isAdmin ? 7 : 6} className="table__empty">No se encontraron clientes</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={clientesFiltrados.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Modal crear / editar cliente */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>{editando ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
            </div>
            <form onSubmit={handleSubmit} className="modal__form">
              <div className="form-group">
                <label>Nombre Completo</label>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cédula / RIF</label>
                  <input value={form.documento_identidad} onChange={e => setForm({ ...form, documento_identidad: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Dirección</label>
                  <input value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} />
                </div>
              </div>

              {/* Campos de crédito — solo admin */}
              {isAdmin && (
                <>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                    <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                      Línea de Crédito
                    </p>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Límite de Crédito</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={form.linea_credito}
                          onChange={e => setForm({ ...form, linea_credito: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>Moneda del Crédito</label>
                        <select value={form.moneda_credito} onChange={e => setForm({ ...form, moneda_credito: e.target.value })}>
                          {MONEDAS_CREDITO.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox" id="credito_activo_form"
                        checked={form.credito_activo}
                        onChange={e => setForm({ ...form, credito_activo: e.target.checked })}
                        style={{ width: 'auto' }}
                      />
                      <label htmlFor="credito_activo_form" style={{ margin: 0, cursor: 'pointer' }}>Crédito activo para este cliente</label>
                    </div>
                  </div>
                </>
              )}

              <div className="form-row" style={{ alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox" id="contribuyente_especial_form"
                    checked={form.contribuyente_especial}
                    onChange={e => setForm({ ...form, contribuyente_especial: e.target.checked })}
                    style={{ width: 'auto' }}
                  />
                  <label htmlFor="contribuyente_especial_form" style={{ margin: 0, cursor: 'pointer' }}>
                    Contribuyente especial (nos retiene IVA)
                  </label>
                </div>
                {form.contribuyente_especial && (
                  <div className="form-group">
                    <label>% de retención de IVA</label>
                    <select value={form.porcentaje_retencion_iva} onChange={e => setForm({ ...form, porcentaje_retencion_iva: e.target.value })}>
                      <option value={75}>75 % (general)</option>
                      <option value={100}>100 %</option>
                    </select>
                  </div>
                )}
              </div>

              <button type="submit" className="btn btn--primary btn--full">{editando ? 'Guardar' : 'Crear Cliente'}</button>
            </form>
          </div>
        </div>
      )}

      {/* Modal gestión de crédito (solo admin) */}
      {showCreditoModal && creditoCliente && isAdmin && (
        <div className="modal-overlay" onClick={() => setShowCreditoModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Línea de Crédito</h2>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {creditoCliente.nombre} · {creditoCliente.documento_identidad}
              </p>
            </div>
            <form onSubmit={handleSaveCredito} className="modal__form">
              <div className="form-row">
                <div className="form-group">
                  <label>Límite de Crédito</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={creditoForm.linea_credito}
                    onChange={e => setCreditoForm({ ...creditoForm, linea_credito: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Moneda</label>
                  <select value={creditoForm.moneda_credito} onChange={e => setCreditoForm({ ...creditoForm, moneda_credito: e.target.value })}>
                    {MONEDAS_CREDITO.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Toggle estado crédito */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.75rem 1rem', borderRadius: '0.5rem',
                  background: creditoForm.credito_activo ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.06)',
                  border: `1px solid ${creditoForm.credito_activo ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`,
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>Estado del crédito</p>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {creditoForm.credito_activo ? 'El cliente puede comprar a crédito' : 'Crédito suspendido — solo contado'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreditoForm(prev => ({ ...prev, credito_activo: !prev.credito_activo }))}
                  style={{
                    width: '48px', height: '26px', borderRadius: '9999px', border: 'none', cursor: 'pointer',
                    background: creditoForm.credito_activo ? 'var(--success, #10B981)' : 'rgba(255,255,255,0.15)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: '3px', left: creditoForm.credito_activo ? '25px' : '3px',
                    width: '20px', height: '20px', borderRadius: '50%', background: 'white',
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }} />
                </button>
              </div>

              {parseFloat(creditoForm.linea_credito) === 0 && (
                <p style={{ fontSize: '0.78rem', color: 'var(--warning, #F59E0B)', margin: '0.25rem 0 0' }}>
                  ⚠️ Límite en 0: el cliente podrá usar crédito sin restricción de monto.
                </p>
              )}

              <button type="submit" className="btn btn--primary btn--full" disabled={savingCredito}>
                {savingCredito ? 'Guardando...' : 'Guardar Línea de Crédito'}
              </button>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!clienteToDelete}
        title={`¿Eliminar al cliente "${clienteToDelete?.nombre}"?`}
        message="Las facturas emitidas a este cliente se conservarán en el historial como registro contable, desvinculando la referencia al cliente eliminado."
        confirmText="Sí, Eliminar Cliente"
        cancelText="Cancelar"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDeleteCliente}
        onCancel={() => !deleting && setClienteToDelete(null)}
      />
    </div>
  );
}
