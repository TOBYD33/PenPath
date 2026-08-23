import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";

const app = createApp();
const runId = Date.now();
const institutionIds: string[] = [];

async function makeUser(role: "ADMIN" | "OPS_OFFICER") {
  const email = `inst-test-${role.toLowerCase()}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}`, email, passwordHash, role } });
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let admin: Awaited<ReturnType<typeof makeUser>>;
let opsOfficer: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  opsOfficer = await makeUser("OPS_OFFICER");
});

afterAll(async () => {
  await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
  const ids = [admin.user.id, opsOfficer.user.id];
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("institution management is gated by institution:manage", () => {
  it("ADMIN can create a PFA with a form template", async () => {
    const res = await request(app)
      .post("/api/institutions")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        type: "PFA",
        name: `Test PFA ${runId}`,
        formTemplate: [
          { key: "rsa_pin", label: "RSA PIN", type: "text", required: true },
          { key: "years_service", label: "Years of Service", type: "number", required: false },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.institution.formTemplate).toHaveLength(2);
    institutionIds.push(res.body.institution.id);
  });

  it("OPS_OFFICER cannot create an institution", async () => {
    const res = await request(app)
      .post("/api/institutions")
      .set("Authorization", `Bearer ${opsOfficer.token}`)
      .send({ type: "PMB", name: `Should Fail ${runId}`, formTemplate: [] });
    expect(res.status).toBe(403);
  });

  it("any authenticated role can read institutions", async () => {
    const res = await request(app).get("/api/institutions").set("Authorization", `Bearer ${opsOfficer.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.institutions)).toBe(true);
  });

  it("ADMIN can update the form template", async () => {
    const institutionId = institutionIds[0];
    const res = await request(app)
      .patch(`/api/institutions/${institutionId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ formTemplate: [{ key: "rsa_pin", label: "RSA PIN", type: "text", required: true }] });
    expect(res.status).toBe(200);
    expect(res.body.institution.formTemplate).toHaveLength(1);
  });
});

describe("fee defaults (Section 6.3: editable, never silently recalculated)", () => {
  it("ADMIN can update org-wide fee defaults", async () => {
    const res = await request(app)
      .patch("/api/settings/fee-defaults")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ feeFlat: 150000, feePercent: 10, feeBasis: "FULL_BALANCE" });
    expect(res.status).toBe(200);
    expect(Number(res.body.feeDefault.feeFlat)).toBe(150000);
    expect(res.body.feeDefault.feeBasis).toBe("FULL_BALANCE");

    // restore defaults so other tests / manual QA aren't affected
    await request(app)
      .patch("/api/settings/fee-defaults")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ feeFlat: 100000, feePercent: 8, feeBasis: "ACCESSED_AMOUNT" });
  });

  it("OPS_OFFICER cannot update fee defaults", async () => {
    const res = await request(app)
      .patch("/api/settings/fee-defaults")
      .set("Authorization", `Bearer ${opsOfficer.token}`)
      .send({ feeFlat: 1 });
    expect(res.status).toBe(403);
  });
});
