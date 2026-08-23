import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { Role } from "@penpath/shared";
import { useAuth } from "../lib/auth";

const navItems: { to: string; label: string; roles: Role[] | null }[] = [
  { to: "/", label: "Dashboard", roles: null },
  { to: "/admin/users", label: "Users", roles: ["SUPER_ADMIN"] },
  { to: "/admin/audit-log", label: "Audit Log", roles: ["SUPER_ADMIN"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-bg-secondary">
      <header className="bg-brand-primary text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold">PenPath</span>
          <nav className="flex items-center gap-4 text-sm">
            {navItems
              .filter((item) => !item.roles || (user && item.roles.includes(user.role)))
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `px-1 pb-0.5 border-b-2 transition-colors ${
                      isActive ? "border-accent text-white" : "border-transparent text-white/75 hover:text-white"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span>
            {user?.name} · <span className="text-white/70">{user?.role}</span>
          </span>
          <button onClick={logout} className="bg-accent hover:bg-accent-light rounded-md px-3 py-1.5">
            Sign out
          </button>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
