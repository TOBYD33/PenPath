import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";

const app = createApp();
const runId = Date.now();

async function makeUser(role: "SUPER_ADMIN" | "MANAGEMENT" | "OPS_OFFICER") {
  const email = `rbac-test-${role.toLowerCase()}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({
    data: { name: `Test ${role}`, email, passwordHash, role },
  });
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let superAdmin: Awaited<ReturnType<typeof makeUser>>;
let management: Awaited<ReturnType<typeof makeUser>>;
let opsOfficer: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  superAdmin = await makeUser("SUPER_ADMIN");
  management = await makeUser("MANAGEMENT");
  opsOfficer = await makeUser("OPS_OFFICER");
});

afterAll(async () => {
  const ids = [superAdmin.user.id, management.user.id, opsOfficer.user.id];
  await prisma.userPermission.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("business rule 7: only Super Admin can read the audit log", () => {
  it("allows SUPER_ADMIN", async () => {
    const res = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${superAdmin.token}`);
    expect(res.status).toBe(200);
  });

  it("rejects MANAGEMENT even though it can see cross-case data elsewhere", async () => {
    const res = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${management.token}`);
    expect(res.status).toBe(403);
  });

  it("rejects OPS_OFFICER", async () => {
    const res = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${opsOfficer.token}`);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/audit-logs");
    expect(res.status).toBe(401);
  });
});

describe("user management is gated by the user:manage permission", () => {
  it("SUPER_ADMIN can create a user", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({
        name: "New Ops Officer",
        email: `rbac-created-${runId}@pemwo.local`,
        password: "Password123!",
        role: "OPS_OFFICER",
      });
    expect(res.status).toBe(201);
    await prisma.user.delete({ where: { id: res.body.user.id } });
  });

  it("OPS_OFFICER cannot create a user", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${opsOfficer.token}`)
      .send({
        name: "Should Fail",
        email: `rbac-should-fail-${runId}@pemwo.local`,
        password: "Password123!",
        role: "OPS_OFFICER",
      });
    expect(res.status).toBe(403);
  });

  it("SUPER_ADMIN can grant a permission override and it takes effect", async () => {
    const grantRes = await request(app)
      .put(`/api/users/${opsOfficer.user.id}/permissions/case:read:all`)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ granted: true });
    expect(grantRes.status).toBe(200);

    const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${opsOfficer.token}`);
    expect(meRes.body.permissions).toContain("case:read:all");
  });
});
