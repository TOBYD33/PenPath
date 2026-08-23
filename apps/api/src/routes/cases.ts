import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import {
  BIO_DATA_TEMPLATE,
  CLIENT_STATUS_LABELS,
  EDITABLE_CASE_STATUSES,
  FORM_TYPES,
  type CaseStatus,
  type FormTemplate,
  type FormType,
} from "@penpath/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";
import { validateFormData } from "../lib/formValidation.js";
import { canEditCaseForms, canReadCase, isAssignedOrOverride } from "../lib/caseAccess.js";
import { writeAuditLog } from "../lib/audit.js";
import { upload } from "../lib/upload.js";
import { applyStatusTransitions } from "../lib/caseWorkflow.js";
import { generateCasePacketPdf } from "../lib/pdf.js";
import { notify } from "../lib/notify.js";
import { computeFeeTotal, getOrCreateFeeDefault } from "../lib/feeEngine.js";

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
  const feeDefault = await getOrCreateFeeDefault();

  const kase = await prisma.case.create({
    data: {
      clientId: params.clientId,
      pfaId: params.pfaId,
      pmbId: params.pmbId,
      intakeSource: params.intakeSource,
      feeFlat: feeDefault.feeFlat,
      feePercent: feeDefault.feePercent,
      feeBasis: feeDefault.feeBasis,
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

// ---------------------------------------------------------------------------
// Workflow engine (Phase 5): the CaseStatus state machine, one action per
// spec bullet. Every transition writes StatusHistory via applyStatusTransitions
// (which also flips Case.active off once a terminal status is reached —
// business rule 1) and fires a stub notification (business rule 2 & general
// "notify relevant parties" requirement).
// ---------------------------------------------------------------------------

async function loadCaseForAction(id: string) {
  return prisma.case.findUnique({
    where: { id },
    include: { client: true, pfa: true, pmb: true, formSubmissions: true },
  });
}

const noteSchema = z.object({ note: z.string().optional() });

/** Ops: mark "Ready for PFA Submission" — generates the PDF packet and
 * submits. Re-callable from PFA_QUERY so a query can be answered and resent. */
casesRouter.post("/:id/ready-for-pfa", async (req, res) => {
  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (!isAssignedOrOverride(req.user!, kase)) return res.status(403).json({ error: "Forbidden" });

  const allowedFrom: CaseStatus[] = [...EDITABLE_CASE_STATUSES, "PFA_QUERY"];
  if (!allowedFrom.includes(kase.status)) {
    return res.status(409).json({ error: `Cannot submit to PFA from status ${kase.status}` });
  }

  const byType = (t: FormType) => kase.formSubmissions.filter((f) => f.formType === t).sort((a, b) => b.version - a.version)[0];
  const pdfUrl = await generateCasePacketPdf({
    caseId: kase.id,
    clientName: kase.client.name,
    pfaName: kase.pfa.name,
    pmbName: kase.pmb.name,
    sections: [
      { title: "Bio Data", data: (byType("bio_data")?.data as Record<string, unknown>) ?? {} },
      { title: `${kase.pfa.name} Form`, data: (byType("pfa_form")?.data as Record<string, unknown>) ?? {} },
      { title: `${kase.pmb.name} Form`, data: (byType("pmb_form")?.data as Record<string, unknown>) ?? {} },
    ],
  });

  const document = await prisma.document.create({
    data: { caseId: kase.id, type: "generated_pdf", url: pdfUrl },
  });

  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps: ["SUBMITTED_TO_PFA"],
    changedBy: req.user!.sub,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "SUBMITTED_TO_PFA",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { status: kase.status },
    newValue: { status: updated.status, documentId: document.id },
  });

  await notify({ to: kase.client.email, subject: "Application submitted to your PFA", body: `Your application has been submitted to ${kase.pfa.name}.` });

  res.json({ case: withClientLabel(updated), document });
});

const pfaOutcomeSchema = noteSchema.extend({ outcome: z.enum(["PFA_APPROVED", "PFA_QUERY", "PFA_REJECTED"]) });

/** Ops: record the PFA's decision. Approval auto-advances to SUBMITTED_TO_PMB. */
casesRouter.post("/:id/pfa-outcome", async (req, res) => {
  const parsed = pfaOutcomeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });

  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (!isAssignedOrOverride(req.user!, kase)) return res.status(403).json({ error: "Forbidden" });
  if (kase.status !== "SUBMITTED_TO_PFA") {
    return res.status(409).json({ error: `Cannot record a PFA outcome from status ${kase.status}` });
  }

  const steps: CaseStatus[] = parsed.data.outcome === "PFA_APPROVED" ? ["PFA_APPROVED", "SUBMITTED_TO_PMB"] : [parsed.data.outcome];
  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps,
    changedBy: req.user!.sub,
    note: parsed.data.note,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "PFA_OUTCOME_RECORDED",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { status: kase.status },
    newValue: { status: updated.status },
  });

  await notify({ to: kase.client.email, subject: "Update on your PFA submission", body: `Status: ${CLIENT_STATUS_LABELS[updated.status]}` });

  res.json({ case: withClientLabel(updated) });
});

