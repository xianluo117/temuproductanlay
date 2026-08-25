import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthSession } from '@temu-analytics/shared';
import { getSession, login as loginRequest, logout as logoutRequest, register as registerRequest, switchActiveOwner } from '../api/client';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  dataVersion: number;
  login: (username: string, password: string) => Promise<AuthSession>;
  register: (username: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
  switchOwner: (id: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);

  const refresh = async () => {
    try { setSession(await getSession()); }
    catch { setSession(null); }
  };

  useEffect(() => { void refresh().finally(() => setLoading(false)); }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    dataVersion,
    login: async (username, password) => {
      const next = await loginRequest(username, password);
      setSession(next);
      return next;
    },
    register: async (username, password) => {
      const next = await registerRequest(username, password);
      setSession(next);
      return next;
    },
    logout: async () => {
      await logoutRequest();
      setSession(null);
    },
    switchOwner: async (id) => {
      setSession(await switchActiveOwner(id));
      setDataVersion((value) => value + 1);
      window.location.reload();
    },
    refresh,
  }), [session, loading, dataVersion]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing.');
  return value;
}
