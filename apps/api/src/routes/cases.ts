import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import {
  BIO_DATA_TEMPLATE,
  CLIENT_STATUS_LABELS,
  FORM_TYPES,
  type FormTemplate,
  type FormType,
} from "@penpath/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";
import { validateFormData } from "../lib/formValidation.js";
import { canEditCaseForms, canReadCase } from "../lib/caseAccess.js";
import { writeAuditLog } from "../lib/audit.js";
import { upload } from "../lib/upload.js";

export const casesRouter = Router();

casesRouter.use(requireAuth);

const caseListInclude = {
  client: { select: { id: true, name: true, email: true } },
  pfa: { select: { id: true, name: true } },
  pmb: { select: { id: true, name: true } },
  assignedOfficer: { select: { id: true, name: true } },
} as const;

const caseDetailInclude = {
  ...caseListInclude,
  formSubmissions: { orderBy: [{ formType: "asc" as const }, { version: "desc" as const }] },
  documents: { orderBy: { createdAt: "desc" as const } },
  statusHistory: { orderBy: { createdAt: "desc" as const } },
};

function withClientLabel<T extends { status: string }>(kase: T) {
  return { ...kase, clientStatusLabel: CLIENT_STATUS_LABELS[kase.status as keyof typeof CLIENT_STATUS_LABELS] };
}

