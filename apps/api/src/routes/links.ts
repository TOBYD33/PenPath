import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { env } from "../lib/env.js";

export const linksRouter = Router();

linksRouter.use(requireAuth);

const linkInclude = {
  generatedBy: { select: { id: true, name: true } },
  case: { select: { id: true, status: true } },
} as const;

const DEFAULT_EXPIRY_DAYS = 7;

const createLinkSchema = z.object({
  clientName: z.string().min(1).optional(),
  clientPhone: z.string().optional(),
  clientEmail: z.string().email().optional(),
  expiresInDays: z.number().int().positive().max(90).optional(),
});

/** Generates a trackable, single-use, expirable link so a client can submit
 * their intake remotely — the same case-creation pipeline as every other
 * intake path (business rule 5) once they submit it via /api/apply/:token. */
linksRouter.post("/", requirePermission("case:generate-link"), async (req, res) => {
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + (parsed.data.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000);

  const clientLink = await prisma.clientLink.create({
    data: {
      token,
      generatedById: req.user!.sub,
      clientName: parsed.data.clientName,
      clientPhone: parsed.data.clientPhone,
      clientEmail: parsed.data.clientEmail,
      expiresAt,
    },
    include: linkInclude,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "CLIENT_LINK_GENERATED",
    entityType: "ClientLink",
    entityId: clientLink.id,
    newValue: { id: clientLink.id, expiresAt: clientLink.expiresAt, clientEmail: clientLink.clientEmail },
  });

  res.status(201).json({ clientLink, url: `${env.FRONTEND_URL}/apply/${token}` });
});

/** Admin/Super Admin see every link; anyone else sees only what they generated. */
linksRouter.get("/", requirePermission("case:generate-link"), async (req, res) => {
  const isAdmin = req.user!.role === "ADMIN" || req.user!.role === "SUPER_ADMIN";
  const links = await prisma.clientLink.findMany({
    where: isAdmin ? {} : { generatedById: req.user!.sub },
    include: linkInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json({ links: links.map((l) => ({ ...l, url: `${env.FRONTEND_URL}/apply/${l.token}` })) });
});

/** The generator, or Admin/Super Admin, can revoke a link before it's used. */
linksRouter.post("/:id/revoke", requirePermission("case:generate-link"), async (req, res) => {
  const link = await prisma.clientLink.findUnique({ where: { id: req.params.id } });
  if (!link) return res.status(404).json({ error: "Link not found" });

  const isAdmin = req.user!.role === "ADMIN" || req.user!.role === "SUPER_ADMIN";
  if (!isAdmin && link.generatedById !== req.user!.sub) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (link.status === "USED") {
    return res.status(409).json({ error: "This link has already been used and cannot be revoked" });
  }

  const updated = await prisma.clientLink.update({ where: { id: link.id }, data: { status: "REVOKED" } });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "CLIENT_LINK_REVOKED",
    entityType: "ClientLink",
    entityId: link.id,
    oldValue: { status: link.status },
    newValue: { status: updated.status },
  });

  res.json({ clientLink: updated });
});
