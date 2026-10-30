import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { XLSX, imprimirCon } from '../utils/xlsxFormateado';
import toast from 'react-hot-toast';
import {
  HiOutlineArrowDownTray,
  HiOutlineArrowTrendingUp,
  HiOutlineCalendar,
  HiOutlineChartBar,
  HiOutlineCube,
  HiOutlineExclamationTriangle,
  HiOutlinePrinter,
} from 'react-icons/hi2';
import { supabase } from '../lib/supabase';
import { formatUSD } from '../utils/formatters';

const PAGE_SIZE = 1000;
const REPORTS = [
  { id: 'behavior', label: 'Comportamiento', icon: HiOutlineChartBar },
  { id: 'projection', label: 'Proyección', icon: HiOutlineArrowTrendingUp },
  { id: 'alerts', label: 'Alertas y rotación', icon: HiOutlineExclamationTriangle },
];

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromString(value) {
  return new Date(`${value}T00:00:00`);
}

function formatDate(value, options = { day: '2-digit', month: 'short' }) {
  return dateFromString(value).toLocaleDateString('es-VE', options);
}

function getPresetRange(preset) {
  const today = new Date();
  const todayString = localDate(today);
  const startOfWeek = new Date(today);
  const dayOffset = (today.getDay() + 6) % 7;
  startOfWeek.setDate(today.getDate() - dayOffset);

  switch (preset) {
    case 'today':
      return { desde: todayString, hasta: todayString };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const date = localDate(yesterday);
      return { desde: date, hasta: date };
    }
    case 'week':
      return { desde: localDate(startOfWeek), hasta: todayString };
    case 'previousWeek': {
      const previousSunday = new Date(startOfWeek);
      previousSunday.setDate(startOfWeek.getDate() - 1);
      const previousMonday = new Date(previousSunday);
      previousMonday.setDate(previousSunday.getDate() - 6);
      return { desde: localDate(previousMonday), hasta: localDate(previousSunday) };
    }
    case 'month':
      return { desde: localDate(new Date(today.getFullYear(), today.getMonth(), 1)), hasta: todayString };
    case 'year':
      return { desde: `${today.getFullYear()}-01-01`, hasta: todayString };
    default:
      return null;
  }
}

function getPeriodDays(desde, hasta) {
  const start = new Date(`${desde}T00:00:00Z`);
  const end = new Date(`${hasta}T00:00:00Z`);
  return Math.floor((end - start) / 86400000) + 1;
}

