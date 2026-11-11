import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import Sidebar from './Sidebar';
import ThemeToggle from '../common/ThemeToggle';
import { HiOutlineBars3 } from 'react-icons/hi2';
import { sincronizarTasaBCV } from '../../services/bcvService';
import { supabase } from '../../lib/supabase';
import { getTasaPantalla, setTasaPantalla } from '../../utils/formatters';
import { useAuth } from '../../contexts/AuthContext';
import { mensajeError } from '../../utils/errores';
import { navegacionParaRol } from './sidebar/sidebarConfig';

const TITULO_SISTEMA = 'ARLUC';

/** Etiqueta del menú para la ruta actual (o la de su ruta padre más cercana). */
function etiquetaRuta(rol, ruta) {
  const enlaces = navegacionParaRol(rol).flatMap((grupo) => grupo.items || [grupo]);
  const coincidencias = enlaces.filter((e) => ruta === e.to || ruta.startsWith(`${e.to}/`));
  return coincidencias.sort((a, b) => b.to.length - a.to.length)[0]?.label;
}

export default function AppLayout() {
  // Mobile drawer open state
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop collapsed state
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { profile } = useAuth();
  // Las pantallas muestran montos en Bs: esperan a conocer la tasa vigente
  const [tasaLista, setTasaLista] = useState(getTasaPantalla() > 0);

  useEffect(() => {
    const cargar = async () => {
      const { data, error } = await supabase.rpc('tasa_vigente');
      if (error) {
        // Se conserva la última tasa conocida en lugar de pasar todo a USD
        toast.error(`No se pudo obtener la tasa de cambio vigente: ${mensajeError(error)}`, { id: 'tasa-vigente' });
      } else {
        setTasaPantalla(data);
      }
      setTasaLista(true);
    };
    cargar();
    window.addEventListener('arluc_tasa_actualizada', cargar);
    return () => window.removeEventListener('arluc_tasa_actualizada', cargar);
  }, []);

  // Tasa BCV: se sincroniza al abrir la app y cada 15 minutos (además del cron del servidor)
  useEffect(() => {
    const sincronizar = () => sincronizarTasaBCV().catch((e) => console.warn('Sincronización BCV:', e.message));
    sincronizar();
    const intervalo = setInterval(sincronizar, 15 * 60 * 1000);
    return () => clearInterval(intervalo);
  }, []);

  // Título del navegador según la pantalla («Libro Diario · ARLUC»)
  useEffect(() => {
    const etiqueta = etiquetaRuta(profile?.rol, location.pathname);
    document.title = etiqueta ? `${etiqueta} · ${TITULO_SISTEMA}` : TITULO_SISTEMA;
  }, [profile?.rol, location.pathname]);

  // Close mobile drawer when route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Atajo de teclado global Ctrl+B para contraer/expandir el sidebar
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignorar si el usuario está escribiendo en un input, textarea o select
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (window.innerWidth <= 768) {
          setMobileOpen((prev) => !prev);
        } else {
          setCollapsed((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleToggleMenu = () => {
    if (window.innerWidth <= 768) {
      setMobileOpen(true);
    } else {
      setCollapsed((prev) => !prev);
    }
  };

  return (
    <div className={`app-layout ${collapsed ? 'app-layout--collapsed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <div className="app-layout__content">
        <header className="mobile-topbar">
          <button
            className="mobile-topbar__hamburger"
            onClick={handleToggleMenu}
            aria-label="Abrir menú lateral"
            title="Abrir menú lateral (Ctrl+B)"
          >
            <HiOutlineBars3 />
          </button>
          <div className="mobile-topbar__brand">
            <img src="/logo-arluc.jpg" alt="Logo de ARLUC" className="mobile-topbar__logo" />
            <span className="mobile-topbar__title">ARLUC</span>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <ThemeToggle />
          </div>
        </header>

        <main className="app-layout__main">
          {tasaLista ? <Outlet /> : <div className="loading-screen"><div className="loading-spinner" /></div>}
        </main>
      </div>
    </div>
  );
}
