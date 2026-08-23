import { AppShell } from "../components/AppShell";

export default function Dashboard() {
  return (
    <AppShell>
      <div className="bg-bg-base border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-2">Welcome to PenPath</h2>
        <p className="text-sm text-text-muted">
          Role-specific dashboards land in later phases. Super Admins can manage users and view
          the audit log from the nav above.
        </p>
      </div>
    </AppShell>
  );
}
