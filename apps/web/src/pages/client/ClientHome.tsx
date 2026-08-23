import { useEffect, useState } from "react";
import type { CaseStatus } from "@penpath/shared";
import { api, ApiError } from "../../lib/api";
import { IntakeForm } from "./IntakeForm";

interface ClientCase {
  id: string;
  status: CaseStatus;
  clientStatusLabel: string;
  pfa: { name: string };
  pmb: { name: string };
  createdAt: string;
}

export default function ClientHome() {
  const [cases, setCases] = useState<ClientCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const data = await api.get<{ cases: ClientCase[] }>("/api/cases");
      setCases(data.cases);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load your case");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  if (error) return <p className="text-sm text-status-error">{error}</p>;
  if (cases === null) return <p className="text-sm text-text-muted">Loading…</p>;

  const activeCase = cases[0];

  if (!activeCase) {
    return <IntakeForm onSubmitted={reload} />;
  }

  return (
    <div className="bg-bg-base border border-border rounded-lg p-6 max-w-lg">
      <h2 className="text-lg font-semibold text-text-primary mb-1">Your application</h2>
      <p className="text-sm text-text-muted mb-4">
        {activeCase.pfa.name} · {activeCase.pmb.name}
      </p>
      <div className="bg-bg-secondary border border-border rounded-md px-4 py-3">
        <div className="text-xs text-text-muted mb-1">Status</div>
        <div className="text-sm font-medium text-brand-primary">{activeCase.clientStatusLabel}</div>
      </div>
      <p className="text-xs text-text-muted mt-4">
        Submitted {new Date(activeCase.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}
