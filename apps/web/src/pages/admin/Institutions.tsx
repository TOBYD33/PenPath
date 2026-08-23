import { useEffect, useState, type FormEvent } from "react";
import type { FormFieldDef, InstitutionType } from "@penpath/shared";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../lib/api";
import { FormTemplateBuilder } from "./FormTemplateBuilder";

interface Institution {
  id: string;
  type: InstitutionType;
  name: string;
  active: boolean;
  formTemplate: FormFieldDef[];
  createdAt: string;
}

interface FeeDefault {
  id: string;
  feeFlat: string;
  feePercent: string;
  feeBasis: "ACCESSED_AMOUNT" | "FULL_BALANCE";
}

export default function Institutions() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState<InstitutionType | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await api.get<{ institutions: Institution[] }>("/api/institutions");
      setInstitutions(data.institutions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load institutions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function saveTemplate(id: string, formTemplate: FormFieldDef[]) {
    try {
      await api.patch(`/api/institutions/${id}`, { formTemplate });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save form template");
    }
  }

  async function toggleActive(inst: Institution) {
    try {
      await api.patch(`/api/institutions/${inst.id}`, { active: !inst.active });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-text-primary mb-4">Institutions & Fee Defaults</h1>
      {error && <p className="text-sm text-status-error mb-4">{error}</p>}

      <FeeDefaultsPanel onError={setError} />

      {(["PFA", "PMB"] as const).map((type) => (
        <section key={type} className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {type === "PFA" ? "Pension Fund Administrators" : "Mortgage Banks"}
            </h2>
            <button
              onClick={() => setShowCreate(showCreate === type ? null : type)}
              className="text-accent hover:text-accent-light text-xs font-medium"
            >
              {showCreate === type ? "Cancel" : `+ New ${type}`}
            </button>
          </div>

          {showCreate === type && (
            <CreateInstitutionForm
              type={type}
              onCreated={() => {
                setShowCreate(null);
                reload();
              }}
              onError={setError}
            />
          )}

          <div className="bg-bg-base border border-border rounded-lg divide-y divide-border">
            {loading ? (
              <p className="px-4 py-3 text-sm text-text-muted">Loading…</p>
            ) : (
              institutions
                .filter((i) => i.type === type)
                .map((inst) => (
                  <div key={inst.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-text-primary">{inst.name}</span>
                        <span className="ml-2 text-xs text-text-muted">
                          {inst.formTemplate.length} field{inst.formTemplate.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleActive(inst)}
                          className={`text-xs font-medium rounded-full px-3 py-1 ${
                            inst.active
                              ? "bg-status-success/10 text-status-success"
                              : "bg-status-error/10 text-status-error"
                          }`}
                        >
                          {inst.active ? "Active" : "Inactive"}
                        </button>
                        <button
                          onClick={() => setExpanded(expanded === inst.id ? null : inst.id)}
                          className="text-accent hover:text-accent-light text-xs font-medium"
                        >
                          {expanded === inst.id ? "Hide form" : "Edit form"}
                        </button>
                      </div>
                    </div>

                    {expanded === inst.id && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <TemplateEditor institution={inst} onSave={(fields) => saveTemplate(inst.id, fields)} />
                      </div>
                    )}
                  </div>
                ))
            )}
            {!loading && institutions.filter((i) => i.type === type).length === 0 && (
              <p className="px-4 py-3 text-sm text-text-muted">None yet.</p>
            )}
          </div>
        </section>
      ))}
    </AppShell>
  );
}

function TemplateEditor({ institution, onSave }: { institution: Institution; onSave: (fields: FormFieldDef[]) => void }) {
  const [fields, setFields] = useState<FormFieldDef[]>(institution.formTemplate);
  const [dirty, setDirty] = useState(false);

  return (
    <div>
      <FormTemplateBuilder
        fields={fields}
        onChange={(f) => {
          setFields(f);
          setDirty(true);
        }}
      />
      <button
        onClick={() => {
          onSave(fields);
          setDirty(false);
        }}
        disabled={!dirty}
        className="mt-3 bg-brand-primary hover:bg-brand-dark text-white text-xs font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
      >
        Save form template
      </button>
    </div>
  );
}

function CreateInstitutionForm({
  type,
  onCreated,
  onError,
}: {
  type: InstitutionType;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [fields, setFields] = useState<FormFieldDef[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/api/institutions", { type, name, formTemplate: fields });
      setName("");
      setFields([]);
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to create institution");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg-base border border-border rounded-lg p-4 mb-3">
      <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border border-border rounded-md px-3 py-1.5 text-sm mb-3 w-full max-w-sm"
      />
      <label className="block text-xs font-medium text-text-muted mb-1">Form fields</label>
      <FormTemplateBuilder fields={fields} onChange={setFields} />
      <button
        type="submit"
        disabled={submitting}
        className="mt-3 bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60"
      >
        {submitting ? "Creating…" : "Create"}
      </button>
    </form>
  );
}

function FeeDefaultsPanel({ onError }: { onError: (msg: string) => void }) {
  const [feeDefault, setFeeDefault] = useState<FeeDefault | null>(null);
  const [feeFlat, setFeeFlat] = useState("");
  const [feePercent, setFeePercent] = useState("");
  const [feeBasis, setFeeBasis] = useState<"ACCESSED_AMOUNT" | "FULL_BALANCE">("ACCESSED_AMOUNT");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const data = await api.get<{ feeDefault: FeeDefault }>("/api/settings/fee-defaults");
      setFeeDefault(data.feeDefault);
      setFeeFlat(data.feeDefault.feeFlat);
      setFeePercent(data.feeDefault.feePercent);
      setFeeBasis(data.feeDefault.feeBasis);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to load fee defaults");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch("/api/settings/fee-defaults", {
        feeFlat: Number(feeFlat),
        feePercent: Number(feePercent),
        feeBasis,
      });
      await load();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to save fee defaults");
    } finally {
      setSaving(false);
    }
  }

  if (!feeDefault) return null;

  return (
    <section className="mb-8 bg-bg-base border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-text-primary mb-3">Fee structure defaults</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Flat fee (₦)</label>
          <input
            type="number"
            value={feeFlat}
            onChange={(e) => setFeeFlat(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm w-32"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Percent (%)</label>
          <input
            type="number"
            value={feePercent}
            onChange={(e) => setFeePercent(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm w-24"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Basis</label>
          <select
            value={feeBasis}
            onChange={(e) => setFeeBasis(e.target.value as "ACCESSED_AMOUNT" | "FULL_BALANCE")}
            className="border border-border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="ACCESSED_AMOUNT">Accessed amount</option>
            <option value="FULL_BALANCE">Full balance</option>
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-xs text-text-muted mt-2">
        Applies to new cases only. Existing cases keep their fee unless edited by Accounting/Management.
      </p>
    </section>
  );
}
