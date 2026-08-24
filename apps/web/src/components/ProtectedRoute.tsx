import { Navigate, Outlet } from "react-router-dom";
import type { Permission, Role } from "@penpath/shared";
import { useAuth } from "../lib/auth";

export function ProtectedRoute({
  allowedRoles,
  requiredPermission,
}: {
  allowedRoles?: Role[];
  requiredPermission?: Permission;
}) {
  const { user, permissions, loading } = useAuth();

  if (loading) return <div className="p-8 text-text-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  if (requiredPermission && !permissions.includes(requiredPermission)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
