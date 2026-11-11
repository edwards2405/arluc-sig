import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HiOutlineBookOpen,
  HiOutlinePlus,
  HiOutlineMagnifyingGlass,
  HiOutlineChevronRight,
  HiOutlineChevronDown,
  HiOutlineFolder,
  HiOutlineFolderOpen,
  HiOutlineDocumentText,
  HiOutlineXMark,
  HiOutlineEyeSlash,
  HiOutlineEye,
  HiOutlineArrowPath,
  HiOutlineFunnel,
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import {
  fetchPlanCuentasCompleto,
  crearCuenta,
  toggleCuentaActiva,
} from '../../services/contabilidadService';
import { useAuth } from '../../contexts/AuthContext';
import { puede } from '../../utils/permisos';
import { mensajeError } from '../../utils/errores';

const TIPOS_CUENTA = [
  { value: 'ACTIVO', label: 'Activo', color: 'var(--info)' },
  { value: 'PASIVO', label: 'Pasivo', color: 'var(--warning)' },
  { value: 'PATRIMONIO', label: 'Patrimonio', color: 'var(--primary)' },
  { value: 'INGRESO', label: 'Ingreso', color: '#22C55E' },
  { value: 'COSTO', label: 'Costo', color: '#F97316' },
  { value: 'GASTO', label: 'Gasto', color: '#EF4444' },
];

const NATURALEZAS = [
  { value: 'DEUDORA', label: 'Deudora' },
  { value: 'ACREEDORA', label: 'Acreedora' },
];

function buildTree(cuentas) {
  const map = {};
  const roots = [];

  for (const cuenta of cuentas) {
    map[cuenta.id] = { ...cuenta, children: [] };
  }

  for (const cuenta of cuentas) {
    if (cuenta.cuenta_padre_id && map[cuenta.cuenta_padre_id]) {
      map[cuenta.cuenta_padre_id].children.push(map[cuenta.id]);
    } else {
      roots.push(map[cuenta.id]);
    }
  }

  return roots;
}

function getTipoColor(tipo) {
  const found = TIPOS_CUENTA.find((t) => t.value === tipo?.toUpperCase());
  return found?.color || 'var(--text-muted)';
}

function getTipoBadgeClass(tipo) {
  switch (tipo?.toUpperCase()) {
    case 'ACTIVO': return 'badge--info';
    case 'PASIVO': return 'badge--warning';
    case 'PATRIMONIO': return 'badge--primary';
    case 'INGRESO': return 'badge--success';
    case 'COSTO': return 'badge--warning';
    case 'GASTO': return 'badge--danger';
    default: return 'badge--ghost';
  }
}

