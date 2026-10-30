import { useState } from 'react';

/**
 * Paginación en el cliente para listas largas. Devuelve la página visible y
 * las props listas para <Pagination />. Vuelve a la página 1 cuando cambia
 * el número de elementos (por ejemplo, al aplicar un filtro).
 */
export default function usePaginacion(items, tamano = 20) {
  const lista = items || [];
  const total = lista.length;
  const [pagina, setPagina] = useState(1);
  const [totalPrevio, setTotalPrevio] = useState(total);
  if (total !== totalPrevio) {
    setTotalPrevio(total);
    setPagina(1);
  }
  const paginas = Math.max(1, Math.ceil(total / tamano));
  const actual = Math.min(pagina, paginas);
  return {
    visibles: lista.slice((actual - 1) * tamano, actual * tamano),
    desde: (actual - 1) * tamano,
    paginacion: { currentPage: actual, totalItems: total, pageSize: tamano, onPageChange: setPagina },
  };
}
