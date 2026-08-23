import { Router } from "express";
import { z } from "zod";
import { FEE_BASES } from "@penpath/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { writeAuditLog } from "../lib/audit.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

/** Singleton row: create it on first read if it doesn't exist yet. */
async function getOrCreateFeeDefault() {
  const existing = await prisma.feeDefault.findFirst({ orderBy: { updatedAt: "asc" } });
  if (existing) return existing;
  return prisma.feeDefault.create({ data: {} });
}

settingsRouter.get("/fee-defaults", async (_req, res) => {
  const feeDefault = await getOrCreateFeeDefault();
  res.json({ feeDefault });
});

const updateFeeDefaultsSchema = z.object({
  feeFlat: z.number().nonnegative().optional(),
  feePercent: z.number().min(0).max(100).optional(),
  feeBasis: z.enum(FEE_BASES).optional(),
});

settingsRouter.patch("/fee-defaults", requirePermission("institution:manage"), async (req, res) => {
  const parsed = updateFeeDefaultsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const existing = await getOrCreateFeeDefault();
  const updated = await prisma.feeDefault.update({
    where: { id: existing.id },
    data: { ...parsed.data, updatedBy: req.user!.sub },
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "FEE_DEFAULTS_UPDATED",
    entityType: "FeeDefault",
    entityId: updated.id,
    oldValue: existing,
    newValue: updated,
  });

  res.json({ feeDefault: updated });
});
