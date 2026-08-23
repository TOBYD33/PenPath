import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Role } from "@penpath/shared";
import { api } from "./api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  permissions: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem("penpath_token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ user: AuthUser; permissions: string[] }>("/api/auth/me");
      setUser(data.user);
      setPermissions(data.permissions);
    } catch {
      localStorage.removeItem("penpath_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: AuthUser }>("/api/auth/login", { email, password });
    localStorage.setItem("penpath_token", data.token);
    setUser(data.user);
    await loadMe();
  }, [loadMe]);

  const logout = useCallback(() => {
    localStorage.removeItem("penpath_token");
    setUser(null);
    setPermissions([]);
  }, []);

  return (
    <AuthContext.Provider value={{ user, permissions, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
