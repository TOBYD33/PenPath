import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../lib/api";

interface UnassignedCase {
  id: string;
  intakeSource: "DIGITAL_LINK" | "PHYSICAL_SCAN";
  status: string;
  createdAt: string;
  client: { id: string; name: string; email: string };
  pfa: { name: string };
  pmb: { name: string };
  clientLink: {
    id: string;
    clientName: string | null;
    clientPhone: string | null;
    clientEmail: string | null;
    generatedBy: { id: string; name: string };
  } | null;
}

interface OfficerWorkload {
  id: string;
  name: string;
  email: string;
  maxCaseLoad: number;
  currentCaseLoad: number;
}

export default function CaseAssignment() {
  const [cases, setCases] = useState<UnassignedCase[]>([]);
  const [officers, setOfficers] = useState<OfficerWorkload[]>([]);
  const [selectedOfficer, setSelectedOfficer] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [casesData, officersData] = await Promise.all([
        api.get<{ cases: UnassignedCase[] }>("/api/cases/unassigned"),
        api.get<{ officers: OfficerWorkload[] }>("/api/cases/ops-officers"),
      ]);
      setCases(casesData.cases);
      setOfficers(officersData.officers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load assignment queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function assign(caseId: string) {
    const officerId = selectedOfficer[caseId];
    if (!officerId) return;
    setError(null);
    try {
      await api.post(`/api/cases/${caseId}/assign`, { officerId });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign case");
    }
  }

  async function updateCap(officerId: string, maxCaseLoad: number) {
    try {
      await api.patch(`/api/cases/ops-officers/${officerId}/max-case-load`, { maxCaseLoad });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update case load cap");
    }
  }

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-text-primary mb-4">Case Assignment</h1>
      {error && <p className="text-sm text-status-error mb-4">{error}</p>}

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-text-primary mb-2">Team workload</h2>
        <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">Officer</th>
                <th className="px-4 py-3 font-medium">Load</th>
                <th className="px-4 py-3 font-medium">Cap</th>
              </tr>
            </thead>
            <tbody>
              {officers.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-text-primary">{o.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        o.currentCaseLoad >= o.maxCaseLoad
                          ? "text-status-error font-medium"
                          : "text-text-primary"
                      }
                    >
                      {o.currentCaseLoad} / {o.maxCaseLoad}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={1}
                      defaultValue={o.maxCaseLoad}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v && v !== o.maxCaseLoad) updateCap(o.id, v);
                      }}
                      className="w-16 border border-border rounded-md px-2 py-1 text-sm"
                    />
                  </td>
                </tr>
              ))}
              {officers.length === 0 && !loading && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                    No Ops Officers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text-primary mb-2">Unassigned cases</h2>
        <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">PFA</th>
                <th className="px-4 py-3 font-medium">PMB</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Assign to</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    Loading…
                  </td>
                </tr>
              ) : cases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    Queue is empty.
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-text-primary">{c.client.name}</td>
                    <td className="px-4 py-3 text-text-muted">{c.pfa.name}</td>
                    <td className="px-4 py-3 text-text-muted">{c.pmb.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-medium rounded-full px-2 py-1 ${
                          c.intakeSource === "DIGITAL_LINK" ? "bg-accent-light/20 text-accent" : "bg-bg-secondary text-text-muted"
                        }`}
                      >
                        {c.intakeSource === "DIGITAL_LINK" ? "Digital Link" : "Physical Scan"}
                      </span>
                      {c.clientLink && (
                        <div className="text-xs text-text-muted mt-1">
                          Link by {c.clientLink.generatedBy.name}
                          {c.clientLink.clientPhone && <> · {c.clientLink.clientPhone}</>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedOfficer[c.id] ?? ""}
                          onChange={(e) => setSelectedOfficer((s) => ({ ...s, [c.id]: e.target.value }))}
                          className="border border-border rounded-md px-2 py-1 text-sm"
                        >
                          <option value="" disabled>
                            Select officer…
                          </option>
                          {officers.map((o) => (
                            <option key={o.id} value={o.id} disabled={o.currentCaseLoad >= o.maxCaseLoad}>
                              {o.name} ({o.currentCaseLoad}/{o.maxCaseLoad})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => assign(c.id)}
                          disabled={!selectedOfficer[c.id]}
                          className="bg-brand-primary hover:bg-brand-dark text-white text-xs font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
                        >
                          Assign
                        </button>
                      </div>
                    </td>
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
