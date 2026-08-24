export interface FormFieldDiff {
  key: string;
  kind: "added" | "removed" | "changed";
  from?: unknown;
  to?: unknown;
}

/** Shallow diff between two form-submission `data` snapshots — used to
 * render the version-history UI (Phase 9). */
export function diffFormData(
  older: Record<string, unknown>,
  newer: Record<string, unknown>,
): FormFieldDiff[] {
  const diffs: FormFieldDiff[] = [];
  const keys = new Set([...Object.keys(older), ...Object.keys(newer)]);

  for (const key of keys) {
    const hasOld = Object.prototype.hasOwnProperty.call(older, key);
    const hasNew = Object.prototype.hasOwnProperty.call(newer, key);

    if (!hasOld && hasNew) {
      diffs.push({ key, kind: "added", to: newer[key] });
    } else if (hasOld && !hasNew) {
      diffs.push({ key, kind: "removed", from: older[key] });
    } else if (JSON.stringify(older[key]) !== JSON.stringify(newer[key])) {
      diffs.push({ key, kind: "changed", from: older[key], to: newer[key] });
    }
  }

  return diffs.sort((a, b) => a.key.localeCompare(b.key));
}
