import { describe, expect, it } from "vitest";
import { diffFormData } from "@penpath/shared";

describe("diffFormData", () => {
  it("detects added, removed, and changed fields", () => {
    const older = { full_name: "Ada", phone: "0800", extra: "gone" };
    const newer = { full_name: "Ada Okoye", phone: "0800", added_field: "new" };

    const diffs = diffFormData(older, newer);

    expect(diffs).toEqual([
      { key: "added_field", kind: "added", to: "new" },
      { key: "extra", kind: "removed", from: "gone" },
      { key: "full_name", kind: "changed", from: "Ada", to: "Ada Okoye" },
    ]);
  });

  it("returns no diffs for identical data", () => {
    const data = { a: 1, b: "x" };
    expect(diffFormData(data, { ...data })).toEqual([]);
  });

  it("does not flag unchanged fields, even when other fields change", () => {
    const older = { a: 1, b: 2 };
    const newer = { a: 1, b: 3 };
    const diffs = diffFormData(older, newer);
    expect(diffs).toEqual([{ key: "b", kind: "changed", from: 2, to: 3 }]);
  });
});
