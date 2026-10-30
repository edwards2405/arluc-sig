import { useState, useEffect } from 'react';
import { XLSX, imprimirCon } from '../utils/xlsxFormateado';
import { supabase } from '../lib/supabase';
import { formatUSD, formatBs, formatFecha } from '../utils/formatters';
import { getEmpresaConfig } from '../utils/constants';
import toast from 'react-hot-toast';
import Pagination from '../components/common/Pagination';
import {
  HiOutlineDocumentChartBar,
  HiOutlineArrowDownTray,
  HiOutlinePrinter,
  HiOutlineCalendar,
  HiOutlineBanknotes,
  HiOutlineCreditCard,
  HiOutlineCube,
  HiOutlineExclamationTriangle,
  HiOutlineUserGroup,
  HiOutlineReceiptPercent,
  HiOutlineNoSymbol,
  HiOutlineArrowTrendingUp,
  HiOutlineChartBar,
  HiOutlineBuildingLibrary,
  HiOutlineDevicePhoneMobile,
  HiOutlineShieldCheck,
  HiOutlineCheckCircle,
} from 'react-icons/hi2';

// ── Date preset helpers ──────────────────────────────────────────
function getPreset(preset) {
  const now = new Date();
  const pad = d => d.toLocaleDateString('en-CA'); // fecha local (Venezuela), no UTC
  switch (preset) {
    case 'hoy':
      return { desde: pad(now), hasta: pad(now) };
    case '7d': {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      return { desde: pad(d), hasta: pad(now) };
    }
    case '30d': {
      const d = new Date(now); d.setDate(d.getDate() - 29);
      return { desde: pad(d), hasta: pad(now) };
    }
    case 'mes': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { desde: pad(d), hasta: pad(now) };
    }
    case 'anio': {
      const d = new Date(now.getFullYear(), 0, 1);
      return { desde: pad(d), hasta: pad(now) };
    }
    default:
      return null;
  }
}

// ── Payment method badge colors ──────────────────────────────────
const METODO_COLORS = {
  'Efectivo USD': '#22C55E',
  'Zelle': '#3B82F6',
  'Punto de Venta': '#8B5CF6',
  'Pago Móvil': '#F59E0B',
  'Cashea': '#EC4899',
  'Transferencia': '#06B6D4',
};
function getMetodoColor(m) { return METODO_COLORS[m] || '#A3A3A3'; }

