import { XLSX } from '../../../utils/xlsxFormateado';
import { formatFecha } from '../../../utils/formatters';

export function exportarCxCExcel({ cuentas = [], abonosHistorico = [], config = {}, tasaValor = 0 }) {
  const wb = XLSX.utils.book_new();

  // 1. Hoja: Cartera Completa
  const filasCartera = cuentas.map((c) => ({
    'Factura': c.numero_factura,
    'Emisión': formatFecha(c.fecha_emision, false),
    'Cliente': c.cliente?.nombre || 'Sin cliente',
    'Documento': c.cliente?.documento_identidad || 'N/A',
    'Teléfono': c.cliente?.telefono || 'N/A',
    'Días en Calle': c.diasTranscurridos,
    'Deuda Original USD': c.montoOriginalUSD,
    'Recargo USD': c.recargoUSD,
    'Abonado USD': c.totalAbonadoUSD,
    'Saldo Pendiente USD': c.saldoTotalUSD,
    'Saldo Pendiente Bs': tasaValor > 0 ? parseFloat((c.saldoTotalUSD * tasaValor).toFixed(2)) : 0,
    'Estado': c.saldoTotalUSD === 0 ? 'Solvente' : c.diasTranscurridos >= config.diasGracia ? 'Vencida' : 'Vigente',
  }));

  const wsCartera = XLSX.utils.json_to_sheet(filasCartera);
  wsCartera['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 18 },
    { wch: 18 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsCartera, 'Cartera Completa');

  // 2. Hoja: Antigüedad de Saldos
  const buckets = [
    { label: '0 a 7 días', min: 0, max: 7 },
    { label: '8 a 15 días', min: 8, max: 15 },
    { label: '16 a 30 días', min: 16, max: 30 },
    { label: '31 a 60 días', min: 31, max: 60 },
    { label: 'Más de 60 días', min: 61, max: 99999 },
  ];

  const totalCartera = cuentas.filter(c => c.saldoTotalUSD > 0).reduce((s, c) => s + c.saldoTotalUSD, 0) || 1;

  const filasAging = buckets.map((b) => {
    const cuentasBucket = cuentas.filter(
      (c) => c.saldoTotalUSD > 0 && c.diasTranscurridos >= b.min && c.diasTranscurridos <= b.max
    );
    const monto = cuentasBucket.reduce((s, c) => s + c.saldoTotalUSD, 0);
    return {
      'Rango de Días': b.label,
      'Cant. Cuentas': cuentasBucket.length,
      'Total Saldo USD': parseFloat(monto.toFixed(2)),
      'Participación (%)': parseFloat(((monto / totalCartera) * 100).toFixed(2)),
      'Contravalor Bs': tasaValor > 0 ? parseFloat((monto * tasaValor).toFixed(2)) : 0,
    };
  });

  const wsAging = XLSX.utils.json_to_sheet(filasAging);
  wsAging['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsAging, 'Antigüedad Saldos');

  // 3. Hoja: Abonos y Recaudaciones
  const filasAbonos = (abonosHistorico || []).map((a) => ({
    'Fecha Abono': formatFecha(a.fecha, true),
    'Factura': a.facturaNumero || 'N/A',
    'Cliente': a.clienteNombre || 'N/A',
    'Monto USD': parseFloat(a.monto_usd || 0),
    'Monto Bs': parseFloat(a.monto_bs || 0),
    'Método': a.metodo || 'Efectivo',
    'Notas': a.notas || '',
  }));

  const wsAbonos = XLSX.utils.json_to_sheet(filasAbonos.length > 0 ? filasAbonos : [{ 'Aviso': 'Sin abonos registrados' }]);
  wsAbonos['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsAbonos, 'Abonos Recibidos');

  // 4. Hoja: Resumen por Cliente
  const clienteMap = {};
  cuentas.forEach((c) => {
    const k = c.cliente?.id || c.cliente?.nombre || 'General';
    if (!clienteMap[k]) {
      clienteMap[k] = {
        nombre: c.cliente?.nombre || 'Desconocido',
        documento: c.cliente?.documento_identidad || 'N/A',
        telefono: c.cliente?.telefono || 'N/A',
        cuentasActivas: 0,
        montoTotalUSD: 0,
        abonadoTotalUSD: 0,
        saldoTotalUSD: 0,
      };
    }
    clienteMap[k].montoTotalUSD += c.montoOriginalUSD + c.recargoUSD;
    clienteMap[k].abonadoTotalUSD += c.totalAbonadoUSD;
    clienteMap[k].saldoTotalUSD += c.saldoTotalUSD;
    if (c.saldoTotalUSD > 0) clienteMap[k].cuentasActivas++;
  });

  const filasClientes = Object.values(clienteMap).map((cl) => ({
    'Cliente': cl.nombre,
    'C.I. / RIF': cl.documento,
    'Teléfono': cl.telefono,
    'Facturas Pendientes': cl.cuentasActivas,
    'Total Otorgado USD': parseFloat(cl.montoTotalUSD.toFixed(2)),
    'Total Pagado USD': parseFloat(cl.abonadoTotalUSD.toFixed(2)),
    'Saldo Deudor USD': parseFloat(cl.saldoTotalUSD.toFixed(2)),
    'Saldo Deudor Bs': tasaValor > 0 ? parseFloat((cl.saldoTotalUSD * tasaValor).toFixed(2)) : 0,
  }));

  const wsClientes = XLSX.utils.json_to_sheet(filasClientes);
  wsClientes['!cols'] = [
    { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 18 },
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }
  ];
  XLSX.utils.book_append_sheet(wb, wsClientes, 'Consolidado por Cliente');

  const fechaStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Reporte_Cuentas_Por_Cobrar_ARLUC_${fechaStr}.xlsx`);
}

