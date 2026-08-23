import { Router } from "express";
import { z } from "zod";
import { FORM_FIELD_TYPES, INSTITUTION_TYPES } from "@penpath/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { writeAuditLog } from "../lib/audit.js";

export const institutionsRouter = Router();

institutionsRouter.use(requireAuth);

const formFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const formTemplateSchema = z.array(formFieldSchema);

/** Any authenticated internal role can read institutions (needed for intake dropdowns in later phases). */
institutionsRouter.get("/", async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const institutions = await prisma.institution.findMany({
    where: type ? { type: type as "PFA" | "PMB" } : undefined,
    orderBy: { name: "asc" },
  });
  res.json({ institutions });
});

institutionsRouter.get("/:id", async (req, res) => {
  const institution = await prisma.institution.findUnique({ where: { id: req.params.id } });
  if (!institution) return res.status(404).json({ error: "Institution not found" });
  res.json({ institution });
});

const createInstitutionSchema = z.object({
  type: z.enum(INSTITUTION_TYPES),
  name: z.string().min(1),
  formTemplate: formTemplateSchema.default([]),
});

institutionsRouter.post("/", requirePermission("institution:manage"), async (req, res) => {
  const parsed = createInstitutionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const institution = await prisma.institution.create({ data: parsed.data });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "INSTITUTION_CREATED",
    entityType: "Institution",
    entityId: institution.id,
    newValue: institution,
  });

  res.status(201).json({ institution });
});

const updateInstitutionSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  formTemplate: formTemplateSchema.optional(),
});

institutionsRouter.patch("/:id", requirePermission("institution:manage"), async (req, res) => {
  const parsed = updateInstitutionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const existing = await prisma.institution.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Institution not found" });

  const institution = await prisma.institution.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "INSTITUTION_UPDATED",
    entityType: "Institution",
    entityId: institution.id,
    oldValue: existing,
    newValue: institution,
  });

  res.json({ institution });
});
