/**
 * Mensajes de error para el usuario. Las reglas de negocio de la BD ya lanzan
 * mensajes en español; esto traduce los errores técnicos de PostgreSQL/PostgREST.
 */
export function mensajeError(error, respaldo = 'No se pudo completar la operación') {
  if (!error) return respaldo;
  const texto = String(error.message || error || '');
  if (error.code === '42501' || /row-level security|permission denied/i.test(texto)) return 'No tiene permiso para realizar esta acción.';
  if (error.code === '23505' || /duplicate key/i.test(texto)) return 'Ya existe un registro con esos datos.';
  if (error.code === '23503' || /foreign key/i.test(texto)) return 'No se puede completar: el registro está relacionado con otros documentos.';
  if (error.code === '23514' || /violates check constraint/i.test(texto)) return 'Algún dato no cumple las reglas del sistema. Revise los valores.';
  if (/Failed to fetch|NetworkError|network/i.test(texto)) return 'Sin conexión con el servidor. Revise su internet e intente de nuevo.';
  return texto || respaldo;
}

/**
 * Un UPDATE o DELETE que RLS rechaza no devuelve error: afecta 0 filas.
 * Úsese con .select('id') y pase el `data` devuelto.
 */
export function exigirFilas(data, mensaje = 'No tiene permiso para modificar este registro o ya no existe.') {
  if (!Array.isArray(data) || data.length === 0) throw new Error(mensaje);
  return data;
}
