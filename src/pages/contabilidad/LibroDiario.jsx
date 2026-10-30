import { useState, useEffect, useCallback } from 'react';
import {
  HiOutlineBookOpen,
  HiOutlinePlus,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineCalendar,
  HiOutlineMagnifyingGlass,
  HiOutlineFunnel,
  HiOutlineXMark,
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import {
  fetchAsientos,
  crearAsiento,
  fetchCuentasOperativas,
  ORIGENES_CONTABLES,
} from '../../services/contabilidadService';
import Pagination from '../../components/common/Pagination';
import usePaginacion from '../../hooks/usePaginacion';

const MODULOS = ORIGENES_CONTABLES;

export default function LibroDiario() {
  const [asientos, setAsientos] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterModulo, setFilterModulo] = useState('todos');
  const { visibles: asientosPagina, paginacion } = usePaginacion(asientos, 10);

  // Modal crear asiento
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), glosa: '', modulo: 'Manual' });
  const [lineas, setLineas] = useState([
    { cuenta_id: '', debe: '', haber: '' },
    { cuenta_id: '', debe: '', haber: '' },
  ]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [asientosData, cuentasData] = await Promise.all([
        fetchAsientos({ modulo: filterModulo, search: searchTerm }),
        fetchCuentasOperativas(),
      ]);
      setAsientos(asientosData);
      setCuentas(cuentasData);
    } catch (err) {
      toast.error('Error cargando datos contables: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [filterModulo, searchTerm]);

  useEffect(() => { loadData(); }, [loadData]);

  // ---- Helpers ----
  const formatMoney = (amount) =>
    `$${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatBolivares = (amount) =>
    `Bs. ${Number(amount || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const totalDebeCentimos = asientos.reduce((acc, asiento) =>
    acc + Math.round(Number(asiento.total_debe || 0) * 100), 0);
  const totalHaberCentimos = asientos.reduce((acc, asiento) =>
    acc + Math.round(Number(asiento.total_haber || 0) * 100), 0);
  const totalDebe = totalDebeCentimos / 100;
  const totalHaber = totalHaberCentimos / 100;
  const diferencia = Math.abs(totalDebeCentimos - totalHaberCentimos) / 100;

  // ---- Líneas dinámicas ----
  function updateLinea(idx, field, value) {
    setLineas((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      // Si escribe en debe, limpiar haber y viceversa
      if (field === 'debe' && value) copy[idx].haber = '';
      if (field === 'haber' && value) copy[idx].debe = '';
      return copy;
    });
  }

  function addLinea() {
    setLineas((prev) => [...prev, { cuenta_id: '', debe: '', haber: '' }]);
  }

  function removeLinea(idx) {
    if (lineas.length <= 2) return;
    setLineas((prev) => prev.filter((_, i) => i !== idx));
  }

  const sumaDebeForm = lineas.reduce((s, l) => s + (parseFloat(l.debe) || 0), 0);
  const sumaHaberForm = lineas.reduce((s, l) => s + (parseFloat(l.haber) || 0), 0);
  const sumaDebeFormCentimos = lineas.reduce((s, l) => s + Math.round((parseFloat(l.debe) || 0) * 100), 0);
  const sumaHaberFormCentimos = lineas.reduce((s, l) => s + Math.round((parseFloat(l.haber) || 0) * 100), 0);
  const formBalanced = sumaDebeFormCentimos === sumaHaberFormCentimos && sumaDebeFormCentimos > 0;

  // ---- Submit ----
  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.glosa.trim()) { toast.error('Ingrese un concepto / glosa'); return; }

    const lineasLimpias = lineas
      .filter((l) => l.cuenta_id && (parseFloat(l.debe) > 0 || parseFloat(l.haber) > 0))
      .map((l) => ({
        cuenta_id: l.cuenta_id,
        debe: parseFloat(l.debe) || 0,
        haber: parseFloat(l.haber) || 0,
      }));

    if (lineasLimpias.length < 2) { toast.error('Se requieren al menos 2 líneas válidas'); return; }

    const totalD = lineasLimpias.reduce((s, l) => s + l.debe, 0);
    const totalH = lineasLimpias.reduce((s, l) => s + l.haber, 0);
    const totalDCentimos = lineasLimpias.reduce((s, l) => s + Math.round(l.debe * 100), 0);
    const totalHCentimos = lineasLimpias.reduce((s, l) => s + Math.round(l.haber * 100), 0);
    if (totalDCentimos !== totalHCentimos) {
      toast.error(`El asiento no está balanceado. Debe: ${formatMoney(totalD)} ≠ Haber: ${formatMoney(totalH)}`);
      return;
    }

    setSaving(true);
    try {
      await crearAsiento(form.fecha, form.glosa, form.modulo, lineasLimpias);
      toast.success('Asiento contable registrado exitosamente');
      setShowModal(false);
      setForm({ fecha: new Date().toISOString().slice(0, 10), glosa: '', modulo: 'Manual' });
      setLineas([{ cuenta_id: '', debe: '', haber: '' }, { cuenta_id: '', debe: '', haber: '' }]);
      loadData();
    } catch (err) {
      toast.error('Error al crear asiento: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ---- Render ----
  if (loading) return <div className="page-loading"><div className="loading-spinner" /><p>Cargando Libro Diario...</p></div>;

  return (
    <div className="page">
      {/* Header */}
      <div className="page__header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span className="badge badge--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <HiOutlineBookOpen /> Contabilidad General
            </span>
            {diferencia < 0.01 ? (
              <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <HiOutlineCheckCircle /> Balance Cuadrado
              </span>
            ) : (
              <span className="badge badge--danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <HiOutlineExclamationTriangle /> Descuadrado
              </span>
            )}
          </div>
          <h1 className="page__title">Libro Diario</h1>
          <p className="page__subtitle">{asientos.length} asiento(s) registrado(s) en el sistema</p>
        </div>

        <button className="btn btn--primary" onClick={() => setShowModal(true)}>
          <HiOutlinePlus /> Nuevo Asiento
        </button>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div className="kpi-card__label">Total Débitos (Debe)</div>
          <div className="kpi-card__value" style={{ color: 'var(--primary)' }}>{formatMoney(totalDebe)}</div>
          <div className="kpi-card__sub" style={{ color: '#94A3B8' }}>{asientos.length} asientos analizados</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Total Créditos (Haber)</div>
          <div className="kpi-card__value" style={{ color: 'var(--info)' }}>{formatMoney(totalHaber)}</div>
          <div className="kpi-card__sub" style={{ color: '#94A3B8' }}>Sumas verificadas</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Diferencia</div>
          <div className="kpi-card__value" style={{ color: diferencia < 0.01 ? '#22C55E' : '#EF4444' }}>
            {diferencia < 0.01 ? 'Balanceado' : formatMoney(diferencia)}
          </div>
          <div className="kpi-card__sub" style={{ color: '#94A3B8' }}>
            {diferencia < 0.01 ? 'Partida doble correcta' : '¡Revisar asientos descuadrados!'}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <input
              type="text"
              placeholder="Buscar por glosa o número de asiento..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.85rem 0.6rem 2.2rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.9rem' }}
            />
            <HiOutlineMagnifyingGlass style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <HiOutlineFunnel style={{ color: 'var(--text-muted)' }} />
            <select value={filterModulo} onChange={(e) => setFilterModulo(e.target.value)} style={{ padding: '0.6rem 1rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
              <option value="todos">Todos los módulos</option>
              {MODULOS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Lista de Asientos */}
      {asientos.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: '1rem' }}>No hay asientos contables registrados.</p>
          <button className="btn btn--primary" onClick={() => setShowModal(true)}>
            <HiOutlinePlus /> Registrar Primer Asiento
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {asientosPagina.map((asiento) => (
            <div key={asiento.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Encabezado del Asiento */}
              <div style={{ padding: '0.9rem 1.25rem', background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary)', fontSize: '0.95rem', background: 'var(--primary-bg)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                    {asiento.numero}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    <HiOutlineCalendar /> {asiento.fecha}
                  </span>
                  <span className="badge badge--info" style={{ fontSize: '0.75rem' }}>{asiento.modulo}</span>
                  <span className="badge badge--secondary" style={{ fontSize: '0.75rem' }}>
                    Tasa: {Number(asiento.tasa_cambio || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} Bs./USD
                  </span>
                  {!asiento.balanceado && (
                    <span className="badge badge--danger" style={{ fontSize: '0.75rem' }}>Descuadrado</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {asiento.glosa}
                  </span>
                  <span className="badge badge--success">Registrado</span>
                </div>
              </div>

              {/* Detalle de Cuentas */}
              <div className="table-container" style={{ margin: 0 }}>
                <table className="table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '130px' }}>Código</th>
                      <th>Cuenta Contable</th>
                      <th style={{ width: '130px', textAlign: 'right' }}>Debe (USD)</th>
                      <th style={{ width: '130px', textAlign: 'right' }}>Haber (USD)</th>
                      <th style={{ width: '145px', textAlign: 'right' }}>Debe (Bs.)</th>
                      <th style={{ width: '145px', textAlign: 'right' }}>Haber (Bs.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(asiento.lineas_asiento || []).map((linea) => {
                      const cuenta = linea.plan_cuentas;
                      return (
                        <tr key={linea.id}>
                          <td style={{ fontFamily: 'monospace', color: '#94A3B8' }}>{cuenta?.codigo}</td>
                          <td style={{ paddingLeft: Number(linea.haber) > 0 ? '2rem' : '0.75rem' }}>
                            <span style={{ fontWeight: Number(linea.debe) > 0 ? 600 : 400 }}>{cuenta?.nombre}</span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: Number(linea.debe) > 0 ? 600 : 400, color: Number(linea.debe) > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {Number(linea.debe) > 0 ? formatMoney(linea.debe) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: Number(linea.haber) > 0 ? 600 : 400, color: Number(linea.haber) > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {Number(linea.haber) > 0 ? formatMoney(linea.haber) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: Number(linea.debeVes) > 0 ? 600 : 400, color: Number(linea.debeVes) > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {Number(linea.debeVes) > 0 ? formatBolivares(linea.debeVes) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: Number(linea.haberVes) > 0 ? 600 : 400, color: Number(linea.haberVes) > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {Number(linea.haberVes) > 0 ? formatBolivares(linea.haberVes) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: 'rgba(255, 255, 255, 0.015)', fontWeight: 700, borderTop: '1px solid var(--border)' }}>
                      <td colSpan="2" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>Sumas Iguales:</td>
                      <td style={{ textAlign: 'right', color: 'var(--primary)' }}>{formatMoney(asiento.total_debe)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--info)' }}>{formatMoney(asiento.total_haber)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--primary)' }}>{formatBolivares(asiento.total_debe_ves)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--info)' }}>{formatBolivares(asiento.total_haber_ves)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <Pagination {...paginacion} />
        </div>
      )}

      {/* ======== Modal Crear Asiento ======== */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !saving && setShowModal(false)}>
          <div className="modal modal--lg" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal__header">
              <h2>Registrar Asiento Contable</h2>
            </div>
            <form onSubmit={handleSubmit} className="modal__form" style={{ flex: 1, overflow: 'auto' }}>
              <div className="form-row">
                <div className="form-group">
                  <label>Fecha Contable</label>
                  <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Módulo / Tipo</label>
                  <select value={form.modulo} onChange={(e) => setForm({ ...form, modulo: e.target.value })}>
                    {MODULOS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Concepto / Glosa</label>
                <input value={form.glosa} onChange={(e) => setForm({ ...form, glosa: e.target.value })} placeholder="Descripción del asiento contable" required />
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                La conversión a bolívares utiliza la última tasa BCV registrada hasta la fecha contable.
              </p>

              {/* Líneas dinámicas */}
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Líneas de Partida Doble</label>
                  <button type="button" className="btn btn--ghost btn--xs" onClick={addLinea} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <HiOutlinePlus /> Agregar Línea
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {lineas.map((linea, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <select
                        value={linea.cuenta_id}
                        onChange={(e) => updateLinea(idx, 'cuenta_id', e.target.value)}
                        required
                        style={{ flex: 2, minWidth: '200px', padding: '0.5rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                      >
                        <option value="">Seleccionar cuenta...</option>
                        {cuentas.map((c) => (
                          <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                        ))}
                      </select>
                      <input
                        type="number" min="0" step="0.01" placeholder="Debe"
                        value={linea.debe} onChange={(e) => updateLinea(idx, 'debe', e.target.value)}
                        style={{ flex: 1, minWidth: '100px', padding: '0.5rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                      />
                      <input
                        type="number" min="0" step="0.01" placeholder="Haber"
                        value={linea.haber} onChange={(e) => updateLinea(idx, 'haber', e.target.value)}
                        style={{ flex: 1, minWidth: '100px', padding: '0.5rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeLinea(idx)}
                        disabled={lineas.length <= 2}
                        style={{ background: 'none', border: 'none', color: lineas.length <= 2 ? 'var(--text-muted)' : '#EF4444', cursor: lineas.length <= 2 ? 'not-allowed' : 'pointer', padding: '0.25rem', fontSize: '1.1rem', display: 'flex', minWidth: '36px', minHeight: '36px', alignItems: 'center', justifyContent: 'center' }}
                        title="Quitar línea"
                      >
                        <HiOutlineXMark />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Resumen de balance */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1.5rem', marginTop: '0.75rem', padding: '0.75rem', background: formBalanced ? 'var(--success-bg)' : 'var(--danger-bg)', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600 }}>
                  <span>Debe: {formatMoney(sumaDebeForm)}</span>
                  <span>Haber: {formatMoney(sumaHaberForm)}</span>
                  <span style={{ color: formBalanced ? '#22C55E' : '#EF4444' }}>
                    {formBalanced ? '✓ Balanceado' : `✗ Dif: ${formatMoney(Math.abs(sumaDebeForm - sumaHaberForm))}`}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="btn btn--secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancelar</button>
                <button type="submit" className="btn btn--primary" disabled={saving || !formBalanced}>
                  {saving ? 'Guardando...' : 'Guardar Asiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
