import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import type { FormTemplate } from "@penpath/shared";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  assertOneActiveCase,
  createCaseWithForms,
  getFormTemplates,
  isOneActiveCaseViolation,
  validateIntakeForms,
  withClientLabel,
} from "../lib/caseIntake.js";

export const applyRouter = Router();

const GENERIC_INVALID_LINK = "This link is invalid or has expired.";

/** No requireAuth on this router — this is the public, unauthenticated
 * entry point a client reaches from a shared link. Never reveal *why* a
 * token is invalid (used vs. expired vs. revoked vs. nonexistent) to an
 * unauthenticated visitor — just the one generic message. */
async function loadValidLink(token: string) {
  const link = await prisma.clientLink.findUnique({ where: { token } });
  if (!link) return null;

  if (link.status === "UNUSED" && link.expiresAt < new Date()) {
    // Lazily flip to EXPIRED on the first failed access after expiry, rather
    // than running a scheduled job for what's otherwise a rarely-read field.
    await prisma.clientLink.update({ where: { id: link.id }, data: { status: "EXPIRED" } });
    return null;
  }
  if (link.status !== "UNUSED") return null;

  return link;
}

applyRouter.get("/:token", async (req, res) => {
  const link = await loadValidLink(req.params.token);
  if (!link) return res.status(404).json({ error: GENERIC_INVALID_LINK });

  const [pfas, pmbs] = await Promise.all([
    prisma.institution.findMany({ where: { type: "PFA", active: true }, select: { id: true, name: true, formTemplate: true } }),
    prisma.institution.findMany({ where: { type: "PMB", active: true }, select: { id: true, name: true, formTemplate: true } }),
  ]);

  res.json({
    pfas,
    pmbs,
    prefill: { clientName: link.clientName, clientPhone: link.clientPhone, clientEmail: link.clientEmail },
  });
});

const applySchema = z.object({
  pfaId: z.string().min(1),
  pmbId: z.string().min(1),
  bioData: z.record(z.unknown()),
  pfaForm: z.record(z.unknown()),
  pmbForm: z.record(z.unknown()),
  clientName: z.string().min(1).optional(),
  clientPhone: z.string().optional(),
  clientEmail: z.string().email().optional(),
});

applyRouter.post("/:token", async (req, res) => {
  const link = await loadValidLink(req.params.token);
  if (!link) return res.status(404).json({ error: GENERIC_INVALID_LINK });

  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const email = parsed.data.clientEmail ?? link.clientEmail;
  if (!email) return res.status(400).json({ error: "An email address is required" });
  const name = parsed.data.clientName ?? link.clientName ?? "Client";
  const phone = parsed.data.clientPhone ?? link.clientPhone ?? undefined;

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

  // Atomically claim the link before doing any real work, so two concurrent
  // submissions of the same token can't both proceed (business rule: single-use).
  const claim = await prisma.clientLink.updateMany({
    where: { id: link.id, status: "UNUSED" },
    data: { status: "USED", usedAt: new Date() },
  });
  if (claim.count === 0) return res.status(404).json({ error: GENERIC_INVALID_LINK });

  try {
    let client = await prisma.user.findUnique({ where: { email } });
    if (client && client.role !== "CLIENT") {
      throw Object.assign(new Error("email in use"), { status: 409, message: "This email belongs to a non-client account" });
    }
    if (!client) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
      client = await prisma.user.create({ data: { name, email, phone, passwordHash, role: "CLIENT" } });
    }

    if (!(await assertOneActiveCase(client.id))) {
      throw Object.assign(new Error("active case exists"), {
        status: 409,
        message: "This client already has an active application. Only one is allowed at a time.",
      });
    }

    const kase = await createCaseWithForms({
      clientId: client.id,
      pfaId,
      pmbId,
      intakeSource: "DIGITAL_LINK",
      bioData,
      pfaForm,
      pmbForm,
      createdBy: client.id,
    });

    await prisma.clientLink.update({ where: { id: link.id }, data: { caseId: kase.id } });
    await writeAuditLog({
      userId: client.id,
      action: "CLIENT_LINK_USED",
      entityType: "ClientLink",
      entityId: link.id,
      newValue: { caseId: kase.id },
    });

    res.status(201).json({ case: withClientLabel(kase) });
  } catch (err) {
    // The link was already claimed as USED above; since submission failed
    // for a reason unrelated to the link itself, give it back so the
    // client (or whoever generated it) isn't stuck with a wasted link.
    await prisma.clientLink.updateMany({ where: { id: link.id, status: "USED", caseId: null }, data: { status: "UNUSED", usedAt: null } });

    if (isOneActiveCaseViolation(err)) {
      return res.status(409).json({ error: "This client already has an active application. Only one is allowed at a time." });
    }
    const status = (err as { status?: number }).status;
    if (status) return res.status(status).json({ error: (err as Error).message });
    throw err;
  }
});
