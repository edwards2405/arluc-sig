import { useState } from 'react';
import { normalizarDocumento } from '../../utils/validaciones';

/**
 * Campos con selector para datos venezolanos. Ambos entregan el valor completo
 * ya normalizado ("V-12345678", "J-12345678-9", "0414-1234567"), el mismo
 * formato que valida utils/validaciones.js y la base de datos.
 */

const LETRAS = [
  { valor: 'V', titulo: 'Venezolano' },
  { valor: 'E', titulo: 'Extranjero' },
  { valor: 'J', titulo: 'Jurídico' },
  { valor: 'G', titulo: 'Gobierno' },
  { valor: 'P', titulo: 'Pasaporte' },
];

export const CODIGOS_CELULAR = ['0412', '0414', '0416', '0422', '0424', '0426'];
export const CODIGOS_FIJOS = ['0212', '0251'];

const estiloFila = { display: 'flex', gap: '0.5rem', alignItems: 'stretch' };

/** Cédula o RIF: letra en un selector y el número aparte. */
export function CampoDocumento({ value, onChange, letras = LETRAS.map((l) => l.valor), placeholder, required, id }) {
  const m = String(value ?? '').toUpperCase().match(/^([VEJGP])-?(.*)$/);
  // La letra elegida se recuerda aunque el número aún esté vacío
  const [letraVacia, setLetraVacia] = useState(letras[0]);
  const letra = m ? m[1] : letraVacia;
  const numero = m ? m[2] : '';

  const emitir = (nuevaLetra, nuevoNumero) => {
    setLetraVacia(nuevaLetra);
    const digitos = nuevoNumero.replace(/\D/g, '').slice(0, 9);
    onChange(digitos ? normalizarDocumento(`${nuevaLetra}${digitos}`) : '');
  };

  return (
    <div style={estiloFila}>
      <select aria-label="Tipo de documento" value={letra} onChange={(e) => emitir(e.target.value, numero)}
        style={{ width: '4.75rem', flex: 'none' }}>
        {LETRAS.filter((l) => letras.includes(l.valor)).map((l) => (
          <option key={l.valor} value={l.valor} title={l.titulo}>{l.valor}</option>
        ))}
      </select>
      <input id={id} inputMode="numeric" value={numero} required={required}
        placeholder={placeholder || (letra === 'J' || letra === 'G' ? '12345678-9' : '12345678')}
        onChange={(e) => emitir(letra, e.target.value)} style={{ flex: 1, minWidth: 0 }} />
    </div>
  );
}

/** Teléfono: código de operadora o de área en un selector y los 7 dígitos aparte. */
export function CampoTelefono({ value, onChange, codigos = CODIGOS_CELULAR, id }) {
  const m = String(value ?? '').replace(/\s/g, '').match(/^(0\d{3})-?(.*)$/);
  const [codigoVacio, setCodigoVacio] = useState(codigos[0]);
  // Un número guardado con otro código (p. ej. un fijo) sigue apareciendo como opción
  const opciones = m && !codigos.includes(m[1]) ? [...codigos, m[1]] : codigos;
  const codigo = m ? m[1] : codigoVacio;
  const numero = m ? m[2].replace(/\D/g, '') : '';

  const emitir = (nuevoCodigo, nuevoNumero) => {
    setCodigoVacio(nuevoCodigo);
    const digitos = nuevoNumero.replace(/\D/g, '').slice(0, 7);
    onChange(digitos ? `${nuevoCodigo}-${digitos}` : '');
  };

  return (
    <div style={estiloFila}>
      <select aria-label="Código de teléfono" value={codigo} onChange={(e) => emitir(e.target.value, numero)}
        style={{ width: '6rem', flex: 'none' }}>
        {opciones.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input id={id} inputMode="numeric" value={numero} placeholder="1234567" maxLength={7}
        onChange={(e) => emitir(codigo, e.target.value)} style={{ flex: 1, minWidth: 0 }} />
    </div>
  );
}
