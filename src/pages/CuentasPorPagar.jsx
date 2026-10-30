import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatUSD, formatBs, formatFecha } from '../utils/formatters';
import Pagination from '../components/common/Pagination';
import {
  HiOutlineMagnifyingGlass,
  HiOutlineBanknotes,
  HiOutlineExclamationTriangle,
  HiOutlineClock,
  HiOutlineArrowPath,
} from 'react-icons/hi2';

const METODOS_PAGO_PROVEEDOR = [
  { id: 'transferencia', label: 'Transferencia (Bs)' },
  { id: 'pago_movil', label: 'Pago Móvil (Bs)' },
  { id: 'efectivo_bs', label: 'Efectivo Bs' },
  { id: 'efectivo_usd', label: 'Efectivo USD (genera IGTF)' },
  { id: 'zelle', label: 'Zelle (genera IGTF)' },
];

const hoy = () => new Date().toLocaleDateString('en-CA');

export default function CuentasPorPagar() {
  const { profile } = useAuth();
  const puedePagar = ['admin', 'gerente', 'contador'].includes(profile?.rol);
  const [loading, setLoading] = useState(true);
  const [cuentas, setCuentas] = useState([]);
  const [tasa, setTasa] = useState(0);
  const [search, setSearch] = useState('');
  const [filtro, setFiltro] = useState('PENDIENTE');
  const [currentPage, setCurrentPage] = useState(1);
  const [cuentaAPagar, setCuentaAPagar] = useState(null);
  const [form, setForm] = useState({ monto: '', metodo: 'transferencia', referencia: '', notas: '' });
  const [guardando, setGuardando] = useState(false);
  const pageSize = 15;

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    setLoading(true);
    const [{ data, error }, { data: tasaData }] = await Promise.all([
      supabase
        .from('cuentas_por_pagar')
        .select(`
          *,
          proveedores ( nombre, rif ),
          ordenes_compra ( numero_orden, numero_factura_proveedor ),
          pagos_cxp ( id, fecha, metodo_id, monto_usd, igtf_usd, monto_bs, diferencial_bs, referencia )
        `)
        .order('fecha_vencimiento'),
      supabase.from('tasas_cambio').select('tasa_usd_bs').order('fecha_registro', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error) toast.error('Error cargando cuentas por pagar: ' + error.message);
    setCuentas(data || []);
    setTasa(Number(tasaData?.tasa_usd_bs || 0));
    setLoading(false);
    return data || [];
  }

  const filtradas = useMemo(() => {
    const q = search.toLowerCase().trim();
    return cuentas.filter((c) => {
      const vencida = c.estado === 'PENDIENTE' && c.fecha_vencimiento < hoy();
      const matchFiltro = filtro === 'TODAS' || (filtro === 'VENCIDAS' ? vencida : c.estado === filtro);
      const matchSearch = !q
        || c.proveedores?.nombre?.toLowerCase().includes(q)
        || c.proveedores?.rif?.toLowerCase().includes(q)
        || c.ordenes_compra?.numero_orden?.toLowerCase().includes(q)
        || c.ordenes_compra?.numero_factura_proveedor?.toLowerCase().includes(q);
      return matchFiltro && matchSearch;
    });
  }, [cuentas, search, filtro]);

  const stats = useMemo(() => {
    const pendientes = cuentas.filter((c) => c.estado === 'PENDIENTE');
    const enSieteDias = new Date();
    enSieteDias.setDate(enSieteDias.getDate() + 7);
    const limite = enSieteDias.toLocaleDateString('en-CA');
    const suma = (lista) => lista.reduce((s, c) => s + Number(c.saldo_usd), 0);
    return {
      total: suma(pendientes),
      vencido: suma(pendientes.filter((c) => c.fecha_vencimiento < hoy())),
      porVencer: suma(pendientes.filter((c) => c.fecha_vencimiento >= hoy() && c.fecha_vencimiento <= limite)),
      proveedores: new Set(pendientes.map((c) => c.proveedor_id)).size,
    };
  }, [cuentas]);

  function abrirPago(cuenta) {
    setCuentaAPagar(cuenta);
    setForm({ monto: Number(cuenta.saldo_usd).toFixed(2), metodo: 'transferencia', referencia: '', notas: '' });
  }

  async function registrarPago(e) {
    e.preventDefault();
    setGuardando(true);
    try {
      const { data, error } = await supabase.rpc('pagar_cxp', {
        p_cxp_id: cuentaAPagar.id,
        p_monto_usd: parseFloat(form.monto),
        p_metodo_id: form.metodo,
        p_referencia: form.referencia || null,
        p_notas: form.notas || null,
      });
      if (error) throw error;
      const dif = Number(data.diferencial_bs);
      toast.success(
        `Pago registrado${Number(data.igtf_usd) > 0 ? ` (IGTF ${formatUSD(data.igtf_usd)})` : ''}` +
          (dif !== 0 ? ` · ${dif > 0 ? 'Ganancia' : 'Pérdida'} cambiaria ${formatBs(Math.abs(dif))}` : '')
      );
      const actualizadas = await cargarDatos();
      setCuentaAPagar(actualizadas.find((c) => c.id === cuentaAPagar.id && c.estado === 'PENDIENTE') || null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  if (loading) {
    return <div className="page-loading"><div className="loading-spinner" /><p>Cargando cuentas por pagar...</p></div>;
  }

  const paginadas = filtradas.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Cuentas por Pagar</h1>
          <p className="page__subtitle">Deudas con proveedores por compras recibidas, pagos y diferencial cambiario</p>
        </div>
        <button className="btn btn--secondary" onClick={cargarDatos}><HiOutlineArrowPath /> Refrescar</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366F1' }}><HiOutlineBanknotes /></div>
          <div className="stat-card__content">
            <span className="stat-card__label">Total por pagar</span>
            <span className="stat-card__value">{formatUSD(stats.total)}</span>
            <span className="stat-card__sub">{tasa > 0 ? formatBs(stats.total * tasa) : ''} · {stats.proveedores} proveedor(es)</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444' }}><HiOutlineExclamationTriangle /></div>
          <div className="stat-card__content">
            <span className="stat-card__label">Vencido</span>
            <span className="stat-card__value" style={{ color: '#EF4444' }}>{formatUSD(stats.vencido)}</span>
            <span className="stat-card__sub">Riesgo de recargos y de perder crédito</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B' }}><HiOutlineClock /></div>
          <div className="stat-card__content">
            <span className="stat-card__label">Vence en 7 días</span>
            <span className="stat-card__value" style={{ color: '#F59E0B' }}>{formatUSD(stats.porVencer)}</span>
            <span className="stat-card__sub">Planificar flujo de caja</span>
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <HiOutlineMagnifyingGlass className="search-box__icon" />
          <input placeholder="Buscar por proveedor, RIF, orden o factura..." value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }} />
        </div>
        <select value={filtro} onChange={(e) => { setFiltro(e.target.value); setCurrentPage(1); }}>
          <option value="PENDIENTE">Pendientes</option>
          <option value="VENCIDAS">Vencidas</option>
          <option value="PAGADA">Pagadas</option>
          <option value="TODAS">Todas</option>
        </select>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Proveedor</th><th>Orden / Factura</th><th>Emisión</th><th>Vencimiento</th>
                <th>Monto</th><th>Saldo</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginadas.map((c) => {
                const vencida = c.estado === 'PENDIENTE' && c.fecha_vencimiento < hoy();
                return (
                  <tr key={c.id}>
                    <td><strong>{c.proveedores?.nombre}</strong><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{c.proveedores?.rif}</div></td>
                    <td><code>{c.ordenes_compra?.numero_orden}</code><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{c.ordenes_compra?.numero_factura_proveedor || 'Sin factura'}</div></td>
                    <td>{formatFecha(c.fecha_emision)}</td>
                    <td style={{ color: vencida ? '#EF4444' : undefined, fontWeight: vencida ? 700 : 400 }}>{formatFecha(c.fecha_vencimiento)}</td>
                    <td>{formatUSD(c.monto_usd)}<div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Tasa origen {Number(c.tasa_origen).toFixed(2)}</div></td>
                    <td><strong>{formatUSD(c.saldo_usd)}</strong></td>
                    <td>
                      <span className={`badge ${c.estado === 'PAGADA' ? 'badge--success' : vencida ? 'badge--danger' : 'badge--warning'}`}>
                        {c.estado === 'PAGADA' ? 'Pagada' : vencida ? 'Vencida' : 'Pendiente'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn--primary btn--xs" onClick={() => abrirPago(c)}>
                        <HiOutlineBanknotes /> {c.estado === 'PENDIENTE' && puedePagar ? 'Pagar' : 'Ver pagos'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtradas.length === 0 && <tr><td colSpan="8" className="table__empty">No hay cuentas por pagar con este filtro</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalItems={filtradas.length} pageSize={pageSize} onPageChange={setCurrentPage} />
      </div>

      {cuentaAPagar && (
        <div className="modal-overlay" onClick={() => setCuentaAPagar(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>{cuentaAPagar.proveedores?.nombre} · {cuentaAPagar.ordenes_compra?.numero_orden}</h2>
            </div>
            <div className="modal__form">
              <p>Saldo pendiente: <strong>{formatUSD(cuentaAPagar.saldo_usd)}</strong> de {formatUSD(cuentaAPagar.monto_usd)}</p>

              {cuentaAPagar.estado === 'PENDIENTE' && puedePagar && (
                <form onSubmit={registrarPago}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Monto USD</label>
                      <input type="number" step="0.01" min="0.01" max={cuentaAPagar.saldo_usd} value={form.monto}
                        onChange={(e) => setForm({ ...form, monto: e.target.value })} required />
                      {tasa > 0 && form.monto && <small>≈ {formatBs(parseFloat(form.monto) * tasa)} a la tasa de hoy</small>}
                    </div>
                    <div className="form-group">
                      <label>Método</label>
                      <select value={form.metodo} onChange={(e) => setForm({ ...form, metodo: e.target.value })}>
                        {METODOS_PAGO_PROVEEDOR.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>Referencia</label><input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} /></div>
                    <div className="form-group"><label>Notas</label><input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></div>
                  </div>
                  <button type="submit" className="btn btn--primary btn--full" disabled={guardando}>
                    {guardando ? 'Registrando...' : 'Registrar pago'}
                  </button>
                </form>
              )}

              <h3 style={{ marginTop: '1rem' }}>Pagos registrados ({cuentaAPagar.pagos_cxp?.length || 0})</h3>
              {(cuentaAPagar.pagos_cxp || []).map((p) => (
                <div key={p.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                  <strong>{formatUSD(p.monto_usd)}</strong> · {p.metodo_id} · {formatFecha(p.fecha, true)}
                  {p.referencia && ` · Ref. ${p.referencia}`}
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {formatBs(p.monto_bs)}
                    {Number(p.igtf_usd) > 0 && ` · IGTF ${formatUSD(p.igtf_usd)}`}
                    {Number(p.diferencial_bs) !== 0 &&
                      ` · ${Number(p.diferencial_bs) > 0 ? 'Ganancia' : 'Pérdida'} cambiaria ${formatBs(Math.abs(p.diferencial_bs))}`}
                  </div>
                </div>
              ))}
              <button className="btn btn--ghost btn--full" style={{ marginTop: '1rem' }} onClick={() => setCuentaAPagar(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