function CuentaTreeNode({ cuenta, nivel, expandedIds, toggleExpand, onToggleActive, search }) {
  const hasChildren = cuenta.children && cuenta.children.length > 0;
  const isExpanded = expandedIds.has(cuenta.id);
  const indent = nivel * 1.5;

  const matchesSearch = search
    ? cuenta.codigo.toLowerCase().includes(search) || cuenta.nombre.toLowerCase().includes(search)
    : true;

  const childrenMatchSearch = search
    ? cuenta.children?.some(
        (c) =>
          c.codigo.toLowerCase().includes(search) ||
          c.nombre.toLowerCase().includes(search) ||
          c.children?.some(
            (gc) => gc.codigo.toLowerCase().includes(search) || gc.nombre.toLowerCase().includes(search)
          )
      )
    : true;

  if (search && !matchesSearch && !childrenMatchSearch) return null;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.65rem 0.75rem',
          paddingLeft: `${0.75 + indent}rem`,
          borderBottom: '1px solid var(--border)',
          background: !cuenta.activo ? 'rgba(239, 68, 68, 0.04)' : 'transparent',
          opacity: !cuenta.activo ? 0.55 : 1,
          transition: 'background 0.15s ease',
          flexWrap: 'wrap',
          cursor: hasChildren ? 'pointer' : 'default',
          minHeight: '48px',
        }}
        onClick={() => hasChildren && toggleExpand(cuenta.id)}
      >
        {/* Expand/Collapse toggle */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            flexShrink: 0,
            color: hasChildren ? 'var(--text-secondary)' : 'transparent',
          }}
        >
          {hasChildren ? (
            isExpanded ? <HiOutlineChevronDown size={14} /> : <HiOutlineChevronRight size={14} />
          ) : (
            <span style={{ width: '14px' }} />
          )}
        </span>

        {/* Icon */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: cuenta.es_padre
              ? 'var(--primary-bg)'
              : 'var(--bg-elevated)',
            color: cuenta.es_padre ? 'var(--primary)' : 'var(--text-secondary)',
            flexShrink: 0,
            fontSize: '0.95rem',
          }}
        >
          {cuenta.es_padre ? (
            isExpanded ? <HiOutlineFolderOpen /> : <HiOutlineFolder />
          ) : (
            <HiOutlineDocumentText />
          )}
        </span>

        {/* Code */}
        <code
          style={{
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            fontWeight: 700,
            color: getTipoColor(cuenta.tipo),
            background: 'var(--bg-elevated)',
            padding: '0.15rem 0.45rem',
            borderRadius: '4px',
            flexShrink: 0,
          }}
        >
          {cuenta.codigo}
        </code>

        {/* Name */}
        <span
          style={{
            fontWeight: cuenta.es_padre ? 600 : 400,
            color: cuenta.es_padre ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: '0.9rem',
            flex: 1,
            minWidth: '120px',
          }}
        >
          {cuenta.nombre}
        </span>

        {/* Badges */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span className={`badge ${getTipoBadgeClass(cuenta.tipo)}`} style={{ fontSize: '0.7rem' }}>
            {cuenta.tipo}
          </span>
          <span className="badge badge--ghost" style={{ fontSize: '0.7rem' }}>
            {cuenta.naturaleza}
          </span>
          {cuenta.es_padre && (
            <span className="badge badge--primary" style={{ fontSize: '0.65rem' }}>
              Grupo
            </span>
          )}
          {!cuenta.activo && (
            <span className="badge badge--danger" style={{ fontSize: '0.65rem' }}>
              Inactiva
            </span>
          )}
        </span>

        {/* Actions */}
        {onToggleActive && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive(cuenta);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: cuenta.activo ? 'var(--text-muted)' : 'var(--primary)',
              cursor: 'pointer',
              padding: '0.3rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '36px',
              minHeight: '36px',
              borderRadius: '6px',
              transition: 'all 0.15s ease',
            }}
            title={cuenta.activo ? 'Desactivar cuenta' : 'Reactivar cuenta'}
          >
            {cuenta.activo ? <HiOutlineEyeSlash size={16} /> : <HiOutlineEye size={16} />}
          </button>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {cuenta.children.map((child) => (
            <CuentaTreeNode
              key={child.id}
              cuenta={child}
              nivel={nivel + 1}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              onToggleActive={onToggleActive}
              search={search}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function PlanCuentas() {
  const { profile } = useAuth();
  const puedeEditar = puede(profile?.rol, 'cuenta.editar');
  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTipo, setFilterTipo] = useState('todos');
  const [showInactivas, setShowInactivas] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    codigo: '',
    nombre: '',
    tipo: 'ACTIVO',
    naturaleza: 'DEUDORA',
    es_padre: false,
    cuenta_padre_id: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPlanCuentasCompleto();
      setCuentas(data);
      // Auto-expand first-level parents
      const padresIds = new Set(data.filter((c) => c.es_padre && !c.cuenta_padre_id).map((c) => c.id));
      setExpandedIds(padresIds);
    } catch (err) {
      toast.error('Error al cargar plan de cuentas: ' + mensajeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleExpand = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAll = () => {
    setExpandedIds(new Set(cuentas.filter((c) => c.es_padre).map((c) => c.id)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  async function handleToggleActive(cuenta) {
    try {
      await toggleCuentaActiva(cuenta.id, !cuenta.activo);
      toast.success(cuenta.activo ? `Cuenta "${cuenta.codigo}" desactivada` : `Cuenta "${cuenta.codigo}" reactivada`);
      loadData();
    } catch (err) {
      toast.error(mensajeError(err, 'No se pudo cambiar el estado de la cuenta'));
    }
  }

  const cuentasFiltradas = useMemo(() => {
    let filtered = cuentas;
    if (!showInactivas) {
      filtered = filtered.filter((c) => c.activo);
    }
    if (filterTipo !== 'todos') {
      filtered = filtered.filter((c) => c.tipo?.toUpperCase() === filterTipo);
    }
    return filtered;
  }, [cuentas, showInactivas, filterTipo]);

  const tree = useMemo(() => buildTree(cuentasFiltradas), [cuentasFiltradas]);

  const search = searchTerm.toLowerCase().trim();

  // Stats
  const totalCuentas = cuentas.filter((c) => c.activo).length;
  const cuentasPadre = cuentas.filter((c) => c.activo && c.es_padre).length;
  const cuentasOperativas = cuentas.filter((c) => c.activo && !c.es_padre).length;
  const cuentasInactivas = cuentas.filter((c) => !c.activo).length;

  // Create account
  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.codigo.trim() || !form.nombre.trim()) {
      toast.error('El código y nombre son obligatorios');
      return;
    }
    setSaving(true);
    try {
      await crearCuenta(form);
      toast.success(`Cuenta "${form.codigo}" creada exitosamente`);
      setShowModal(false);
      setForm({ codigo: '', nombre: '', tipo: 'ACTIVO', naturaleza: 'DEUDORA', es_padre: false, cuenta_padre_id: '' });
      loadData();
    } catch (err) {
      toast.error('Error al crear cuenta: ' + mensajeError(err));
    } finally {
      setSaving(false);
    }
  }

  // Parent accounts for the selector
  const cuentasPadreList = cuentas.filter((c) => c.activo && c.es_padre);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Cargando Plan de Cuentas...</p>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="page__header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span className="badge badge--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <HiOutlineBookOpen /> Contabilidad General
            </span>
          </div>
          <h1 className="page__title">Plan de Cuentas</h1>
          <p className="page__subtitle">Estructura jerárquica del catálogo contable</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {puedeEditar && (
            <button className="btn btn--primary" onClick={() => setShowModal(true)}>
              <HiOutlinePlus /> Nueva Cuenta
            </button>
          )}
          <button className="btn btn--secondary" onClick={loadData} title="Refrescar">
            <HiOutlineArrowPath /> Refrescar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.25rem' }}>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--primary">
            <HiOutlineBookOpen />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Total Cuentas</span>
            <span className="stat-card__value">{totalCuentas}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--info">
            <HiOutlineFolder />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Grupos (Padre)</span>
            <span className="stat-card__value">{cuentasPadre}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--success">
            <HiOutlineDocumentText />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Operativas</span>
            <span className="stat-card__value">{cuentasOperativas}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--warning">
            <HiOutlineEyeSlash />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Inactivas</span>
            <span className="stat-card__value">{cuentasInactivas}</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <input
              type="text"
              placeholder="Buscar por código o nombre de cuenta..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.85rem 0.6rem 2.2rem',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                minHeight: '44px',
              }}
            />
            <HiOutlineMagnifyingGlass
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
          </div>

          {/* Filter tipo */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <HiOutlineFunnel style={{ color: 'var(--text-muted)' }} />
            <select
              value={filterTipo}
              onChange={(e) => setFilterTipo(e.target.value)}
              style={{
                padding: '0.6rem 1rem',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                minHeight: '44px',
              }}
            >
              <option value="todos">Todos los tipos</option>
              {TIPOS_CUENTA.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Toggle inactivas */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              minHeight: '44px',
              padding: '0 0.5rem',
            }}
          >
            <input
              type="checkbox"
              checked={showInactivas}
              onChange={(e) => setShowInactivas(e.target.checked)}
              style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
            />
            Mostrar inactivas
          </label>

          {/* Expand / Collapse */}
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button className="btn btn--ghost btn--sm" onClick={expandAll} title="Expandir todo">
              <HiOutlineChevronDown /> Expandir
            </button>
            <button className="btn btn--ghost btn--sm" onClick={collapseAll} title="Contraer todo">
              <HiOutlineChevronRight /> Contraer
            </button>
          </div>
        </div>
      </div>

      {/* Tree */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(255, 255, 255, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            Estructura del Plan Contable
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {cuentasFiltradas.length} cuenta(s) visible(s)
          </span>
        </div>

        {tree.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <HiOutlineBookOpen style={{ fontSize: '2.5rem', opacity: 0.4, marginBottom: '0.5rem' }} />
            <p style={{ fontWeight: 600 }}>No hay cuentas contables</p>
            {puedeEditar && <p style={{ fontSize: '0.85rem' }}>Cree la primera cuenta con el botón "Nueva Cuenta".</p>}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: '600px' }}>
              {tree.map((cuenta) => (
                <CuentaTreeNode
                  key={cuenta.id}
                  cuenta={cuenta}
                  nivel={0}
                  expandedIds={expandedIds}
                  toggleExpand={toggleExpand}
                  onToggleActive={puedeEditar ? handleToggleActive : null}
                  search={search}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ======== Modal Crear Cuenta ======== */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !saving && setShowModal(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
          >
            <div className="modal__header">
              <h2>Nueva Cuenta Contable</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  display: 'flex',
                  minWidth: '36px',
                  minHeight: '36px',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <HiOutlineXMark />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="modal__form" style={{ flex: 1, overflow: 'auto' }}>
              <div className="form-row">
                <div className="form-group">
                  <label>Código</label>
                  <input
                    value={form.codigo}
                    onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    placeholder="Ej: 1.1.01"
                    required
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>
                <div className="form-group">
                  <label>Cuenta Padre (opcional)</label>
                  <select
                    value={form.cuenta_padre_id}
                    onChange={(e) => setForm({ ...form, cuenta_padre_id: e.target.value })}
                  >
                    <option value="">— Ninguna (Raíz) —</option>
                    {cuentasPadreList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} — {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Nombre de la Cuenta</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: Bancos Nacionales"
                  required
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo</label>
                  <select
                    value={form.tipo}
                    onChange={(e) => {
                      const tipo = e.target.value;
                      const naturaleza = ['ACTIVO', 'COSTO', 'GASTO'].includes(tipo) ? 'DEUDORA' : 'ACREEDORA';
                      setForm({ ...form, tipo, naturaleza });
                    }}
                  >
                    {TIPOS_CUENTA.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Naturaleza</label>
                  <select
                    value={form.naturaleza}
                    onChange={(e) => setForm({ ...form, naturaleza: e.target.value })}
                  >
                    {NATURALEZAS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '0.5rem 0',
                }}
              >
                <input
                  type="checkbox"
                  checked={form.es_padre}
                  onChange={(e) => setForm({ ...form, es_padre: e.target.checked })}
                  style={{ accentColor: 'var(--primary)', width: '18px', height: '18px' }}
                />
                Es cuenta padre (agrupadora — no acepta movimientos directos)
              </label>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn--secondary" onClick={() => setShowModal(false)} disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  {saving ? 'Guardando...' : 'Crear Cuenta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
