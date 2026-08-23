import { Fragment, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../lib/api";

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string };
}

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ logs: AuditLogEntry[] }>("/api/audit-logs")
      .then((data) => setLogs(data.logs))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load audit log"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-text-primary mb-4">Audit Log</h1>
      {error && <p className="text-sm text-status-error mb-4">{error}</p>}

      <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                  Loading…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                  No activity yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <Fragment key={log.id}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-text-muted whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      {log.user.name} <span className="text-text-muted">({log.user.role})</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">{log.action}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {log.entityType} #{log.entityId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                        className="text-accent hover:text-accent-light text-xs font-medium"
                      >
                        {expanded === log.id ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {expanded === log.id && (
                    <tr className="bg-bg-secondary">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className="text-text-muted mb-1">Old value</div>
                            <pre className="whitespace-pre-wrap break-all">
                              {JSON.stringify(log.oldValue, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-text-muted mb-1">New value</div>
                            <pre className="whitespace-pre-wrap break-all">
                              {JSON.stringify(log.newValue, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
