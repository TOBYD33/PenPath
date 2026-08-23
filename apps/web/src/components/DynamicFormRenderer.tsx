import type { FormFieldDef, FormTemplate } from "@penpath/shared";

interface Props {
  template: FormTemplate;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export function DynamicFormRenderer({ template, values, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {template.map((field) => (
        <FieldInput key={field.key} field={field} value={values[field.key]} onChange={(v) => onChange(field.key, v)} />
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = (
    <label className="block text-xs font-medium text-text-muted mb-1">
      {field.label}
      {field.required && <span className="text-status-error"> *</span>}
    </label>
  );

  const inputClass = "w-full border border-border rounded-md px-3 py-1.5 text-sm";

  if (field.type === "textarea") {
    return (
      <div className="sm:col-span-2">
        {label}
        <textarea
          required={field.required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          rows={3}
        />
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div>
        {label}
        <select
          required={field.required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            Select…
          </option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <div className="flex items-center gap-2 pt-5">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          id={`field-${field.key}`}
        />
        <label htmlFor={`field-${field.key}`} className="text-sm text-text-primary">
          {field.label}
        </label>
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        required={field.required}
        value={(value as string | number) ?? ""}
        onChange={(e) => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)}
        className={inputClass}
      />
    </div>
  );
}
