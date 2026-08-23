import { FORM_FIELD_TYPES, type FormFieldDef, type FormFieldType } from "@penpath/shared";

interface Props {
  fields: FormFieldDef[];
  onChange: (fields: FormFieldDef[]) => void;
}

function emptyField(): FormFieldDef {
  return { key: "", label: "", type: "text", required: false };
}

export function FormTemplateBuilder({ fields, onChange }: Props) {
  function updateField(index: number, patch: Partial<FormFieldDef>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function addField() {
    onChange([...fields, emptyField()]);
  }

  return (
    <div className="space-y-2">
      {fields.length === 0 && <p className="text-xs text-text-muted">No fields yet.</p>}
      {fields.map((field, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2 bg-bg-secondary border border-border rounded-md p-2">
          <input
            placeholder="key (e.g. rsa_pin)"
            value={field.key}
            onChange={(e) => updateField(i, { key: e.target.value })}
            className="border border-border rounded-md px-2 py-1 text-xs w-32"
          />
          <input
            placeholder="Label"
            value={field.label}
            onChange={(e) => updateField(i, { label: e.target.value })}
            className="border border-border rounded-md px-2 py-1 text-xs w-40"
          />
          <select
            value={field.type}
            onChange={(e) => updateField(i, { type: e.target.value as FormFieldType })}
            className="border border-border rounded-md px-2 py-1 text-xs"
          >
            {FORM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {field.type === "select" && (
            <input
              placeholder="comma,separated,options"
              value={(field.options ?? []).join(",")}
              onChange={(e) => updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              className="border border-border rounded-md px-2 py-1 text-xs w-48"
            />
          )}
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => updateField(i, { required: e.target.checked })}
            />
            required
          </label>
          <button type="button" onClick={() => removeField(i)} className="text-status-error text-xs font-medium ml-auto">
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addField}
        className="text-accent hover:text-accent-light text-xs font-medium"
      >
        + Add field
      </button>
    </div>
  );
}
