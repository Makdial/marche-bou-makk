import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { Me, Role } from '../shared/types';

interface AuthValue {
  user: Me | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<Me>;
  signUp: (payload: Record<string, unknown>) => Promise<Me>;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export const HOME_PATH: Record<Role, string> = {
  buyer: '/shop',
  vendor: '/vendor',
  conductor: '/conductor',
  admin: '/admin',
  gp: '/gp',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<{ user: Me }>('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onSignedOut = () => setUser(null);
    window.addEventListener('marche:signed-out', onSignedOut);
    return () => window.removeEventListener('marche:signed-out', onSignedOut);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api<{ token: string; user: Me }>('/auth/login', { body: { email, password } });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const signUp = useCallback(async (payload: Record<string, unknown>) => {
    const data = await api<{ token: string; user: Me }>('/auth/register', { body: payload });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signUp, signOut }), [user, loading, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
