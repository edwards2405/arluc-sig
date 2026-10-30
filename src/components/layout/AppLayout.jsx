import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import ThemeToggle from '../common/ThemeToggle';
import { HiOutlineBars3 } from 'react-icons/hi2';
import { sincronizarTasaBCV } from '../../services/bcvService';

export default function AppLayout() {
  // Mobile drawer open state
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop collapsed state
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  // Tasa BCV: se sincroniza al abrir la app y cada 15 minutos (además del cron del servidor)
  useEffect(() => {
    const sincronizar = () => sincronizarTasaBCV().catch((e) => console.warn('Sincronización BCV:', e.message));
    sincronizar();
    const intervalo = setInterval(sincronizar, 15 * 60 * 1000);
    return () => clearInterval(intervalo);
  }, []);

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
            <img src="/logo-arluc.jpg" alt="ARLUC Logo" className="mobile-topbar__logo" />
            <span className="mobile-topbar__title">ARLUC System</span>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <ThemeToggle />
          </div>
        </header>

        <main className="app-layout__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
