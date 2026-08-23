import { useAuth } from "../lib/auth";

export default function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-bg-secondary">
      <header className="bg-brand-primary text-white px-6 py-4 flex items-center justify-between">
        <span className="font-semibold">PenPath</span>
        <div className="flex items-center gap-4 text-sm">
          <span>
            {user?.name} · <span className="text-white/70">{user?.role}</span>
          </span>
          <button onClick={logout} className="bg-accent hover:bg-accent-light rounded-md px-3 py-1.5">
            Sign out
          </button>
        </div>
      </header>
      <main className="p-6">
        <div className="bg-bg-base border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-2">Welcome to PenPath</h2>
          <p className="text-sm text-text-muted">
            Phase 0 scaffold complete. Role-specific dashboards land in later phases.
          </p>
        </div>
      </main>
    </div>
  );
}
