import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@penpath/shared";

describe("default role permissions", () => {
  it("only grants user:manage and permission:manage to Super Admin", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (role === "SUPER_ADMIN") continue;
      expect(perms).not.toContain("user:manage");
      expect(perms).not.toContain("permission:manage");
    }
    expect(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN).toContain("user:manage");
  });

  it("restricts CLIENT to reading only their own case", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CLIENT).toEqual(["case:read:own"]);
  });

  it("restricts OPS_OFFICER to assigned cases only, not all cases", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OPS_OFFICER).not.toContain("case:read:all");
    expect(DEFAULT_ROLE_PERMISSIONS.OPS_OFFICER).not.toContain("case:edit:all");
  });
});
