import type { Role } from "./enums.js";

export const PERMISSIONS = [
  "case:read:own",
  "case:read:assigned",
  "case:read:all",
  "case:edit:assigned",
  "case:edit:all",
  "case:assign",
  "institution:manage",
  "user:manage",
  "permission:manage",
  "audit:read:all",
  "transferform:review",
  "complaint:manage",
  "dashboard:revenue",
  "dashboard:activity",
  "case:override",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Default permissions per role. Super Admin can grant/revoke individual
 * permissions per-user on top of these via the Permission join table. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  CLIENT: ["case:read:own"],
  CUSTOMER_CARE: ["case:read:all", "complaint:manage"],
  OPS_OFFICER: ["case:read:assigned", "case:edit:assigned"],
  OPS_SUPERVISOR: ["case:read:all", "case:assign", "dashboard:activity"],
  ACCOUNTING: ["case:read:all", "transferform:review"],
  MANAGEMENT: ["case:read:all", "dashboard:revenue", "dashboard:activity"],
  ADMIN: ["institution:manage", "case:read:all"],
  SUPER_ADMIN: [
    "case:read:all",
    "case:edit:all",
    "case:assign",
    "case:override",
    "institution:manage",
    "user:manage",
    "permission:manage",
    "audit:read:all",
    "transferform:review",
    "complaint:manage",
    "dashboard:revenue",
    "dashboard:activity",
  ],
};
