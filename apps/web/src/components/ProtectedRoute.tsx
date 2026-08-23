import { Navigate, Outlet } from "react-router-dom";
import type { Role } from "@penpath/shared";
import { useAuth } from "../lib/auth";

export function ProtectedRoute({ allowedRoles }: { allowedRoles?: Role[] }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="p-8 text-text-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
