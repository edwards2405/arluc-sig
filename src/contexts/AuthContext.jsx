import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(false);
  const initializedRef = useRef(false);

  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('Profile fetch warning:', error.message);
        setProfile(null);
      } else {
        setProfile(data);
      }
      return data;
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        fetchProfile(currentUser.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          fetchProfile(currentUser.id);
        } else if (event === 'SIGNED_OUT') {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  async function signIn(email, password) {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      if (data?.user?.id) {
        setUser(data.user);
        const { data: profileData } = await supabase
          .from('usuarios')
          .select('*')
          .eq('id', data.user.id)
          .maybeSingle();

        if (profileData && profileData.activo === false) {
          await supabase.auth.signOut();
          setUser(null);
          setProfile(null);
          throw new Error('Usuario desactivado. Contacte al administrador del sistema.');
        }

        setProfile(profileData || null);
      }

      return data;
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setProfile(null);
  }

  async function createUser(email, password, nombreCompleto, rol) {
    // El registro se hace por REST para no reemplazar la sesión del admin.
    // La base de datos crea el perfil como vendedor INACTIVO (ignora el rol
    // enviado); luego el admin, con su sesión, asigna el rol y lo activa.
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/signup`,
      {
        method: 'POST',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          data: { nombre_completo: nombreCompleto },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok || data.error || data.msg) {
      throw new Error(data.error_description || data.msg || data.error || 'Error al crear usuario');
    }

    const nuevoId = data.user?.id ?? data.id;
    const { error: perfilError } = await supabase
      .from('usuarios')
      .update({ rol, activo: true })
      .eq('id', nuevoId);
    if (perfilError) throw perfilError;

    return data;
  }

  const isAdmin = profile?.rol === 'admin';
  const isVendedor = profile?.rol === 'vendedor';

  const value = {
    user,
    profile,
    loading,
    isAdmin,
    isVendedor,
    signIn,
    signOut,
    createUser,
    refreshProfile: () => user && fetchProfile(user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
