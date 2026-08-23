import { useEffect, useState, type FormEvent } from "react";
import { BIO_DATA_TEMPLATE, type FormFieldDef } from "@penpath/shared";
import { api, ApiError } from "../../lib/api";
import { DynamicFormRenderer } from "../../components/DynamicFormRenderer";

interface Institution {
  id: string;
  name: string;
  formTemplate: FormFieldDef[];
}

export function IntakeForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [pfas, setPfas] = useState<Institution[]>([]);
  const [pmbs, setPmbs] = useState<Institution[]>([]);
  const [pfaId, setPfaId] = useState("");
  const [pmbId, setPmbId] = useState("");
  const [bioData, setBioData] = useState<Record<string, unknown>>({});
  const [pfaForm, setPfaForm] = useState<Record<string, unknown>>({});
  const [pmbForm, setPmbForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
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
    if (!pfaId || !pmbId) {
      setError("Please select your PFA and Mortgage Bank");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/cases/intake", { pfaId, pmbId, bioData, pfaForm, pmbForm });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg-base border border-border rounded-lg p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-1">Apply for mortgage equity access</h2>
        <p className="text-sm text-text-muted">Select your institutions and fill in your details below.</p>
      </div>

      {error && <p className="text-sm text-status-error">{error}</p>}

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
        <h3 className="text-sm font-semibold text-text-primary mb-2">Your details</h3>
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
        {submitting ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
