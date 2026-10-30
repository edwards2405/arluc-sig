import { Navigate, useLocation } from 'react-router-dom';
import { puedeAcceder, rutaInicio } from '../../utils/permisos';
import { useAuth } from '../../contexts/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, profile, loading, signOut } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Cargando...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return (
      <div className="loading-screen">
        <p style={{ color: 'var(--accent-red, #EF4444)', fontWeight: 600 }}>Error al cargar el perfil de usuario</p>
        <p style={{ fontSize: '0.875rem', opacity: 0.8, marginTop: '0.5rem' }}>No se pudo obtener la información de su cuenta en la base de datos.</p>
        <button 
          onClick={() => window.location.reload()} 
          style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!profile.activo) {
    return (
      <div className="loading-screen">
        <p style={{ color: 'var(--accent-red, #EF4444)', fontWeight: 600 }}>Cuenta inactiva</p>
        <p style={{ fontSize: '0.875rem', opacity: 0.8, marginTop: '0.5rem' }}>Un administrador debe activar su usuario y asignarle un rol.</p>
        <button
          onClick={signOut}
          style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Cerrar sesión
        </button>
      </div>
    );
  }

  if (!puedeAcceder(profile.rol, pathname)) {
    return <Navigate to={rutaInicio(profile.rol)} replace />;
  }

  return children;
}
