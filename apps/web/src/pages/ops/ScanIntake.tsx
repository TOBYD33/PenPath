import { useEffect, useState, type FormEvent } from "react";
import { BIO_DATA_TEMPLATE, type FormFieldDef } from "@penpath/shared";
import { AppShell } from "../../components/AppShell";
import { DynamicFormRenderer } from "../../components/DynamicFormRenderer";
import { api, ApiError } from "../../lib/api";

interface Institution {
  id: string;
  name: string;
  formTemplate: FormFieldDef[];
}

export default function ScanIntake() {
  const [pfas, setPfas] = useState<Institution[]>([]);
  const [pmbs, setPmbs] = useState<Institution[]>([]);
  const [pfaId, setPfaId] = useState("");
  const [pmbId, setPmbId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [bioData, setBioData] = useState<Record<string, unknown>>({});
  const [pfaForm, setPfaForm] = useState<Record<string, unknown>>({});
  const [pmbForm, setPmbForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ institutions: Institution[] }>("/api/institutions?type=PFA").then((d) => setPfas(d.institutions));
    api.get<{ institutions: Institution[] }>("/api/institutions?type=PMB").then((d) => setPmbs(d.institutions));
  }, []);

  const selectedPfa = pfas.find((p) => p.id === pfaId);
  const selectedPmb = pmbs.find((p) => p.id === pmbId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!pfaId || !pmbId || !file) {
      setError("PFA, PMB, and the scanned form are all required");
      return;
    }
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("clientName", clientName);
      formData.append("clientEmail", clientEmail);
      if (clientPhone) formData.append("clientPhone", clientPhone);
      formData.append("pfaId", pfaId);
      formData.append("pmbId", pmbId);
      formData.append("bioData", JSON.stringify(bioData));
      formData.append("pfaForm", JSON.stringify(pfaForm));
      formData.append("pmbForm", JSON.stringify(pmbForm));
      formData.append("scannedForm", file);

      await api.postForm("/api/cases/scan-intake", formData);
      setSuccess("Case created from scanned form.");
      setClientName("");
      setClientEmail("");
      setClientPhone("");
      setFile(null);
      setBioData({});
      setPfaForm({});
      setPmbForm({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit scanned intake");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <form onSubmit={handleSubmit} className="bg-bg-base border border-border rounded-lg p-6 max-w-2xl space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-1">Scan intake</h2>
          <p className="text-sm text-text-muted">
            Upload the scanned physical form, then key in the same fields the client would fill digitally.
          </p>
        </div>

        {error && <p className="text-sm text-status-error">{error}</p>}
        {success && <p className="text-sm text-status-success">{success}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Client name</label>
            <input
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Client email</label>
            <input
              required
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Client phone</label>
            <input
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Scanned form file</label>
            <input
              required
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Pension Fund Administrator</label>
            <select
              required
              value={pfaId}
              onChange={(e) => setPfaId(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-1.5 text-sm"
            >
              <option value="" disabled>
                Select…
              </option>
              {pfas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Mortgage Bank</label>
            <select
              required
              value={pmbId}
              onChange={(e) => setPmbId(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-1.5 text-sm"
            >
              <option value="" disabled>
                Select…
              </option>
              {pmbs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-2">Bio data</h3>
          <DynamicFormRenderer
            template={BIO_DATA_TEMPLATE}
            values={bioData}
            onChange={(key, value) => setBioData((d) => ({ ...d, [key]: value }))}
          />
        </div>

        {selectedPfa && (
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-2">{selectedPfa.name} details</h3>
            <DynamicFormRenderer
              template={selectedPfa.formTemplate}
              values={pfaForm}
              onChange={(key, value) => setPfaForm((d) => ({ ...d, [key]: value }))}
            />
          </div>
        )}

        {selectedPmb && (
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-2">{selectedPmb.name} details</h3>
            <DynamicFormRenderer
              template={selectedPmb.formTemplate}
              values={pmbForm}
              onChange={(key, value) => setPmbForm((d) => ({ ...d, [key]: value }))}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-5 py-2.5 disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Create case"}
        </button>
      </form>
    </AppShell>
  );
}
