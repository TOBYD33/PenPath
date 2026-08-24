import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { ROLES, type Role } from "@penpath/shared";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";

const app = createApp();
const runId = Date.now();

const userIds: string[] = [];
const tokenByRole = new Map<Role, string>();

async function makeUser(role: Role) {
  const email = `matrix-test-${role.toLowerCase()}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Matrix ${role}`, email, passwordHash, role } });
  userIds.push(user.id);
  return signToken({ sub: user.id, role: user.role, email: user.email });
}

beforeAll(async () => {
  for (const role of ROLES) {
    tokenByRole.set(role, await makeUser(role));
  }
}, 60000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.institution.deleteMany({ where: { name: `Matrix PFA ${runId}` } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}, 30000);

interface Probe {
  name: string;
  method: "get" | "post" | "patch";
  path: string;
  body?: Record<string, unknown>;
  allowedRoles: Role[];
}

const probes: Probe[] = [
  {
    name: "list users (user:manage)",
    method: "get",
    path: "/api/users",
    allowedRoles: ["SUPER_ADMIN"],
  },
  {
    name: "read audit log (role-gated to Super Admin — business rule 7)",
    method: "get",
    path: "/api/audit-logs",
    allowedRoles: ["SUPER_ADMIN"],
  },
  {
    name: "create institution (institution:manage)",
    method: "post",
    path: "/api/institutions",
    body: { type: "PFA", name: `Matrix PFA ${runId}`, formTemplate: [] },
    allowedRoles: ["ADMIN", "SUPER_ADMIN"],
  },
  {
    name: "update org-wide fee defaults (institution:manage)",
    method: "patch",
    path: "/api/settings/fee-defaults",
    body: {},
    allowedRoles: ["ADMIN", "SUPER_ADMIN"],
  },
  {
    name: "view unassigned case queue (case:assign)",
    method: "get",
    path: "/api/cases/unassigned",
    allowedRoles: ["OPS_SUPERVISOR", "SUPER_ADMIN"],
  },
  {
    name: "revenue dashboard (dashboard:revenue)",
    method: "get",
    path: "/api/dashboard/revenue",
    allowedRoles: ["MANAGEMENT", "SUPER_ADMIN"],
  },
  {
    name: "activity dashboard (dashboard:activity)",
    method: "get",
    path: "/api/dashboard/activity",
    allowedRoles: ["OPS_SUPERVISOR", "MANAGEMENT", "SUPER_ADMIN"],
  },
  {
    name: "update a complaint's status (complaint:manage)",
    method: "patch",
    path: "/api/complaints/nonexistent-id",
    body: { status: "IN_PROGRESS" },
    allowedRoles: ["CUSTOMER_CARE", "SUPER_ADMIN"],
  },
];

describe("RBAC matrix: every role can only access what it should", () => {
  for (const probe of probes) {
    describe(probe.name, () => {
      for (const role of ROLES) {
        const shouldBeAllowed = probe.allowedRoles.includes(role);

        it(`${role} is ${shouldBeAllowed ? "allowed" : "forbidden"}`, async () => {
          const token = tokenByRole.get(role)!;
          const req =
            probe.method === "get"
              ? request(app).get(probe.path)
              : probe.method === "post"
                ? request(app).post(probe.path).send(probe.body)
                : request(app).patch(probe.path).send(probe.body);
          const res = await req.set("Authorization", `Bearer ${token}`);

          if (shouldBeAllowed) {
            expect(res.status).not.toBe(403);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });
  }

  it("an unauthenticated request is rejected on a representative sample of protected routes", async () => {
    for (const probe of probes) {
      const res =
        probe.method === "get"
          ? await request(app).get(probe.path)
          : probe.method === "post"
            ? await request(app).post(probe.path).send(probe.body)
            : await request(app).patch(probe.path).send(probe.body);
      expect(res.status).toBe(401);
    }
  });
});
