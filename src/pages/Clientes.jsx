import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatFecha, formatMonto, getWhatsAppUrl, getPhoneCallUrl } from '../utils/formatters';
import toast from 'react-hot-toast';
import Pagination from '../components/common/Pagination';
import { useAuth } from '../contexts/AuthContext';
import {
  HiOutlinePlus, HiOutlinePencilSquare, HiOutlineMagnifyingGlass,
  HiOutlineTrash, HiOutlineCreditCard, HiOutlineLockClosed, HiOutlineLockOpen,
} from 'react-icons/hi2';
import { FaWhatsapp, FaPhone } from 'react-icons/fa';
import ConfirmModal from '../components/common/ConfirmModal';
import { CampoDocumento, CampoTelefono } from '../components/common/CamposVenezuela';
import { useDialogo } from '../components/common/DialogoProvider';
import {
  tieneTexto, normalizarDocumento, validarDocumento, normalizarTelefono, validarTelefono, validarCorreo,
} from '../utils/validaciones';
import { puede } from '../utils/permisos';
import { mensajeError, exigirFilas } from '../utils/errores';

const MONEDAS_CREDITO = [
  { id: 'usd', label: 'USD (Dólares)' },
  { id: 'bs', label: 'Bs (Bolívares)' },
];

export default function Clientes() {
  const { profile } = useAuth();
  // Las condiciones de crédito las gestionan admin y gerente (la BD lo valida)
  const isAdmin = ['admin', 'gerente'].includes(profile?.rol);
  // La condición de contribuyente especial la fijan admin, gerente y contador (la BD lo valida)
  const puedeFiscal = ['admin', 'gerente', 'contador'].includes(profile?.rol);
  const puedeEliminar = puede(profile?.rol, 'cliente.eliminar');
  const { confirmar } = useDialogo();
  const [errores, setErrores] = useState({});

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
    if (error) toast.error('Error cargando clientes: ' + mensajeError(error));
    setClientes(data || []);
    setLoading(false);
  }

  /** Valida las condiciones de crédito; devuelve un mensaje de error o null. */
  function errorCredito(linea, activo) {
    const n = Number(linea);
    if (!Number.isFinite(n) || n < 0) return 'El límite de crédito debe ser un número mayor o igual a 0';
    if (activo && n <= 0) return 'Para activar el crédito, el límite debe ser mayor que 0';
    return null;
  }

  /** Si el nuevo límite (USD) queda por debajo de la deuda pendiente, pide confirmación. */
  async function confirmarLimiteBajoDeuda(cliente, linea, moneda) {
    if (!cliente || moneda !== 'usd') return true;
    const { data: saldo, error } = await supabase.rpc('saldo_credito_cliente', { p_cliente_id: cliente.id });
    if (error || !(Number(saldo) > Number(linea))) return true;
    return confirmar({
      titulo: 'Límite por debajo de la deuda',
      mensaje: `${cliente.nombre} debe ${formatMonto(saldo)} a crédito y el nuevo límite es ${formatMonto(linea)}. No podrá comprar a crédito hasta que su deuda baje del límite. ¿Desea continuar?`,
      variante: 'warning',
      textoConfirmar: 'Sí, guardar',
    });
  }

  function validarFormulario() {
    const errs = {};
    if (!tieneTexto(form.nombre)) errs.nombre = 'El nombre es obligatorio';
    const errDoc = validarDocumento(form.documento_identidad);
    if (errDoc) errs.documento_identidad = errDoc;
    const errTel = validarTelefono(form.telefono);
    if (errTel) errs.telefono = errTel;
    const errCorreo = validarCorreo(form.email);
    if (errCorreo) errs.email = errCorreo;
    if (puedeFiscal && form.contribuyente_especial) {
      if (!errDoc && !/^[JG]-/.test(normalizarDocumento(form.documento_identidad))) {
        errs.documento_identidad = 'Un contribuyente especial debe tener RIF jurídico (J) o gubernamental (G)';
      } else if (!errDoc && validarDocumento(form.documento_identidad, { soloRif: true })) {
        errs.documento_identidad = validarDocumento(form.documento_identidad, { soloRif: true });
      }
      if (![75, 100].includes(Number(form.porcentaje_retencion_iva))) errs.porcentaje_retencion_iva = 'El porcentaje de retención debe ser 75 o 100';
    }
    if (isAdmin) {
      const errCred = errorCredito(form.linea_credito, form.credito_activo);
      if (errCred) errs.linea_credito = errCred;
    }
    setErrores(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validarFormulario()) return;
    try {
      if (isAdmin && editando && !(await confirmarLimiteBajoDeuda(editando, form.linea_credito, form.moneda_credito))) return;
      const payload = {
        nombre: form.nombre.trim(),
        documento_identidad: normalizarDocumento(form.documento_identidad),
        telefono: tieneTexto(form.telefono) ? normalizarTelefono(form.telefono) : null,
        direccion: form.direccion.trim() || null,
        email: form.email.trim().toLowerCase() || null,
        // Contribuyente especial: solo admin/gerente/contador (la BD lo valida)
        ...(puedeFiscal && {
          contribuyente_especial: !!form.contribuyente_especial,
          porcentaje_retencion_iva: Number(form.porcentaje_retencion_iva) === 100 ? 100 : 75,
        }),
        // Las condiciones de crédito solo las fija admin/gerente (la BD lo valida)
        ...(isAdmin && {
          linea_credito: Number(form.linea_credito) || 0,
          credito_activo: !!form.credito_activo,
          moneda_credito: form.moneda_credito,
        }),
      };

      if (editando) {
        const { data, error } = await supabase.from('clientes').update(payload).eq('id', editando.id).select('id');
        if (error) throw error;
        exigirFilas(data);
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
      toast.error(mensajeError(error, 'Error al guardar el cliente'));
    }
  }

  async function handleSaveCredito(e) {
    e.preventDefault();
    if (!creditoCliente || !isAdmin) return;
    const errCred = errorCredito(creditoForm.linea_credito, creditoForm.credito_activo);
    if (errCred) { toast.error(errCred); return; }
    setSavingCredito(true);
    try {
      if (!(await confirmarLimiteBajoDeuda(creditoCliente, creditoForm.linea_credito, creditoForm.moneda_credito))) return;
      const { data, error } = await supabase.from('clientes').update({
        linea_credito: Number(creditoForm.linea_credito) || 0,
        credito_activo: creditoForm.credito_activo,
        moneda_credito: creditoForm.moneda_credito,
      }).eq('id', creditoCliente.id).select('id');
      if (error) throw error;
      exigirFilas(data);

      toast.success('Línea de crédito actualizada');
      setShowCreditoModal(false);
      setCreditoCliente(null);
      loadClientes();
    } catch (err) {
      toast.error(mensajeError(err, 'Error al guardar la línea de crédito'));
    } finally {
      setSavingCredito(false);
    }
  }

  async function toggleCreditoRapido(cliente) {
    if (!isAdmin) return;
    try {
      const nuevoEstado = !cliente.credito_activo;
      if (nuevoEstado && !(Number(cliente.linea_credito) > 0)) {
        toast.error('Asigne primero un límite de crédito mayor que 0');
        return;
      }
      const { data, error } = await supabase.from('clientes')
        .update({ credito_activo: nuevoEstado })
        .eq('id', cliente.id)
        .select('id');
      if (error) throw error;
      exigirFilas(data);

      toast.success(nuevoEstado ? `Crédito activado para ${cliente.nombre}` : `Crédito desactivado para ${cliente.nombre}`);
      loadClientes();
    } catch (err) {
      toast.error(mensajeError(err, 'Error al cambiar el crédito'));
    }
  }

  async function handleConfirmDeleteCliente() {
    if (!clienteToDelete) return;
    setDeleting(true);
    try {
      // La BD impide borrar un cliente con facturas, notas o cuentas por cobrar
      const { data, error } = await supabase.from('clientes').delete().eq('id', clienteToDelete.id).select('id');
      if (error) throw error;
      exigirFilas(data, 'No se eliminó el cliente: no tiene permiso o ya no existe.');
      toast.success(`Cliente "${clienteToDelete.nombre}" eliminado`);
      setClienteToDelete(null);
      loadClientes();
    } catch (err) {
      toast.error(err.code === '23503'
        ? `No se puede eliminar a "${clienteToDelete.nombre}": tiene facturas u otros documentos registrados.`
        : mensajeError(err, 'Error al eliminar el cliente'));
    } finally {
      setDeleting(false);
    }
  }

  function resetForm() {
    setErrores({});
    setForm({ nombre: '', documento_identidad: '', telefono: '', direccion: '', email: '', linea_credito: 0, credito_activo: false, moneda_credito: 'usd', contribuyente_especial: false, porcentaje_retencion_iva: 75 });
  }

  function editarCliente(cliente) {
    setEditando(cliente);
    setErrores({});
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
                            {c.moneda_credito === 'usd' ? formatMonto(c.linea_credito) : `Bs ${Number(c.linea_credito).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`}
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
                      {puedeEliminar && (
                        <button className="btn btn--ghost btn--xs text-danger" onClick={() => setClienteToDelete(c)} title="Eliminar Cliente"><HiOutlineTrash /></button>
                      )}
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
                {errores.nombre && <small style={{ color: '#ef4444' }}>{errores.nombre}</small>}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cédula / RIF</label>
                  <CampoDocumento
                    value={form.documento_identidad}
                    onChange={(v) => setForm(f => ({ ...f, documento_identidad: v }))}
                    required
                  />
                  {errores.documento_identidad && <small style={{ color: '#ef4444' }}>{errores.documento_identidad}</small>}
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <CampoTelefono
                    value={form.telefono}
                    onChange={(v) => setForm(f => ({ ...f, telefono: v }))}
                  />
                  {errores.telefono && <small style={{ color: '#ef4444' }}>{errores.telefono}</small>}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                  {errores.email && <small style={{ color: '#ef4444' }}>{errores.email}</small>}
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
                        <label>Límite de Crédito ({form.moneda_credito === 'usd' ? 'USD' : 'Bs'})</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={form.linea_credito}
                          onChange={e => setForm({ ...form, linea_credito: e.target.value })}
                        />
                        {form.moneda_credito === 'usd' && Number(form.linea_credito) > 0 && <small>≈ {formatMonto(form.linea_credito)}</small>}
                        {errores.linea_credito && <small style={{ color: '#ef4444' }}>{errores.linea_credito}</small>}
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

              {puedeFiscal ? (
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
                    {errores.porcentaje_retencion_iva && <small style={{ color: '#ef4444' }}>{errores.porcentaje_retencion_iva}</small>}
                  </div>
                )}
              </div>
              ) : (
                editando?.contribuyente_especial && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Contribuyente especial (retención {editando.porcentaje_retencion_iva || 75} %). Solo admin, gerente o contador pueden cambiarlo.
                  </p>
                )
              )}

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
                  <label>Límite de Crédito ({creditoForm.moneda_credito === 'usd' ? 'USD' : 'Bs'})</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={creditoForm.linea_credito}
                    onChange={e => setCreditoForm({ ...creditoForm, linea_credito: e.target.value })}
                  />
                  {creditoForm.moneda_credito === 'usd' && Number(creditoForm.linea_credito) > 0 && <small>≈ {formatMonto(creditoForm.linea_credito)}</small>}
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

              {!(Number(creditoForm.linea_credito) > 0) && (
                <p style={{ fontSize: '0.78rem', color: creditoForm.credito_activo ? '#ef4444' : 'var(--warning, #F59E0B)', margin: '0.25rem 0 0' }}>
                  ⚠️ Límite en 0: el cliente no puede comprar a crédito. Para activar el crédito asigne un límite mayor que 0.
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
        message="Solo se puede eliminar un cliente sin facturas, notas ni cuentas por cobrar. Si tiene documentos registrados, el sistema no permitirá eliminarlo para conservar el registro contable."
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