export default function Reportes() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ventas');
  const [activePreset, setActivePreset] = useState('30d');
  const [pageInventario, setPageInventario] = useState(1);
  const [pageVendedores, setPageVendedores] = useState(1);
  const empresaConfig = getEmpresaConfig();

  // Date filters (default: last 30 days)
  const defaultPreset = getPreset('30d');
  const [fechaDesde, setFechaDesde] = useState(defaultPreset.desde);
  const [fechaHasta, setFechaHasta] = useState(defaultPreset.hasta);

  // Data
  const [ventas, setVentas] = useState([]);
  const [detallesVentas, setDetallesVentas] = useState([]);
  const [inventario, setInventario] = useState([]);
  const [tasaActual, setTasaActual] = useState(null);

  useEffect(() => { loadReportes(); }, [fechaDesde, fechaHasta]);

  async function loadReportes() {
    setLoading(true);
    try {
      const [
        { data: facturasData, error: fErr },
        { data: prodsData, error: pErr },
        { data: rateData },
      ] = await Promise.all([
        supabase
          .from('facturas')
          .select(`
            id, numero_factura, fecha_emision, estado, total_usd, total_bs, metodos_pago,
            clientes(nombre, documento_identidad),
            usuarios!facturas_vendedor_id_fkey(nombre_completo)
          `)
          .gte('fecha_emision', `${fechaDesde}T00:00:00`)
          .lte('fecha_emision', `${fechaHasta}T23:59:59`)
          .order('fecha_emision', { ascending: false }),
        supabase
          .from('productos')
          .select('id, sku, nombre, precio_usd, stock, stock_minimo, categorias(nombre)')
          .eq('activo', true)
          .order('nombre'),
        supabase
          .from('tasas_cambio')
          .select('tasa_usd_bs')
          .order('fecha_registro', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (fErr) throw fErr;
      if (pErr) throw pErr;

      const facturas = facturasData || [];
      setVentas(facturas);
      setInventario(prodsData || []);
      setTasaActual(rateData);

      // Fetch detalles only for emitted invoices (max 150)
      const facturaIds = facturas
        .filter(f => f.estado === 'emitida')
        .slice(0, 150)
        .map(f => f.id);

      if (facturaIds.length > 0) {
        const { data: detallesData } = await supabase
          .from('detalles_factura')
          .select('producto_nombre, cantidad, precio_unitario_usd, subtotal_usd')
          .in('factura_id', facturaIds);
        setDetallesVentas(detallesData || []);
      } else {
        setDetallesVentas([]);
      }
    } catch (error) {
      console.error('Error cargando reportes:', error);
      toast.error('Error al cargar datos del reporte');
    } finally {
      setLoading(false);
    }
  }

  // ── Calculated Metrics ───────────────────────────────────────────
  const facturasEmitidas = ventas.filter(f => f.estado === 'emitida');
  const facturasAnuladas = ventas.filter(f => f.estado === 'anulada');

  const totalUSD = facturasEmitidas.reduce((s, f) => s + parseFloat(f.total_usd || 0), 0);
  const totalBs  = facturasEmitidas.reduce((s, f) => s + parseFloat(f.total_bs  || 0), 0);
  const ticketPromedio = facturasEmitidas.length > 0 ? totalUSD / facturasEmitidas.length : 0;

  // ── CIERRE DE CAJA / ARQUEO DIARIO (Cálculo Contable Exhaustivo) ──
  // Desglosa las iniciales de Cashea al método real donde entró el dinero (banco o efectivo),
  // y aísla el monto financiado por Cashea como saldo por cobrar a la plataforma.
  const cierreCaja = {
    // Físico en Gaveta
    efectivoUSD: { label: 'Efectivo USD (Físico en Gaveta)', total_usd: 0, total_bs: 0, transacciones: 0, directas_usd: 0, iniciales_usd: 0 },
    efectivoBs:  { label: 'Efectivo Bs (Físico en Gaveta)',  total_usd: 0, total_bs: 0, transacciones: 0, directas_bs: 0, iniciales_bs: 0 },
    // Banco en Bolívares
    puntoVenta:    { label: 'Punto de Venta (Banco Bs)', total_usd: 0, total_bs: 0, transacciones: 0, directas_bs: 0, iniciales_bs: 0 },
    pagoMovil:     { label: 'Pago Móvil (Banco Bs)',     total_usd: 0, total_bs: 0, transacciones: 0, directas_bs: 0, iniciales_bs: 0 },
    transferencia: { label: 'Transferencia (Banco Bs)',  total_usd: 0, total_bs: 0, transacciones: 0, directas_bs: 0, iniciales_bs: 0 },
    // Banco Internacional (Divisas digitales)
    zelle: { label: 'Zelle (Dólares Digitales)', total_usd: 0, total_bs: 0, transacciones: 0, directas_usd: 0, iniciales_usd: 0 },
    // Cashea Financiado (Cuentas por cobrar a plataforma)
    casheaFinanciado: { label: 'Monto Financiado Cashea (A cobrar)', total_usd: 0, total_bs: 0, transacciones: 0 },
    // Desglose consolidado de iniciales Cashea
    inicialesCasheaTotal: { total_usd: 0, total_bs: 0, transacciones: 0, porMetodo: {} },
    // Otros
    otros: { label: 'Otros Métodos', total_usd: 0, total_bs: 0, transacciones: 0 },
  };

  facturasEmitidas.forEach(f => {
    const fTasa = (f.total_usd > 0 && f.total_bs > 0)
      ? (parseFloat(f.total_bs) / parseFloat(f.total_usd))
      : (tasaActual?.tasa_usd_bs || 1);

    (f.metodos_pago || []).forEach(mp => {
      const id = (mp.metodo_id || mp.id || '').toLowerCase();
      const nombre = (mp.metodo || mp.label || '').toLowerCase();

      // ¿Es Cashea?
      if (id === 'cashea' || nombre.includes('cashea')) {
        // 1. Monto financiado por Cashea a clientes (crédito que Cashea liquida al comercio)
        const creditoUSD = parseFloat(mp.credito_cashea_usd || 0);
        const creditoBs = parseFloat(mp.credito_cashea_bs || (creditoUSD * fTasa).toFixed(2));
        if (creditoUSD > 0) {
          cierreCaja.casheaFinanciado.total_usd += creditoUSD;
          cierreCaja.casheaFinanciado.total_bs  += creditoBs;
          cierreCaja.casheaFinanciado.transacciones += 1;
        }

        // 2. Iniciales pagadas en tienda para la orden de Cashea
        let desglose = [];
        if (Array.isArray(mp.desglose_inicial) && mp.desglose_inicial.length > 0) {
          desglose = mp.desglose_inicial;
        } else {
          const inicialPropiaUSD = parseFloat(mp.inicial_usd ?? mp.monto_usd ?? 0);
          if (inicialPropiaUSD > 0) {
            desglose.push({
              metodo: mp.cashea_metodo_inicial_label || mp.cashea_metodo_inicial || 'Punto de Venta',
              metodo_id: mp.cashea_metodo_inicial || 'punto_venta',
              monto_usd: inicialPropiaUSD,
              monto_bs: mp.inicial_bs || parseFloat((inicialPropiaUSD * fTasa).toFixed(2)),
            });
          }
        }

        desglose.forEach(di => {
          const diId = (di.metodo_id || '').toLowerCase();
          const diNombre = (di.metodo || '').toLowerCase();
          const diUSD = parseFloat(di.monto_usd || 0);
          const diBs = parseFloat(di.monto_bs || (diUSD * fTasa).toFixed(2));

          cierreCaja.inicialesCasheaTotal.total_usd += diUSD;
          cierreCaja.inicialesCasheaTotal.total_bs  += diBs;
          cierreCaja.inicialesCasheaTotal.transacciones += 1;

          const metKey = di.metodo || 'Punto de Venta';
          if (!cierreCaja.inicialesCasheaTotal.porMetodo[metKey]) {
            cierreCaja.inicialesCasheaTotal.porMetodo[metKey] = { usd: 0, bs: 0, ops: 0 };
          }
          cierreCaja.inicialesCasheaTotal.porMetodo[metKey].usd += diUSD;
          cierreCaja.inicialesCasheaTotal.porMetodo[metKey].bs  += diBs;
          cierreCaja.inicialesCasheaTotal.porMetodo[metKey].ops += 1;

          // Asignar al canal contable donde realmente entró el dinero
          if (diId === 'efectivo_usd' || diNombre.includes('efectivo usd') || diNombre === 'efectivo $') {
            cierreCaja.efectivoUSD.total_usd += diUSD;
            cierreCaja.efectivoUSD.total_bs  += diBs;
            cierreCaja.efectivoUSD.iniciales_usd += diUSD;
            cierreCaja.efectivoUSD.transacciones += 1;
          } else if (diId === 'efectivo_bs' || diNombre.includes('efectivo bs')) {
            cierreCaja.efectivoBs.total_usd += diUSD;
            cierreCaja.efectivoBs.total_bs  += diBs;
            cierreCaja.efectivoBs.iniciales_bs += diBs;
            cierreCaja.efectivoBs.transacciones += 1;
          } else if (diId === 'punto_venta' || diNombre.includes('punto')) {
            cierreCaja.puntoVenta.total_usd += diUSD;
            cierreCaja.puntoVenta.total_bs  += diBs;
            cierreCaja.puntoVenta.iniciales_bs += diBs;
            cierreCaja.puntoVenta.transacciones += 1;
          } else if (diId === 'pago_movil' || diNombre.includes('pago')) {
            cierreCaja.pagoMovil.total_usd += diUSD;
            cierreCaja.pagoMovil.total_bs  += diBs;
            cierreCaja.pagoMovil.iniciales_bs += diBs;
            cierreCaja.pagoMovil.transacciones += 1;
          } else if (diId === 'zelle' || diNombre.includes('zelle')) {
            cierreCaja.zelle.total_usd += diUSD;
            cierreCaja.zelle.total_bs  += diBs;
            cierreCaja.zelle.iniciales_usd += diUSD;
            cierreCaja.zelle.transacciones += 1;
          } else if (diId === 'transferencia' || diNombre.includes('transferencia')) {
            cierreCaja.transferencia.total_usd += diUSD;
            cierreCaja.transferencia.total_bs  += diBs;
            cierreCaja.transferencia.iniciales_bs += diBs;
            cierreCaja.transferencia.transacciones += 1;
          } else {
            cierreCaja.otros.total_usd += diUSD;
            cierreCaja.otros.total_bs  += diBs;
            cierreCaja.otros.transacciones += 1;
          }
        });
      } else {
        // Venta regular sin Cashea
        const mUSD = parseFloat(mp.monto_usd || 0);
        const mBs  = parseFloat(mp.monto_bs || (mUSD * fTasa).toFixed(2));

        if (id === 'efectivo_usd' || nombre.includes('efectivo usd') || nombre === 'efectivo $') {
          cierreCaja.efectivoUSD.total_usd += mUSD;
          cierreCaja.efectivoUSD.total_bs  += mBs;
          cierreCaja.efectivoUSD.directas_usd += mUSD;
          cierreCaja.efectivoUSD.transacciones += 1;
        } else if (id === 'efectivo_bs' || nombre.includes('efectivo bs')) {
          cierreCaja.efectivoBs.total_usd += mUSD;
          cierreCaja.efectivoBs.total_bs  += mBs;
          cierreCaja.efectivoBs.directas_bs += mBs;
          cierreCaja.efectivoBs.transacciones += 1;
        } else if (id === 'punto_venta' || nombre.includes('punto')) {
          cierreCaja.puntoVenta.total_usd += mUSD;
          cierreCaja.puntoVenta.total_bs  += mBs;
          cierreCaja.puntoVenta.directas_bs += mBs;
          cierreCaja.puntoVenta.transacciones += 1;
        } else if (id === 'pago_movil' || nombre.includes('pago')) {
          cierreCaja.pagoMovil.total_usd += mUSD;
          cierreCaja.pagoMovil.total_bs  += mBs;
          cierreCaja.pagoMovil.directas_bs += mBs;
          cierreCaja.pagoMovil.transacciones += 1;
        } else if (id === 'zelle' || nombre.includes('zelle')) {
          cierreCaja.zelle.total_usd += mUSD;
          cierreCaja.zelle.total_bs  += mBs;
          cierreCaja.zelle.directas_usd += mUSD;
          cierreCaja.zelle.transacciones += 1;
        } else if (id === 'transferencia' || nombre.includes('transferencia')) {
          cierreCaja.transferencia.total_usd += mUSD;
          cierreCaja.transferencia.total_bs  += mBs;
          cierreCaja.transferencia.directas_bs += mBs;
          cierreCaja.transferencia.transacciones += 1;
        } else {
          cierreCaja.otros.total_usd += mUSD;
          cierreCaja.otros.total_bs  += mBs;
          cierreCaja.otros.transacciones += 1;
        }
      }
    });
  });

  // Totales de Arqueo de Caja
  const totalBancoBs = cierreCaja.puntoVenta.total_bs + cierreCaja.pagoMovil.total_bs + cierreCaja.transferencia.total_bs;
  const totalBancoUSD_equiv = cierreCaja.puntoVenta.total_usd + cierreCaja.pagoMovil.total_usd + cierreCaja.transferencia.total_usd;

  const totalEfectivoUSD = cierreCaja.efectivoUSD.total_usd;
  const totalEfectivoBs  = cierreCaja.efectivoBs.total_bs;

  const totalZelleUSD = cierreCaja.zelle.total_usd;
  const totalCasheaFinanciadoUSD = cierreCaja.casheaFinanciado.total_usd;
  const totalCasheaFinanciadoBs  = cierreCaja.casheaFinanciado.total_bs;

  // Total recaudado físicamente y en bancos en tienda (excluyendo lo que Cashea aún no liquida)
  const totalRecaudadoEnTiendaUSD = totalEfectivoUSD + totalBancoUSD_equiv + totalZelleUSD + cierreCaja.efectivoBs.total_usd + cierreCaja.otros.total_usd;

  // Payment method breakdown (para la pestaña de gráficos tradicionales)
  const metodosTotales = {};
  facturasEmitidas.forEach(f => {
    (f.metodos_pago || []).forEach(mp => {
      const key = mp.metodo || 'Otro';
      if (!metodosTotales[key]) metodosTotales[key] = { total_usd: 0, total_bs: 0, transacciones: 0 };
      metodosTotales[key].total_usd     += parseFloat(mp.monto_usd || 0);
      metodosTotales[key].total_bs      += parseFloat(mp.monto_bs  || 0);
      metodosTotales[key].transacciones += 1;
    });
  });
  const metodosOrdenados = Object.entries(metodosTotales)
    .map(([m, s]) => ({ metodo: m, ...s }))
    .sort((a, b) => b.total_usd - a.total_usd);
  const maxMetodoUSD = metodosOrdenados[0]?.total_usd || 1;

  // Top products sold
  const rankingProductos = {};
  detallesVentas.forEach(d => {
    const key = d.producto_nombre || 'Producto';
    if (!rankingProductos[key]) rankingProductos[key] = { cantidad: 0, total_usd: 0 };
    rankingProductos[key].cantidad   += d.cantidad;
    rankingProductos[key].total_usd  += parseFloat(d.subtotal_usd || (d.cantidad * (d.precio_unitario_usd || 0)));
  });
  const listaRanking = Object.entries(rankingProductos)
    .map(([nombre, s]) => ({ nombre, ...s }))
    .sort((a, b) => b.cantidad - a.cantidad);
  const topProductos = listaRanking.slice(0, 10);

  // Bottom products (least sold or no movement) — limited to 10
  // Only includes products that appeared in detalles but sold less, plus products with 0 sales from inventario
  const productosSinVentas = inventario
    .filter(p => !rankingProductos[p.nombre])
    .map(p => ({ nombre: p.nombre, sku: p.sku, cantidad: 0, total_usd: 0 }));
  const productosPocoMovimiento = [
    ...listaRanking.slice(-Math.min(10, listaRanking.length)).reverse(),
    ...productosSinVentas,
  ]
    .filter((p, idx, arr) => arr.findIndex(x => x.nombre === p.nombre) === idx)
    .slice(0, 10);

  // Sellers breakdown
  const vendedoresTotales = {};
  facturasEmitidas.forEach(f => {
    const key = f.usuarios?.nombre_completo || 'Sin asignar';
    if (!vendedoresTotales[key]) vendedoresTotales[key] = { facturas: 0, total_usd: 0, total_bs: 0 };
    vendedoresTotales[key].facturas  += 1;
    vendedoresTotales[key].total_usd += parseFloat(f.total_usd || 0);
    vendedoresTotales[key].total_bs  += parseFloat(f.total_bs  || 0);
  });
  const listaVendedores = Object.entries(vendedoresTotales)
    .map(([nombre, s]) => ({ nombre, ...s }))
    .sort((a, b) => b.total_usd - a.total_usd);
  const maxVendedorUSD = listaVendedores[0]?.total_usd || 1;
  const vendedoresPage = listaVendedores.slice((pageVendedores - 1) * 20, pageVendedores * 20);

  // Inventory valuation
  const tasaBsRef = tasaActual?.tasa_usd_bs || 1;
  const valorInventarioUSD = inventario.reduce((s, p) => s + (p.stock * parseFloat(p.precio_usd || 0)), 0);
  const productosBajoStock = inventario.filter(p => p.stock <= p.stock_minimo);

  // ── Preset handler ───────────────────────────────────────────────
  function applyPreset(preset) {
    const range = getPreset(preset);
    if (!range) return;
    setActivePreset(preset);
    setFechaDesde(range.desde);
    setFechaHasta(range.hasta);
    setPageVendedores(1);
  }

  function handleManualDate(field, value) {
    setActivePreset(null);
    if (field === 'desde') setFechaDesde(value);
    else setFechaHasta(value);
  }

  // ── Excel (.xlsx) & PDF Exporters ─────────────────────────────────
  function exportarVentasExcel() {
    if (!facturasEmitidas.length) {
      toast.error('No hay ventas en este rango para exportar');
      return;
    }

    const wb = XLSX.utils.book_new();

    // Hoja 1: Ventas Detalladas
    const filasVentas = facturasEmitidas.map(f => ({
      'N° Factura': f.numero_factura,
      'Fecha y Hora': formatFecha(f.fecha_emision, true),
      'Cliente': f.clientes?.nombre || 'Consumidor Final',
      'C.I. / RIF': f.clientes?.documento_identidad || 'N/A',
      'Vendedor': f.usuarios?.nombre_completo || 'N/A',
      'Total USD': parseFloat(f.total_usd || 0),
      'Total Bs': parseFloat(f.total_bs || 0),
      'Métodos de Pago': (f.metodos_pago || []).map(m => `${m.metodo}: $${m.monto_usd}`).join(' | '),
      'Estado': f.estado || 'emitida',
    }));

    // Fila resumen de totales
    filasVentas.push({
      'N° Factura': 'TOTALES',
      'Fecha y Hora': '',
      'Cliente': '',
      'C.I. / RIF': '',
      'Vendedor': `${facturasEmitidas.length} facturas`,
      'Total USD': parseFloat(totalUSD.toFixed(2)),
      'Total Bs': parseFloat(totalBs.toFixed(2)),
      'Métodos de Pago': '',
      'Estado': '',
    });

    const wsVentas = XLSX.utils.json_to_sheet(filasVentas);
    wsVentas['!cols'] = [
      { wch: 18 }, // Factura
      { wch: 22 }, // Fecha
      { wch: 28 }, // Cliente
      { wch: 16 }, // Documento
      { wch: 22 }, // Vendedor
      { wch: 14 }, // Total USD
      { wch: 18 }, // Total Bs
      { wch: 42 }, // Métodos
      { wch: 12 }, // Estado
    ];
    XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas Detalladas');

    // Hoja 2: Cierre y Arqueo de Caja
    const filasArqueo = [
      { 'Categoría': 'EFECTIVO EN GAVETA (FÍSICO)', 'Canal / Método': 'Efectivo USD', 'Monto Moneda Origen': parseFloat(totalEfectivoUSD.toFixed(2)), 'Moneda': 'USD ($)', 'Equivalente Ref': parseFloat((cierreCaja.efectivoUSD.total_bs).toFixed(2)), 'Moneda Ref': 'Bs', 'Operaciones': cierreCaja.efectivoUSD.transacciones },
      { 'Categoría': 'EFECTIVO EN GAVETA (FÍSICO)', 'Canal / Método': 'Efectivo Bolívares', 'Monto Moneda Origen': parseFloat(totalEfectivoBs.toFixed(2)), 'Moneda': 'Bs', 'Equivalente Ref': parseFloat((cierreCaja.efectivoBs.total_usd).toFixed(2)), 'Moneda Ref': 'USD ($)', 'Operaciones': cierreCaja.efectivoBs.transacciones },
      { 'Categoría': 'BANCO NACIONAL (BOLÍVARES)', 'Canal / Método': 'Punto de Venta (Lote Débito/Crédito)', 'Monto Moneda Origen': parseFloat((cierreCaja.puntoVenta.total_bs).toFixed(2)), 'Moneda': 'Bs', 'Equivalente Ref': parseFloat((cierreCaja.puntoVenta.total_usd).toFixed(2)), 'Moneda Ref': 'USD ($)', 'Operaciones': cierreCaja.puntoVenta.transacciones },
      { 'Categoría': 'BANCO NACIONAL (BOLÍVARES)', 'Canal / Método': 'Pago Móvil (Transferencia Inmediata)', 'Monto Moneda Origen': parseFloat((cierreCaja.pagoMovil.total_bs).toFixed(2)), 'Moneda': 'Bs', 'Equivalente Ref': parseFloat((cierreCaja.pagoMovil.total_usd).toFixed(2)), 'Moneda Ref': 'USD ($)', 'Operaciones': cierreCaja.pagoMovil.transacciones },
      { 'Categoría': 'BANCO NACIONAL (BOLÍVARES)', 'Canal / Método': 'Transferencia Bancaria Nacional', 'Monto Moneda Origen': parseFloat((cierreCaja.transferencia.total_bs).toFixed(2)), 'Moneda': 'Bs', 'Equivalente Ref': parseFloat((cierreCaja.transferencia.total_usd).toFixed(2)), 'Moneda Ref': 'USD ($)', 'Operaciones': cierreCaja.transferencia.transacciones },
      { 'Categoría': 'BANCO NACIONAL (BOLÍVARES)', 'Canal / Método': 'TOTAL EN BANCO (BOLÍVARES)', 'Monto Moneda Origen': parseFloat(totalBancoBs.toFixed(2)), 'Moneda': 'Bs', 'Equivalente Ref': parseFloat(totalBancoUSD_equiv.toFixed(2)), 'Moneda Ref': 'USD ($)', 'Operaciones': cierreCaja.puntoVenta.transacciones + cierreCaja.pagoMovil.transacciones + cierreCaja.transferencia.transacciones },
      { 'Categoría': 'BANCO INTERNACIONAL (DIGITAL)', 'Canal / Método': 'Zelle (Dólares Digitales)', 'Monto Moneda Origen': parseFloat(totalZelleUSD.toFixed(2)), 'Moneda': 'USD ($)', 'Equivalente Ref': parseFloat((cierreCaja.zelle.total_bs).toFixed(2)), 'Moneda Ref': 'Bs', 'Operaciones': cierreCaja.zelle.transacciones },
      { 'Categoría': 'CRÉDITO CASHEA (A COBRAR)', 'Canal / Método': 'Monto Financiado a Clientes', 'Monto Moneda Origen': parseFloat(totalCasheaFinanciadoUSD.toFixed(2)), 'Moneda': 'USD ($)', 'Equivalente Ref': parseFloat(totalCasheaFinanciadoBs.toFixed(2)), 'Moneda Ref': 'Bs', 'Operaciones': cierreCaja.casheaFinanciado.transacciones },
      { 'Categoría': 'TOTALES DEL CIERRE', 'Canal / Método': 'TOTAL RECAUDADO EN TIENDA', 'Monto Moneda Origen': parseFloat(totalRecaudadoEnTiendaUSD.toFixed(2)), 'Moneda': 'USD ($)', 'Equivalente Ref': parseFloat((totalBs - totalCasheaFinanciadoBs).toFixed(2)), 'Moneda Ref': 'Bs', 'Operaciones': facturasEmitidas.length },
      { 'Categoría': 'TOTALES DEL CIERRE', 'Canal / Método': 'TOTAL GENERAL FACTURADO', 'Monto Moneda Origen': parseFloat(totalUSD.toFixed(2)), 'Moneda': 'USD ($)', 'Equivalente Ref': parseFloat(totalBs.toFixed(2)), 'Moneda Ref': 'Bs', 'Operaciones': facturasEmitidas.length },
    ];
    const wsArqueo = XLSX.utils.json_to_sheet(filasArqueo);
    wsArqueo['!cols'] = [
      { wch: 30 }, // Categoría
      { wch: 36 }, // Canal
      { wch: 20 }, // Monto Origen
      { wch: 12 }, // Moneda
      { wch: 20 }, // Equiv Ref
      { wch: 12 }, // Moneda Ref
      { wch: 14 }, // Operaciones
    ];
    XLSX.utils.book_append_sheet(wb, wsArqueo, 'Cierre y Arqueo Caja');

    // Hoja 3: Resumen y KPIs
    const resumenKPIs = [
      { 'Métrica': 'Período', 'Valor': `${fechaDesde} al ${fechaHasta}` },
      { 'Métrica': 'Total Ventas USD', 'Valor': parseFloat(totalUSD.toFixed(2)) },
      { 'Métrica': 'Total Ventas Bs', 'Valor': parseFloat(totalBs.toFixed(2)) },
      { 'Métrica': 'Total Efectivo Físico USD', 'Valor': parseFloat(totalEfectivoUSD.toFixed(2)) },
      { 'Métrica': 'Total Efectivo Físico Bs', 'Valor': parseFloat(totalEfectivoBs.toFixed(2)) },
      { 'Métrica': 'Total en Bancos Bs', 'Valor': parseFloat(totalBancoBs.toFixed(2)) },
      { 'Métrica': 'Total en Zelle USD', 'Valor': parseFloat(totalZelleUSD.toFixed(2)) },
      { 'Métrica': 'Total Financiado por Cashea USD', 'Valor': parseFloat(totalCasheaFinanciadoUSD.toFixed(2)) },
      { 'Métrica': 'Cantidad de Facturas', 'Valor': facturasEmitidas.length },
      { 'Métrica': 'Ticket Promedio USD', 'Valor': parseFloat(ticketPromedio.toFixed(2)) },
    ];
    const wsResumen = XLSX.utils.json_to_sheet(resumenKPIs);
    wsResumen['!cols'] = [{ wch: 32 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen General');

    // Hoja 3: Top Productos
    if (topProductos.length > 0) {
      const filasTop = topProductos.map((p, idx) => ({
        'Puesto': `#${idx + 1}`,
        'Producto': p.nombre,
        'Unidades Vendidas': p.cantidad,
        'Total USD Generado': parseFloat(p.total_usd.toFixed(2)),
      }));
      const wsTop = XLSX.utils.json_to_sheet(filasTop);
      wsTop['!cols'] = [{ wch: 10 }, { wch: 35 }, { wch: 18 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsTop, 'Top Productos');
    }

    // Hoja 4: Rendimiento Vendedores
    if (listaVendedores.length > 0) {
      const filasVend = listaVendedores.map((v, idx) => ({
        'Puesto': `#${idx + 1}`,
        'Vendedor': v.nombre,
        'Facturas Emitidas': v.facturas,
        'Total USD': parseFloat(v.total_usd.toFixed(2)),
        'Total Bs': parseFloat(v.total_bs.toFixed(2)),
      }));
      const wsVend = XLSX.utils.json_to_sheet(filasVend);
      wsVend['!cols'] = [{ wch: 10 }, { wch: 25 }, { wch: 18 }, { wch: 16 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsVend, 'Por Vendedor');
    }

    XLSX.writeFile(wb, `Reporte_Ventas_ARLUC_${fechaDesde}_al_${fechaHasta}.xlsx`);
    toast.success('Reporte Excel (.xlsx) descargado correctamente');
  }

  function exportarInventarioExcel() {
    if (!inventario.length) {
      toast.error('No hay datos de inventario para exportar');
      return;
    }

    const datosInventario = inventario.map(p => {
      const vUSD = p.stock * parseFloat(p.precio_usd || 0);
      const vBs = vUSD * tasaBsRef;
      return {
        'SKU': p.sku || 'N/A',
        'Producto': p.nombre || 'Sin nombre',
        'Categoría': p.categorias?.nombre || 'General',
        'Precio USD': parseFloat(p.precio_usd || 0),
        'Stock Actual': p.stock,
        'Stock Mínimo': p.stock_minimo,
        'Valor Total USD': parseFloat(vUSD.toFixed(2)),
        'Valor Total Bs': parseFloat(vBs.toFixed(2)),
        'Estado': p.stock <= p.stock_minimo ? 'CRÍTICO' : 'NORMAL',
      };
    });

    const ws = XLSX.utils.json_to_sheet(datosInventario);
    ws['!cols'] = [
      { wch: 15 }, // SKU
      { wch: 38 }, // Producto
      { wch: 20 }, // Categoría
      { wch: 14 }, // Precio USD
      { wch: 14 }, // Stock Actual
      { wch: 14 }, // Stock Mínimo
      { wch: 18 }, // Valor Total USD
      { wch: 18 }, // Valor Total Bs
      { wch: 12 }, // Estado
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');

    const fechaStr = new Date().toLocaleDateString('en-CA');
    XLSX.writeFile(wb, `Inventario_ARLUC_${fechaStr}.xlsx`);
    toast.success('Inventario Excel (.xlsx) descargado correctamente');
  }

  function exportarExcel() {
    if (activeTab === 'inventario') {
      exportarInventarioExcel();
    } else {
      exportarVentasExcel();
    }
  }

  // Imprime (o guarda como PDF) el mismo contenido del Excel, con formato de reporte
  function exportarPDF() {
    imprimirCon(exportarExcel);
  }

  // ── Render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Generando reportes...</p>
      </div>
    );
  }

  const PRESETS = [
    { id: 'hoy',  label: 'Hoy' },
    { id: '7d',   label: '7 días' },
    { id: '30d',  label: '30 días' },
    { id: 'mes',  label: 'Este mes' },
    { id: 'anio', label: 'Este año' },
  ];

  const TABS = [
    { id: 'ventas',     label: 'Ventas & Flujo',          icon: <HiOutlineArrowTrendingUp /> },
    { id: 'cierre',     label: 'Cierre de Caja (Arqueo)', icon: <HiOutlineBuildingLibrary /> },
    { id: 'vendedores', label: 'Por Vendedor',             icon: <HiOutlineUserGroup /> },
    { id: 'metodos',    label: 'Métodos de Pago',          icon: <HiOutlineChartBar /> },
    { id: 'inventario', label: 'Inventario Valorizado',    icon: <HiOutlineCube /> },
  ];

  return (
    <div className="page reportes-page">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="page__header no-print">
        <div>
          <h1 className="page__title">Reportes y Auditoría</h1>
          <p className="page__subtitle">Métricas de facturación, rendimiento por vendedor e inventario valorizado</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn--primary"
            onClick={exportarPDF}
            title="Generar PDF del reporte (no editable)"
          >
            <HiOutlinePrinter /> Exportar PDF
          </button>
          <button
            className="btn btn--outline"
            onClick={exportarExcel}
            style={{ borderColor: '#10B981', color: '#10B981', fontWeight: 'bold' }}
            title="Descargar libro Excel profesional (.xlsx)"
          >
            <HiOutlineArrowDownTray /> Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* ── Filters & Tabs ──────────────────────────────────────── */}
      <div className="card no-print" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem' }}>
        {/* Date presets + custom range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HiOutlineCalendar style={{ color: 'var(--primary)' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              PERÍODO:
            </span>
          </div>
          {/* Preset buttons */}
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                style={{
                  padding: '0.3rem 0.7rem',
                  borderRadius: '6px',
                  border: '1px solid',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  borderColor: activePreset === p.id ? 'var(--primary)' : 'var(--border)',
                  background: activePreset === p.id ? 'var(--primary-bg)' : 'transparent',
                  color: activePreset === p.id ? 'var(--primary)' : 'var(--text-secondary)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Manual date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Desde</span>
            <input
              type="date" value={fechaDesde}
              onChange={e => handleManualDate('desde', e.target.value)}
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '6px', padding: '0.35rem 0.55rem', fontSize: '0.82rem' }}
            />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Hasta</span>
            <input
              type="date" value={fechaHasta}
              onChange={e => handleManualDate('hasta', e.target.value)}
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '6px', padding: '0.35rem 0.55rem', fontSize: '0.82rem' }}
            />
          </div>
        </div>

        {/* Tab navigation */}
        <div style={{ display: 'flex', gap: '0.35rem', background: 'var(--bg-elevated)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border)' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.45rem 0.9rem', borderRadius: '7px', border: 'none',
                fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s ease',
                background: activeTab === tab.id ? 'var(--primary)' : 'transparent',
                color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Printable header ── */}
      <div className="print-report-header">
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#000', margin: '0 0 2px' }}>
          {empresaConfig?.nombre || 'COMERCIALIZADORA ARLUC C.A.'}
        </h2>
        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#333' }}>
          RIF: {empresaConfig?.rif || 'J-500654642'}
        </div>
        <h3 style={{ fontSize: '14px', margin: '4px 0', color: '#000', textTransform: 'uppercase' }}>
          Reporte de Gestión Empresarial ({activeTab === 'cierre' ? 'Cierre y Arqueo Diario de Caja' : activeTab === 'inventario' ? 'Inventario Valorizado' : 'Ventas y Flujo'})
        </h3>
        <p style={{ fontSize: '11px', color: '#555', margin: '4px 0' }}>
          Período: {formatFecha(fechaDesde)} al {formatFecha(fechaHasta)} | Generado: {formatFecha(new Date(), true)}
        </p>
        <hr style={{ margin: '10px 0', borderColor: '#000' }} />
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--primary"><HiOutlineBanknotes /></div>
          <div className="stat-card__content">
            <span className="stat-card__label">Facturación USD</span>
            <span className="stat-card__value">{formatUSD(totalUSD)}</span>
            <span className="stat-card__sub">{facturasEmitidas.length} facturas emitidas</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--success"><HiOutlineCreditCard /></div>
          <div className="stat-card__content">
            <span className="stat-card__label">Facturación Bs</span>
            <span className="stat-card__value">{formatBs(totalBs)}</span>
            <span className="stat-card__sub">Al cambio de cada operación</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--info"><HiOutlineDocumentChartBar /></div>
          <div className="stat-card__content">
            <span className="stat-card__label">Ticket Promedio</span>
            <span className="stat-card__value">{formatUSD(ticketPromedio)}</span>
            <span className="stat-card__sub">Promedio por venta</span>
          </div>
        </div>
        <div className="stat-card" style={{ borderColor: facturasAnuladas.length > 0 ? 'rgba(239,68,68,0.3)' : undefined }}>
          <div className="stat-card__icon" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}>
            <HiOutlineNoSymbol />
          </div>
          <div className="stat-card__content">
            <span className="stat-card__label">Facturas Anuladas</span>
            <span className="stat-card__value" style={{ color: facturasAnuladas.length > 0 ? '#EF4444' : undefined }}>
              {facturasAnuladas.length}
            </span>
            <span className="stat-card__sub">
              {facturasAnuladas.length > 0
                ? `${formatUSD(facturasAnuladas.reduce((s, f) => s + parseFloat(f.total_usd || 0), 0))} anulados`
                : 'Sin anulaciones'}
            </span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          TAB 1 — Ventas & Flujo
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'ventas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Top Products */}
          <div className="card print-avoid-break">
            <h3 className="card__title" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <HiOutlineReceiptPercent style={{ color: 'var(--primary)' }} />
                Top Productos Más Vendidos
              </span>
              <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span className="badge badge--primary" style={{ fontSize: '0.78rem' }}>
                  Top {topProductos.length} de {listaRanking.length > 0 ? listaRanking.length : '—'}
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>período: {fechaDesde} al {fechaHasta}</span>
              </span>
            </h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>Producto</th>
                    <th style={{ textAlign: 'center' }}>Unidades</th>
                    <th style={{ textAlign: 'right' }}>Total (USD)</th>
                    <th style={{ textAlign: 'right' }}>% Aporte</th>
                  </tr>
                </thead>
                <tbody>
                  {topProductos.map((prod, idx) => {
                    const pct = totalUSD > 0 ? ((prod.total_usd / totalUSD) * 100).toFixed(1) : 0;
                    return (
                      <tr key={idx}>
                        <td style={{ color: idx < 3 ? 'var(--primary)' : 'var(--text-muted)', fontWeight: '700', textAlign: 'center' }}>
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                        </td>
                        <td><strong>{prod.nombre}</strong></td>
                        <td style={{ textAlign: 'center' }}>
                          <span className="badge badge--primary">{prod.cantidad} uds</span>
                        </td>
                        <td style={{ textAlign: 'right' }}><strong>{formatUSD(prod.total_usd)}</strong></td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <div style={{ width: '60px', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: '3px' }} />
                            </div>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', minWidth: '36px' }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {listaRanking.length === 0 && (
                    <tr><td colSpan="5" className="table__empty">No hay ventas registradas en el período seleccionado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Products — Least Movement */}
          <div className="card print-avoid-break">
            <h3 className="card__title" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <HiOutlineExclamationTriangle style={{ color: '#F59E0B' }} />
                Productos con Menos Movimiento
              </span>
              <span className="badge badge--warning" style={{ fontSize: '0.78rem' }}>
                {productosPocoMovimiento.length} productos
              </span>
            </h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Producto</th>
                    <th style={{ textAlign: 'center' }}>Unidades Vendidas</th>
                    <th style={{ textAlign: 'right' }}>Total (USD)</th>
                    <th style={{ textAlign: 'center' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {productosPocoMovimiento.map((prod, idx) => (
                    <tr key={idx}>
                      <td style={{ color: '#F59E0B', fontWeight: '700', textAlign: 'center' }}>{idx + 1}</td>
                      <td>
                        <strong>{prod.nombre}</strong>
                        {prod.sku && <div style={{ fontSize: '0.78rem', color: '#666' }}>SKU: {prod.sku}</div>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge ${prod.cantidad === 0 ? 'badge--danger' : 'badge--warning'}`}>
                          {prod.cantidad} uds
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatUSD(prod.total_usd)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge ${prod.cantidad === 0 ? 'badge--danger' : 'badge--warning'}`}>
                          {prod.cantidad === 0 ? 'Sin ventas' : 'Baja rotación'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {productosPocoMovimiento.length === 0 && (
                    <tr><td colSpan="5" className="table__empty">No hay datos de movimiento para este período</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB — Cierre de Caja Diario (Arqueo Contable)
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'cierre' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Header del Cierre */}
          <div className="card" style={{ background: 'linear-gradient(135deg, var(--primary-bg) 0%, var(--bg-card) 100%)', borderColor: 'var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.35rem 0', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.3rem', color: 'var(--text-primary)' }}>
                  <HiOutlineBuildingLibrary style={{ color: 'var(--primary)' }} />
                  Cierre de Caja y Arqueo Diario
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Conciliación de dinero físico en gaveta, transferencias en bancos, Zelle y financiamiento de Cashea
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}>
                  Período: {formatFecha(fechaDesde)} al {formatFecha(fechaHasta)}
                </span>
                <span className="badge" style={{ background: 'rgba(59,130,246,0.15)', color: '#60A5FA', fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}>
                  Tasa Ref: {tasaBsRef.toFixed(2)} Bs/$
                </span>
                <span className="badge badge--success" style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}>
                  {facturasEmitidas.length} Facturas Emitidas
                </span>
              </div>
            </div>
          </div>

          {/* 4 Grandes Tarjetas de Conciliación de Fondos */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            {/* 1. GAVETA: EFECTIVO FÍSICO */}
            <div className="card" style={{ borderTop: '4px solid #22C55E', background: 'rgba(34,197,94,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(34,197,94,0.15)', color: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                  <HiOutlineBanknotes />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#22C55E' }}>
                    1. Efectivo en Físico (Gaveta)
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#888' }}>Dinero que debe estar en caja física</span>
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: '#141414', borderRadius: '8px', marginBottom: '0.6rem', border: '1px solid #262626' }}>
                <div style={{ fontSize: '0.75rem', color: '#A3A3A3', textTransform: 'uppercase' }}>Dólares en Billetes (USD)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: '900', color: '#22C55E', marginTop: '2px' }}>
                  {formatUSD(totalEfectivoUSD)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '4px', borderTop: '1px solid #222', paddingTop: '4px' }}>
                  • Ventas directas: {formatUSD(cierreCaja.efectivoUSD.directas_usd)}<br />
                  • Iniciales Cashea en $: {formatUSD(cierreCaja.efectivoUSD.iniciales_usd)}
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: '#141414', borderRadius: '8px', border: '1px solid #262626' }}>
                <div style={{ fontSize: '0.75rem', color: '#A3A3A3', textTransform: 'uppercase' }}>Bolívares en Billetes (Bs)</div>
                <div style={{ fontSize: '1.3rem', fontWeight: '800', color: '#F59E0B', marginTop: '2px' }}>
                  {formatBs(totalEfectivoBs)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '4px', borderTop: '1px solid #222', paddingTop: '4px' }}>
                  • Ventas directas: {formatBs(cierreCaja.efectivoBs.directas_bs)}<br />
                  • Iniciales Cashea en Bs: {formatBs(cierreCaja.efectivoBs.iniciales_bs)}
                </div>
              </div>
            </div>

            {/* 2. BANCO NACIONAL: BOLÍVARES */}
            <div className="card" style={{ borderTop: '4px solid #8B5CF6', background: 'rgba(139,92,246,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(139,92,246,0.15)', color: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                  <HiOutlineCreditCard />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8B5CF6' }}>
                    2. Cuentas en Banco (Bolívares)
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#888' }}>Punto de Venta, Pago Móvil y Bancos</span>
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: '#141414', borderRadius: '8px', marginBottom: '0.6rem', border: '1px solid #262626' }}>
                <div style={{ fontSize: '0.75rem', color: '#A3A3A3', textTransform: 'uppercase' }}>Total a Verificar en Bancos (Bs)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: '900', color: '#A78BFA', marginTop: '2px' }}>
                  {formatBs(totalBancoBs)}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#888' }}>
                  Contravalor Ref: {formatUSD(totalBancoUSD_equiv)}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                  <span>💳 <strong>Punto de Venta (Lote):</strong></span>
                  <span style={{ fontWeight: 'bold' }}>{formatBs(cierreCaja.puntoVenta.total_bs)}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#777', paddingLeft: '0.6rem' }}>
                  (Ventas: {formatBs(cierreCaja.puntoVenta.directas_bs)} | Iniciales Cashea: {formatBs(cierreCaja.puntoVenta.iniciales_bs)})
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                  <span>📲 <strong>Pago Móvil (Recibido):</strong></span>
                  <span style={{ fontWeight: 'bold' }}>{formatBs(cierreCaja.pagoMovil.total_bs)}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#777', paddingLeft: '0.6rem' }}>
                  (Ventas: {formatBs(cierreCaja.pagoMovil.directas_bs)} | Iniciales Cashea: {formatBs(cierreCaja.pagoMovil.iniciales_bs)})
                </div>

                {cierreCaja.transferencia.total_bs > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                    <span>🏛️ <strong>Transferencias:</strong></span>
                    <span style={{ fontWeight: 'bold' }}>{formatBs(cierreCaja.transferencia.total_bs)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 3. BANCO INTERNACIONAL: ZELLE */}
            <div className="card" style={{ borderTop: '4px solid #3B82F6', background: 'rgba(59,130,246,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(59,130,246,0.15)', color: '#3B82F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                  <HiOutlineDevicePhoneMobile />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#3B82F6' }}>
                    3. Banco Digital (Zelle)
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#888' }}>Cobros recibidos por cuenta Zelle</span>
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: '#141414', borderRadius: '8px', marginBottom: '0.6rem', border: '1px solid #262626' }}>
                <div style={{ fontSize: '0.75rem', color: '#A3A3A3', textTransform: 'uppercase' }}>Total Recibido en Zelle (USD)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: '900', color: '#60A5FA', marginTop: '2px' }}>
                  {formatUSD(totalZelleUSD)}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#888' }}>
                  {cierreCaja.zelle.transacciones} operaciones | Ref. {formatBs(cierreCaja.zelle.total_bs)}
                </div>
              </div>

              <div style={{ fontSize: '0.75rem', color: '#777', padding: '0.5rem', background: '#141414', borderRadius: '6px', border: '1px solid #222' }}>
                • Ventas directas Zelle: {formatUSD(cierreCaja.zelle.directas_usd)}<br />
                • Iniciales Cashea en Zelle: {formatUSD(cierreCaja.zelle.iniciales_usd)}
              </div>
            </div>

            {/* 4. CASHEA FINANCIADO: CUENTAS POR COBRAR */}
            <div className="card" style={{ borderTop: '4px solid #EC4899', background: 'rgba(236,72,153,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(236,72,153,0.15)', color: '#EC4899', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                  <HiOutlineReceiptPercent />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#EC4899' }}>
                    4. Financiado por Cashea
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#888' }}>Crédito que Cashea liquida al comercio</span>
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: '#141414', borderRadius: '8px', marginBottom: '0.6rem', border: '1px solid #262626' }}>
                <div style={{ fontSize: '0.75rem', color: '#EC4899', textTransform: 'uppercase', fontWeight: 'bold' }}>Total Financiado a Clientes</div>
                <div style={{ fontSize: '1.6rem', fontWeight: '900', color: '#F472B6', marginTop: '2px' }}>
                  {formatUSD(totalCasheaFinanciadoUSD)}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#888' }}>
                  Ref. {formatBs(totalCasheaFinanciadoBs)} | {cierreCaja.casheaFinanciado.transacciones} órdenes Cashea
                </div>
              </div>

              <div style={{ fontSize: '0.75rem', color: '#aaa', fontStyle: 'italic', padding: '0.4rem', borderTop: '1px dotted #333' }}>
                * El cliente pagó la inicial en tienda y el saldo restante es liquidado por Cashea según cronograma.
              </div>
            </div>
          </div>

          {/* Tabla Resumen de Conciliación de Fondos */}
          <div className="card">
            <h3 className="card__title" style={{ marginBottom: '1rem' }}>
              <HiOutlineShieldCheck style={{ marginRight: '0.5rem', color: '#22C55E' }} />
              Cuadro Resumen de Conciliación de Fondos del Cierre
            </h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Canal / Destino de los Fondos</th>
                    <th style={{ textAlign: 'center' }}>Operaciones</th>
                    <th style={{ textAlign: 'right' }}>Monto en Moneda de Origen</th>
                    <th style={{ textAlign: 'right' }}>Contravalor Referencial</th>
                    <th style={{ textAlign: 'right' }}>Estado / Ubicación</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>💵 Efectivo Dólares (USD)</strong></td>
                    <td style={{ textAlign: 'center' }}>{cierreCaja.efectivoUSD.transacciones}</td>
                    <td style={{ textAlign: 'right' }}><strong style={{ color: '#22C55E' }}>{formatUSD(totalEfectivoUSD)}</strong></td>
                    <td style={{ textAlign: 'right', color: '#888' }}>{formatBs(cierreCaja.efectivoUSD.total_bs)}</td>
                    <td style={{ textAlign: 'right' }}><span className="badge badge--success">Físico en Gaveta</span></td>
                  </tr>
                  <tr>
                    <td><strong>💵 Efectivo Bolívares (Bs)</strong></td>
                    <td style={{ textAlign: 'center' }}>{cierreCaja.efectivoBs.transacciones}</td>
                    <td style={{ textAlign: 'right' }}><strong style={{ color: '#F59E0B' }}>{formatBs(totalEfectivoBs)}</strong></td>
                    <td style={{ textAlign: 'right', color: '#888' }}>{formatUSD(cierreCaja.efectivoBs.total_usd)}</td>
                    <td style={{ textAlign: 'right' }}><span className="badge badge--success">Físico en Gaveta</span></td>
                  </tr>
                  <tr>
                    <td><strong>💳 Punto de Venta (Tarjetas Débito/Crédito)</strong></td>
                    <td style={{ textAlign: 'center' }}>{cierreCaja.puntoVenta.transacciones}</td>
                    <td style={{ textAlign: 'right' }}><strong style={{ color: '#A78BFA' }}>{formatBs(cierreCaja.puntoVenta.total_bs)}</strong></td>
                    <td style={{ textAlign: 'right', color: '#888' }}>{formatUSD(cierreCaja.puntoVenta.total_usd)}</td>
                    <td style={{ textAlign: 'right' }}><span className="badge badge--primary">Banco en Bolívares</span></td>
                  </tr>
                  <tr>
                    <td><strong>📲 Pago Móvil Interbancario</strong></td>
                    <td style={{ textAlign: 'center' }}>{cierreCaja.pagoMovil.transacciones}</td>
                    <td style={{ textAlign: 'right' }}><strong style={{ color: '#A78BFA' }}>{formatBs(cierreCaja.pagoMovil.total_bs)}</strong></td>
                    <td style={{ textAlign: 'right', color: '#888' }}>{formatUSD(cierreCaja.pagoMovil.total_usd)}</td>
                    <td style={{ textAlign: 'right' }}><span className="badge badge--primary">Banco en Bolívares</span></td>
                  </tr>
                  {cierreCaja.transferencia.total_bs > 0 && (
                    <tr>
                      <td><strong>🏛️ Transferencias Bancarias</strong></td>
                      <td style={{ textAlign: 'center' }}>{cierreCaja.transferencia.transacciones}</td>
                      <td style={{ textAlign: 'right' }}><strong style={{ color: '#A78BFA' }}>{formatBs(cierreCaja.transferencia.total_bs)}</strong></td>
                      <td style={{ textAlign: 'right', color: '#888' }}>{formatUSD(cierreCaja.transferencia.total_usd)}</td>
                      <td style={{ textAlign: 'right' }}><span className="badge badge--primary">Banco en Bolívares</span></td>
                    </tr>
                  )}
                  {totalZelleUSD > 0 && (
                    <tr>
                      <td><strong>🌐 Zelle</strong></td>
                      <td style={{ textAlign: 'center' }}>{cierreCaja.zelle.transacciones}</td>
                      <td style={{ textAlign: 'right' }}><strong style={{ color: '#60A5FA' }}>{formatUSD(totalZelleUSD)}</strong></td>
                      <td style={{ textAlign: 'right', color: '#888' }}>{formatBs(cierreCaja.zelle.total_bs)}</td>
                      <td style={{ textAlign: 'right' }}><span className="badge badge--info">Banco Internacional</span></td>
                    </tr>
                  )}
                  {totalCasheaFinanciadoUSD > 0 && (
                    <tr style={{ background: 'rgba(236,72,153,0.05)' }}>
                      <td><strong>📱 Monto Financiado por Cashea (Crédito a Clientes)</strong></td>
                      <td style={{ textAlign: 'center' }}>{cierreCaja.casheaFinanciado.transacciones}</td>
                      <td style={{ textAlign: 'right' }}><strong style={{ color: '#EC4899' }}>{formatUSD(totalCasheaFinanciadoUSD)}</strong></td>
                      <td style={{ textAlign: 'right', color: '#888' }}>{formatBs(totalCasheaFinanciadoBs)}</td>
                      <td style={{ textAlign: 'right' }}><span className="badge" style={{ background: '#EC4899', color: '#fff' }}>Por Liquidar Cashea</span></td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-elevated)' }}>
                    <td><strong>TOTAL COBRADO EN TIENDA (FÍSICO + BANCOS)</strong></td>
                    <td style={{ textAlign: 'center' }}><strong>{facturasEmitidas.length}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong style={{ color: 'var(--success)', fontSize: '1.05rem' }}>{formatUSD(totalRecaudadoEnTiendaUSD)}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{formatBs(totalBs - totalCasheaFinanciadoBs)}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>Recaudado Hoy</strong></td>
                  </tr>
                  <tr style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
                    <td><strong style={{ color: 'var(--primary)' }}>TOTAL FACTURACIÓN GENERAL (INCLUYENDO CRÉDITO CASHEA)</strong></td>
                    <td style={{ textAlign: 'center' }}><strong>{facturasEmitidas.length} facturas</strong></td>
                    <td style={{ textAlign: 'right' }}><strong style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>{formatUSD(totalUSD)}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>{formatBs(totalBs)}</strong></td>
                    <td style={{ textAlign: 'right' }}><span className="badge badge--primary">Total General</span></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Desglose Exclusivo de Iniciales de Cashea */}
          {cierreCaja.inicialesCasheaTotal.transacciones > 0 && (
            <div className="card" style={{ borderLeft: '4px solid #EC4899' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h4 style={{ margin: 0, color: '#EC4899', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
                  <HiOutlineReceiptPercent />
                  Desglose Detallado de Iniciales Cobradas de Cashea
                </h4>
                <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 'bold' }}>
                  Total Iniciales Cobradas en Tienda: {formatUSD(cierreCaja.inicialesCasheaTotal.total_usd)} | {formatBs(cierreCaja.inicialesCasheaTotal.total_bs)}
                </div>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#888', margin: '0 0 0.75rem 0' }}>
                Los siguientes importes ya están sumados en sus respectivas cuentas de caja y banco arriba, según cómo pagó cada cliente su inicial:
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                {Object.entries(cierreCaja.inicialesCasheaTotal.porMetodo).map(([met, vals]) => (
                  <div key={met} style={{ background: '#141414', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #262626' }}>
                    <div style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase' }}>{met}</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#fff', marginTop: '2px' }}>
                      {formatUSD(vals.usd)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#A3A3A3' }}>
                      {formatBs(vals.bs)} ({vals.ops} iniciales)
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bloque de Firmas y Validación de Cierre */}
          <div className="card" style={{ marginTop: '0.5rem', padding: '1.25rem' }}>
            <h4 style={{ margin: '0 0 1.25rem 0', fontSize: '0.9rem', textTransform: 'uppercase', color: '#888', letterSpacing: '0.5px' }}>
              Validación y Firmas de Auditoría de Cierre
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
              <div style={{ borderTop: '1.5px solid #444', paddingTop: '0.6rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff' }}>Cajero / Responsable de Caja</div>
                <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '2px' }}>Firma y C.I. de quien entrega el turno</div>
              </div>
              <div style={{ borderTop: '1.5px solid #444', paddingTop: '0.6rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff' }}>Administrador / Supervisor</div>
                <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '2px' }}>Firma de conformidad y recepción de fondos</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB 2 — Por Vendedor
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'vendedores' && (
        <div className="card">
          <h3 className="card__title">
            <HiOutlineUserGroup style={{ marginRight: '0.5rem', color: 'var(--primary)' }} />
            Rendimiento por Vendedor
          </h3>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Vendedor</th>
                  <th style={{ textAlign: 'center' }}>Facturas</th>
                  <th style={{ textAlign: 'right' }}>Total USD</th>
                  <th style={{ textAlign: 'right' }}>Total Bs</th>
                  <th style={{ textAlign: 'right' }}>Ticket Promedio</th>
                  <th>Participación</th>
                </tr>
              </thead>
              <tbody>
                {vendedoresPage.map((v, idx) => {
                  const pct = totalUSD > 0 ? ((v.total_usd / totalUSD) * 100).toFixed(1) : 0;
                  const barWidth = maxVendedorUSD > 0 ? ((v.total_usd / maxVendedorUSD) * 100).toFixed(1) : 0;
                  const ticket  = v.facturas > 0 ? v.total_usd / v.facturas : 0;
                  const rank    = (pageVendedores - 1) * 20 + idx + 1;
                  return (
                    <tr key={v.nombre}>
                      <td style={{ color: rank <= 3 ? 'var(--primary)' : 'var(--text-muted)', fontWeight: '700', textAlign: 'center' }}>{rank}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <div style={{
                            width: '32px', height: '32px', borderRadius: '50%',
                            background: 'var(--primary-bg)', color: 'var(--primary)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: '700', fontSize: '0.82rem', flexShrink: 0,
                          }}>
                            {v.nombre.charAt(0).toUpperCase()}
                          </div>
                          <strong>{v.nombre}</strong>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge badge--primary">{v.facturas}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}><strong>{formatUSD(v.total_usd)}</strong></td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{formatBs(v.total_bs)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{formatUSD(ticket)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <div style={{ flex: 1, height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', minWidth: '80px' }}>
                            <div style={{ width: `${barWidth}%`, height: '100%', background: 'var(--primary)', borderRadius: '4px', transition: 'width 0.4s ease' }} />
                          </div>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: '38px' }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {listaVendedores.length === 0 && (
                  <tr><td colSpan="7" className="table__empty">No hay datos de vendedores en este período</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={pageVendedores} totalItems={listaVendedores.length} pageSize={20} onPageChange={setPageVendedores} />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB 3 — Métodos de Pago
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'metodos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Visual chart */}
          <div className="card">
            <h3 className="card__title">
              <HiOutlineChartBar style={{ marginRight: '0.5rem', color: 'var(--primary)' }} />
              Distribución de Cobros por Método
            </h3>
            {metodosOrdenados.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', padding: '0.5rem 0' }}>
                {metodosOrdenados.map(m => {
                  const pct    = totalUSD > 0 ? ((m.total_usd / totalUSD) * 100) : 0;
                  const barPct = maxMetodoUSD > 0 ? ((m.total_usd / maxMetodoUSD) * 100) : 0;
                  const color  = getMetodoColor(m.metodo);
                  return (
                    <div key={m.metodo}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                          <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{m.metodo}</span>
                          <span className="badge badge--primary" style={{ fontSize: '0.72rem' }}>{m.transacciones} ops</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: '700', fontSize: '0.95rem' }}>{formatUSD(m.total_usd)}</span>
                          <span style={{ fontSize: '0.8rem', color: '#666', marginLeft: '0.5rem' }}>({pct.toFixed(1)}%)</span>
                        </div>
                      </div>
                      <div style={{ height: '10px', background: '#1F1F1F', borderRadius: '5px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${barPct}%`, height: '100%', background: color,
                          borderRadius: '5px', transition: 'width 0.5s ease',
                          boxShadow: `0 0 8px ${color}55`,
                        }} />
                      </div>
                      {m.total_bs > 0 && (
                        <div style={{ fontSize: '0.77rem', color: '#555', marginTop: '0.25rem' }}>
                          Equiv. Bs: {formatBs(m.total_bs)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: '#555', textAlign: 'center', padding: '2rem 0' }}>Sin cobros en este rango de fechas</p>
            )}
          </div>

          {/* Detail table */}
          <div className="card">
            <h3 className="card__title">Detalle por Método de Pago</h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Método</th>
                    <th style={{ textAlign: 'center' }}>Operaciones</th>
                    <th style={{ textAlign: 'right' }}>Total Recaudado (USD)</th>
                    <th style={{ textAlign: 'right' }}>Total Recaudado (Bs)</th>
                    <th style={{ textAlign: 'right' }}>Participación</th>
                  </tr>
                </thead>
                <tbody>
                  {metodosOrdenados.map((m, i) => {
                    const pct   = totalUSD > 0 ? ((m.total_usd / totalUSD) * 100).toFixed(1) : 0;
                    const color = getMetodoColor(m.metodo);
                    return (
                      <tr key={i}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                            <strong>{m.metodo}</strong>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>{m.transacciones}</td>
                        <td style={{ textAlign: 'right' }}><strong>{formatUSD(m.total_usd)}</strong></td>
                        <td style={{ textAlign: 'right', color: '#A3A3A3' }}>
                          {m.total_bs > 0 ? formatBs(m.total_bs) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', color: '#A3A3A3' }}>{pct}%</td>
                      </tr>
                    );
                  })}
                  {metodosOrdenados.length === 0 && (
                    <tr><td colSpan="5" className="table__empty">Sin cobros en este rango</td></tr>
                  )}
                </tbody>
                {metodosOrdenados.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #262626' }}>
                      <td><strong>TOTAL</strong></td>
                      <td style={{ textAlign: 'center' }}>
                        <strong>{metodosOrdenados.reduce((s, m) => s + m.transacciones, 0)}</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}><strong style={{ color: '#22C55E' }}>{formatUSD(totalUSD)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong style={{ color: '#A3A3A3' }}>{formatBs(totalBs)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>100%</strong></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB 4 — Inventario Valorizado
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'inventario' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div className="stat-card">
              <div className="stat-card__icon" style={{ background: 'rgba(59,130,246,0.15)', color: '#60A5FA' }}>
                <HiOutlineCube />
              </div>
              <div className="stat-card__content">
                <span className="stat-card__label">Valor USD</span>
                <span className="stat-card__value">{formatUSD(valorInventarioUSD)}</span>
                <span className="stat-card__sub">{inventario.length} productos activos</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__icon" style={{ background: 'rgba(59,130,246,0.15)', color: '#60A5FA' }}>
                <HiOutlineBanknotes />
              </div>
              <div className="stat-card__content">
                <span className="stat-card__label">Valor Bs (tasa actual)</span>
                <span className="stat-card__value">{formatBs(valorInventarioUSD * tasaBsRef)}</span>
                <span className="stat-card__sub">Tasa: {tasaBsRef.toFixed(2)} Bs/$</span>
              </div>
            </div>
            <div className="stat-card" style={{ borderColor: productosBajoStock.length > 0 ? 'rgba(239,68,68,0.3)' : undefined }}>
              <div className="stat-card__icon" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}>
                <HiOutlineExclamationTriangle />
              </div>
              <div className="stat-card__content">
                <span className="stat-card__label">Stock Crítico</span>
                <span className="stat-card__value" style={{ color: productosBajoStock.length > 0 ? '#EF4444' : undefined }}>
                  {productosBajoStock.length}
                </span>
                <span className="stat-card__sub">artículos bajo el mínimo</span>
              </div>
            </div>
          </div>

          {/* Critical stock alert */}
          {productosBajoStock.length > 0 && (
            <div className="card" style={{ borderLeft: '4px solid #EF4444', background: 'rgba(239,68,68,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <HiOutlineExclamationTriangle style={{ color: '#EF4444', fontSize: '1.25rem' }} />
                <h4 style={{ margin: 0, color: '#EF4444' }}>Alerta Stock Crítico ({productosBajoStock.length} artículos)</h4>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {productosBajoStock.map(p => (
                  <span key={p.id} className="badge badge--danger">
                    {p.nombre} ({p.stock}/{p.stock_minimo})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Products table */}
          <div className="card">
            <h3 className="card__title">Valoración de Existencias</h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th style={{ textAlign: 'right' }}>Precio USD</th>
                    <th style={{ textAlign: 'center' }}>Stock</th>
                    <th style={{ textAlign: 'right' }}>Valor USD</th>
                    <th style={{ textAlign: 'right' }}>Valor Bs</th>
                  </tr>
                </thead>
                <tbody>
                  {inventario.slice((pageInventario - 1) * 20, pageInventario * 20).map(p => {
                    const vUSD = p.stock * parseFloat(p.precio_usd || 0);
                    const vBs  = vUSD * tasaBsRef;
                    const bajo = p.stock <= p.stock_minimo;
                    return (
                      <tr key={p.id}>
                        <td><code>{p.sku}</code></td>
                        <td><strong>{p.nombre}</strong></td>
                        <td>{p.categorias?.nombre || 'General'}</td>
                        <td style={{ textAlign: 'right' }}>{formatUSD(p.precio_usd)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${bajo ? 'badge--danger' : 'badge--success'}`}>{p.stock}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}><strong>{formatUSD(vUSD)}</strong></td>
                        <td style={{ textAlign: 'right', color: '#A3A3A3' }}>{formatBs(vBs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={pageInventario}
              totalItems={inventario.length}
              pageSize={20}
              onPageChange={setPageInventario}
            />
          </div>
        </div>
      )}
    </div>
  );
}