casesRouter.get("/", async (req, res) => {
  const role = req.user!.role;
  const where =
    role === "CLIENT"
      ? { clientId: req.user!.sub }
      : role === "OPS_OFFICER"
        ? { assignedOfficerId: req.user!.sub }
        : {};

  const cases = await prisma.case.findMany({
    where,
    include: caseListInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json({ cases: cases.map(withClientLabel) });
});

/** Supervisor queue: active cases with no Ops Officer assigned yet. */
casesRouter.get("/unassigned", requirePermission("case:assign"), async (_req, res) => {
  const cases = await prisma.case.findMany({
    where: { assignedOfficerId: null, active: true },
    include: caseListInclude,
    orderBy: { createdAt: "asc" },
  });
  res.json({ cases: cases.map(withClientLabel) });
});

/** Ops Officer workload, for the Supervisor to see capacity before assigning. */
casesRouter.get("/ops-officers", requirePermission("case:assign"), async (_req, res) => {
  const officers = await prisma.user.findMany({
    where: { role: "OPS_OFFICER", active: true },
    select: { id: true, name: true, email: true, maxCaseLoad: true },
    orderBy: { name: "asc" },
  });
  const counts = await prisma.case.groupBy({
    by: ["assignedOfficerId"],
    where: { assignedOfficerId: { in: officers.map((o) => o.id) }, active: true },
    _count: { _all: true },
  });
  const countByOfficer = new Map(counts.map((c) => [c.assignedOfficerId, c._count._all]));
  res.json({
    officers: officers.map((o) => ({ ...o, currentCaseLoad: countByOfficer.get(o.id) ?? 0 })),
  });
});

const maxCaseLoadSchema = z.object({ maxCaseLoad: z.number().int().positive() });

/** Supervisor sets per-officer case caps (default 6), scoped narrowly to
 * this one field so Supervisors don't need full user:manage rights. */
casesRouter.patch("/ops-officers/:id/max-case-load", requirePermission("case:assign"), async (req, res) => {
  const parsed = maxCaseLoadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const officer = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!officer || officer.role !== "OPS_OFFICER") {
    return res.status(404).json({ error: "Ops Officer not found" });
  }

  const updated = await prisma.user.update({
    where: { id: officer.id },
    data: { maxCaseLoad: parsed.data.maxCaseLoad },
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "MAX_CASE_LOAD_UPDATED",
    entityType: "User",
    entityId: officer.id,
    oldValue: { maxCaseLoad: officer.maxCaseLoad },
    newValue: { maxCaseLoad: updated.maxCaseLoad },
  });

  res.json({ officer: { id: updated.id, name: updated.name, maxCaseLoad: updated.maxCaseLoad } });
});

const assignCaseSchema = z.object({ officerId: z.string().min(1) });

/** Manual assignment/reassignment, enforcing each officer's maxCaseLoad. */
casesRouter.post("/:id/assign", requirePermission("case:assign"), async (req, res) => {
  const parsed = assignCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const kase = await prisma.case.findUnique({ where: { id: req.params.id } });
  if (!kase) return res.status(404).json({ error: "Case not found" });

  const officer = await prisma.user.findUnique({ where: { id: parsed.data.officerId } });
  if (!officer || officer.role !== "OPS_OFFICER" || !officer.active) {
    return res.status(400).json({ error: "Target user is not an active Ops Officer" });
  }

  const currentLoad = await prisma.case.count({
    where: { assignedOfficerId: officer.id, active: true, id: { not: kase.id } },
  });
  const cap = officer.maxCaseLoad ?? 6;
  if (currentLoad >= cap) {
    return res.status(409).json({ error: `${officer.name} is already at their case load cap (${cap})` });
  }

  const updated = await prisma.case.update({
    where: { id: kase.id },
    data: { assignedOfficerId: officer.id },
    include: caseListInclude,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "CASE_ASSIGNED",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { assignedOfficerId: kase.assignedOfficerId },
    newValue: { assignedOfficerId: officer.id },
  });

  res.json({ case: withClientLabel(updated) });
});

casesRouter.get("/:id", async (req, res) => {
  const kase = await prisma.case.findUnique({ where: { id: req.params.id }, include: caseDetailInclude });
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (!canReadCase(req.user!, kase)) return res.status(403).json({ error: "Forbidden" });
  res.json({ case: withClientLabel(kase) });
});

async function getFormTemplates(pfaId: string, pmbId: string) {
  const [pfa, pmb] = await Promise.all([
    prisma.institution.findUnique({ where: { id: pfaId } }),
    prisma.institution.findUnique({ where: { id: pmbId } }),
  ]);
  if (!pfa || pfa.type !== "PFA" || !pfa.active) return { error: "Invalid or inactive PFA selected" as const };
  if (!pmb || pmb.type !== "PMB" || !pmb.active) return { error: "Invalid or inactive PMB selected" as const };
  return { pfa, pmb };
}

function validateIntakeForms(
  bioData: unknown,
  pfaForm: unknown,
  pmbForm: unknown,
  pfaTemplate: FormTemplate,
  pmbTemplate: FormTemplate,
) {
  const errors = {
    bioData: validateFormData(BIO_DATA_TEMPLATE, bioData),
    pfaForm: validateFormData(pfaTemplate, pfaForm),
    pmbForm: validateFormData(pmbTemplate, pmbForm),
  };
  const hasErrors = errors.bioData.length || errors.pfaForm.length || errors.pmbForm.length;
  return hasErrors ? errors : null;
}

async function assertOneActiveCase(clientId: string): Promise<boolean> {
  const existing = await prisma.case.findFirst({ where: { clientId, active: true } });
  return !existing;
}

async function createCaseWithForms(params: {
  clientId: string;
  pfaId: string;
  pmbId: string;
  intakeSource: "DIGITAL_LINK" | "PHYSICAL_SCAN";
  bioData: unknown;
  pfaForm: unknown;
  pmbForm: unknown;
  createdBy: string;
}) {
  const kase = await prisma.case.create({
    data: {
      clientId: params.clientId,
      pfaId: params.pfaId,
      pmbId: params.pmbId,
      intakeSource: params.intakeSource,
      formSubmissions: {
        create: [
          { formType: "bio_data", data: params.bioData as object, version: 1 },
          { formType: "pfa_form", data: params.pfaForm as object, version: 1 },
          { formType: "pmb_form", data: params.pmbForm as object, version: 1 },
        ],
      },
      statusHistory: {
        create: [{ toStatus: "NEW_APPLICATION", changedBy: params.createdBy }],
      },
    },
    include: caseDetailInclude,
  });

  await writeAuditLog({
    userId: params.createdBy,
    action: "CASE_CREATED",
    entityType: "Case",
    entityId: kase.id,
    newValue: { id: kase.id, intakeSource: kase.intakeSource, status: kase.status },
  });

  return kase;
}

const intakeSchema = z.object({
  pfaId: z.string().min(1),
  pmbId: z.string().min(1),
  bioData: z.record(z.unknown()),
  pfaForm: z.record(z.unknown()),
  pmbForm: z.record(z.unknown()),
});

/** Digital intake: the client fills their own form. */
casesRouter.post("/intake", requireRole("CLIENT"), async (req, res) => {
  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  if (!(await assertOneActiveCase(req.user!.sub))) {
    return res.status(409).json({ error: "You already have an active application. Only one is allowed at a time." });
  }

  const { pfaId, pmbId, bioData, pfaForm, pmbForm } = parsed.data;
  const templates = await getFormTemplates(pfaId, pmbId);
  if ("error" in templates) return res.status(400).json({ error: templates.error });

  const formErrors = validateIntakeForms(
    bioData,
    pfaForm,
    pmbForm,
    templates.pfa.formTemplate as unknown as FormTemplate,
    templates.pmb.formTemplate as unknown as FormTemplate,
  );
  if (formErrors) return res.status(400).json({ error: "Form validation failed", details: formErrors });

  const kase = await createCaseWithForms({
    clientId: req.user!.sub,
    pfaId,
    pmbId,
    intakeSource: "DIGITAL_LINK",
    bioData,
    pfaForm,
    pmbForm,
    createdBy: req.user!.sub,
  });

  res.status(201).json({ case: withClientLabel(kase) });
});

const scanIntakeBodySchema = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  clientPhone: z.string().optional(),
  pfaId: z.string().min(1),
  pmbId: z.string().min(1),
  bioData: z.string(), // JSON-encoded, since this arrives as multipart/form-data
  pfaForm: z.string(),
  pmbForm: z.string(),
});

