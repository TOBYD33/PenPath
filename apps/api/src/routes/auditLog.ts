import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const auditLogRouter = Router();

/**
 * Business rule 7: Super Admin is the only role that can view all users'
 * activity, including Management's. Gated by role, not by the granular
 * permission system, so it can never be delegated away.
 */
auditLogRouter.get("/", requireAuth, requireRole("SUPER_ADMIN"), async (req, res) => {
  const { entityType, userId } = req.query;
  const take = Math.min(Number(req.query.limit ?? 50), 200);
  const skip = Number(req.query.offset ?? 0);

  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: typeof entityType === "string" ? entityType : undefined,
      userId: typeof userId === "string" ? userId : undefined,
    },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });

  res.json({ logs });
});