/** Ops: resend to the PMB after a query, without regenerating the PDF packet. */
casesRouter.post("/:id/resubmit-to-pmb", async (req, res) => {
  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (!isAssignedOrOverride(req.user!, kase)) return res.status(403).json({ error: "Forbidden" });
  if (kase.status !== "PMB_QUERY") {
    return res.status(409).json({ error: `Cannot resubmit to PMB from status ${kase.status}` });
  }

  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps: ["SUBMITTED_TO_PMB"],
    changedBy: req.user!.sub,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "RESUBMITTED_TO_PMB",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { status: kase.status },
    newValue: { status: updated.status },
  });

  res.json({ case: withClientLabel(updated) });
});

const pmbOutcomeSchema = noteSchema.extend({ outcome: z.enum(["PMB_APPROVED", "PMB_QUERY", "PMB_REJECTED"]) });

/** Ops: record the Mortgage Bank's decision. Approval auto-advances to
 * AWAITING_FUND_RELEASE. */
casesRouter.post("/:id/pmb-outcome", async (req, res) => {
  const parsed = pmbOutcomeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });

  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (!isAssignedOrOverride(req.user!, kase)) return res.status(403).json({ error: "Forbidden" });
  if (kase.status !== "SUBMITTED_TO_PMB") {
    return res.status(409).json({ error: `Cannot record a PMB outcome from status ${kase.status}` });
  }

  const steps: CaseStatus[] = parsed.data.outcome === "PMB_APPROVED" ? ["PMB_APPROVED", "AWAITING_FUND_RELEASE"] : [parsed.data.outcome];
  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps,
    changedBy: req.user!.sub,
    note: parsed.data.note,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "PMB_OUTCOME_RECORDED",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { status: kase.status },
    newValue: { status: updated.status },
  });

  await notify({ to: kase.client.email, subject: "Update on your Mortgage Bank submission", body: `Status: ${CLIENT_STATUS_LABELS[updated.status]}` });

  res.json({ case: withClientLabel(updated) });
});

/** Client: confirms funds were released — to the mortgage lender, never to
 * them directly (business rule 2). Notifies the assigned Ops Officer. */
casesRouter.post("/:id/confirm-funds-received", requireRole("CLIENT"), async (req, res) => {
  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (kase.clientId !== req.user!.sub) return res.status(403).json({ error: "Forbidden" });
  if (kase.status !== "AWAITING_FUND_RELEASE") {
    return res.status(409).json({ error: `Cannot confirm funds from status ${kase.status}` });
  }

  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps: ["FUNDS_RELEASED_CONFIRMED"],
    changedBy: req.user!.sub,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "FUNDS_RECEIVED_CONFIRMED",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { status: kase.status },
    newValue: { status: updated.status },
  });

  if (kase.assignedOfficerId) {
    const officer = await prisma.user.findUnique({ where: { id: kase.assignedOfficerId } });
    if (officer) {
      await notify({ to: officer.email, subject: "Client confirmed funds released", body: `Case ${kase.id} is ready for the transfer form step.` });
    }
  }

  res.json({ case: withClientLabel(updated) });
});