/**
 * Ops-facing scan intake: upload the scanned physical form as a Document,
 * then key in field values against the *same* dynamic schema as digital
 * intake (business rule 5 — intake source never changes the pipeline).
 */
casesRouter.post(
  "/scan-intake",
  requireRole("OPS_OFFICER", "OPS_SUPERVISOR", "ADMIN", "SUPER_ADMIN"),
  upload.single("scannedForm"),
  async (req, res) => {
    const parsed = scanIntakeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    if (!req.file) {
      return res.status(400).json({ error: "A scanned form file is required" });
    }

    let bioData: unknown, pfaForm: unknown, pmbForm: unknown;
    try {
      bioData = JSON.parse(parsed.data.bioData);
      pfaForm = JSON.parse(parsed.data.pfaForm);
      pmbForm = JSON.parse(parsed.data.pmbForm);
    } catch {
      return res.status(400).json({ error: "bioData, pfaForm, and pmbForm must be valid JSON" });
    }

    const { pfaId, pmbId, clientName, clientEmail, clientPhone } = parsed.data;
    const templates = await getFormTemplates(pfaId, pmbId);
    if ("error" in templates) return res.status(400).json({ error: templates.error });

    const formErrors = validateIntakeForms(
      bioData,
      pfaForm,
      pmbForm,
      templates.pfa.formTemplate as unknown as FormTemplate,
      templates.pmb.formTemplate as unknown as FormTemplate,
    );
    if (formErrors) return res.status(400).json({ error: "Form validation failed", details: formErrors });

    let client = await prisma.user.findUnique({ where: { email: clientEmail } });
    if (client && client.role !== "CLIENT") {
      return res.status(409).json({ error: "This email belongs to a non-client account" });
    }
    if (!client) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
      client = await prisma.user.create({
        data: { name: clientName, email: clientEmail, phone: clientPhone, passwordHash, role: "CLIENT" },
      });
    }

    if (!(await assertOneActiveCase(client.id))) {
      return res.status(409).json({ error: "This client already has an active application." });
    }

    const kase = await createCaseWithForms({
      clientId: client.id,
      pfaId,
      pmbId,
      intakeSource: "PHYSICAL_SCAN",
      bioData,
      pfaForm,
      pmbForm,
      createdBy: req.user!.sub,
    });

    const document = await prisma.document.create({
      data: { caseId: kase.id, type: "scanned_original", url: `/uploads/${req.file.filename}` },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "DOCUMENT_UPLOADED",
      entityType: "Document",
      entityId: document.id,
      newValue: document,
    });

    res.status(201).json({ case: { ...withClientLabel(kase), documents: [document] } });
  },
);

const editFormSubmissionSchema = z.object({ data: z.record(z.unknown()) });

/** Editable-before-approval: assigned Ops Officer (or override role) can edit
 * any FormSubmission pre-SUBMITTED_TO_PFA. Every edit creates a new version
 * and an AuditLog entry (business rules 5 & 6). */
casesRouter.patch("/:id/form-submissions/:formType", async (req, res) => {
  const formType = req.params.formType as FormType;
  if (!(FORM_TYPES as readonly string[]).includes(formType)) {
    return res.status(400).json({ error: "Unknown form type" });
  }

  const parsed = editFormSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const kase = await prisma.case.findUnique({
    where: { id: req.params.id },
    include: { pfa: true, pmb: true },
  });
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (!canEditCaseForms(req.user!, kase)) {
    return res.status(403).json({ error: "Forbidden: not editable by you at this case status" });
  }

  const template: FormTemplate =
    formType === "bio_data"
      ? BIO_DATA_TEMPLATE
      : formType === "pfa_form"
        ? (kase.pfa.formTemplate as unknown as FormTemplate)
        : (kase.pmb.formTemplate as unknown as FormTemplate);

  const errors = validateFormData(template, parsed.data.data);
  if (errors.length) return res.status(400).json({ error: "Form validation failed", details: errors });

  const latest = await prisma.formSubmission.findFirst({
    where: { caseId: kase.id, formType },
    orderBy: { version: "desc" },
  });
  if (!latest) return res.status(404).json({ error: "No existing submission for this form type" });

  const updated = await prisma.formSubmission.create({
    data: {
      caseId: kase.id,
      formType,
      data: parsed.data.data as object,
      version: latest.version + 1,
      editedBy: req.user!.sub,
      editedAt: new Date(),
    },
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "FORM_SUBMISSION_EDITED",
    entityType: "FormSubmission",
    entityId: updated.id,
    oldValue: latest.data,
    newValue: updated.data,
  });

  res.json({ formSubmission: updated });
});

