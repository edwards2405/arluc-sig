import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { getEmpresaConfig } from '../../utils/constants';
import BarcodeSvg from './BarcodeSvg';
import { HiOutlinePrinter, HiOutlineXMark, HiOutlineMagnifyingGlass, HiOutlineTag } from 'react-icons/hi2';

const MEDIDAS_ETIQUETA = {
  '50x30': { label: '50 x 30 mm (Estándar Góndola)', width: '50mm', height: '30mm', barWidth: 1.3, barHeight: 30, fontSize: 10 },
  '40x25': { label: '40 x 25 mm (Compacta)', width: '40mm', height: '25mm', barWidth: 1.1, barHeight: 22, fontSize: 9 },
  '58x40': { label: '58 x 40 mm (Grande / Detallada)', width: '58mm', height: '40mm', barWidth: 1.5, barHeight: 38, fontSize: 11 },
};

export default function ModalImprimirEtiquetas({ productos = [], productoInicial = null, onClose }) {
  const empresa = getEmpresaConfig();

  // Diccionario de cantidades por producto { [id]: cantidad }
  const [cantidades, setCantidades] = useState(() => {
    const init = {};
    if (productoInicial) {
      init[productoInicial.id] = 1;
    } else {
      productos.forEach(p => {
        init[p.id] = 1;
      });
    }
    return init;
  });

  const [seleccionados, setSeleccionados] = useState(() => {
    const init = {};
    if (productoInicial) {
      init[productoInicial.id] = true;
    } else {
      productos.forEach(p => {
        init[p.id] = true;
      });
    }
    return init;
  });

  const [busqueda, setBusqueda] = useState('');
  const [medidaSeleccionada, setMedidaSeleccionada] = useState('50x30');
  const [incluirEmpresa, setIncluirEmpresa] = useState(true);
  const [tipoPapel, setTipoPapel] = useState('rollo'); // 'rollo' o 'hoja'

  const medida = MEDIDAS_ETIQUETA[medidaSeleccionada];

  // Filtrar productos para la lista
  const productosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return productos;
    const q = busqueda.toLowerCase();
    return productos.filter(p =>
      p.nombre?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  }, [productos, busqueda]);

  // Total de etiquetas a imprimir
  const totalEtiquetas = useMemo(() => {
    return Object.entries(seleccionados).reduce((total, [id, checked]) => {
      if (checked) {
        return total + (parseInt(cantidades[id]) || 0);
      }
      return total;
    }, 0);
  }, [seleccionados, cantidades]);

  // Producto activo para la vista previa
  const productoPreview = useMemo(() => {
    if (productoInicial && seleccionados[productoInicial.id]) return productoInicial;
    const primerId = Object.keys(seleccionados).find(id => seleccionados[id] && (cantidades[id] || 0) > 0);
    return productos.find(p => String(p.id) === String(primerId)) || productos[0] || null;
  }, [productoInicial, seleccionados, cantidades, productos]);

  const toggleSeleccionarTodos = (marcar) => {
    const nuevo = {};
    productosFiltrados.forEach(p => {
      nuevo[p.id] = marcar;
    });
    setSeleccionados(prev => ({ ...prev, ...nuevo }));
  };

  const aplicarCopiasATodos = (modo) => {
    const nuevasCant = { ...cantidades };
    productos.forEach(p => {
      if (modo === 'uno') {
        nuevasCant[p.id] = 1;
      } else if (modo === 'stock') {
        nuevasCant[p.id] = Math.max(1, parseInt(p.stock) || 1);
      }
    });
    setCantidades(nuevasCant);
  };

  const setCantidadProducto = (id, valor) => {
    const num = Math.max(0, parseInt(valor) || 0);
    setCantidades(prev => ({ ...prev, [id]: num }));
  };

  // Imprimir etiquetas
  const handlePrint = () => {
    // Recolectar lista plana de etiquetas a imprimir según cantidades
    const listaEtiquetas = [];
    productos.forEach(p => {
      if (seleccionados[p.id]) {
        const qty = parseInt(cantidades[p.id]) || 0;
        for (let i = 0; i < qty; i++) {
          listaEtiquetas.push(p);
        }
      }
    });

    if (listaEtiquetas.length === 0) {
      toast.error('Seleccione al menos un producto con cantidad mayor a cero.');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();

    const isRollo = tipoPapel === 'rollo';

    // Generar HTML de cada etiqueta
    const etiquetasHtml = listaEtiquetas.map((prod) => {
      const precioFormatted = Number(prod.precio_usd || 0).toFixed(2);
      const codigoSku = prod.sku || '000000';

      return `
        <div class="barcode-label ${isRollo ? 'barcode-label--rollo' : 'barcode-label--hoja'}">
          ${incluirEmpresa ? `<div class="label-company">${empresa.nombre || 'ARLUC'}</div>` : ''}
          <div class="label-product-name">${prod.nombre || 'PRODUCTO'}</div>
          <div class="label-barcode-container">
            <svg class="barcode-svg" data-sku="${codigoSku}"></svg>
          </div>
          <div class="label-price-row">
            <span class="label-currency">$</span>
            <span class="label-price-value">${precioFormatted}</span>
          </div>
        </div>
      `;
    }).join('');

    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Imprimir Códigos de Barra - ARLUC</title>
          <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
          <style>
            @page {
              margin: ${isRollo ? '0' : '8mm'};
              size: ${isRollo ? `${medida.width} ${medida.height}` : 'auto'};
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            body {
              margin: 0;
              padding: 0;
              background: #fff;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #000;
            }
            ${isRollo ? `
              .labels-wrapper {
                margin: 0;
                padding: 0;
              }
              .barcode-label--rollo {
                width: ${medida.width};
                height: ${medida.height};
                max-width: ${medida.width};
                max-height: ${medida.height};
                padding: 1.5mm 2mm;
                page-break-after: always;
                page-break-inside: avoid;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                align-items: center;
                overflow: hidden;
                box-sizing: border-box;
                text-align: center;
              }
            ` : `
              .labels-wrapper {
                display: flex;
                flex-wrap: wrap;
                gap: 3mm;
                padding: 2mm;
              }
              .barcode-label--hoja {
                width: ${medida.width};
                height: ${medida.height};
                border: 1px dashed #ccc;
                padding: 1.5mm 2mm;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                align-items: center;
                overflow: hidden;
                box-sizing: border-box;
                text-align: center;
                page-break-inside: avoid;
              }
            `}
            .label-company {
              font-size: 7pt;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              line-height: 1;
              color: #333;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              width: 100%;
            }
            .label-product-name {
              font-size: 7.5pt;
              font-weight: 800;
              line-height: 1.15;
              text-transform: uppercase;
              color: #000;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
              width: 100%;
              margin: 1px 0;
            }
            .label-barcode-container {
              width: 100%;
              display: flex;
              justify-content: center;
              align-items: center;
              margin: 0 auto;
            }
            .label-barcode-container svg {
              max-width: 95%;
              height: auto;
            }
            .label-price-row {
              display: flex;
              align-items: baseline;
              justify-content: center;
              gap: 2px;
              line-height: 1;
              margin-top: 1px;
            }
            .label-currency {
              font-size: 10pt;
              font-weight: 800;
            }
            .label-price-value {
              font-size: 15pt;
              font-weight: 900;
              letter-spacing: -0.5px;
            }
          </style>
        </head>
        <body>
          <div class="labels-wrapper">
            ${etiquetasHtml}
          </div>
          <script>
            window.onload = function() {
              const svgs = document.querySelectorAll('.barcode-svg');
              svgs.forEach(svg => {
                const sku = svg.getAttribute('data-sku') || '000000';
                try {
                  JsBarcode(svg, sku, {
                    format: 'CODE128',
                    width: ${medida.barWidth},
                    height: ${medida.barHeight},
                    displayValue: true,
                    fontSize: ${medida.fontSize},
                    font: 'monospace',
                    textMargin: 1,
                    margin: 0,
                    lineColor: '#000'
                  });
                } catch(e) {
                  console.error(e);
                }
              });
              setTimeout(function() {
                window.focus();
                window.print();
              }, 300);
            };
          </script>
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        // Ignored
      }
    }, 4000);
  };

  return (
    <div className="ticket-overlay" style={{ zIndex: 1000 }}>
      <div
        className="card"
        style={{
          width: '95%',
          maxWidth: '1050px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          backgroundColor: '#1e2029',
          color: '#fff',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255,255,255,0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.15)',
                color: '#60a5fa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
              }}
            >
              <HiOutlineTag />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', margin: 0 }}>
                Imprimir Códigos de Barra
              </h2>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
                Etiquetas tipo góndola / estantería con código Code128 y precio en USD
              </p>
            </div>
          </div>
          <button
            className="btn btn--ghost btn--xs"
            onClick={onClose}
            style={{ color: '#94a3b8', fontSize: '1.2rem', padding: '6px' }}
          >
            <HiOutlineXMark />
          </button>
        </div>

        {/* Content Body: Two columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 0.8fr',
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {/* Left Column: Product selection and settings */}
          <div
            style={{
              padding: '16px 20px',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              overflowY: 'auto',
            }}
          >
            {/* Options Bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                background: 'rgba(0,0,0,0.2)',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                  Tamaño de Etiqueta:
                </label>
                <select
                  value={medidaSeleccionada}
                  onChange={e => setMedidaSeleccionada(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: '#13151b',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: '0.85rem',
                  }}
                >
                  {Object.entries(MEDIDAS_ETIQUETA).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                  Modo de Impresora:
                </label>
                <select
                  value={tipoPapel}
                  onChange={e => setTipoPapel(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: '#13151b',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="rollo">Rollo Térmico Adhesivo (1 por etiqueta)</option>
                  <option value="hoja">Hojas Adhesivas (Carta / A4)</option>
                </select>
              </div>

              <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                <input
                  type="checkbox"
                  id="chk-empresa"
                  checked={incluirEmpresa}
                  onChange={e => setIncluirEmpresa(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="chk-empresa" style={{ fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  Mostrar nombre de la empresa ({empresa.nombre}) en el encabezado
                </label>
              </div>
            </div>

            {/* Quick Actions & Search */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="search-box" style={{ flex: 1, margin: 0 }}>
                  <HiOutlineMagnifyingGlass className="search-box__icon" />
                  <input
                    type="text"
                    placeholder="Filtrar por nombre o SKU..."
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs"
                    onClick={() => toggleSeleccionarTodos(true)}
                    style={{ fontSize: '0.75rem' }}
                  >
                    Marcar Todos
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs"
                    onClick={() => toggleSeleccionarTodos(false)}
                    style={{ fontSize: '0.75rem' }}
                  >
                    Desmarcar
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs"
                    onClick={() => aplicarCopiasATodos('uno')}
                    style={{ fontSize: '0.75rem' }}
                    title="Establecer 1 etiqueta para cada producto"
                  >
                    1 copia c/u
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs"
                    onClick={() => aplicarCopiasATodos('stock')}
                    style={{ fontSize: '0.75rem' }}
                    title="Establecer cantidad de etiquetas igual al stock del producto"
                  >
                    Según Stock
                  </button>
                </div>
              </div>
            </div>

            {/* Products Table */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '6px',
                background: '#13151b',
                maxHeight: '340px',
              }}
            >
              <table className="table" style={{ fontSize: '0.8rem', width: '100%' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th style={{ width: '36px', textAlign: 'center' }}></th>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th>Precio</th>
                    <th style={{ width: '90px', textAlign: 'center' }}>Copias</th>
                  </tr>
                </thead>
                <tbody>
                  {productosFiltrados.map(p => {
                    const isChecked = !!seleccionados[p.id];
                    const cant = cantidades[p.id] ?? 1;

                    return (
                      <tr
                        key={p.id}
                        style={{
                          background: isChecked ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                        }}
                      >
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => setSeleccionados(prev => ({ ...prev, [p.id]: e.target.checked }))}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td>
                          <div style={{ fontWeight: 'bold', color: isChecked ? '#fff' : '#94a3b8' }}>
                            {p.nombre}
                          </div>
                        </td>
                        <td>
                          <code style={{ fontSize: '0.75rem' }}>{p.sku}</code>
                        </td>
                        <td style={{ fontWeight: 'bold', color: '#10b981' }}>
                          ${Number(p.precio_usd || 0).toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max="999"
                            value={cant}
                            disabled={!isChecked}
                            onChange={e => setCantidadProducto(p.id, e.target.value)}
                            style={{
                              width: '60px',
                              padding: '2px 4px',
                              textAlign: 'center',
                              borderRadius: '4px',
                              border: '1px solid rgba(255,255,255,0.2)',
                              background: isChecked ? '#1e2029' : 'rgba(255,255,255,0.05)',
                              color: '#fff',
                              fontSize: '0.8rem',
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Live Label Preview & Actions */}
          <div
            style={{
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(0,0,0,0.15)',
            }}
          >
            <div style={{ width: '100%', textAlign: 'center' }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                  letterSpacing: '1px',
                }}
              >
                Vista Previa de Etiqueta
              </span>
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '2px 0 16px 0' }}>
                Formato {medida.label}
              </p>

              {/* Physical Label Mockup */}
              <div
                style={{
                  background: '#ffffff',
                  color: '#000000',
                  width: '240px',
                  height: '144px',
                  borderRadius: '4px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.1)',
                  margin: '0 auto',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* Header: Company */}
                {incluirEmpresa && (
                  <div
                    style={{
                      fontSize: '8px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: '#444',
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      width: '100%',
                      textAlign: 'center',
                    }}
                  >
                    {empresa.nombre || 'ARLUC STORE'}
                  </div>
                )}

                {/* Product Name */}
                <div
                  style={{
                    fontSize: '9.5px',
                    fontWeight: 800,
                    lineHeight: 1.15,
                    textTransform: 'uppercase',
                    color: '#000',
                    textAlign: 'center',
                    width: '100%',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {productoPreview ? productoPreview.nombre : 'NOMBRE DEL PRODUCTO'}
                </div>

                {/* Barcode Vector */}
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    margin: '2px 0',
                  }}
                >
                  <BarcodeSvg
                    value={productoPreview ? productoPreview.sku : 'ARLUC-0001'}
                    width={medida.barWidth}
                    height={medida.barHeight}
                    fontSize={medida.fontSize}
                  />
                </div>

                {/* Price Display (Highlighted shelf style) */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'center',
                    gap: '2px',
                    lineHeight: 1,
                    width: '100%',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#000' }}>$</span>
                  <span style={{ fontSize: '20px', fontWeight: 900, color: '#000', letterSpacing: '-0.5px' }}>
                    {productoPreview ? Number(productoPreview.precio_usd || 0).toFixed(2) : '0.00'}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: '14px', fontSize: '0.8rem', color: '#94a3b8' }}>
                Total a imprimir:{' '}
                <strong style={{ color: '#60a5fa', fontSize: '1.05rem' }}>{totalEtiquetas}</strong> etiquetas
              </div>
            </div>

            {/* Bottom Actions */}
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '20px',
              }}
            >
              <button
                type="button"
                className="btn btn--primary"
                onClick={handlePrint}
                disabled={totalEtiquetas === 0}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  padding: '12px',
                  fontSize: '0.95rem',
                  fontWeight: 'bold',
                }}
              >
                <HiOutlinePrinter style={{ fontSize: '1.2rem' }} />
                Imprimir {totalEtiquetas} {totalEtiquetas === 1 ? 'Etiqueta' : 'Etiquetas'}
              </button>

              <button
                type="button"
                className="btn btn--ghost"
                onClick={onClose}
                style={{ width: '100%', justifyContent: 'center', color: '#94a3b8' }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
