import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getEmpresaConfig, saveEmpresaConfig, DEFAULT_EMPRESA } from '../utils/constants';
import { useTheme } from '../contexts/ThemeContext';
import toast from 'react-hot-toast';
import { useDialogo } from '../components/common/DialogoProvider';
import { CampoDocumento, CampoTelefono, CODIGOS_CELULAR, CODIGOS_FIJOS } from '../components/common/CamposVenezuela';
import { tieneTexto, normalizarDocumento, validarDocumento, normalizarTelefono, validarTelefono } from '../utils/validaciones';
import { useAuth } from '../contexts/AuthContext';
import { puede } from '../utils/permisos';
import { mensajeError, exigirFilas } from '../utils/errores';
import {
  HiOutlineBuildingOffice2,
  HiOutlineIdentification,
  HiOutlineMapPin,
  HiOutlinePhone,
  HiOutlineSparkles,
  HiOutlineArrowPath,
  HiOutlineCheck,
  HiOutlineSun,
  HiOutlineMoon,
  HiOutlinePaintBrush,
} from 'react-icons/hi2';

export default function Configuracion() {
  const { confirmar } = useDialogo();
  const { theme, setTheme } = useTheme();
  const { profile } = useAuth();
  // Razón social y RIF solo los cambia el administrador (la BD lo valida)
  const puedeFiscal = puede(profile?.rol, 'empresa.fiscal');
  const [config, setConfig] = useState(() => getEmpresaConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errores, setErrores] = useState({});

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('configuracion_empresa')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();

      if (data && !error) {
        const dbConfig = {
          nombre: data.nombre ?? DEFAULT_EMPRESA.nombre,
          rif: data.rif ?? DEFAULT_EMPRESA.rif,
          direccion: data.direccion ?? DEFAULT_EMPRESA.direccion,
          telefono: data.telefono ?? DEFAULT_EMPRESA.telefono,
          logo: data.logo || DEFAULT_EMPRESA.logo,
          slogan: data.slogan ?? DEFAULT_EMPRESA.slogan,
        };
        setConfig(dbConfig);
        saveEmpresaConfig(dbConfig);
      } else {
        setConfig(getEmpresaConfig());
      }
    } catch (e) {
      console.error('Error cargando configuración desde Supabase:', e);
      setConfig(getEmpresaConfig());
    } finally {
      setLoading(false);
    }
  }

  function handleChange(field, value) {
    setConfig(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (!tieneTexto(config.nombre)) errs.nombre = 'La razón social es obligatoria';
    const errRif = validarDocumento(config.rif, { soloRif: true });
    if (errRif) errs.rif = errRif;
    if (!tieneTexto(config.direccion)) errs.direccion = 'La dirección fiscal es obligatoria';
    const errTel = validarTelefono(config.telefono);
    if (errTel) errs.telefono = errTel;
    setErrores(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const payload = {
        nombre: config.nombre.trim().replace(/\s+/g, ' '),
        rif: normalizarDocumento(config.rif),
        direccion: config.direccion.trim(),
        telefono: tieneTexto(config.telefono) ? normalizarTelefono(config.telefono) : '',
        logo: config.logo || DEFAULT_EMPRESA.logo,
        slogan: (config.slogan || '').trim(),
      };

      // Sin permiso fiscal no se envían razón social ni RIF (el trigger los rechaza)
      const { nombre: _nombre, rif: _rif, ...noFiscales } = payload;
      const cambios = puedeFiscal ? payload : noFiscales;

      // Guardar primero en la BD; el caché local solo se actualiza si la BD confirma.
      // update (no upsert): el upsert exige permiso de INSERT, que solo tiene el administrador.
      const { data, error } = await supabase
        .from('configuracion_empresa')
        .update(cambios)
        .eq('id', 'default')
        .select('id');

      if (error) throw error;
      exigirFilas(data, 'La base de datos no confirmó el cambio (¿permisos insuficientes?).');

      saveEmpresaConfig(payload);
      setConfig(payload);
      toast.success('Configuración de empresa guardada con éxito');
    } catch (error) {
      console.error('Error guardando configuración:', error);
      toast.error('Error al guardar configuración: ' + mensajeError(error, 'Error de conexión'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    // No escribe nada en la BD: descarta los cambios del formulario y vuelve a los datos guardados
    if (!(await confirmar({
      titulo: 'Restablecer datos',
      mensaje: '¿Descartar los cambios no guardados y volver a los datos registrados en la base de datos?',
      textoConfirmar: 'Restablecer',
    }))) return;
    setErrores({});
    await loadConfig();
    toast.success('Se restablecieron los datos guardados');
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Configuración del Sistema</h1>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Card de Apariencia y Colores */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              backgroundColor: 'var(--primary-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
              fontSize: '1.25rem'
            }}>
              <HiOutlinePaintBrush />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 600 }}>Apariencia y Colores del Sistema</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Seleccione el tema visual de la aplicación.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            {/* Opción Tema Claro */}
            <div
              onClick={() => setTheme('light')}
              style={{
                border: theme === 'light' ? '2px solid #16A34A' : '1px solid var(--border)',
                borderRadius: '12px',
                padding: '1.25rem',
                cursor: 'pointer',
                background: theme === 'light' ? 'rgba(22, 163, 74, 0.08)' : 'var(--bg-elevated)',
                transition: 'all 0.2s ease',
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <HiOutlineSun style={{ color: '#F59E0B', fontSize: '1.3rem' }} />
                  Tema Claro
                </div>
                {theme === 'light' && (
                  <span className="badge badge--success" style={{ gap: '0.2rem' }}>
                    <HiOutlineCheck /> Activo
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Colores principales: <strong>Verde Esmeralda</strong> y <strong>Blanco Puro</strong>.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#16A34A', border: '1px solid #fff', display: 'inline-block' }} title="Verde" />
                <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#FFFFFF', border: '1px solid #CBD5E1', display: 'inline-block' }} title="Blanco" />
                <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'inline-block' }} title="Fondo claro" />
              </div>
            </div>

            {/* Opción Tema Oscuro */}
            <div
              onClick={() => setTheme('dark')}
              style={{
                border: theme === 'dark' ? '2px solid #22C55E' : '1px solid var(--border)',
                borderRadius: '12px',
                padding: '1.25rem',
                cursor: 'pointer',
                background: theme === 'dark' ? 'rgba(34, 197, 94, 0.12)' : 'var(--bg-elevated)',
                transition: 'all 0.2s ease',
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <HiOutlineMoon style={{ color: '#22C55E', fontSize: '1.3rem' }} />
                  Tema Oscuro
                </div>
                {theme === 'dark' && (
                  <span className="badge badge--success" style={{ gap: '0.2rem' }}>
                    <HiOutlineCheck /> Activo
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Colores principales: <strong>Verde Vibrante</strong> y <strong>Negro Grisáceo</strong>.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#22C55E', border: '1px solid #181C22', display: 'inline-block' }} title="Verde" />
                <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#121519', border: '1px solid #333', display: 'inline-block' }} title="Negro Grisáceo" />
                <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#181C22', border: '1px solid #333', display: 'inline-block' }} title="Superficie Grisácea" />
              </div>
            </div>
          </div>
        </div>

        {/* Card de Datos Fiscales */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              backgroundColor: 'var(--primary-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
              fontSize: '1.25rem'
            }}>
              <HiOutlineBuildingOffice2 />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 600 }}>Datos Fiscales y de Facturación</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Esta información aparecerá en el encabezado y pie de página de los tickets de venta y facturas emitidas.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="modal__form" style={{ padding: 0 }}>
            <div className="form-row">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <HiOutlineBuildingOffice2 /> Razón Social / Nombre Comercial
                </label>
                <input
                  type="text"
                  value={config.nombre || ''}
                  onChange={e => handleChange('nombre', e.target.value)}
                  placeholder="Ej. COMERCIALIZADORA ARLUC C.A."
                  required
                  disabled={!puedeFiscal}
                />
                {errores.nombre && <small style={{ color: '#ef4444' }}>{errores.nombre}</small>}
                {!puedeFiscal && <small style={{ color: 'var(--text-secondary)' }}>Solo el administrador cambia la razón social.</small>}
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <HiOutlineIdentification /> RIF / Identificación Fiscal
                </label>
                {/* fieldset deshabilita los controles internos del campo de RIF */}
                <fieldset disabled={!puedeFiscal} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <CampoDocumento
                    value={config.rif || ''}
                    onChange={(v) => handleChange('rif', v)}
                    letras={['J', 'G']}
                    placeholder="50123456-7"
                    required
                  />
                </fieldset>
                {errores.rif && <small style={{ color: '#ef4444' }}>{errores.rif}</small>}
                {!puedeFiscal && <small style={{ color: 'var(--text-secondary)' }}>Solo el administrador cambia el RIF.</small>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <HiOutlineMapPin /> Dirección Fiscal
                </label>
                <input
                  type="text"
                  value={config.direccion || ''}
                  onChange={e => handleChange('direccion', e.target.value)}
                  placeholder="Ej. Caracas, Venezuela"
                  required
                />
                {errores.direccion && <small style={{ color: '#ef4444' }}>{errores.direccion}</small>}
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <HiOutlinePhone /> Teléfono de Contacto
                </label>
                <CampoTelefono
                  value={config.telefono || ''}
                  onChange={(v) => handleChange('telefono', v)}
                  codigos={[...CODIGOS_FIJOS, ...CODIGOS_CELULAR]}
                />
                {errores.telefono && <small style={{ color: '#ef4444' }}>{errores.telefono}</small>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <HiOutlineSparkles /> Slogan / Mensaje de Despedida
                </label>
                <input
                  type="text"
                  value={config.slogan || ''}
                  onChange={e => handleChange('slogan', e.target.value)}
                  placeholder="Ej. ¡Gracias por su compra!"
                />
              </div>
            </div>

            {/* Preview Box */}
            <div style={{
              background: 'var(--bg-elevated)',
              border: '1px dashed var(--border)',
              borderRadius: '8px',
              padding: '1.25rem',
              margin: '1rem 0'
            }}>
              <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 600 }}>
                Vista previa en Ticket
              </span>
              <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
                <strong style={{ fontSize: '1rem', display: 'block', color: 'var(--text-primary)' }}>{config.nombre || 'Nombre de Empresa'}</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>RIF: {config.rif || '(sin RIF)'}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>{config.direccion || 'Dirección'}</span>
                {config.telefono && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>Tlf: {config.telefono}</span>}
                <div style={{ borderTop: '1px dashed var(--border)', margin: '0.75rem 0' }}></div>
                <span style={{ fontSize: '0.8rem', fontStyle: 'italic', color: 'var(--text-secondary)' }}>{config.slogan}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleReset}
                disabled={saving}
              >
                <HiOutlineArrowPath /> Restablecer
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={saving}
              >
                <HiOutlineCheck /> {saving ? 'Guardando...' : 'Guardar Configuración'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
