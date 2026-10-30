import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatUSD, formatBs, formatFecha } from '../utils/formatters';
import {
  HiOutlineBanknotes,
  HiOutlineDocumentText,
  HiOutlineArrowTrendingUp,
  HiOutlineExclamationTriangle,
  HiOutlineCalendarDays,
} from 'react-icons/hi2';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';

export default function Dashboard() {
  const { profile } = useAuth();
  // Admin, gerente y contador ven el consolidado; los demás roles, sus propias ventas
  const isAdmin = ['admin', 'gerente', 'contador'].includes(profile?.rol);
  const [stats, setStats] = useState({
    ventasHoy: 0, ventasSemana: 0, ventasMes: 0,
    facturasHoy: 0, facturasSemana: 0, facturasMes: 0,
    tasaActual: null,
    productosStockBajo: [],
  });
  const [ventasDiarias, setVentasDiarias] = useState([]);
  const [topProductos, setTopProductos] = useState([]);
  const [vendedoresStats, setVendedoresStats] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const now = new Date();
      const hoyInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const semanaInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();
      const mesInicio = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const hace30Dias = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).toISOString();

      // Base query filter for vendedor
      const vendedorId = !isAdmin ? profile.id : null;

      // Prepare parallel queries
      let qHoy = supabase.from('facturas').select('total_usd').gte('fecha_emision', hoyInicio).eq('estado', 'emitida');
      let qSemana = supabase.from('facturas').select('total_usd').gte('fecha_emision', semanaInicio).eq('estado', 'emitida');
      let qMes = supabase.from('facturas').select('total_usd, vendedor_id').gte('fecha_emision', mesInicio).eq('estado', 'emitida');
      let qDiarias = supabase.from('facturas').select('total_usd, fecha_emision').gte('fecha_emision', hace30Dias).eq('estado', 'emitida').order('fecha_emision');
      let qTasa = supabase.from('tasas_cambio').select('*').order('fecha_registro', { ascending: false }).limit(1).maybeSingle();
      let qProds = isAdmin ? supabase.from('productos').select('id, nombre, sku, stock, stock_minimo').eq('activo', true) : Promise.resolve({ data: [] });
      let qVendedores = isAdmin ? supabase.from('usuarios').select('id, nombre_completo').eq('rol', 'vendedor').eq('activo', true) : Promise.resolve({ data: [] });
      let qDetalles = supabase.from('detalles_factura').select('producto_nombre, cantidad').limit(250);

      if (vendedorId) {
        qHoy = qHoy.eq('vendedor_id', vendedorId);
        qSemana = qSemana.eq('vendedor_id', vendedorId);
        qMes = qMes.eq('vendedor_id', vendedorId);
        qDiarias = qDiarias.eq('vendedor_id', vendedorId);
      }

      // Execute queries in PARALLEL
      const [
        { data: ventasHoyData },
        { data: ventasSemanaData },
        { data: ventasMesData },
        { data: facturasDiarias },
        { data: tasaData },
        { data: allProds },
        { data: vendedoresData },
        { data: detallesData },
      ] = await Promise.all([qHoy, qSemana, qMes, qDiarias, qTasa, qProds, qVendedores, qDetalles]);

      const sumTotal = (arr) => (arr || []).reduce((sum, f) => sum + (parseFloat(f.total_usd) || 0), 0);
      const productosStockBajo = (allProds || []).filter(p => p.stock <= p.stock_minimo);

      setStats({
        ventasHoy: sumTotal(ventasHoyData),
        ventasSemana: sumTotal(ventasSemanaData),
        ventasMes: sumTotal(ventasMesData),
        facturasHoy: ventasHoyData?.length || 0,
        facturasSemana: ventasSemanaData?.length || 0,
        facturasMes: ventasMesData?.length || 0,
        tasaActual: tasaData,
        productosStockBajo,
      });

      // Group daily sales
      const porDia = {};
      (facturasDiarias || []).forEach(f => {
        const dia = new Date(f.fecha_emision).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
        porDia[dia] = (porDia[dia] || 0) + parseFloat(f.total_usd);
      });
      setVentasDiarias(Object.entries(porDia).map(([dia, total]) => ({ dia, total: parseFloat(total.toFixed(2)) })));

      // Top 5 productos from recent sales
      const productoCount = {};
      (detallesData || []).forEach(d => {
        productoCount[d.producto_nombre] = (productoCount[d.producto_nombre] || 0) + d.cantidad;
      });
      const topProds = Object.entries(productoCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([nombre, cantidad]) => ({ nombre, cantidad }));
      setTopProductos(topProds);

      // Rendimiento por vendedor
      if (isAdmin && vendedoresData) {
        const vendStats = (vendedoresData || []).map(v => {
          const ventasVend = (ventasMesData || []).filter(f => f.vendedor_id === v.id);
          return {
            nombre: v.nombre_completo,
            total: ventasVend.reduce((sum, f) => sum + parseFloat(f.total_usd), 0),
            facturas: ventasVend.length,
          };
        }).sort((a, b) => b.total - a.total);
        setVendedoresStats(vendStats);
      }

    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, profile?.id]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const COLORS = ['#16A34A', '#22C55E', '#4ADE80', '#86EFAC', '#A7F3D0'];

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Cargando dashboard...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">
          {isAdmin ? 'Dashboard General' : 'Mi Dashboard'}
        </h1>
        <p className="page__subtitle">
          ¡Hola, {profile?.nombre_completo}! — {formatFecha(new Date(), true)}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--primary">
            <HiOutlineBanknotes />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Ventas Hoy</span>
            <span className="stat-card__value">{formatUSD(stats.ventasHoy)}</span>
            <span className="stat-card__sub">{stats.facturasHoy} factura(s)</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--success">
            <HiOutlineCalendarDays />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Ventas Semana</span>
            <span className="stat-card__value">{formatUSD(stats.ventasSemana)}</span>
            <span className="stat-card__sub">{stats.facturasSemana} factura(s)</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--warning">
            <HiOutlineArrowTrendingUp />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Ventas del Mes</span>
            <span className="stat-card__value">{formatUSD(stats.ventasMes)}</span>
            <span className="stat-card__sub">{stats.facturasMes} factura(s)</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--info">
            <HiOutlineDocumentText />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Tasa del Día</span>
            <span className="stat-card__value">
              {stats.tasaActual ? `Bs ${stats.tasaActual.tasa_usd_bs}` : 'Sin registrar'}
            </span>
            <span className="stat-card__sub">
              {stats.tasaActual ? formatFecha(stats.tasaActual.fecha_registro) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="dashboard-grid">
        {/* Sales Chart */}
        <div className="card dashboard-grid__chart">
          <h3 className="card__title">Ventas Últimos 30 Días</h3>
          {ventasDiarias.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={ventasDiarias}>
                <defs>
                  <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="dia" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                  formatter={(value) => [`$${value.toFixed(2)}`, 'Ventas']}
                />
                <Area type="monotone" dataKey="total" stroke="#22C55E" fill="url(#colorVentas)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="card__empty">Sin datos de ventas</p>
          )}
        </div>

        {/* Top Products */}
        <div className="card dashboard-grid__side">
          <h3 className="card__title">Top 5 Productos</h3>
          {topProductos.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topProductos} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <YAxis type="category" dataKey="nombre" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={100} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Bar dataKey="cantidad" radius={[0, 4, 4, 0]}>
                  {topProductos.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="card__empty">Sin datos de productos</p>
          )}
        </div>
      </div>

      {/* Admin-only sections */}
      {isAdmin && (
        <div className="dashboard-grid">
          {/* Seller Performance */}
          {vendedoresStats.length > 0 && (
            <div className="card dashboard-grid__chart">
              <h3 className="card__title">Rendimiento por Vendedor (Mes)</h3>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th>Facturas</th>
                      <th>Total Ventas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendedoresStats.map((v, i) => (
                      <tr key={i}>
                        <td>{v.nombre}</td>
                        <td>{v.facturas}</td>
                        <td className="text-success">{formatUSD(v.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Low Stock Alert */}
          {stats.productosStockBajo.length > 0 && (
            <div className="card dashboard-grid__side">
              <h3 className="card__title">
                <HiOutlineExclamationTriangle className="text-warning" />
                Stock Bajo
              </h3>
              <div className="stock-alerts">
                {stats.productosStockBajo.map(p => (
                  <div key={p.id} className="stock-alert-item">
                    <div>
                      <span className="stock-alert-item__name">{p.nombre}</span>
                      <span className="stock-alert-item__sku">{p.sku}</span>
                    </div>
                    <span className={`stock-alert-item__count ${p.stock === 0 ? 'stock-alert-item__count--danger' : 'stock-alert-item__count--warning'}`}>
                      {p.stock} / {p.stock_minimo}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
