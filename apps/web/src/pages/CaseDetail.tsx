import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { diffFormData, type CaseStatus } from "@penpath/shared";
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
  pensionBalance: string | null;
  dealValue: string | null;
  feeFlat: string;
  feePercent: string;
  feeBasis: "ACCESSED_AMOUNT" | "FULL_BALANCE";
  feeTotal: string | null;
  feeManuallyEdited: boolean;
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

        <FinancialsPanel
          data={data}
          canEditFinancials={isOwnOrOverride || ["ACCOUNTING", "MANAGEMENT", "SUPER_ADMIN"].includes(user?.role ?? "")}
          canOverrideFee={["ACCOUNTING", "MANAGEMENT", "SUPER_ADMIN"].includes(user?.role ?? "")}
          onSaved={reload}
          onError={setError}
        />

        <FormSubmissionsPanel caseId={data.id} formSubmissions={data.formSubmissions} pfaName={data.pfa.name} pmbName={data.pmb.name} />

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

        <ComplaintsPanel caseId={data.id} />
      </div>
    </AppShell>
  );
}

interface Complaint {
  id: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  resolutionNote: string | null;
  createdAt: string;
  raisedBy: { name: string; role: string };
}

const COMPLAINT_STATUS_STYLES: Record<Complaint["status"], string> = {
  OPEN: "bg-status-error/10 text-status-error",
  IN_PROGRESS: "bg-status-warning/10 text-status-warning",
  RESOLVED: "bg-status-success/10 text-status-success",
};

