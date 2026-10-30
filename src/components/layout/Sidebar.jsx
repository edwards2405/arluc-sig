import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import SidebarGroup from './sidebar/SidebarGroup';
import { navegacionParaRol } from './sidebar/sidebarConfig';
import { ROLES_LABEL } from '../../utils/permisos';
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineBars3,
  HiOutlineXMark,
} from 'react-icons/hi2';

export default function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const groups = navegacionParaRol(profile?.rol);

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  const handleNavigate = () => {
    if (mobileOpen) {
      setMobileOpen(false);
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="sidebar-overlay sidebar-overlay--visible"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${mobileOpen ? 'sidebar--mobile-open' : ''}`}>
        {/* Header */}
        <div
          className={`sidebar__header ${collapsed ? 'sidebar__header--collapsed' : ''}`}
          onClick={() => {
            if (collapsed) setCollapsed(false);
          }}
          title={collapsed ? "Haz clic para expandir el menú lateral (Ctrl+B)" : undefined}
          style={collapsed ? { cursor: 'pointer' } : undefined}
        >
          {collapsed ? (
            /* Modo Contraído: Botón hamburguesa centrado, 44x44px y alineado con los iconos */
            <button
              type="button"
              className="sidebar__toggle sidebar__toggle--collapsed"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed(false);
              }}
              aria-label="Expandir menú lateral"
              title="Expandir menú lateral (Ctrl+B)"
            >
              <HiOutlineBars3 />
            </button>
          ) : (
            /* Modo Expandido: Logo + Marca ERP + Botón para contraer */
            <>
              <img src="/logo-arluc.jpg" alt="ARLUC" className="sidebar__logo" />
              <div className="sidebar__brand">
                <h1>ARLUC</h1>
                <span>Sistema ERP</span>
              </div>
              <button
                type="button"
                className="sidebar__toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  if (mobileOpen) {
                    setMobileOpen(false);
                  } else {
                    setCollapsed(true);
                  }
                }}
                aria-label={mobileOpen ? "Cerrar menú" : "Contraer menú"}
                title={mobileOpen ? "Cerrar menú" : "Contraer menú (Ctrl+B)"}
              >
                {mobileOpen ? <HiOutlineXMark /> : <HiOutlineBars3 />}
              </button>
            </>
          )}
        </div>

        {/* Navigation Groups */}
        <nav className="sidebar__nav sidebar__nav--tree">
          {groups.map((group) => (
            <SidebarGroup
              key={group.id}
              group={group}
              collapsed={collapsed}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>

        {/* User info + logout */}
        <div className="sidebar__footer">
          {!collapsed && (
            <div className="sidebar__user">
              <div className="sidebar__avatar">
                {profile?.nombre_completo?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <div className="sidebar__user-info">
                <span className="sidebar__user-name">{profile?.nombre_completo}</span>
                <span className={`sidebar__user-role sidebar__user-role--${profile?.rol}`}>
                  {ROLES_LABEL[profile?.rol] || profile?.rol}
                </span>
              </div>
            </div>
          )}
          <button className="sidebar__logout" onClick={handleSignOut} title="Cerrar Sesión">
            <HiOutlineArrowRightOnRectangle />
            {!collapsed && <span>Cerrar Sesión</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