/** Ops: trigger the transfer form — prompts the client to fill it in. */
casesRouter.post("/:id/trigger-transfer-form", async (req, res) => {
  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (!isAssignedOrOverride(req.user!, kase)) return res.status(403).json({ error: "Forbidden" });
  if (kase.status !== "FUNDS_RELEASED_CONFIRMED") {
    return res.status(409).json({ error: `Cannot trigger the transfer form from status ${kase.status}` });
  }

  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps: ["TRANSFER_FORM_SENT"],
    changedBy: req.user!.sub,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "TRANSFER_FORM_TRIGGERED",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { status: kase.status },
    newValue: { status: updated.status },
  });

  await notify({ to: kase.client.email, subject: "Please complete your transfer form", body: "We need your bank details to complete the mortgage equity transfer." });

  res.json({ case: withClientLabel(updated) });
});

const transferFormSchema = z.object({
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  amount: z.number().positive(),
  mortgageRef: z.string().min(1),
});

/** Client: fills the transfer form. Submission auto-routes it into
 * Accounting's queue (TransferForm.submittedAt and sentToAccountingAt are
 * both stamped now — Accounting acts on it from TRANSFER_SENT_TO_ACCOUNTING). */
casesRouter.post("/:id/transfer-form", requireRole("CLIENT"), async (req, res) => {
  const parsed = transferFormSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });

  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (kase.clientId !== req.user!.sub) return res.status(403).json({ error: "Forbidden" });
  if (kase.status !== "TRANSFER_FORM_SENT") {
    return res.status(409).json({ error: `Cannot submit a transfer form from status ${kase.status}` });
  }

  const now = new Date();
  const transferForm = await prisma.transferForm.create({
    data: { caseId: kase.id, ...parsed.data, submittedAt: now, sentToAccountingAt: now },
  });

  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps: ["TRANSFER_FORM_SUBMITTED", "TRANSFER_SENT_TO_ACCOUNTING"],
    changedBy: req.user!.sub,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "TRANSFER_FORM_SUBMITTED",
    entityType: "TransferForm",
    entityId: transferForm.id,
    newValue: transferForm,
  });

  res.status(201).json({ case: withClientLabel(updated), transferForm });
});

/** Accounting: reviews the transfer form and sends it to the Mortgage Bank. */
casesRouter.post("/:id/send-transfer-to-pmb", requirePermission("transferform:review"), async (req, res) => {
  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (kase.status !== "TRANSFER_SENT_TO_ACCOUNTING") {
    return res.status(409).json({ error: `Cannot send to PMB from status ${kase.status}` });
  }

  const transferForm = await prisma.transferForm.update({
    where: { caseId: kase.id },
    data: { sentToPmbAt: new Date() },
  });

  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps: ["TRANSFER_SENT_TO_PMB"],
    changedBy: req.user!.sub,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "TRANSFER_SENT_TO_PMB",
    entityType: "TransferForm",
    entityId: transferForm.id,
    newValue: transferForm,
  });

  res.json({ case: withClientLabel(updated), transferForm });
});

/** Management: records the Mortgage Bank's confirmation of the transfer. */
casesRouter.post("/:id/confirm-mortgage-bank", requireRole("MANAGEMENT", "SUPER_ADMIN"), async (req, res) => {
  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (kase.status !== "TRANSFER_SENT_TO_PMB") {
    return res.status(409).json({ error: `Cannot confirm the Mortgage Bank from status ${kase.status}` });
  }

  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps: ["MORTGAGE_BANK_CONFIRMED"],
    changedBy: req.user!.sub,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "MORTGAGE_BANK_CONFIRMED",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { status: kase.status },
    newValue: { status: updated.status },
  });

  res.json({ case: withClientLabel(updated) });
});

