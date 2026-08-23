import { AppShell } from "../components/AppShell";
import { useAuth } from "../lib/auth";
import ClientHome from "./client/ClientHome";

export default function Dashboard() {
  const { user } = useAuth();

  if (user?.role === "CLIENT") {
    return (
      <AppShell>
        <ClientHome />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="bg-bg-base border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-2">Welcome to PenPath</h2>
        <p className="text-sm text-text-muted">
          Role-specific dashboards land in later phases. Use the nav above for what's available to
          your role today.
        </p>
      </div>
    </AppShell>
  );
}
