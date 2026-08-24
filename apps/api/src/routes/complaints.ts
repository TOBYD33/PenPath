import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { canReadCase } from "../lib/caseAccess.js";
import { writeAuditLog } from "../lib/audit.js";

export const complaintsRouter = Router();

complaintsRouter.use(requireAuth);

const complaintInclude = {
  case: { select: { id: true, clientId: true, assignedOfficerId: true, status: true } },
  raisedBy: { select: { id: true, name: true, email: true, role: true } },
  assignedOfficer: { select: { id: true, name: true } },
} as const;

const createComplaintSchema = z.object({
  caseId: z.string().min(1),
  description: z.string().min(1),
});

/** Complaint intake: the client (on their own case) or an internal role can
 * raise a complaint. It's flagged to the case's assigned Ops Officer. */
complaintsRouter.post("/", async (req, res) => {
  const parsed = createComplaintSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });

  const kase = await prisma.case.findUnique({ where: { id: parsed.data.caseId } });
  if (!kase) return res.status(404).json({ error: "Case not found" });
  if (!canReadCase(req.user!, kase)) return res.status(403).json({ error: "Forbidden" });

  const complaint = await prisma.complaint.create({
    data: {
      caseId: kase.id,
      raisedById: req.user!.sub,
      assignedOfficerId: kase.assignedOfficerId,
      description: parsed.data.description,
    },
    include: complaintInclude,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "COMPLAINT_RAISED",
    entityType: "Complaint",
    entityId: complaint.id,
    newValue: complaint,
  });

  res.status(201).json({ complaint });
});

/**
 * Visible to all internal roles (business spec: "visible to all internal
 * roles"). Clients see only their own case's complaints; Ops Officers see
 * complaints flagged to them; everyone else has cross-case visibility.
 */
complaintsRouter.get("/", async (req, res) => {
  const role = req.user!.role;
  const where: Record<string, unknown> = {};

  if (role === "CLIENT") {
    where.case = { clientId: req.user!.sub };
  } else if (role === "OPS_OFFICER") {
    where.assignedOfficerId = req.user!.sub;
  }
  if (typeof req.query.caseId === "string") where.caseId = req.query.caseId;
  if (typeof req.query.status === "string") where.status = req.query.status;

  const complaints = await prisma.complaint.findMany({
    where,
    include: complaintInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json({ complaints });
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: [],
};

const updateComplaintSchema = z.object({
  status: z.enum(["IN_PROGRESS", "RESOLVED"]),
  resolutionNote: z.string().optional(),
});

/** Status flow Open -> In Progress -> Resolved, managed by Customer Care
 * (or Super Admin). Resolving requires a resolution note. */
complaintsRouter.patch("/:id", requirePermission("complaint:manage"), async (req, res) => {
  const parsed = updateComplaintSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  if (parsed.data.status === "RESOLVED" && !parsed.data.resolutionNote) {
    return res.status(400).json({ error: "A resolution note is required to resolve a complaint" });
  }

  const complaint = await prisma.complaint.findUnique({ where: { id: req.params.id } });
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  if (!ALLOWED_TRANSITIONS[complaint.status].includes(parsed.data.status)) {
    return res.status(409).json({ error: `Cannot move a complaint from ${complaint.status} to ${parsed.data.status}` });
  }

  const updated = await prisma.complaint.update({
    where: { id: complaint.id },
    data: { status: parsed.data.status, resolutionNote: parsed.data.resolutionNote },
    include: complaintInclude,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "COMPLAINT_STATUS_UPDATED",
    entityType: "Complaint",
    entityId: complaint.id,
    oldValue: { status: complaint.status },
    newValue: { status: updated.status, resolutionNote: updated.resolutionNote },
  });

  res.json({ complaint: updated });
});
