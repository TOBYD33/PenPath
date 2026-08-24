import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Complaint {
  id: string;
  caseId: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  resolutionNote: string | null;
  createdAt: string;
  raisedBy: { id: string; name: string; role: string };
  assignedOfficer: { id: string; name: string } | null;
}

const STATUS_STYLES: Record<Complaint["status"], string> = {
  OPEN: "bg-status-error/10 text-status-error",
  IN_PROGRESS: "bg-status-warning/10 text-status-warning",
  RESOLVED: "bg-status-success/10 text-status-success",
};

export default function Complaints() {
  const { user } = useAuth();
  const canManage = user?.role === "CUSTOMER_CARE" || user?.role === "SUPER_ADMIN";

  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  async function reload() {
    try {
      const data = await api.get<{ complaints: Complaint[] }>("/api/complaints");
      setComplaints(data.complaints);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load complaints");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function updateStatus(id: string, status: "IN_PROGRESS" | "RESOLVED", note?: string) {
    setError(null);
    try {
      await api.patch(`/api/complaints/${id}`, { status, resolutionNote: note });
      setResolvingId(null);
      setResolutionNote("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update complaint");
    }
  }

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-text-primary mb-4">Complaints</h1>
      {error && <p className="text-sm text-status-error mb-4">{error}</p>}

      <div className="bg-bg-base border border-border rounded-lg divide-y divide-border">
        {complaints === null ? (
          <p className="px-4 py-6 text-sm text-text-muted text-center">Loading…</p>
        ) : complaints.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-muted text-center">No complaints.</p>
        ) : (
          complaints.map((c) => (
            <div key={c.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-text-primary">{c.description}</p>
                  <p className="text-xs text-text-muted mt-1">
                    Raised by {c.raisedBy.name} ({c.raisedBy.role}) · {new Date(c.createdAt).toLocaleString()} ·{" "}
                    <Link to={`/cases/${c.caseId}`} className="text-accent hover:text-accent-light">
                      View case
                    </Link>
                    {c.assignedOfficer && <> · Flagged to {c.assignedOfficer.name}</>}
                  </p>
                  {c.resolutionNote && <p className="text-xs text-text-muted mt-1">Resolution: {c.resolutionNote}</p>}
                </div>
                <span className={`text-xs font-medium rounded-full px-3 py-1 whitespace-nowrap ${STATUS_STYLES[c.status]}`}>
                  {c.status.replaceAll("_", " ")}
                </span>
              </div>

              {canManage && c.status !== "RESOLVED" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {c.status === "OPEN" && (
                    <button
                      onClick={() => updateStatus(c.id, "IN_PROGRESS")}
                      className="bg-bg-secondary hover:bg-border text-text-primary text-xs font-medium rounded-md px-3 py-1.5"
                    >
                      Mark In Progress
                    </button>
                  )}
                  {resolvingId === c.id ? (
                    <>
                      <input
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        placeholder="Resolution note"
                        className="border border-border rounded-md px-2 py-1 text-xs w-64"
                      />
                      <button
                        onClick={() => updateStatus(c.id, "RESOLVED", resolutionNote)}
                        disabled={!resolutionNote}
                        className="bg-brand-primary hover:bg-brand-dark text-white text-xs font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
                      >
                        Confirm resolve
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setResolvingId(c.id)}
                      className="bg-brand-primary hover:bg-brand-dark text-white text-xs font-medium rounded-md px-3 py-1.5"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
