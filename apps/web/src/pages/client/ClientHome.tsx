import { useEffect, useState, type FormEvent } from "react";
import type { CaseStatus } from "@penpath/shared";
import { api, ApiError } from "../../lib/api";
import { IntakeForm } from "./IntakeForm";
import { ComplaintsPanel } from "../CaseDetail";

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
  const [busy, setBusy] = useState(false);

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

  async function confirmFundsReceived() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/cases/${activeCase.id}/confirm-funds-received`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to confirm funds received");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
    <div className="bg-bg-base border border-border rounded-lg p-6">
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

      {activeCase.status === "AWAITING_FUND_RELEASE" && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-sm text-text-primary mb-2">
            Funds have been sent to your Mortgage Bank. Please confirm once you've verified this with them.
          </p>
          <button
            onClick={confirmFundsReceived}
            disabled={busy}
            className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60"
          >
            Confirm Funds Received
          </button>
        </div>
      )}

      {activeCase.status === "TRANSFER_FORM_SENT" && (
        <div className="mt-4 pt-4 border-t border-border">
          <TransferFormPanel caseId={activeCase.id} onSubmitted={reload} />
        </div>
      )}

    </div>

      <ComplaintsPanel caseId={activeCase.id} />
    </div>
  );
}

function TransferFormPanel({ caseId, onSubmitted }: { caseId: string; onSubmitted: () => void }) {
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [mortgageRef, setMortgageRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/api/cases/${caseId}/transfer-form`, {
        bankName,
        accountNumber,
        amount: Number(amount),
        mortgageRef,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit transfer form");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-text-primary">Please provide your bank details to complete the transfer.</p>
      {error && <p className="text-sm text-status-error">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Bank name</label>
          <input required value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Account number</label>
          <input required value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Amount (₦)</label>
          <input required type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Mortgage reference</label>
          <input required value={mortgageRef} onChange={(e) => setMortgageRef(e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm" />
        </div>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60"
      >
        {submitting ? "Submitting…" : "Submit transfer form"}
      </button>
    </form>
  );
}
