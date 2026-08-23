import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PERMISSIONS, ROLES } from "@penpath/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getEffectivePermissions } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

const userSummary = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  active: true,
  maxCaseLoad: true,
  createdAt: true,
} as const;

usersRouter.get("/", requirePermission("user:manage"), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: userSummary,
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
  role: z.enum(ROLES),
  maxCaseLoad: z.number().int().positive().optional(),
});

usersRouter.post("/", requirePermission("user:manage"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }
  const { name, email, phone, password, role, maxCaseLoad } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, phone, passwordHash, role, maxCaseLoad },
    select: userSummary,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "USER_CREATED",
    entityType: "User",
    entityId: user.id,
    newValue: user,
  });

  res.status(201).json({ user });
});

const updateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  maxCaseLoad: z.number().int().positive().optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
});

usersRouter.patch("/:id", requirePermission("user:manage"), async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSummary });
  if (!existing) return res.status(404).json({ error: "User not found" });

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: parsed.data,
    select: userSummary,
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "USER_UPDATED",
    entityType: "User",
    entityId: user.id,
    oldValue: existing,
    newValue: user,
  });

  res.json({ user });
});

usersRouter.get("/:id/permissions", requirePermission("user:manage"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  const effective = await getEffectivePermissions(user.id, user.role);
  const overrides = await prisma.userPermission.findMany({ where: { userId: user.id } });
  res.json({ effective: Array.from(effective), overrides, allPermissions: PERMISSIONS });
});

const setPermissionSchema = z.object({
  granted: z.boolean(),
});

usersRouter.put("/:id/permissions/:permission", requirePermission("permission:manage"), async (req, res) => {
  const { id, permission } = req.params;
  if (!(PERMISSIONS as readonly string[]).includes(permission)) {
    return res.status(400).json({ error: "Unknown permission" });
  }
  const parsed = setPermissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const before = await prisma.userPermission.findUnique({
    where: { userId_permission: { userId: id, permission } },
  });

  const record = await prisma.userPermission.upsert({
    where: { userId_permission: { userId: id, permission } },
    create: { userId: id, permission, granted: parsed.data.granted },
    update: { granted: parsed.data.granted },
  });

  await writeAuditLog({
    userId: req.user!.sub,
    action: "PERMISSION_OVERRIDE_SET",
    entityType: "UserPermission",
    entityId: record.id,
    oldValue: before,
    newValue: record,
  });

  res.json({ override: record });
});
