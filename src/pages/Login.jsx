import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ThemeToggle from '../components/common/ThemeToggle';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Ingrese email y contraseña');
      return;
    }

    setLoading(true);
    try {
      await signIn(email, password);
      toast.success('¡Bienvenido!');
      navigate('/dashboard');
    } catch (error) {
      toast.error(error.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <ThemeToggle className="theme-toggle-btn--floating" showLabel={true} />
      <div className="login-card">
        <div className="login-card__header">
          <img src="/logo-arluc.jpg" alt="ARLUC" className="login-card__logo" />
          <h1 className="login-card__title">ARLUC System</h1>
          <p className="login-card__subtitle">Sistema ERP ARLUC</p>
        </div>

        <form onSubmit={handleSubmit} className="login-card__form">
          <div className="form-group">
            <label htmlFor="email">Correo Electrónico</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn--primary btn--full" disabled={loading}>
            {loading ? (
              <span className="btn__loading">
                <span className="loading-spinner loading-spinner--small" />
                Ingresando...
              </span>
            ) : (
              'Iniciar Sesión'
            )}
          </button>
        </form>

        <p className="login-card__footer">
          ARLUC C.A. &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
