import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { BIO_DATA_TEMPLATE, type FormFieldDef } from "@penpath/shared";
import { api, ApiError } from "../lib/api";
import { DynamicFormRenderer } from "../components/DynamicFormRenderer";

interface Institution {
  id: string;
  name: string;
  formTemplate: FormFieldDef[];
}

interface ApplyData {
  pfas: Institution[];
  pmbs: Institution[];
  prefill: { clientName: string | null; clientPhone: string | null; clientEmail: string | null };
}

type LoadState = "loading" | "invalid" | "ready" | "submitted";

export default function ApplyPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<ApplyData | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [pfaId, setPfaId] = useState("");
  const [pmbId, setPmbId] = useState("");
  const [bioData, setBioData] = useState<Record<string, unknown>>({});
  const [pfaForm, setPfaForm] = useState<Record<string, unknown>>({});
  const [pmbForm, setPmbForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<ApplyData>(`/api/apply/${token}`)
      .then((res) => {
        setData(res);
        setClientName(res.prefill.clientName ?? "");
        setClientPhone(res.prefill.clientPhone ?? "");
        setClientEmail(res.prefill.clientEmail ?? "");
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const selectedPfa = data?.pfas.find((p) => p.id === pfaId);
  const selectedPmb = data?.pmbs.find((p) => p.id === pmbId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pfaId || !pmbId) {
      setError("Please select your PFA and Mortgage Bank");
      return;
    }
    if (!clientEmail) {
      setError("An email address is required");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/apply/${token}`, {
        pfaId,
        pmbId,
        bioData,
        pfaForm,
        pmbForm,
        clientName: clientName || undefined,
        clientPhone: clientPhone || undefined,
        clientEmail,
      });
      setState("submitted");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit your application");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary p-6">
        <div className="w-full max-w-sm bg-bg-base border border-border rounded-lg shadow-sm p-8 text-center">
          <h1 className="text-lg font-semibold text-text-primary mb-2">Link unavailable</h1>
          <p className="text-sm text-text-muted">This link has expired or already been used. Please contact PEMWO Property Ltd. for a new one.</p>
        </div>
      </div>
    );
  }

  if (state === "submitted") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary p-6">
        <div className="w-full max-w-sm bg-bg-base border border-border rounded-lg shadow-sm p-8 text-center">
          <h1 className="text-lg font-semibold text-brand-primary mb-2">Application received</h1>
          <p className="text-sm text-text-muted">Thank you — our team will be in touch shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-secondary py-10 px-4">
      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto bg-bg-base border border-border rounded-lg p-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-brand-primary mb-1">PenPath</h1>
          <p className="text-sm text-text-muted">Apply for mortgage equity access with PEMWO Property Ltd.</p>
        </div>

        {error && <p className="text-sm text-status-error">{error}</p>}

        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-2">Your contact info</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Full name</label>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Email <span className="text-status-error">*</span>
              </label>
              <input
                required
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full border border-border rounded-md px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Phone</label>
              <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Pension Fund Administrator</label>
            <select required value={pfaId} onChange={(e) => setPfaId(e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm">
              <option value="" disabled>
                Select…
              </option>
              {data?.pfas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Mortgage Bank</label>
            <select required value={pmbId} onChange={(e) => setPmbId(e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm">
              <option value="" disabled>
                Select…
              </option>
              {data?.pmbs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-2">Your details</h2>
          <DynamicFormRenderer template={BIO_DATA_TEMPLATE} values={bioData} onChange={(key, value) => setBioData((d) => ({ ...d, [key]: value }))} />
        </div>

        {selectedPfa && (
          <div>
            <h2 className="text-sm font-semibold text-text-primary mb-2">{selectedPfa.name} details</h2>
            <DynamicFormRenderer template={selectedPfa.formTemplate} values={pfaForm} onChange={(key, value) => setPfaForm((d) => ({ ...d, [key]: value }))} />
          </div>
        )}

        {selectedPmb && (
          <div>
            <h2 className="text-sm font-semibold text-text-primary mb-2">{selectedPmb.name} details</h2>
            <DynamicFormRenderer template={selectedPmb.formTemplate} values={pmbForm} onChange={(key, value) => setPmbForm((d) => ({ ...d, [key]: value }))} />
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-5 py-2.5 disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit application"}
        </button>
      </form>
    </div>
  );
}
