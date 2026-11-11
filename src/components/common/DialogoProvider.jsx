import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { HiOutlineExclamationTriangle, HiOutlineXCircle, HiOutlineQuestionMarkCircle } from 'react-icons/hi2';

/**
 * Diálogos propios del sistema en lugar de window.confirm / window.prompt.
 *   const { confirmar, pedirTexto, pedirDatos } = useDialogo();
 *   if (!(await confirmar({ titulo, mensaje }))) return;
 *   const motivo = await pedirTexto({ titulo, etiqueta: 'Motivo', minimo: 10 });   // null si cancela
 *   const datos = await pedirDatos({ titulo, campos: [{ clave, etiqueta, minimo }] }); // objeto o null
 */
const DialogoContext = createContext(null);

const COLORES = {
  danger: { borde: '#ef4444', fondo: 'rgba(239, 68, 68, 0.15)', Icono: HiOutlineXCircle },
  warning: { borde: '#f59e0b', fondo: 'rgba(245, 158, 11, 0.15)', Icono: HiOutlineExclamationTriangle },
  primary: { borde: 'var(--primary)', fondo: 'var(--primary-bg)', Icono: HiOutlineQuestionMarkCircle },
};

function validarCampo(campo, valor) {
  const texto = String(valor ?? '').trim();
  if (campo.opcional && !texto) return null;
  if (!texto) return `${campo.etiqueta} es obligatorio`;
  if (campo.minimo && texto.length < campo.minimo) return `${campo.etiqueta}: mínimo ${campo.minimo} caracteres`;
  if (campo.tipo === 'number') {
    const n = Number(texto.replace(',', '.'));
    if (!Number.isFinite(n)) return `${campo.etiqueta} debe ser un número`;
    if (campo.min !== undefined && n < campo.min) return `${campo.etiqueta} debe ser mayor o igual a ${campo.min}`;
    if (campo.mayorQue !== undefined && n <= campo.mayorQue) return `${campo.etiqueta} debe ser mayor que ${campo.mayorQue}`;
  }
  if (campo.patron && !campo.patron.test(texto)) return campo.mensajePatron || `${campo.etiqueta} no tiene un formato válido`;
  return null;
}

function Dialogo({ dialogo, cerrar }) {
  const { titulo, mensaje, campos = [], variante = 'primary', textoConfirmar = 'Aceptar', textoCancelar = 'Cancelar' } = dialogo;
  const [valores, setValores] = useState(() => Object.fromEntries(campos.map((c) => [c.clave, c.inicial ?? ''])));
  const [errores, setErrores] = useState({});
  const primero = useRef(null);
  const { borde, fondo, Icono } = COLORES[variante] || COLORES.primary;

  useEffect(() => {
    primero.current?.focus();
    const alPresionar = (e) => { if (e.key === 'Escape') cerrar(null); };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [cerrar]);

  function aceptar(e) {
    e.preventDefault();
    const nuevos = {};
    for (const c of campos) {
      const error = validarCampo(c, valores[c.clave]);
      if (error) nuevos[c.clave] = error;
    }
    setErrores(nuevos);
    if (Object.keys(nuevos).length) return;
    if (!campos.length) { cerrar(true); return; }
    cerrar(Object.fromEntries(campos.map((c) => {
      const texto = String(valores[c.clave] ?? '').trim();
      return [c.clave, c.tipo === 'number' && texto ? Number(texto.replace(',', '.')) : texto];
    })));
  }

  return (
    <div className="modal-overlay" onClick={() => cerrar(null)} style={{ zIndex: 500 }}>
      <form className="modal modal--sm" onClick={(e) => e.stopPropagation()} onSubmit={aceptar} style={{ borderTop: `4px solid ${borde}` }}>
        <div className="modal__header" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: fondo, color: borde, fontSize: '1.3rem', flexShrink: 0 }}>
              <Icono />
            </div>
            <h2 style={{ fontSize: '1.1rem', margin: 0, lineHeight: 1.3 }}>{titulo}</h2>
          </div>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {mensaje && <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{mensaje}</div>}
          {campos.map((c, i) => (
            <div key={c.clave} className="form-group" style={{ margin: 0 }}>
              <label htmlFor={`dialogo-${c.clave}`}>{c.etiqueta}{!c.opcional && ' *'}</label>
              {c.multilinea ? (
                <textarea id={`dialogo-${c.clave}`} ref={i === 0 ? primero : undefined} rows={3} value={valores[c.clave]}
                  placeholder={c.placeholder} maxLength={c.maximo}
                  onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })} />
              ) : (
                <input id={`dialogo-${c.clave}`} ref={i === 0 ? primero : undefined} type="text"
                  inputMode={c.tipo === 'number' ? 'decimal' : undefined} value={valores[c.clave]} placeholder={c.placeholder}
                  maxLength={c.maximo} onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })} />
              )}
              {errores[c.clave]
                ? <small style={{ color: '#ef4444' }}>{errores[c.clave]}</small>
                : c.ayuda && <small style={{ color: 'var(--text-secondary)' }}>{c.ayuda}</small>}
            </div>
          ))}
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button type="button" className="btn btn--ghost" onClick={() => cerrar(null)}>{textoCancelar}</button>
          <button type="submit" className={`btn ${variante === 'danger' ? 'btn--danger' : 'btn--primary'}`}
            ref={campos.length ? undefined : primero}
            style={variante === 'danger' ? { background: '#ef4444', borderColor: '#ef4444', color: '#fff' } : undefined}>
            {textoConfirmar}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DialogoProvider({ children }) {
  const [dialogo, setDialogo] = useState(null);

  const abrir = useCallback((config) => new Promise((resolver) => setDialogo({ ...config, resolver })), []);

  const cerrar = useCallback((resultado) => {
    setDialogo((actual) => {
      actual?.resolver(actual.campos?.length ? resultado : resultado === true);
      return null;
    });
  }, []);

  const confirmar = useCallback((config) => abrir({ variante: 'warning', ...config, campos: [] }), [abrir]);
  const pedirDatos = useCallback((config) => abrir(config), [abrir]);
  const pedirTexto = useCallback(async ({ etiqueta = 'Valor', minimo, maximo, multilinea, placeholder, ayuda, inicial, tipo, min, mayorQue, ...config }) => {
    const datos = await abrir({ ...config, campos: [{ clave: 'valor', etiqueta, minimo, maximo, multilinea, placeholder, ayuda, inicial, tipo, min, mayorQue }] });
    return datos ? datos.valor : null;
  }, [abrir]);

  return (
    <DialogoContext.Provider value={{ confirmar, pedirTexto, pedirDatos }}>
      {children}
      {dialogo && <Dialogo key={dialogo.titulo} dialogo={dialogo} cerrar={cerrar} />}
    </DialogoContext.Provider>
  );
}

export function useDialogo() {
  return useContext(DialogoContext);
}
