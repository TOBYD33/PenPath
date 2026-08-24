import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../lib/api";

interface OfficerStat {
  id: string;
  name: string;
  email: string;
  lastLoginAt: string | null;
  casesAssigned: number;
  casesClosed: number;
  avgDaysToClose: number | null;
}

interface CareStat {
  id: string;
  name: string;
  email: string;
  lastLoginAt: string | null;
  complaintsResolved: number;
}

interface ActivityReport {
  opsOfficers: OfficerStat[];
  customerCareAgents: CareStat[];
}

export default function ActivityDashboard() {
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  function buildQuery() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }

  async function reload() {
    try {
      const query = buildQuery();
      const data = await api.get<ActivityReport>(`/api/dashboard/activity${query ? `?${query}` : ""}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load activity report");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportReport(type: "opsOfficers" | "customerCare", format: "csv" | "pdf") {
    try {
      const query = buildQuery();
      const q = `type=${type}&format=${format}${query ? `&${query}` : ""}`;
      await api.downloadFile(`/api/dashboard/activity/export?${q}`, `activity-${type}.${format}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    }
  }

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-text-primary mb-4">User Activity</h1>
      {error && <p className="text-sm text-status-error mb-4">{error}</p>}

      <div className="bg-bg-base border border-border rounded-lg p-4 mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-border rounded-md px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-border rounded-md px-2 py-1 text-sm" />
        </div>
        <button onClick={reload} className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-1.5">
          Apply
        </button>
      </div>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-text-primary">Ops Officers</h2>
          <div className="flex gap-2">
            <button onClick={() => exportReport("opsOfficers", "csv")} className="bg-bg-secondary hover:bg-border text-text-primary text-xs font-medium rounded-md px-3 py-1.5">
              Export CSV
            </button>
            <button onClick={() => exportReport("opsOfficers", "pdf")} className="bg-bg-secondary hover:bg-border text-text-primary text-xs font-medium rounded-md px-3 py-1.5">
              Export PDF
            </button>
          </div>
        </div>
        <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">Officer</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3 font-medium">Cases assigned</th>
                <th className="px-4 py-3 font-medium">Cases closed</th>
                <th className="px-4 py-3 font-medium">Avg days to close</th>
              </tr>
            </thead>
            <tbody>
              {report === null ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    Loading…
                  </td>
                </tr>
              ) : report.opsOfficers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    No Ops Officers yet.
                  </td>
                </tr>
              ) : (
                report.opsOfficers.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-text-primary">{o.name}</td>
                    <td className="px-4 py-3 text-text-muted">{o.lastLoginAt ? new Date(o.lastLoginAt).toLocaleString() : "Never"}</td>
                    <td className="px-4 py-3 text-text-muted">{o.casesAssigned}</td>
                    <td className="px-4 py-3 text-text-muted">{o.casesClosed}</td>
                    <td className="px-4 py-3 text-text-muted">{o.avgDaysToClose ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-text-primary">Customer Care</h2>
          <div className="flex gap-2">
            <button onClick={() => exportReport("customerCare", "csv")} className="bg-bg-secondary hover:bg-border text-text-primary text-xs font-medium rounded-md px-3 py-1.5">
              Export CSV
            </button>
            <button onClick={() => exportReport("customerCare", "pdf")} className="bg-bg-secondary hover:bg-border text-text-primary text-xs font-medium rounded-md px-3 py-1.5">
              Export PDF
            </button>
          </div>
        </div>
        <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3 font-medium">Complaints resolved</th>
              </tr>
            </thead>
            <tbody>
              {report === null ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                    Loading…
                  </td>
                </tr>
              ) : report.customerCareAgents.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                    No Customer Care agents yet.
                  </td>
                </tr>
              ) : (
                report.customerCareAgents.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-text-primary">{a.name}</td>
                    <td className="px-4 py-3 text-text-muted">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "Never"}</td>
                    <td className="px-4 py-3 text-text-muted">{a.complaintsResolved}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
