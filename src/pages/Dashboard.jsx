import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { mensajeError } from '../utils/errores';
import { formatMonto, formatFecha, formatTasa, getTasaPantalla } from '../utils/formatters';
import {
  HiOutlineBanknotes,
  HiOutlineDocumentText,
  HiOutlineArrowTrendingUp,
  HiOutlineExclamationTriangle,
  HiOutlineCalendarDays,
  HiOutlineCube,
} from 'react-icons/hi2';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';

// Eje de gráficos en Bs con notación compacta: el monto completo no cabe en el eje
const ejeMonto = (usd) => {
  const tasa = getTasaPantalla();
  return tasa > 0
    ? `Bs ${new Intl.NumberFormat('es-VE', { notation: 'compact', maximumFractionDigits: 1 }).format(usd * tasa)}`
    : formatMonto(usd);
};

// PostgREST entrega como máximo 1000 filas por petición: se lee por páginas
async function traerTodo(crearConsulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await crearConsulta().range(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

export default function Dashboard() {
  const { profile } = useAuth();
  // Admin, gerente y contador ven el consolidado; el vendedor, sus propias ventas;
  // el almacenista no vende: ve indicadores de inventario
  const isAdmin = ['admin', 'gerente', 'contador'].includes(profile?.rol);
  const esAlmacenista = profile?.rol === 'almacenista';
  const [stats, setStats] = useState({
    ventasHoy: 0, ventasSemana: 0, ventasMes: 0,
    facturasHoy: 0, facturasSemana: 0, facturasMes: 0,
    tasaActual: null,
    productosStockBajo: [],
    productosActivos: 0, valorInventario: 0, unidadesInventario: 0,
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

      // Filtro del vendedor (solo ve sus ventas)
      const vendedorId = !isAdmin ? profile?.id : null;
      const sinFilas = Promise.resolve([]);

      // Facturas emitidas (las anuladas no cuentan como venta)
      const facturasDesde = (campos, desde) => () => {
        let q = supabase.from('facturas').select(campos).gte('fecha_emision', desde).eq('estado', 'emitida').order('fecha_emision').order('id');
        if (vendedorId) q = q.eq('vendedor_id', vendedorId);
        return q;
      };
      const ventas = (campos, desde) => (esAlmacenista ? sinFilas : traerTodo(facturasDesde(campos, desde)));

      // Top productos: solo líneas de facturas emitidas de los últimos 30 días (y del vendedor si aplica)
      const qDetalles = esAlmacenista ? sinFilas : traerTodo(() => {
        let q = supabase
          .from('detalles_factura')
          .select('producto_nombre, cantidad, facturas!inner(fecha_emision, estado, vendedor_id)')
          .eq('facturas.estado', 'emitida')
          .gte('facturas.fecha_emision', hace30Dias)
          .order('id');
        if (vendedorId) q = q.eq('facturas.vendedor_id', vendedorId);
        return q;
      });

      const verInventario = isAdmin || esAlmacenista;
      const qProds = verInventario
        ? traerTodo(() => supabase.from('productos').select('id, nombre, sku, stock, stock_minimo, costo_usd').eq('activo', true).order('nombre'))
        : sinFilas;
      const qVendedores = isAdmin
        ? supabase.from('usuarios').select('id, nombre_completo').eq('rol', 'vendedor').eq('activo', true).then(({ data, error }) => {
            if (error) throw error;
            return data || [];
          })
        : sinFilas;
      // Tasa vigente hoy (la de mañana, si ya se registró, no aplica todavía)
      const qTasa = supabase.rpc('tasa_vigente').then(({ data, error }) => {
        if (error) throw error;
        return Number(data) || null;
      });

      // Consultas en paralelo
      const [
        ventasHoyData,
        ventasSemanaData,
        ventasMesData,
        facturasDiarias,
        tasaData,
        allProds,
        vendedoresData,
        detallesData,
      ] = await Promise.all([
        ventas('total_usd', hoyInicio),
        ventas('total_usd', semanaInicio),
        ventas('total_usd, vendedor_id', mesInicio),
        ventas('total_usd, fecha_emision', hace30Dias),
        qTasa,
        qProds,
        qVendedores,
        qDetalles,
      ]);

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
        productosActivos: allProds.length,
        valorInventario: allProds.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.costo_usd) || 0), 0),
        unidadesInventario: allProds.reduce((s, p) => s + (Number(p.stock) || 0), 0),
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
      toast.error('No se pudieron cargar los indicadores: ' + mensajeError(error));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, esAlmacenista, profile?.id]);

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
          {isAdmin ? 'Dashboard General' : esAlmacenista ? 'Dashboard de Inventario' : 'Mi Dashboard'}
        </h1>
        <p className="page__subtitle">
          ¡Hola, {profile?.nombre_completo}! — {formatFecha(new Date(), true)}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid">
        {esAlmacenista ? (
          <>
            <div className="stat-card">
              <div className="stat-card__icon stat-card__icon--primary">
                <HiOutlineCube />
              </div>
              <div className="stat-card__content">
                <span className="stat-card__label">Productos Activos</span>
                <span className="stat-card__value">{stats.productosActivos}</span>
                <span className="stat-card__sub">{stats.unidadesInventario.toLocaleString('es-VE')} unidad(es) en existencia</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card__icon stat-card__icon--success">
                <HiOutlineBanknotes />
              </div>
              <div className="stat-card__content">
                <span className="stat-card__label">Valor del Inventario</span>
                <span className="stat-card__value">{formatMonto(stats.valorInventario)}</span>
                <span className="stat-card__sub">A costo promedio</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card__icon stat-card__icon--warning">
                <HiOutlineExclamationTriangle />
              </div>
              <div className="stat-card__content">
                <span className="stat-card__label">Stock Bajo</span>
                <span className="stat-card__value">{stats.productosStockBajo.length}</span>
                <span className="stat-card__sub">
                  {stats.productosStockBajo.filter((p) => p.stock <= 0).length} agotado(s)
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--primary">
            <HiOutlineBanknotes />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Ventas Hoy</span>
            <span className="stat-card__value">{formatMonto(stats.ventasHoy)}</span>
            <span className="stat-card__sub">{stats.facturasHoy} factura(s)</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--success">
            <HiOutlineCalendarDays />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Ventas Semana</span>
            <span className="stat-card__value">{formatMonto(stats.ventasSemana)}</span>
            <span className="stat-card__sub">{stats.facturasSemana} factura(s)</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--warning">
            <HiOutlineArrowTrendingUp />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Ventas del Mes</span>
            <span className="stat-card__value">{formatMonto(stats.ventasMes)}</span>
            <span className="stat-card__sub">{stats.facturasMes} factura(s)</span>
          </div>
        </div>
          </>
        )}

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--info">
            <HiOutlineDocumentText />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Tasa del Día</span>
            <span className="stat-card__value">
              {stats.tasaActual ? formatTasa(stats.tasaActual) : 'Sin registrar'}
            </span>
            <span className="stat-card__sub">
              {stats.tasaActual ? 'Vigente hoy' : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Charts Row (ventas: no aplica al almacenista) */}
      {!esAlmacenista && (
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
                <YAxis width={80} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickFormatter={ejeMonto} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                  formatter={(value) => [formatMonto(value), 'Ventas']}
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
      )}

      {/* Secciones de dirección (y stock bajo para el almacenista) */}
      {(isAdmin || esAlmacenista) && (
        <div className="dashboard-grid">
          {/* Seller Performance */}
          {isAdmin && vendedoresStats.length > 0 && (
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
                        <td className="text-success">{formatMonto(v.total)}</td>
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
