/**
 * Adaptador con la misma interfaz que usan los reportes de SheetJS
 * (book_new, json_to_sheet, book_append_sheet, writeFile), pero que genera el
 * Excel con formato del motor común (utils/reportes.js) o lo imprime.
 * Permite dar formato a reportes de varias hojas sin reescribir su lógica.
 */
import { exportarExcel, imprimirReporte, columnasDesdeFilas } from './reportes';

let modo = 'excel';

/** Ejecuta una función que arma y "guarda" un libro, pero lo envía a imprimir. */
export function imprimirCon(fn) {
  modo = 'imprimir';
  try {
    fn();
  } finally {
    modo = 'excel';
  }
}

const tituloDesdeArchivo = (archivo) => archivo
  .replace(/\.xlsx$/i, '')
  .replace(/_ARLUC/gi, '')
  .replace(/_/g, ' ')
  .replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1')
  .trim();

function aReporte(libro, archivo) {
  const titulo = tituloDesdeArchivo(archivo);
  return {
    titulo,
    archivo: archivo.replace(/\.xlsx$/i, ''),
    hojas: libro.hojas.map((h) => {
      const filas = h.filas.map((f) => {
        const primero = Object.values(f)[0];
        return typeof primero === 'string' && /^(total|totales)\b/i.test(primero) ? { ...f, _estilo: 'total' } : f;
      });
      return { nombre: h.nombre, titulo: `${titulo} · ${h.nombre}`, secciones: [{ columnas: columnasDesdeFilas(filas), filas }] };
    }),
  };
}

export const XLSX = {
  utils: {
    book_new: () => ({ hojas: [] }),
    json_to_sheet: (filas) => ({ filas: filas.length ? filas : [{ Aviso: 'Sin datos para el período' }] }),
    book_append_sheet: (libro, hoja, nombre) => {
      libro.hojas.push({ nombre, filas: hoja.filas });
    },
  },
  writeFile: (libro, archivo) => {
    const reporte = aReporte(libro, archivo);
    if (modo === 'imprimir') {
      imprimirReporte(reporte);
      return;
    }
    exportarExcel(reporte).catch((e) => console.error('Error generando Excel:', e));
  },
};
