import type { FormTemplate } from "@penpath/shared";

export function validateFormData(template: FormTemplate, data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return ["Form data must be an object"];
  }
  const record = data as Record<string, unknown>;

  for (const field of template) {
    const value = record[field.key];
    const isEmpty = value === undefined || value === null || value === "";

    if (field.required && isEmpty) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (isEmpty) continue;

    if (field.type === "number" && typeof value !== "number") {
      errors.push(`${field.label} must be a number`);
    }
    if (field.type === "checkbox" && typeof value !== "boolean") {
      errors.push(`${field.label} must be true or false`);
    }
    if (field.type === "select" && field.options && !field.options.includes(String(value))) {
      errors.push(`${field.label} must be one of: ${field.options.join(", ")}`);
    }
  }

  return errors;
}