function buildDailySales(desde, hasta, details) {
  const totals = new Map();
  details.forEach(detail => {
    const date = detail.facturas?.fecha_emision?.slice(0, 10);
    if (date) totals.set(date, (totals.get(date) || 0) + Number(detail.cantidad || 0));
  });

  const days = [];
  const date = new Date(`${desde}T00:00:00Z`);
  const finalDate = new Date(`${hasta}T00:00:00Z`);
  while (date <= finalDate) {
    const key = date.toISOString().slice(0, 10);
    days.push({ fecha: key, unidades: totals.get(key) || 0 });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

export default function ReportesInventario() {
  const initialRange = getPresetRange('month');
  const [fechaDesde, setFechaDesde] = useState(initialRange.desde);
  const [fechaHasta, setFechaHasta] = useState(initialRange.hasta);
  const [activePreset, setActivePreset] = useState('month');
  const [activeReport, setActiveReport] = useState('behavior');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);

  const rangoValido = Boolean(fechaDesde && fechaHasta && fechaDesde <= fechaHasta);

  useEffect(() => {
    if (!rangoValido) return undefined;

    let mounted = true;
    async function loadReport() {
      try {
        const productosData = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const { data, error } = await supabase
            .from('productos')
            .select('id, sku, nombre, precio_usd, stock, stock_minimo, categorias(nombre)')
            .eq('activo', true)
            .order('nombre')
            .order('id')
            .range(offset, offset + PAGE_SIZE - 1);
          if (error) throw error;
          productosData.push(...(data || []));
          if (!data || data.length < PAGE_SIZE) break;
        }

        const detalles = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const { data, error } = await supabase
            .from('detalles_factura')
            .select('id, producto_id, producto_nombre, cantidad, factura_id, facturas!inner(fecha_emision, estado)')
            .eq('facturas.estado', 'emitida')
            .gte('facturas.fecha_emision', `${fechaDesde}T00:00:00`)
            .lte('facturas.fecha_emision', `${fechaHasta}T23:59:59.999`)
            .order('id', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);
          if (error) throw error;
          detalles.push(...(data || []));
          if (!data || data.length < PAGE_SIZE) break;
        }

        if (mounted) {
          setProductos(productosData || []);
          setVentas(detalles);
        }
      } catch (error) {
        console.error('Error cargando reportes de inventario:', error);
        if (mounted) {
          setProductos([]);
          setVentas([]);
          setErrorCarga(true);
          toast.error('No se pudieron cargar los reportes de inventario');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadReport();
    return () => { mounted = false; };
  }, [fechaDesde, fechaHasta, rangoValido]);

  const diasPeriodo = rangoValido ? getPeriodDays(fechaDesde, fechaHasta) : 0;
  const calculos = useMemo(() => {
    const ventasPorProducto = new Map();
    const productoNombre = new Map();
    const productoPorId = new Map(productos.map(producto => [producto.id, producto]));
    ventas.forEach(detalle => {
      if (!detalle.producto_id) return;
      ventasPorProducto.set(
        detalle.producto_id,
        (ventasPorProducto.get(detalle.producto_id) || 0) + Number(detalle.cantidad || 0)
      );
      productoNombre.set(detalle.producto_id, detalle.producto_nombre || 'Producto sin nombre');
    });

    const filasVentas = [...ventasPorProducto.entries()]
      .map(([productoId, unidades]) => {
        const producto = productoPorId.get(productoId);
        return {
          id: productoId,
          sku: producto?.sku || '—',
          nombre: producto?.nombre || productoNombre.get(productoId),
          categoria: producto?.categorias?.nombre || 'Sin categoría',
          unidades,
          precio: Number(producto?.precio_usd || 0),
          stock: producto ? Number(producto.stock || 0) : null,
          stockMinimo: producto ? Number(producto.stock_minimo || 0) : null,
        };
      })
      .sort((a, b) => b.unidades - a.unidades);

    const proyecciones = productos.map(producto => {
      const unidades = ventasPorProducto.get(producto.id) || 0;
      const stock = Number(producto.stock || 0);
      const promedioDiario = diasPeriodo && unidades > 0 ? unidades / diasPeriodo : 0;
      const cobertura = diasPeriodo && unidades > 0 ? (stock * unidades) / diasPeriodo : 0;
      const stockAlCierre = Math.max(0, stock - promedioDiario * diasPeriodo);
      return {
        id: producto.id,
        sku: producto.sku,
        nombre: producto.nombre,
        categoria: producto.categorias?.nombre || 'Sin categoría',
        stock,
        stockMinimo: Number(producto.stock_minimo || 0),
        unidades,
        promedioDiario,
        cobertura,
        stockAlCierre,
        diasCobertura: promedioDiario > 0 ? stock / promedioDiario : null,
        reposicion: Math.ceil(Math.max(0, Number(producto.stock_minimo || 0) - stockAlCierre)),
      };
    });

    return {
      filasVentas,
      proyecciones: proyecciones.sort((a, b) => (a.cobertura ?? Infinity) - (b.cobertura ?? Infinity)),
      diario: buildDailySales(fechaDesde, fechaHasta, ventas),
      unidadesVendidas: ventas.reduce((sum, item) => sum + Number(item.cantidad || 0), 0),
    };
  }, [ventas, productos, diasPeriodo, fechaDesde, fechaHasta]);

  const filasVentasFiltradas = calculos.filasVentas.filter(item =>
    `${item.sku} ${item.nombre} ${item.categoria}`.toLowerCase().includes(search.toLowerCase())
  );
  const proyeccionesFiltradas = calculos.proyecciones.filter(item =>
    `${item.sku} ${item.nombre} ${item.categoria}`.toLowerCase().includes(search.toLowerCase())
  );
  const alertasStock = proyeccionesFiltradas.filter(item => item.stock <= item.stockMinimo);
  const sinVentas = proyeccionesFiltradas.filter(item => item.unidades === 0);
  const productosBajoStock = calculos.proyecciones.filter(item => item.stock <= item.stockMinimo).length;
  const valorInventario = productos.reduce(
    (total, producto) => total + Number(producto.stock || 0) * Number(producto.precio_usd || 0),
    0
  );
  const maxUnidadesDiarias = calculos.diario.reduce(
    (maximo, item) => Math.max(maximo, item.unidades),
    1
  );
  const tituloReporte = REPORTS.find(report => report.id === activeReport)?.label || 'Comportamiento';

  function seleccionarPeriodo(preset) {
    const range = getPresetRange(preset);
    if (!range) return;
    if (range.desde !== fechaDesde || range.hasta !== fechaHasta) {
      setLoading(true);
      setErrorCarga(false);
      setProductos([]);
      setVentas([]);
    }
    setActivePreset(preset);
    setFechaDesde(range.desde);
    setFechaHasta(range.hasta);
  }

  function cambiarFecha(campo, valor) {
    const nuevoDesde = campo === 'desde' ? valor : fechaDesde;
    const nuevoHasta = campo === 'hasta' ? valor : fechaHasta;
    setActivePreset('custom');
    if (nuevoDesde && nuevoHasta && nuevoDesde <= nuevoHasta) {
      setLoading(true);
      setErrorCarga(false);
    } else {
      setLoading(false);
      setErrorCarga(false);
    }
    setProductos([]);
    setVentas([]);
    if (campo === 'desde') setFechaDesde(valor);
    else setFechaHasta(valor);
  }

  function exportarExcel() {
    if (errorCarga || !rangoValido) {
      toast.error('No hay datos válidos para exportar');
      return;
    }

    const libro = XLSX.utils.book_new();
    const agregarHoja = (filas, nombre) => {
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), nombre);
    };

    if (activeReport === 'behavior') {
      agregarHoja([
        { Indicador: 'Periodo', Valor: `${fechaDesde} al ${fechaHasta}` },
        { Indicador: 'Días analizados', Valor: diasPeriodo },
        { Indicador: 'Unidades vendidas', Valor: calculos.unidadesVendidas },
        { Indicador: 'Productos con ventas', Valor: calculos.filasVentas.length },
        { Indicador: 'Valor del inventario actual (USD)', Valor: valorInventario },
      ], 'Resumen');
      agregarHoja(calculos.diario.map(item => ({
        Fecha: item.fecha,
        'Unidades vendidas': item.unidades,
      })), 'Salidas por día');
      agregarHoja(filasVentasFiltradas.map(item => ({
        SKU: item.sku,
        Producto: item.nombre,
        Categoría: item.categoria,
        'Unidades vendidas': item.unidades,
        'Stock actual': item.stock ?? 'No disponible',
      })), 'Ventas por producto');
    } else if (activeReport === 'projection') {
      agregarHoja(proyeccionesFiltradas.map(item => ({
        SKU: item.sku,
        Producto: item.nombre,
        Categoría: item.categoria,
        'Stock actual': item.stock,
        'Unidades vendidas en el periodo': item.unidades,
        'Promedio diario': Number(item.promedioDiario.toFixed(2)),
        'Stock estimado al cierre': Number(item.stockAlCierre.toFixed(2)),
        'Cobertura': item.unidades > 0 ? Number(item.cobertura.toFixed(1)) : 'Sin ventas',
        'Unidades para reponer': item.reposicion,
      })), 'Proyección');
    } else {
      agregarHoja(alertasStock.map(item => ({
        SKU: item.sku,
        Producto: item.nombre,
        Categoría: item.categoria,
        'Stock actual': item.stock,
        'Stock mínimo': item.stockMinimo,
        'Unidades vendidas': item.unidades,
        'Stock estimado al cierre': Number(item.stockAlCierre.toFixed(2)),
      })), 'Bajo stock');
      agregarHoja(sinVentas.map(item => ({
        SKU: item.sku,
        Producto: item.nombre,
        Categoría: item.categoria,
        'Stock actual': item.stock,
        'Stock mínimo': item.stockMinimo,
      })), 'Sin ventas');
    }

    const reportName = activeReport === 'behavior' ? 'Comportamiento' : activeReport === 'projection' ? 'Proyeccion' : 'Alertas';
    try {
      XLSX.writeFile(libro, `Reporte_Inventario_${reportName}_${fechaDesde}_al_${fechaHasta}.xlsx`);
      toast.success('Reporte Excel exportado');
    } catch (error) {
      console.error('Error exportando reporte de inventario:', error);
      toast.error('No se pudo generar el archivo Excel');
    }
  }

  function exportarPDF() {
    if (errorCarga || !rangoValido) {
      toast.error('No hay datos válidos para exportar');
      return;
    }
    imprimirCon(exportarExcel);
  }

  if (loading && !productos.length && !ventas.length) {
    return <div className="page-loading"><div className="loading-spinner" /><p>Cargando reportes de inventario...</p></div>;
  }

  return (
    <div className="page inventory-reports-page">
      <div className="page__header no-print">
        <div>
          <h1 className="page__title">Reportes de Inventario</h1>
          <p className="page__subtitle">Comportamiento, proyección y alertas de existencias</p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--secondary" to="/inventario">
            <HiOutlineCube /> Volver a productos
          </Link>
          <button className="btn btn--secondary" onClick={exportarPDF} disabled={loading || errorCarga}>
            <HiOutlinePrinter /> Exportar PDF
          </button>
          <button className="btn btn--primary" onClick={exportarExcel} disabled={loading || errorCarga}>
            <HiOutlineArrowDownTray /> Exportar Excel
          </button>
        </div>
      </div>

      <div className="inventory-report-controls no-print">
        <div className="inventory-report-presets" aria-label="Periodos predefinidos">
          <HiOutlineCalendar aria-hidden="true" />
          {[
            ['today', 'Hoy'],
            ['yesterday', 'Ayer'],
            ['week', 'Esta semana'],
            ['previousWeek', 'Semana anterior'],
            ['month', 'Mes actual'],
            ['year', 'Año actual'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn btn--sm ${activePreset === id ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => seleccionarPeriodo(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="inventory-report-dates">
          <label>Desde <input type="date" value={fechaDesde} onChange={event => cambiarFecha('desde', event.target.value)} /></label>
          <label>Hasta <input type="date" value={fechaHasta} onChange={event => cambiarFecha('hasta', event.target.value)} /></label>
        </div>
      </div>

      <div className="inventory-report-search no-print">
        <input
          type="search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Filtrar productos por nombre, SKU o categoría..."
          aria-label="Filtrar productos del reporte"
        />
        {loading && <span className="inventory-report-loading">Actualizando reporte...</span>}
      </div>

      {!rangoValido && <div className="inventory-report-warning">La fecha inicial debe ser anterior o igual a la fecha final.</div>}
      {errorCarga && <div className="inventory-report-warning">No se pudieron cargar los datos. Cambia el periodo o inténtalo nuevamente.</div>}

      <section className="inventory-report-printable">
        <div className="inventory-report-print-heading">
          <div>
            <h2>Reporte de inventario · {tituloReporte}</h2>
            <p>Periodo: {fechaDesde ? formatDate(fechaDesde, { day: '2-digit', month: 'long', year: 'numeric' }) : '—'} – {fechaHasta ? formatDate(fechaHasta, { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</p>
          </div>
          <p>Generado: {new Date().toLocaleString('es-VE')}</p>
        </div>

        <div className="inventory-report-tabs no-print" role="tablist" aria-label="Tipo de reporte">
          {REPORTS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeReport === id}
              className={activeReport === id ? 'inventory-report-tab inventory-report-tab--active' : 'inventory-report-tab'}
              onClick={() => setActiveReport(id)}
            >
              <Icon /> {label}
            </button>
          ))}
        </div>

        <div className="inventory-report-summary">
          <article className="inventory-report-summary-card">
            <span>Unidades vendidas</span>
            <strong>{calculos.unidadesVendidas.toLocaleString('es-VE')}</strong>
          </article>
          <article className="inventory-report-summary-card">
            <span>Productos con ventas</span>
            <strong>{calculos.filasVentas.length.toLocaleString('es-VE')}</strong>
          </article>
          <article className="inventory-report-summary-card">
            <span>Valor actual del inventario</span>
            <strong>{formatUSD(valorInventario)}</strong>
          </article>
          <article className="inventory-report-summary-card">
            <span>Productos bajo mínimo</span>
            <strong>{productosBajoStock.toLocaleString('es-VE')}</strong>
          </article>
        </div>

        {activeReport === 'behavior' && (
          <div className="inventory-report-content">
            <article className="card inventory-report-panel">
              <div className="inventory-report-panel-heading">
                <div><h3>Salidas por ventas</h3><p>Unidades vendidas por día dentro del periodo seleccionado</p></div>
                <HiOutlineCube aria-hidden="true" />
              </div>
              <div className="inventory-report-chart">
                {calculos.diario.map(item => (
                  <div className="inventory-report-chart-day" key={item.fecha} title={`${formatDate(item.fecha)}: ${item.unidades} unidades`}>
                    <span>{item.unidades || ''}</span>
                    <div style={{ height: `${Math.max(item.unidades ? 8 : 2, (item.unidades / maxUnidadesDiarias) * 100)}%` }} />
                    <small>{formatDate(item.fecha)}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="card inventory-report-panel">
              <div className="inventory-report-panel-heading">
                <div><h3>Productos con mayor salida</h3><p>Ordenados por unidades vendidas en el periodo</p></div>
              </div>
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Unidades vendidas</th><th>Stock actual</th></tr></thead>
                  <tbody>
                    {filasVentasFiltradas.map(item => (
                      <tr key={item.id}><td>{item.sku}</td><td>{item.nombre}</td><td>{item.categoria}</td><td>{item.unidades}</td><td>{item.stock ?? '—'}</td></tr>
                    ))}
                    {!filasVentasFiltradas.length && <tr><td colSpan="5" className="table__empty">No hubo ventas de productos en este periodo</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        )}

        {activeReport === 'projection' && (
          <article className="card inventory-report-panel">
            <div className="inventory-report-note">
              Proyección estimada: mantiene el ritmo promedio diario de ventas del periodo seleccionado durante {diasPeriodo} {diasPeriodo === 1 ? 'día' : 'días'}. No contempla futuras recepciones, ajustes ni cambios de demanda.
            </div>
            <div className="table-container">
              <table className="table">
                <thead><tr><th>SKU</th><th>Producto</th><th>Stock actual</th><th>Vendidas</th><th>Promedio / día</th><th>Stock al cierre</th><th>Cobertura</th><th>Reponer</th></tr></thead>
                <tbody>
                  {proyeccionesFiltradas.map(item => (
                    <tr key={item.id}>
                      <td>{item.sku}</td><td>{item.nombre}</td><td>{item.stock}</td>
                      <td>{item.unidades}</td><td>{item.promedioDiario.toFixed(2)}</td>
                      <td><span className={`badge ${item.stockAlCierre <= item.stockMinimo ? 'badge--warning' : 'badge--success'}`}>{item.stockAlCierre.toFixed(1)}</span></td>
                      <td>{item.unidades > 0 ? item.cobertura.toFixed(1) : 'Sin ventas'}</td>
                      <td>{item.reposicion || '—'}</td>
                    </tr>
                  ))}
                  {!proyeccionesFiltradas.length && <tr><td colSpan="8" className="table__empty">No hay productos que coincidan con la búsqueda</td></tr>}
                </tbody>
              </table>
            </div>
          </article>
        )}

        {activeReport === 'alerts' && (
          <div className="inventory-report-content">
            <article className="card inventory-report-panel">
              <div className="inventory-report-panel-heading">
                <div><h3>En o por debajo del stock mínimo</h3><p>Existencias que requieren revisión o reposición</p></div>
                <HiOutlineExclamationTriangle aria-hidden="true" />
              </div>
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>SKU</th><th>Producto</th><th>Stock actual</th><th>Stock mínimo</th><th>Vendidas</th></tr></thead>
                  <tbody>
                    {alertasStock.map(item => (
                      <tr key={item.id}><td>{item.sku}</td><td>{item.nombre}</td><td><span className="badge badge--warning">{item.stock}</span></td><td>{item.stockMinimo}</td><td>{item.unidades}</td></tr>
                    ))}
                    {!alertasStock.length && <tr><td colSpan="5" className="table__empty">No hay productos bajo el mínimo de stock</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="card inventory-report-panel">
              <div className="inventory-report-panel-heading">
                <div><h3>Sin ventas en el periodo</h3><p>Productos activos sin salidas registradas durante las fechas seleccionadas</p></div>
              </div>
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Stock actual</th><th>Stock mínimo</th></tr></thead>
                  <tbody>
                    {sinVentas.map(item => (
                      <tr key={item.id}><td>{item.sku}</td><td>{item.nombre}</td><td>{item.categoria}</td><td>{item.stock}</td><td>{item.stockMinimo}</td></tr>
                    ))}
                    {!sinVentas.length && <tr><td colSpan="5" className="table__empty">Todos los productos tuvieron ventas en el periodo</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        )}

        <p className="inventory-report-footnote">
          Las salidas se calculan a partir de facturas emitidas. El sistema no conserva todavía un historial completo de ajustes y recepciones de inventario; por ello no se reconstruye el stock histórico.
        </p>
      </section>

    </div>
  );
}
