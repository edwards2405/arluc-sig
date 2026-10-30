import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/layout/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Inventario from './pages/Inventario';
import ReportesInventario from './pages/ReportesInventario';
import Clientes from './pages/Clientes';
import CuentasPorCobrar from './pages/CuentasPorCobrar';
import ReportesCxC from './pages/ReportesCxC';
import Proveedores from './pages/Proveedores';
import OrdenesCompra from './pages/OrdenesCompra';
import TasaCambio from './pages/TasaCambio';
import Usuarios from './pages/Usuarios';
import HistorialFacturas from './pages/HistorialFacturas';
import Reportes from './pages/Reportes';
import Configuracion from './pages/Configuracion';
import LibroDiario from './pages/contabilidad/LibroDiario';
import LibroMayor from './pages/contabilidad/LibroMayor';
import PlanCuentas from './pages/contabilidad/PlanCuentas';
import BalanceComprobacion from './pages/contabilidad/BalanceComprobacion';
import EstadosFinancieros from './pages/contabilidad/EstadosFinancieros';
import PanelGerencial from './pages/PanelGerencial';
import CuentasPorPagar from './pages/CuentasPorPagar';
import { rutaInicio } from './utils/permisos';

function AppRoutes() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Cargando ARLUC...</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user && profile ? <Navigate to={rutaInicio(profile.rol)} /> : <Login />} />
      
      <Route element={
        <ProtectedRoute>
          <AppLayout />
        </ProtectedRoute>
      }>
        {/* El acceso por rol lo decide ProtectedRoute con utils/permisos.js */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/panel-gerencial" element={<PanelGerencial />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/historial" element={<HistorialFacturas />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/cuentas-por-cobrar" element={<CuentasPorCobrar />} />
        <Route path="/cuentas-por-cobrar/reportes" element={<ReportesCxC />} />
        <Route path="/cuentas-por-pagar" element={<CuentasPorPagar />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/inventario/reportes" element={<ReportesInventario />} />
        <Route path="/proveedores" element={<Proveedores />} />
        <Route path="/ordenes-compra" element={<OrdenesCompra />} />
        <Route path="/tasa-cambio" element={<TasaCambio />} />
        <Route path="/reportes" element={<Reportes />} />
        <Route path="/contabilidad/plan-cuentas" element={<PlanCuentas />} />
        <Route path="/contabilidad/libro-diario" element={<LibroDiario />} />
        <Route path="/contabilidad/libro-mayor" element={<LibroMayor />} />
        <Route path="/contabilidad/balance-comprobacion" element={<BalanceComprobacion />} />
        <Route path="/contabilidad/estados-financieros" element={<EstadosFinancieros />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/configuracion" element={<Configuracion />} />
      </Route>

      <Route path="*" element={<Navigate to={user ? rutaInicio(profile?.rol) : "/login"} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3000,
              style: {
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--card-shadow)',
              },
              success: { iconTheme: { primary: '#22C55E', secondary: 'var(--bg-elevated)' } },
              error: { iconTheme: { primary: '#EF4444', secondary: 'var(--bg-elevated)' } },
            }}
          />
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
