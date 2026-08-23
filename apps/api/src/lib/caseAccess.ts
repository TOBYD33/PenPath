import type { Role } from "@penpath/shared";
import { EDITABLE_CASE_STATUSES } from "@penpath/shared";
import type { AuthTokenPayload } from "./jwt.js";

interface CaseLike {
  clientId: string;
  assignedOfficerId: string | null;
  status: string;
}

const CASE_OVERRIDE_ROLES: Role[] = ["OPS_SUPERVISOR", "ADMIN", "SUPER_ADMIN"];

/** The assigned Ops Officer, or a Supervisor/Admin/Super Admin override —
 * regardless of case status. Workflow actions (which move a case *past*
 * the editable-forms window) use this; form editing layers the status
 * check on top via canEditCaseForms. */
export function isAssignedOrOverride(user: AuthTokenPayload, kase: CaseLike): boolean {
  if (CASE_OVERRIDE_ROLES.includes(user.role)) return true;
  return user.role === "OPS_OFFICER" && kase.assignedOfficerId === user.sub;
}

/** Business rule 6: only the assigned Ops Officer (or a Supervisor/Admin/
 * Super Admin override) can edit a case's forms — and only pre-approval. */
export function canEditCaseForms(user: AuthTokenPayload, kase: CaseLike): boolean {
  if (!EDITABLE_CASE_STATUSES.includes(kase.status as (typeof EDITABLE_CASE_STATUSES)[number])) {
    return false;
  }
  return isAssignedOrOverride(user, kase);
}

export function canReadCase(user: AuthTokenPayload, kase: CaseLike): boolean {
  if (user.role === "CLIENT") return kase.clientId === user.sub;
  if (user.role === "OPS_OFFICER") return kase.assignedOfficerId === user.sub;
  // Customer Care, Ops Supervisor, Accounting, Management, Admin, Super Admin all have cross-case read visibility.
  return true;
}
