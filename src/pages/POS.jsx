import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { METODOS_PAGO, METODOS_INICIAL_CASHEA } from '../utils/constants';
import { formatTasa, formatUSD } from '../utils/formatters';
import toast from 'react-hot-toast';
import { fetchTasaBCV } from '../services/bcvService';
import { mergeClienteCredito } from '../services/cuentasCobrarService';
import { HiOutlineArrowPath } from 'react-icons/hi2';

// Subcomponentes modulares de Caja
import POSCuentasBar from '../components/pos/POSCuentasBar';
import POSClientSection from '../components/pos/POSClientSection';
import POSProductSection from '../components/pos/POSProductSection';
import POSCartSection from '../components/pos/POSCartSection';
import POSPaymentSection from '../components/pos/POSPaymentSection';
import POSInvoiceSuccess from '../components/pos/POSInvoiceSuccess';

export default function POS() {
  const { profile } = useAuth();

  // Multi-Cuenta / Multi-Cliente simultáneo en Caja
  const createNewCuenta = (num) => ({
    id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 4),
    numero: num,
    clienteSeleccionado: null,
    clienteSearch: '',
    carrito: [],
    metodosPago: [],
    showPago: false,
  });

  const [cuentas, setCuentas] = useState(() => {
    try {
      const saved = localStorage.getItem('arluc_pos_cuentas');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Error loading saved cuentas:', e);
    }
    return [createNewCuenta(1)];
  });

  const [cuentaActivaId, setCuentaActivaId] = useState(() => {
    try {
      const savedId = localStorage.getItem('arluc_pos_cuenta_activa');
      if (savedId) return savedId;
    } catch (e) {}
    return cuentas[0]?.id || '1';
  });

  // Guardar en localStorage para persistencia
  useEffect(() => {
    try {
      localStorage.setItem('arluc_pos_cuentas', JSON.stringify(cuentas));
      localStorage.setItem('arluc_pos_cuenta_activa', cuentaActivaId);
    } catch (e) {}
  }, [cuentas, cuentaActivaId]);

  // Cuenta activa actual
  const cuentaActiva = cuentas.find((c) => c.id === cuentaActivaId) || cuentas[0] || createNewCuenta(1);

  // Extraer valores de la cuenta activa
  const carrito = cuentaActiva?.carrito || [];
  const clienteSeleccionado = cuentaActiva?.clienteSeleccionado || null;
  const clienteSearch = cuentaActiva?.clienteSearch || '';
  const metodosPago = cuentaActiva?.metodosPago || [];
  const showPago = cuentaActiva?.showPago || false;

  // Mutadores de la cuenta activa
  const updateCuentaActiva = (updater) => {
    setCuentas((prev) =>
      prev.map((c) => {
        if (c.id === cuentaActiva.id) {
          return typeof updater === 'function' ? updater(c) : { ...c, ...updater };
        }
        return c;
      })
    );
  };

  const setCarrito = (newCarrito) => {
    updateCuentaActiva((c) => ({
      ...c,
      carrito: typeof newCarrito === 'function' ? newCarrito(c.carrito || []) : newCarrito,
    }));
  };

  const setClienteSeleccionado = (newCliente) => {
    updateCuentaActiva({ clienteSeleccionado: newCliente });
  };

  const setClienteSearch = (newSearch) => {
    updateCuentaActiva({ clienteSearch: newSearch });
  };

  const setMetodosPago = (newMetodos) => {
    updateCuentaActiva((c) => ({
      ...c,
      metodosPago: typeof newMetodos === 'function' ? newMetodos(c.metodosPago || []) : newMetodos,
    }));
  };

  const setShowPago = (val) => {
    updateCuentaActiva({ showPago: val });
  };

  // Búsqueda de clientes y nuevo cliente
  const [clienteResults, setClienteResults] = useState([]);
  const [showNuevoCliente, setShowNuevoCliente] = useState(false);
  const [nuevoCliente, setNuevoCliente] = useState({ nombre: '', documento_identidad: '', telefono: '' });

  // Productos
  const [productoSearch, setProductoSearch] = useState('');
  const [productoResults, setProductoResults] = useState([]);

  // Tasa de cambio
  const [tasaHoy, setTasaHoy] = useState(null);

  // Resultado de factura
  const [facturaEmitida, setFacturaEmitida] = useState(null);
  const [showTicket, setShowTicket] = useState(false);

  const [loading, setLoading] = useState(false);
  const productoSearchRef = useRef(null);

  function agregarNuevaCuenta() {
    const num = cuentas.length + 1;
    const nueva = createNewCuenta(num);
    setCuentas((prev) => [...prev, nueva]);
    setCuentaActivaId(nueva.id);
    toast.success(`Abierta Cuenta #${num}`);
  }

  function cerrarCuenta(idToClose, e) {
    if (e) e.stopPropagation();
    const c = cuentas.find((item) => item.id === idToClose);
    if (!c) return;

    if (c.carrito && c.carrito.length > 0) {
      if (!window.confirm(`La cuenta tiene ${c.carrito.length} productos en el carrito. ¿Seguro que deseas cerrarla?`)) {
        return;
      }
    }

    if (cuentas.length <= 1) {
      const reset = createNewCuenta(1);
      setCuentas([reset]);
      setCuentaActivaId(reset.id);
      return;
    }

    const remaining = cuentas.filter((item) => item.id !== idToClose);
    setCuentas(remaining);
    if (cuentaActivaId === idToClose) {
      setCuentaActivaId(remaining[0].id);
    }
  }

  // Limpiar caja / Cancelar compra en la cuenta activa
  function limpiarCajaActual() {
    if (carrito.length === 0 && !clienteSeleccionado) {
      toast('Esta cuenta ya está vacía', { icon: 'ℹ️' });
      return;
    }

    if (!window.confirm('¿Deseas limpiar todos los productos y cliente de esta cuenta?')) {
      return;
    }

    updateCuentaActiva({
      clienteSeleccionado: null,
      clienteSearch: '',
      carrito: [],
      metodosPago: [],
      showPago: false,
    });
    setProductoSearch('');
    setProductoResults([]);
    setClienteResults([]);

    toast.success('Caja limpiada correctamente');
  }

  // Parámetros fiscales (el servidor recalcula; aquí solo se muestran)
  const [fiscal, setFiscal] = useState({ alicuota_iva: 16, alicuota_igtf: 3, contribuyente_especial: true });

  // Cargar tasa de hoy y parámetros fiscales al montar
  useEffect(() => {
    loadTasaHoy();
    supabase
      .from('configuracion_empresa')
      .select('alicuota_iva, alicuota_igtf, contribuyente_especial')
      .eq('id', 'default')
      .maybeSingle()
      .then(({ data }) => data && setFiscal(data));
  }, []);

  async function loadTasaHoy() {
    const { data } = await supabase
      .from('tasas_cambio')
      .select('*')
      .order('fecha_registro', { ascending: false })
      .limit(1)
      .maybeSingle();
    setTasaHoy(data);
  }

  async function sincronizarBCV() {
    try {
      toast.loading('Consultando API BCV...', { id: 'bcv-sync' });
      const bcv = await fetchTasaBCV();
      if (!bcv.tasa_usd) throw new Error('No se obtuvo tasa');
      const valor = parseFloat(bcv.tasa_usd.toFixed(2));
      const hoy = new Date().toISOString().split('T')[0];

      const { data: existing } = await supabase
        .from('tasas_cambio')
        .select('id')
        .eq('fecha_registro', hoy)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('tasas_cambio')
          .update({ tasa_usd_bs: valor, registrado_por: profile?.id })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('tasas_cambio')
          .insert({ tasa_usd_bs: valor, fecha_registro: hoy, registrado_por: profile?.id });
      }
      await loadTasaHoy();
      toast.success(`Tasa BCV actualizada: Bs ${valor.toFixed(2)}`, { id: 'bcv-sync' });
    } catch (e) {
      toast.error(`Error al sincronizar BCV: ${e.message}`, { id: 'bcv-sync' });
    }
  }

  // Búsqueda de clientes
  async function searchClientes(query) {
    setClienteSearch(query);
    if (query.length < 2) {
      setClienteResults([]);
      return;
    }
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .or(`nombre.ilike.%${query}%,documento_identidad.ilike.%${query}%`)
      .limit(5);
    const enriquecidos = (data || []).map(mergeClienteCredito);
    setClienteResults(enriquecidos);
  }

  // Crear cliente inline
  async function crearCliente(e) {
    e.preventDefault();
    if (!nuevoCliente.nombre || !nuevoCliente.documento_identidad) {
      toast.error('Nombre y documento son obligatorios');
      return;
    }
    try {
      const { data, error } = await supabase.from('clientes').insert(nuevoCliente).select().single();
      if (error) throw error;
      setClienteSeleccionado(data);
      setShowNuevoCliente(false);
      setNuevoCliente({ nombre: '', documento_identidad: '', telefono: '' });
      toast.success('Cliente creado');
    } catch (error) {
      toast.error(error.message);
    }
  }

  // Búsqueda de productos
  async function searchProductos(query) {
    setProductoSearch(query);
    if (query.length < 2) {
      setProductoResults([]);
      return;
    }
    const { data } = await supabase
      .from('productos')
      .select('*')
      .eq('activo', true)
      .or(`nombre.ilike.%${query}%,sku.ilike.%${query}%`)
      .gt('stock', 0)
      .limit(10);
    setProductoResults(data || []);
  }

  // Agregar producto al carrito
  function agregarAlCarrito(producto) {
    const existente = carrito.find((item) => item.producto_id === producto.id);
    if (existente) {
      if (existente.cantidad + 1 > producto.stock) {
        toast.error(`Stock insuficiente. Disponible: ${producto.stock}`);
        return;
      }
      setCarrito(
        carrito.map((item) =>
          item.producto_id === producto.id
            ? { ...item, cantidad: item.cantidad + 1, subtotal: (item.cantidad + 1) * item.precio_unitario }
            : item
        )
      );
    } else {
      setCarrito([
        ...carrito,
        {
          producto_id: producto.id,
          producto_nombre: producto.nombre,
          precio_unitario: parseFloat(producto.precio_usd),
          cantidad: 1,
          subtotal: parseFloat(producto.precio_usd),
          stock_disponible: producto.stock,
          exento_iva: !!producto.exento_iva,
        },
      ]);
    }
    setProductoSearch('');
    setProductoResults([]);
    productoSearchRef.current?.focus();
  }

  // Actualizar cantidad en carrito
  function actualizarCantidad(productoId, nuevaCantidad) {
    const item = carrito.find((i) => i.producto_id === productoId);
    if (nuevaCantidad < 1) return;
    if (nuevaCantidad > item.stock_disponible) {
      toast.error(`Stock insuficiente. Disponible: ${item.stock_disponible}`);
      return;
    }
    setCarrito(
      carrito.map((i) =>
        i.producto_id === productoId
          ? { ...i, cantidad: nuevaCantidad, subtotal: nuevaCantidad * i.precio_unitario }
          : i
      )
    );
  }

  // Quitar producto del carrito
  function quitarDelCarrito(productoId) {
    setCarrito(carrito.filter((i) => i.producto_id !== productoId));
  }

  // Totales de la cuenta: base gravada + exento + IVA. Los pagos cubren este
  // total; el IGTF se suma aparte sobre lo pagado en divisas.
  const redondear = (n) => Math.round(n * 100) / 100;
  const baseGravada = redondear(carrito.filter((i) => !i.exento_iva).reduce((sum, i) => sum + i.subtotal, 0));
  const montoExento = redondear(carrito.filter((i) => i.exento_iva).reduce((sum, i) => sum + i.subtotal, 0));
  const montoIva = redondear(baseGravada * Number(fiscal.alicuota_iva) / 100);
  const totalUSD = redondear(baseGravada + montoExento + montoIva);
  const totalBs = tasaHoy ? totalUSD * parseFloat(tasaHoy.tasa_usd_bs) : 0;

  function agregarMetodoPago(metodoId = '') {
    const metodoConfig = METODOS_PAGO.find((m) => m.id === metodoId);
    const tasa = tasaHoy ? parseFloat(tasaHoy.tasa_usd_bs) : 0;

    const otherPayments = metodosPago.reduce((sum, mp) => sum + parseFloat(mp.monto_usd || 0), 0);
    const pend = Math.max(0, parseFloat((totalUSD - otherPayments).toFixed(2)));
    const defaultMontoUSD = metodoConfig?.isCashea ? parseFloat((pend * 0.4).toFixed(2)) : pend;
    const montoBs = metodoConfig?.enBs && tasa > 0 ? parseFloat((defaultMontoUSD * tasa).toFixed(2)) : 0;

    setMetodosPago([
      ...metodosPago,
      {
        metodo: metodoId,
        monto_usd: defaultMontoUSD,
        monto_bs: montoBs,
        referencia: '',
        zelle_email: '',
        zelle_titular: '',
        cashea_inicial_usd: defaultMontoUSD,
        cashea_inicial_bs: montoBs,
      },
    ]);
  }

  function actualizarMetodoPago(index, field, value) {
    const updated = [...metodosPago];
    const item = { ...updated[index] };
    const tasa = tasaHoy ? parseFloat(tasaHoy.tasa_usd_bs) : 0;

    if (field === 'metodo') {
      item.metodo = value;
      const metodoConfig = METODOS_PAGO.find((m) => m.id === value);
      const otherPayments = updated
        .filter((_, i) => i !== index)
        .reduce((sum, mp) => sum + parseFloat(mp.monto_usd || 0), 0);
      const pend = Math.max(0, parseFloat((totalUSD - otherPayments).toFixed(2)));

      if (metodoConfig?.isCashea) {
        item.monto_usd = parseFloat((pend * 0.4).toFixed(2));
      } else if (!item.monto_usd || item.monto_usd === 0) {
        item.monto_usd = pend;
      }

      if (metodoConfig?.enBs && tasa > 0) {
        item.monto_bs = parseFloat((item.monto_usd * tasa).toFixed(2));
      } else {
        item.monto_bs = 0;
      }
    } else if (field === 'monto_usd') {
      const numVal = parseFloat(value) || 0;
      item.monto_usd = value === '' ? '' : numVal;
      const metodoConfig = METODOS_PAGO.find((m) => m.id === item.metodo);
      if (metodoConfig?.enBs && tasa > 0) {
        item.monto_bs = parseFloat((numVal * tasa).toFixed(2));
      }
    } else if (field === 'monto_bs') {
      const numBs = parseFloat(value) || 0;
      item.monto_bs = value === '' ? '' : numBs;
      if (tasa > 0) {
        item.monto_usd = parseFloat((numBs / tasa).toFixed(2));
      }
    } else {
      item[field] = value;
    }

    updated[index] = item;
    setMetodosPago(updated);
  }

  function quitarMetodoPago(index) {
    setMetodosPago(metodosPago.filter((_, i) => i !== index));
  }

  // Cálculos de Cashea y montos restantes
  const tieneCashea = metodosPago.some((mp) => mp.metodo === 'cashea');
  const casheaItem = metodosPago.find((mp) => mp.metodo === 'cashea');
  const otrosPagos = metodosPago
    .filter((mp) => mp.metodo !== 'cashea')
    .reduce((sum, mp) => sum + parseFloat(mp.monto_usd || 0), 0);
  const casheaInicial = tieneCashea ? parseFloat(casheaItem?.monto_usd || 0) : 0;
  const totalPagadoEnTienda = otrosPagos + casheaInicial;
  const casheaCreditoUSD = tieneCashea ? Math.max(0, parseFloat((totalUSD - totalPagadoEnTienda).toFixed(2))) : 0;
  const restante = tieneCashea
    ? casheaInicial <= 0
      ? Math.max(0, parseFloat((totalUSD - otrosPagos).toFixed(2)))
      : 0
    : Math.max(0, parseFloat((totalUSD - totalPagadoEnTienda).toFixed(2)));

  // IGTF estimado sobre lo cobrado en divisas (incluye la inicial Cashea en divisas)
  const esDivisa = (metodoId) => {
    const config = METODOS_PAGO.find((m) => m.id === metodoId);
    return !!config && !config.enBs && !config.isCredito && !config.isCashea;
  };
  const montoIgtf = fiscal.contribuyente_especial
    ? metodosPago.reduce((sum, mp) => {
        const metodoCobro = mp.metodo === 'cashea' ? mp.cashea_metodo_inicial || 'punto_venta' : mp.metodo;
        return esDivisa(metodoCobro)
          ? sum + redondear(parseFloat(mp.monto_usd || 0) * Number(fiscal.alicuota_igtf) / 100)
          : sum;
      }, 0)
    : 0;

  function iniciarCobro() {
    if (carrito.length === 0) {
      toast.error('Carrito vacío');
      return;
    }
    if (!tasaHoy) {
      toast.error('Registre la tasa del día primero');
      return;
    }
    setShowPago(true);
    agregarMetodoPago();
  }

  // Verificar si la venta incluye pago a crédito
  const tieneCredito = metodosPago.some((mp) => mp.metodo === 'credito');
  const montoCredito = metodosPago
    .filter((mp) => mp.metodo === 'credito')
    .reduce((s, mp) => s + parseFloat(mp.monto_usd || 0), 0);

  // Emitir Factura
  async function emitirFactura() {
    if (carrito.length === 0) {
      toast.error('Agregue productos al carrito');
      return;
    }
    if (!tasaHoy) {
      toast.error('No hay tasa de cambio registrada');
      return;
    }

    // Si hay pago a crédito, el cliente es obligatorio
    if (tieneCredito && !clienteSeleccionado) {
      toast.error('Para ventas a crédito debe seleccionar un cliente');
      return;
    }

    if (restante > 0.01) {
      toast.error(`Faltan ${formatUSD(restante)} por pagar`);
      return;
    }

    for (const mp of metodosPago) {
      if (!mp.metodo) {
        toast.error('Seleccione el método de pago');
        return;
      }
      if (mp.metodo === 'zelle') {
        if (!mp.zelle_titular?.trim()) {
          toast.error('Ingrese el nombre del titular/emisor de Zelle');
          return;
        }
        if (!mp.zelle_email?.trim()) {
          toast.error('Ingrese el correo del emisor de Zelle');
          return;
        }
      } else if (mp.metodo === 'cashea') {
        if (!mp.referencia?.trim()) {
          toast.error('Ingrese el N° de orden / comprobante Cashea');
          return;
        }
        if (parseFloat(mp.monto_usd || 0) <= 0) {
          toast.error('Ingrese el monto de la inicial pagada en Cashea');
          return;
        }
      } else if (METODOS_PAGO.find((m) => m.id === mp.metodo)?.requiereReferencia) {
        if (!mp.referencia?.trim()) {
          toast.error(`Ingrese el número de referencia para ${METODOS_PAGO.find((m) => m.id === mp.metodo)?.label}`);
          return;
        }
      }
    }

    const pagos = metodosPago.map((mp) => ({
      metodo_id: mp.metodo,
      monto_usd: parseFloat(mp.monto_usd || 0),
      ...(METODOS_PAGO.find((m) => m.id === mp.metodo)?.enBs && { monto_bs: parseFloat(mp.monto_bs || 0) }),
      ...(mp.referencia && { referencia: mp.referencia }),
      ...(mp.zelle_titular && { zelle_titular: mp.zelle_titular }),
      ...(mp.zelle_email && { zelle_email: mp.zelle_email }),
      ...(mp.metodo === 'cashea' && {
        cashea_metodo_inicial: mp.cashea_metodo_inicial || 'punto_venta',
        cashea_metodo_inicial_label:
          METODOS_INICIAL_CASHEA.find((m) => m.id === (mp.cashea_metodo_inicial || 'punto_venta'))?.label,
        cashea_referencia_inicial: mp.cashea_referencia_inicial || '',
      }),
    }));
    const items = carrito.map((item) => ({ producto_id: item.producto_id, cantidad: item.cantidad }));

    setLoading(true);
    try {
      // Una sola transacción en el servidor: precios, IVA, IGTF, crédito,
      // stock, cuenta por cobrar y asiento contable.
      const emitir = (autorizarSobregiro) =>
        supabase.rpc('emitir_factura', {
          p_cliente_id: clienteSeleccionado?.id || null,
          p_items: items,
          p_pagos: pagos,
          p_autorizar_sobregiro: autorizarSobregiro,
        });

      let { data: factura, error } = await emitir(false);

      if (error?.hint === 'SOBREGIRO_CREDITO' && ['admin', 'gerente'].includes(profile?.rol)) {
        const autorizar = window.confirm(`⚠️ ${error.message}\n\n¿Autoriza el sobregiro bajo su responsabilidad?`);
        if (!autorizar) return;
        ({ data: factura, error } = await emitir(true));
      }
      if (error) throw error;

      setFacturaEmitida({
        ...factura,
        cliente: clienteSeleccionado || null,
        detalles: carrito,
        tasa: tasaHoy,
        vendedor: profile,
        metodos_pago_detalle: factura.metodos_pago,
      });

      toast.success(`Factura ${factura.numero_factura} emitida correctamente`);

      if (cuentas.length > 1) {
        const remaining = cuentas.filter((c) => c.id !== cuentaActiva.id);
        setCuentas(remaining);
        setCuentaActivaId(remaining[0].id);
      } else {
        const reset = createNewCuenta(1);
        setCuentas([reset]);
        setCuentaActivaId(reset.id);
      }
    } catch (error) {
      toast.error(error.message || 'Error al emitir factura');
    } finally {
      setLoading(false);
    }
  }

  function nuevaVenta() {
    setFacturaEmitida(null);
    setShowTicket(false);
  }

  if (facturaEmitida) {
    return (
      <POSInvoiceSuccess
        facturaEmitida={facturaEmitida}
        showTicket={showTicket}
        onShowTicket={() => setShowTicket(true)}
        onCloseTicket={() => setShowTicket(false)}
        onNuevaVenta={nuevaVenta}
      />
    );
  }

  return (
    <div className="page pos-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Caja</h1>
          <p className="page__subtitle">Atención y facturación simultánea a clientes</p>
        </div>
        {tasaHoy && (
          <div className="pos-tasa" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>
              Tasa BCV: <strong>Bs {formatTasa(tasaHoy.tasa_usd_bs)}</strong>
            </span>
            <button className="btn btn--ghost btn--xs" onClick={sincronizarBCV} title="Actualizar tasa desde BCV">
              <HiOutlineArrowPath />
            </button>
          </div>
        )}
        {!tasaHoy && (
          <div className="pos-tasa pos-tasa--warning" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span>⚠️ Sin tasa de cambio</span>
            <button className="btn btn--primary btn--xs" onClick={sincronizarBCV}>
              <HiOutlineArrowPath /> Cargar Tasa BCV
            </button>
          </div>
        )}
      </div>

      {/* Barra de Cuentas Simultáneas */}
      <POSCuentasBar
        cuentas={cuentas}
        cuentaActivaId={cuentaActiva.id}
        onSelectCuenta={setCuentaActivaId}
        onAgregarCuenta={agregarNuevaCuenta}
        onCerrarCuenta={cerrarCuenta}
      />

      <div className="pos-layout">
        {/* Izquierda: Cliente, Búsqueda de Productos y Carrito */}
        <div className="pos-products">
          <POSClientSection
            clienteSeleccionado={clienteSeleccionado}
            clienteSearch={clienteSearch}
            clienteResults={clienteResults}
            showNuevoCliente={showNuevoCliente}
            nuevoCliente={nuevoCliente}
            onSearchChange={searchClientes}
            onSelectCliente={(c) => {
              setClienteSeleccionado(c);
              setClienteSearch('');
              setClienteResults([]);
            }}
            onClearCliente={() => {
              setClienteSeleccionado(null);
              setClienteSearch('');
            }}
            onOpenNuevoCliente={() => setShowNuevoCliente(true)}
            onCloseNuevoCliente={() => setShowNuevoCliente(false)}
            onNuevoClienteChange={setNuevoCliente}
            onCrearCliente={crearCliente}
          />

          <POSProductSection
            productoSearchRef={productoSearchRef}
            productoSearch={productoSearch}
            productoResults={productoResults}
            onSearchChange={searchProductos}
            onSelectProducto={agregarAlCarrito}
          />

          <POSCartSection
            carrito={carrito}
            clienteSeleccionado={clienteSeleccionado}
            onActualizarCantidad={actualizarCantidad}
            onQuitarDelCarrito={quitarDelCarrito}
            onLimpiarCaja={limpiarCajaActual}
          />
        </div>

        {/* Derecha: Resumen, Cobro y Métodos de Pago */}
        <POSPaymentSection
          totalUSD={totalUSD}
          totalBs={totalBs}
          baseGravada={baseGravada}
          montoExento={montoExento}
          montoIva={montoIva}
          montoIgtf={montoIgtf}
          fiscal={fiscal}
          tasaHoy={tasaHoy}
          showPago={showPago}
          carrito={carrito}
          clienteSeleccionado={clienteSeleccionado}
          metodosPago={metodosPago}
          loading={loading}
          tieneCashea={tieneCashea}
          tieneCredito={tieneCredito}
          montoCredito={montoCredito}
          totalPagadoEnTienda={totalPagadoEnTienda}
          casheaCreditoUSD={casheaCreditoUSD}
          restante={restante}
          onIniciarCobro={iniciarCobro}
          onAgregarMetodoPago={agregarMetodoPago}
          onActualizarMetodoPago={actualizarMetodoPago}
          onQuitarMetodoPago={quitarMetodoPago}
          onEmitirFactura={emitirFactura}
          onVolverAlCarrito={() => {
            setShowPago(false);
            setMetodosPago([]);
          }}
          onLimpiarCaja={limpiarCajaActual}
        />
      </div>
    </div>
  );
}