export function ComplaintsPanel({ caseId }: { caseId: string }) {
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function reload() {
    try {
      const data = await api.get<{ complaints: Complaint[] }>(`/api/complaints?caseId=${caseId}`);
      setComplaints(data.complaints);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load complaints");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function submit() {
    if (!description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/complaints", { caseId, description });
      setDescription("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to raise complaint");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-bg-base border border-border rounded-lg p-6">
      <h2 className="text-sm font-semibold text-text-primary mb-3">Complaints</h2>
      {error && <p className="text-sm text-status-error mb-2">{error}</p>}

      {complaints === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : complaints.length === 0 ? (
        <p className="text-sm text-text-muted mb-3">None yet.</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {complaints.map((c) => (
            <li key={c.id} className="text-sm border border-border rounded-md p-2">
              <div className="flex items-center justify-between">
                <span className="text-text-primary">{c.description}</span>
                <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${COMPLAINT_STATUS_STYLES[c.status]}`}>
                  {c.status.replaceAll("_", " ")}
                </span>
              </div>
              <div className="text-xs text-text-muted mt-1">
                {c.raisedBy.name} ({c.raisedBy.role}) · {new Date(c.createdAt).toLocaleString()}
              </div>
              {c.resolutionNote && <div className="text-xs text-text-muted mt-1">Resolution: {c.resolutionNote}</div>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the issue…"
          className="border border-border rounded-md px-3 py-1.5 text-sm flex-1"
        />
        <button
          onClick={submit}
          disabled={submitting || !description.trim()}
          className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60"
        >
          Raise complaint
        </button>
      </div>
    </div>
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

const FORM_TYPE_LABELS: Record<string, string> = {
  bio_data: "Bio Data",
  pfa_form: "PFA Form",
  pmb_form: "PMB Form",
};

function FormSubmissionsPanel({
  caseId,
  formSubmissions,
  pfaName,
  pmbName,
}: {
  caseId: string;
  formSubmissions: FormSubmission[];
  pfaName: string;
  pmbName: string;
}) {
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byType = new Map<string, FormSubmission[]>();
  for (const fs of formSubmissions) {
    const list = byType.get(fs.formType) ?? [];
    list.push(fs);
    byType.set(fs.formType, list);
  }
  // Each formType's versions arrive newest-first from the API; oldest-first is easier to diff against.
  for (const list of byType.values()) list.sort((a, b) => a.version - b.version);

  const labelFor = (formType: string) =>
    formType === "pfa_form" ? `${pfaName} Form` : formType === "pmb_form" ? `${pmbName} Form` : FORM_TYPE_LABELS[formType] ?? formType;

  async function downloadPdf(formType: string, version?: number) {
    setError(null);
    try {
      const q = version ? `?version=${version}` : "";
      await api.downloadFile(`/api/cases/${caseId}/form-submissions/${formType}/pdf${q}`, `${formType}-v${version ?? "latest"}.pdf`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to download PDF");
    }
  }

  if (byType.size === 0) return null;

  return (
    <div className="bg-bg-base border border-border rounded-lg p-6">
      <h2 className="text-sm font-semibold text-text-primary mb-3">Form Submissions</h2>
      {error && <p className="text-sm text-status-error mb-2">{error}</p>}

      <div className="space-y-4">
        {Array.from(byType.entries()).map(([formType, versions]) => {
          const latest = versions[versions.length - 1];
          return (
            <div key={formType} className="border border-border rounded-md p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-text-primary">{labelFor(formType)}</span>
                  <span className="ml-2 text-xs text-text-muted">v{latest.version}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => downloadPdf(formType, latest.version)} className="text-accent hover:text-accent-light text-xs font-medium">
                    Download PDF
                  </button>
                  {versions.length > 1 && (
                    <button
                      onClick={() => setExpandedType(expandedType === formType ? null : formType)}
                      className="text-brand-primary hover:text-brand-dark text-xs font-medium"
                    >
                      {expandedType === formType ? "Hide history" : `Version history (${versions.length})`}
                    </button>
                  )}
                </div>
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(latest.data).map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <dt className="text-text-muted inline">{key.replaceAll("_", " ")}: </dt>
                    <dd className="text-text-primary inline">{String(value)}</dd>
                  </div>
                ))}
              </dl>

              {expandedType === formType && (
                <div className="mt-3 pt-3 border-t border-border space-y-3">
                  {versions.slice(1).map((version, i) => {
                    const previous = versions[i];
                    const diffs = diffFormData(
                      previous.data as Record<string, unknown>,
                      version.data as Record<string, unknown>,
                    );
                    return (
                      <div key={version.id} className="text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-text-primary">
                            v{previous.version} → v{version.version}
                          </span>
                          <button onClick={() => downloadPdf(formType, version.version)} className="text-accent hover:text-accent-light">
                            PDF
                          </button>
                        </div>
                        {diffs.length === 0 ? (
                          <p className="text-text-muted">No field changes.</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {diffs.map((d) => (
                              <li key={d.key}>
                                <span className="text-text-muted">{d.key.replaceAll("_", " ")}: </span>
                                {d.kind === "added" && <span className="text-status-success">+ {String(d.to)}</span>}
                                {d.kind === "removed" && <span className="text-status-error line-through">{String(d.from)}</span>}
                                {d.kind === "changed" && (
                                  <span>
                                    <span className="text-status-error line-through">{String(d.from)}</span>{" "}
                                    <span className="text-status-success">→ {String(d.to)}</span>
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinancialsPanel({
  data,
  canEditFinancials,
  canOverrideFee,
  onSaved,
  onError,
}: {
  data: CaseDetailData;
  canEditFinancials: boolean;
  canOverrideFee: boolean;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [pensionBalance, setPensionBalance] = useState(data.pensionBalance ?? "");
  const [dealValue, setDealValue] = useState(data.dealValue ?? "");
  const [feeOverride, setFeeOverride] = useState(data.feeTotal ?? "");
  const [savingFinancials, setSavingFinancials] = useState(false);
  const [savingFee, setSavingFee] = useState(false);

  async function saveFinancials() {
    setSavingFinancials(true);
    try {
      const body: Record<string, number> = {};
      if (pensionBalance !== "") body.pensionBalance = Number(pensionBalance);
      if (dealValue !== "") body.dealValue = Number(dealValue);
      await api.patch(`/api/cases/${data.id}/financials`, body);
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to save financials");
    } finally {
      setSavingFinancials(false);
    }
  }

  async function saveFeeOverride() {
    setSavingFee(true);
    try {
      await api.patch(`/api/cases/${data.id}/fee`, { feeTotal: Number(feeOverride) });
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to override fee");
    } finally {
      setSavingFee(false);
    }
  }

  return (
    <div className="bg-bg-base border border-border rounded-lg p-6">
      <h2 className="text-sm font-semibold text-text-primary mb-3">Financials</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <div className="text-xs text-text-muted mb-1">Pension balance</div>
          {canEditFinancials ? (
            <input
              type="number"
              value={pensionBalance}
              onChange={(e) => setPensionBalance(e.target.value)}
              className="w-full border border-border rounded-md px-2 py-1 text-sm"
            />
          ) : (
            <div className="text-sm text-text-primary">{data.pensionBalance ?? "—"}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-text-muted mb-1">Deal value</div>
          {canEditFinancials ? (
            <input
              type="number"
              value={dealValue}
              onChange={(e) => setDealValue(e.target.value)}
              className="w-full border border-border rounded-md px-2 py-1 text-sm"
            />
          ) : (
            <div className="text-sm text-text-primary">{data.dealValue ?? "—"}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-text-muted mb-1">Fee basis</div>
          <div className="text-sm text-text-primary">{data.feeBasis === "ACCESSED_AMOUNT" ? "Accessed amount" : "Full balance"}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted mb-1">Fee total</div>
          <div className="text-sm font-medium text-brand-primary">
            {data.feeTotal ?? "—"}
            {data.feeManuallyEdited && <span className="ml-1 text-xs text-accent">(manual)</span>}
          </div>
        </div>
      </div>

      {canEditFinancials && (
        <button
          onClick={saveFinancials}
          disabled={savingFinancials}
          className="bg-brand-primary hover:bg-brand-dark text-white text-xs font-medium rounded-md px-3 py-1.5 disabled:opacity-60"
        >
          {savingFinancials ? "Saving…" : "Save pension balance & deal value"}
        </button>
      )}

      {canOverrideFee && (
        <div className="mt-4 pt-4 border-t border-border flex items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Manual fee override (₦)</label>
            <input
              type="number"
              value={feeOverride}
              onChange={(e) => setFeeOverride(e.target.value)}
              className="border border-border rounded-md px-2 py-1 text-sm w-40"
            />
          </div>
          <button
            onClick={saveFeeOverride}
            disabled={savingFee || feeOverride === ""}
            className="bg-accent hover:bg-accent-light text-white text-xs font-medium rounded-md px-3 py-1.5 disabled:opacity-60"
          >
            {savingFee ? "Saving…" : "Override fee"}
          </button>
        </div>
      )}
    </div>
  );
}

function ActionPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-base border border-border rounded-lg p-6">
      <h2 className="text-sm font-semibold text-text-primary mb-3">{title}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
