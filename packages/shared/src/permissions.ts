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
  "fee:override",
  "case:generate-link",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Default permissions per role. Super Admin can grant/revoke individual
 * permissions per-user on top of these via the Permission join table. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  CLIENT: ["case:read:own"],
  CUSTOMER_CARE: ["case:read:all", "complaint:manage"],
  OPS_OFFICER: ["case:read:assigned", "case:edit:assigned"],
  OPS_SUPERVISOR: ["case:read:all", "case:assign", "dashboard:activity"],
  ACCOUNTING: ["case:read:all", "transferform:review", "fee:override"],
  MANAGEMENT: ["case:read:all", "dashboard:revenue", "dashboard:activity", "fee:override"],
  ADMIN: ["institution:manage", "case:read:all", "case:assign", "case:generate-link"],
  SUPER_ADMIN: [
    "case:read:all",
    "case:edit:all",
    "case:assign",
    "case:override",
    "fee:override",
    "institution:manage",
    "user:manage",
    "permission:manage",
    "audit:read:all",
    "transferform:review",
    "complaint:manage",
    "dashboard:revenue",
    "dashboard:activity",
    "case:generate-link",
  ],
};
