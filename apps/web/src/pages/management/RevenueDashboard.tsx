import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../lib/api";

interface CaseRow {
  id: string;
  client: string;
  pfa: string;
  pmb: string;
  officer: string | null;
  status: string;
  feeTotal: string | null;
  createdAt: string;
  closedAt: string | null;
}

interface RevenueReport {
  totalRealizedRevenue: number;
  totalPipelineValue: number;
  caseCount: number;
  realizedCount: number;
  pipelineCount: number;
  monthlyTrend: { month: string; revenue: number }[];
  cases: CaseRow[];
}

interface Institution {
  id: string;
  name: string;
}

const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function RevenueDashboard() {
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [pfas, setPfas] = useState<Institution[]>([]);
  const [pmbs, setPmbs] = useState<Institution[]>([]);
  const [officers, setOfficers] = useState<{ id: string; name: string }[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pfaId, setPfaId] = useState("");
  const [pmbId, setPmbId] = useState("");
  const [officerId, setOfficerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function buildQuery() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (pfaId) params.set("pfaId", pfaId);
    if (pmbId) params.set("pmbId", pmbId);
    if (officerId) params.set("officerId", officerId);
    return params.toString();
  }

  async function reload() {
    try {
      const query = buildQuery();
      const data = await api.get<RevenueReport>(`/api/dashboard/revenue${query ? `?${query}` : ""}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load revenue report");
    }
  }

  useEffect(() => {
    api.get<{ institutions: Institution[] }>("/api/institutions?type=PFA").then((d) => setPfas(d.institutions));
    api.get<{ institutions: Institution[] }>("/api/institutions?type=PMB").then((d) => setPmbs(d.institutions));
    api.get<{ officers: { id: string; name: string }[] }>("/api/cases/ops-officers").then((d) => setOfficers(d.officers)).catch(() => {});
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportReport(format: "csv" | "pdf") {
    try {
      const query = buildQuery();
      const q = query ? `${query}&format=${format}` : `format=${format}`;
      await api.downloadFile(`/api/dashboard/revenue/export?${q}`, `revenue-report.${format}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    }
  }

  const maxTrend = report ? Math.max(1, ...report.monthlyTrend.map((m) => m.revenue)) : 1;

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-text-primary mb-4">Revenue Dashboard</h1>
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
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">PFA</label>
          <select value={pfaId} onChange={(e) => setPfaId(e.target.value)} className="border border-border rounded-md px-2 py-1 text-sm">
            <option value="">All</option>
            {pfas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">PMB</label>
          <select value={pmbId} onChange={(e) => setPmbId(e.target.value)} className="border border-border rounded-md px-2 py-1 text-sm">
            <option value="">All</option>
            {pmbs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Officer</label>
          <select value={officerId} onChange={(e) => setOfficerId(e.target.value)} className="border border-border rounded-md px-2 py-1 text-sm">
            <option value="">All</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <button onClick={reload} className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-1.5">
          Apply
        </button>
        <div className="ml-auto flex gap-2">
          <button onClick={() => exportReport("csv")} className="bg-bg-secondary hover:bg-border text-text-primary text-xs font-medium rounded-md px-3 py-1.5">
            Export CSV
          </button>
          <button onClick={() => exportReport("pdf")} className="bg-bg-secondary hover:bg-border text-text-primary text-xs font-medium rounded-md px-3 py-1.5">
            Export PDF
          </button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatTile label="Realized revenue" value={currency.format(report.totalRealizedRevenue)} sub={`${report.realizedCount} closed cases`} accent="success" />
            <StatTile label="Pipeline value" value={currency.format(report.totalPipelineValue)} sub={`${report.pipelineCount} open cases`} accent="warning" />
            <StatTile label="Total cases" value={String(report.caseCount)} sub="matching filters" />
          </div>

          <div className="bg-bg-base border border-border rounded-lg p-6 mb-6">
            <h2 className="text-sm font-semibold text-text-primary mb-4">Monthly trend (realized revenue)</h2>
            {report.monthlyTrend.length === 0 ? (
              <p className="text-sm text-text-muted">No closed cases yet.</p>
            ) : (
              <div className="flex items-end gap-3 h-40">
                {report.monthlyTrend.map((m) => (
                  <div key={m.month} className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className="w-full bg-brand-primary rounded-t"
                      style={{ height: `${Math.max(4, (m.revenue / maxTrend) * 100)}%` }}
                      title={currency.format(m.revenue)}
                    />
                    <span className="text-xs text-text-muted">{m.month}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">PFA</th>
                  <th className="px-4 py-3 font-medium">PMB</th>
                  <th className="px-4 py-3 font-medium">Officer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Fee</th>
                </tr>
              </thead>
              <tbody>
                {report.cases.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-text-primary">{c.client}</td>
                    <td className="px-4 py-3 text-text-muted">{c.pfa}</td>
                    <td className="px-4 py-3 text-text-muted">{c.pmb}</td>
                    <td className="px-4 py-3 text-text-muted">{c.officer ?? "—"}</td>
                    <td className="px-4 py-3 text-text-muted">{c.status.replaceAll("_", " ")}</td>
                    <td className="px-4 py-3 text-text-primary">{c.feeTotal ? currency.format(Number(c.feeTotal)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}

function StatTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: "success" | "warning" }) {
  const accentClass = accent === "success" ? "text-status-success" : accent === "warning" ? "text-status-warning" : "text-brand-primary";
  return (
    <div className="bg-bg-base border border-border rounded-lg p-4">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className={`text-xl font-semibold ${accentClass}`}>{value}</div>
      <div className="text-xs text-text-muted mt-1">{sub}</div>
    </div>
  );
}
