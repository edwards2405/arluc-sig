import { supabase } from '../lib/supabase';

/**
 * Servicio para consultar la API del Banco Central de Venezuela
 * Repositorio: https://github.com/Chitty400/chitty-bcv-api
 * Endpoint público estático actualizado automáticamente vía GitHub Actions
 */

const BCV_API_URL = 'https://chitty400.github.io/chitty-bcv-api/latest.json';

export async function fetchTasaBCV() {
  try {
    const res = await fetch(BCV_API_URL, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Error en la API BCV: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const rawUsd = data.tasas?.usd || data.tasa_bcv || 0;
    const rawEur = data.tasas?.eur || 0;
    return {
      tasa_usd: rawUsd ? parseFloat(Number(rawUsd).toFixed(2)) : 0,
      tasa_eur: rawEur ? parseFloat(Number(rawEur).toFixed(2)) : 0,
      updated_at: data.updated_at,
      ipc: data.ipc || null,
      raw: data,
    };
  } catch (error) {
    console.error('Error fetching BCV rate:', error);
    throw error;
  }
}

/**
 * Pide al servidor sincronizar la tasa oficial. El servidor consulta la API,
 * valida la variación y registra la tasa; el navegador no envía montos.
 * Notifica a las pantallas abiertas (POS, Tasa de Cambio) con un evento.
 */
export async function sincronizarTasaBCV() {
  const { data, error } = await supabase.rpc('sincronizar_tasa_bcv');
  if (error) throw error;
  if (data?.estado !== 'RECIENTE' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arluc_tasa_actualizada', { detail: data }));
  }
  return data;
}
