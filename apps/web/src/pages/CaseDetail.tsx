import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { CaseStatus } from "@penpath/shared";
import { AppShell } from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

interface FormSubmission {
  id: string;
  formType: string;
  data: Record<string, unknown>;
  version: number;
}

interface Document {
  id: string;
  type: string;
  url: string;
  createdAt: string;
}

interface StatusHistoryEntry {
  id: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  note: string | null;
  createdAt: string;
}

interface CaseDetailData {
  id: string;
  status: CaseStatus;
  clientStatusLabel: string;
  intakeSource: "DIGITAL_LINK" | "PHYSICAL_SCAN";
  client: { id: string; name: string; email: string };
  pfa: { id: string; name: string };
  pmb: { id: string; name: string };
  assignedOfficer: { id: string; name: string } | null;
  formSubmissions: FormSubmission[];
  documents: Document[];
  statusHistory: StatusHistoryEntry[];
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<CaseDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const res = await api.get<{ case: CaseDetailData }>(`/api/cases/${id}`);
      setData(res.case);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load case");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/cases/${id}${path}`, body);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <AppShell>
        <p className="text-sm text-status-error">{error}</p>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell>
        <p className="text-sm text-text-muted">Loading…</p>
      </AppShell>
    );
  }

  const isOwnOrOverride =
    user?.role === "OPS_SUPERVISOR" ||
    user?.role === "ADMIN" ||
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "OPS_OFFICER" && data.assignedOfficer?.id === user.id);

  return (
    <AppShell>
      <div className="max-w-3xl space-y-6">
        <div className="bg-bg-base border border-border rounded-lg p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">{data.client.name}</h1>
              <p className="text-sm text-text-muted">
                {data.pfa.name} · {data.pmb.name} · {data.intakeSource === "DIGITAL_LINK" ? "Digital intake" : "Scanned intake"}
              </p>
            </div>
            <span className="text-xs font-medium bg-bg-secondary rounded-full px-3 py-1">
              {data.status.replaceAll("_", " ")}
            </span>
          </div>
          <p className="text-sm text-brand-primary font-medium mt-3">{data.clientStatusLabel}</p>
          {data.assignedOfficer && (
            <p className="text-xs text-text-muted mt-1">Assigned to {data.assignedOfficer.name}</p>
          )}
        </div>

        {error && <p className="text-sm text-status-error">{error}</p>}

        <WorkflowActions status={data.status} role={user?.role} isOwnOrOverride={isOwnOrOverride} busy={busy} act={act} />

        <div className="bg-bg-base border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Documents</h2>
          {data.documents.length === 0 ? (
            <p className="text-sm text-text-muted">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {data.documents.map((d) => (
                <li key={d.id} className="text-sm">
                  <a href={`${API_BASE}${d.url}`} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-light">
                    {d.type.replaceAll("_", " ")}
                  </a>
                  <span className="text-text-muted"> — {new Date(d.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-bg-base border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Status history</h2>
          <ol className="space-y-2">
            {data.statusHistory.map((h) => (
              <li key={h.id} className="text-sm flex items-baseline gap-2">
                <span className="text-text-muted text-xs whitespace-nowrap">{new Date(h.createdAt).toLocaleString()}</span>
                <span className="text-text-primary">
                  {h.fromStatus ? `${h.fromStatus.replaceAll("_", " ")} → ` : ""}
                  {h.toStatus.replaceAll("_", " ")}
                </span>
                {h.note && <span className="text-text-muted">— {h.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </AppShell>
  );
}

function WorkflowActions({
  status,
  role,
  isOwnOrOverride,
  busy,
  act,
}: {
  status: CaseStatus;
  role: string | undefined;
  isOwnOrOverride: boolean;
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  const btn = "bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60";
  const btnDanger = "bg-status-error hover:opacity-90 text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60";
  const btnMuted = "bg-bg-secondary hover:bg-border text-text-primary text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60";

  const opsEditableStatuses: CaseStatus[] = ["NEW_APPLICATION", "BIO_DATA_SUBMITTED", "UNDER_OPS_REVIEW", "PFA_QUERY"];

  if (isOwnOrOverride && opsEditableStatuses.includes(status)) {
    return (
      <ActionPanel title="Ready to submit">
        <button disabled={busy} onClick={() => act("/ready-for-pfa")} className={btn}>
          Mark Ready for PFA Submission
        </button>
      </ActionPanel>
    );
  }

  if (isOwnOrOverride && status === "SUBMITTED_TO_PFA") {
    return (
      <ActionPanel title="Record PFA outcome">
        <button disabled={busy} onClick={() => act("/pfa-outcome", { outcome: "PFA_APPROVED" })} className={btn}>
          Approved
        </button>
        <button disabled={busy} onClick={() => act("/pfa-outcome", { outcome: "PFA_QUERY" })} className={btnMuted}>
          Query
        </button>
        <button disabled={busy} onClick={() => act("/pfa-outcome", { outcome: "PFA_REJECTED" })} className={btnDanger}>
          Rejected
        </button>
      </ActionPanel>
    );
  }

  if (isOwnOrOverride && status === "SUBMITTED_TO_PMB") {
    return (
      <ActionPanel title="Record Mortgage Bank outcome">
        <button disabled={busy} onClick={() => act("/pmb-outcome", { outcome: "PMB_APPROVED" })} className={btn}>
          Approved
        </button>
        <button disabled={busy} onClick={() => act("/pmb-outcome", { outcome: "PMB_QUERY" })} className={btnMuted}>
          Query
        </button>
        <button disabled={busy} onClick={() => act("/pmb-outcome", { outcome: "PMB_REJECTED" })} className={btnDanger}>
          Rejected
        </button>
      </ActionPanel>
    );
  }

  if (isOwnOrOverride && status === "PMB_QUERY") {
    return (
      <ActionPanel title="Query resolved">
        <button disabled={busy} onClick={() => act("/resubmit-to-pmb")} className={btn}>
          Resubmit to Mortgage Bank
        </button>
      </ActionPanel>
    );
  }

  if (isOwnOrOverride && status === "FUNDS_RELEASED_CONFIRMED") {
    return (
      <ActionPanel title="Next: transfer form">
        <button disabled={busy} onClick={() => act("/trigger-transfer-form")} className={btn}>
          Trigger Transfer Form
        </button>
      </ActionPanel>
    );
  }

  if (role === "ACCOUNTING" && status === "TRANSFER_SENT_TO_ACCOUNTING") {
    return (
      <ActionPanel title="Send transfer to Mortgage Bank">
        <button disabled={busy} onClick={() => act("/send-transfer-to-pmb")} className={btn}>
          Send to PMB
        </button>
      </ActionPanel>
    );
  }

  if (role === "MANAGEMENT" && status === "TRANSFER_SENT_TO_PMB") {
    return (
      <ActionPanel title="Confirm Mortgage Bank">
        <button disabled={busy} onClick={() => act("/confirm-mortgage-bank")} className={btn}>
          Confirm Mortgage Bank Received Transfer
        </button>
      </ActionPanel>
    );
  }

  if (role === "MANAGEMENT" && status === "MORTGAGE_BANK_CONFIRMED") {
    return (
      <ActionPanel title="Process payout">
        <button disabled={busy} onClick={() => act("/process-payout")} className={btn}>
          Process Payout &amp; Close Case
        </button>
      </ActionPanel>
    );
  }

  return null;
}

function ActionPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-base border border-border rounded-lg p-6">
      <h2 className="text-sm font-semibold text-text-primary mb-3">{title}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