/** Management: processes the payout and closes the case — visible to
 * Accounting and Ops simultaneously via their normal cross-case read access. */
casesRouter.post("/:id/process-payout", requireRole("MANAGEMENT", "SUPER_ADMIN"), async (req, res) => {
  const kase = await loadCaseForAction(req.params.id);
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (kase.status !== "MORTGAGE_BANK_CONFIRMED") {
    return res.status(409).json({ error: `Cannot process payout from status ${kase.status}` });
  }

  const updated = await applyStatusTransitions({
    caseId: kase.id,
    fromStatus: kase.status,
    steps: ["MANAGEMENT_PAYOUT_PROCESSED", "CASE_CLOSED"],
    changedBy: req.user!.sub,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "PAYOUT_PROCESSED",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { status: kase.status },
    newValue: { status: updated.status },
  });

  await notify({ to: kase.client.email, subject: "Your case is closed", body: "Your mortgage equity payout has been processed. Thank you." });

  res.json({ case: withClientLabel(updated) });
});

// ---------------------------------------------------------------------------
// Fee engine (Phase 6, business rule 3): feeTotal = feeFlat + feePercent% x
// dealValue, recalculated whenever dealValue changes — unless the fee has
// been manually overridden, in which case it is never silently recalculated.
// ---------------------------------------------------------------------------

const financialsSchema = z.object({
  dealValue: z.number().nonnegative().optional(),
  pensionBalance: z.number().nonnegative().optional(),
});

/** Ops (assigned/override) or Accounting/Management record the pensioner's
 * balance and the deal value the fee is calculated against. */
casesRouter.patch("/:id/financials", async (req, res) => {
  const parsed = financialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "No fields to update" });

  const kase = await prisma.case.findUnique({ where: { id: req.params.id } });
  if (!kase) return res.status(404).json({ error: "Case not found" });

  const allowed = isAssignedOrOverride(req.user!, kase) || ["ACCOUNTING", "MANAGEMENT", "SUPER_ADMIN"].includes(req.user!.role);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const dealValue = parsed.data.dealValue ?? (kase.dealValue !== null ? Number(kase.dealValue) : undefined);
  const feeTotal =
    !kase.feeManuallyEdited && dealValue !== undefined
      ? computeFeeTotal(Number(kase.feeFlat), Number(kase.feePercent), dealValue)
      : undefined;

  const updated = await prisma.case.update({
    where: { id: kase.id },
    data: { ...parsed.data, ...(feeTotal !== undefined ? { feeTotal } : {}) },
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "CASE_FINANCIALS_UPDATED",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { dealValue: kase.dealValue, pensionBalance: kase.pensionBalance, feeTotal: kase.feeTotal },
    newValue: { dealValue: updated.dealValue, pensionBalance: updated.pensionBalance, feeTotal: updated.feeTotal },
  });

  res.json({ case: withClientLabel(updated) });
});

const feeOverrideSchema = z.object({ feeTotal: z.number().nonnegative(), note: z.string().optional() });

/** Accounting/Management manual override — always audit-logged, and once
 * set, dealValue changes no longer auto-recalculate feeTotal. */
casesRouter.patch("/:id/fee", requirePermission("fee:override"), async (req, res) => {
  const parsed = feeOverrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });

  const kase = await prisma.case.findUnique({ where: { id: req.params.id } });
  if (!kase) return res.status(404).json({ error: "Case not found" });

  const updated = await prisma.case.update({
    where: { id: kase.id },
    data: { feeTotal: parsed.data.feeTotal, feeManuallyEdited: true },
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "FEE_MANUALLY_OVERRIDDEN",
    entityType: "Case",
    entityId: kase.id,
    oldValue: { feeTotal: kase.feeTotal, feeManuallyEdited: kase.feeManuallyEdited },
    newValue: { feeTotal: updated.feeTotal, feeManuallyEdited: updated.feeManuallyEdited, note: parsed.data.note },
  });

  res.json({ case: withClientLabel(updated) });
});

