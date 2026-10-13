import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { apiFetch, getToken, setToken } from '../services/api';

/**
 * Authentication context value.
 * @interface AuthContextValue
 * @property {boolean} authenticated - Whether a session token is present.
 * @property {(masterKey: string) => Promise<void>} login - Exchanges the master key for a session.
 * @property {() => void} logout - Revokes the session locally and remotely.
 */
interface AuthContextValue {
  authenticated: boolean;
  login: (masterKey: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authenticated: false,
  login: async () => undefined,
  logout: () => undefined,
});

/**
 * Provides JWT session state and actions to the dashboard tree.
 * @param {object} props - Component props.
 * @param {React.ReactNode} props.children - Wrapped application tree.
 * @returns {React.ReactElement} The provider element.
 */
export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [authenticated, setAuthenticated] = useState<boolean>(Boolean(getToken()));

  const login = useCallback(async (masterKey: string) => {
    const result = await apiFetch<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ masterKey }),
    });
    setToken(result.token);
    setAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    void apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setAuthenticated(false);
    window.location.href = '/login';
  }, []);

  const value = useMemo(() => ({ authenticated, login, logout }), [authenticated, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Accesses the authentication context.
 * @returns {AuthContextValue} Session state and actions.
 */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
