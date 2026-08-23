import { DEFAULT_ROLE_PERMISSIONS, type Permission, type Role } from "@penpath/shared";
import { prisma } from "./prisma.js";

/** Effective permissions = role defaults, with per-user grants added and revokes removed. */
export async function getEffectivePermissions(userId: string, role: Role): Promise<Set<Permission>> {
  const defaults = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);
  const overrides = await prisma.userPermission.findMany({ where: { userId } });
  for (const o of overrides) {
    const perm = o.permission as Permission;
    if (o.granted) defaults.add(perm);
    else defaults.delete(perm);
  }
  return defaults;
}
