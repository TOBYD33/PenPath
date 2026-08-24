import { useEffect, useState, type FormEvent } from "react";
import type { LinkStatus } from "@penpath/shared";
import { AppShell } from "../components/AppShell";
import { api, ApiError } from "../lib/api";

interface ClientLink {
  id: string;
  token: string;
  url: string;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  status: LinkStatus;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  generatedBy: { id: string; name: string };
  case: { id: string; status: string } | null;
}

const STATUS_STYLES: Record<LinkStatus, string> = {
  UNUSED: "bg-status-warning/10 text-status-warning",
  USED: "bg-status-success/10 text-status-success",
  EXPIRED: "bg-bg-secondary text-text-muted",
  REVOKED: "bg-status-error/10 text-status-error",
};

export default function GenerateLink() {
  const [links, setLinks] = useState<ClientLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [submitting, setSubmitting] = useState(false);
  const [justCreated, setJustCreated] = useState<{ url: string } | null>(null);

  async function reload() {
    try {
      const data = await api.get<{ links: ClientLink[] }>("/api/links");
      setLinks(data.links);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load links");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ clientLink: ClientLink; url: string }>("/api/links", {
        clientName: clientName || undefined,
        clientPhone: clientPhone || undefined,
        clientEmail: clientEmail || undefined,
        expiresInDays: Number(expiresInDays) || undefined,
      });
      setJustCreated({ url: res.url });
      setClientName("");
      setClientPhone("");
      setClientEmail("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate link");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch {
      // clipboard API unavailable — the link is still visible to copy manually
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await api.post(`/api/links/${id}/revoke`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke link");
    }
  }

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-text-primary mb-4">Generate Application Link</h1>
      {error && <p className="text-sm text-status-error mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="bg-bg-base border border-border rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Client name (optional)</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="border border-border rounded-md px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Phone (optional)</label>
          <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="border border-border rounded-md px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Email (optional)</label>
          <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="border border-border rounded-md px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Expires in (days)</label>
          <input
            type="number"
            min={1}
            max={90}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm w-24"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60"
        >
          {submitting ? "Generating…" : "Generate link"}
        </button>
      </form>

      {justCreated && (
        <div className="bg-bg-base border border-border rounded-lg p-4 mb-6 flex items-center gap-3">
          <code className="text-sm text-text-primary bg-bg-secondary rounded px-2 py-1 flex-1 truncate">{justCreated.url}</code>
          <button
            onClick={() => copyToClipboard(justCreated.url, "just-created")}
            className="bg-accent hover:bg-accent-light text-white text-xs font-medium rounded-md px-3 py-1.5 whitespace-nowrap"
          >
            {copiedId === "just-created" ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}

      <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Generated by</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Link</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {links === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                  Loading…
                </td>
              </tr>
            ) : links.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                  No links generated yet.
                </td>
              </tr>
            ) : (
              links.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-text-primary">{l.clientName ?? l.clientEmail ?? "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{l.generatedBy.name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium rounded-full px-3 py-1 ${STATUS_STYLES[l.status]}`}>{l.status}</span>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{new Date(l.expiresAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => copyToClipboard(l.url, l.id)} className="text-accent hover:text-accent-light text-xs font-medium">
                      {copiedId === l.id ? "Copied!" : "Copy"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {l.status === "UNUSED" && (
                      <button onClick={() => revoke(l.id)} className="text-status-error hover:opacity-80 text-xs font-medium">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
