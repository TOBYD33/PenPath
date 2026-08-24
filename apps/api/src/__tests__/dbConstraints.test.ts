import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Role } from "@penpath/shared";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";

const app = createApp();
const runId = Date.now();

const userIds: string[] = [];
const caseIds: string[] = [];
const institutionIds: string[] = [];

async function makeUser(role: Role, suffix = "") {
  const email = `dbconstraint-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}${suffix}`, email, passwordHash, role } });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Bisi Alade",
  date_of_birth: "1961-02-18",
  nin: "88899900011",
  phone: "08022233344",
  residential_address: "4 Awolowo Rd, Ikoyi, Lagos",
  rsa_pin: "PEN222333444",
};

beforeAll(async () => {
  const pfa = await prisma.institution.create({ data: { type: "PFA", name: `DBConstraint PFA ${runId}`, formTemplate: [] } });
  const pmb = await prisma.institution.create({ data: { type: "PMB", name: `DBConstraint PMB ${runId}`, formTemplate: [] } });
  pfaId = pfa.id;
  pmbId = pmb.id;
  institutionIds.push(pfa.id, pmb.id);
}, 30000);

afterAll(async () => {
  await prisma.formSubmission.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.statusHistory.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...caseIds, ...userIds] } } });
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}, 30000);

describe("business rule 1 is enforced at the database level, not just the API", () => {
  it("Postgres rejects a second active Case row for the same client even bypassing the app's check", async () => {
    const client = await makeUser("CLIENT", "-dblevel");

    const first = await prisma.case.create({
      data: { clientId: client.user.id, pfaId, pmbId, intakeSource: "DIGITAL_LINK" },
    });
    caseIds.push(first.id);

    // Bypasses assertOneActiveCase entirely — talks straight to Prisma, the
    // same way a second concurrent request's insert would race the first.
    await expect(
      prisma.case.create({ data: { clientId: client.user.id, pfaId, pmbId, intakeSource: "DIGITAL_LINK" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows a new active case once the first is marked inactive (e.g. after closure)", async () => {
    const client = await makeUser("CLIENT", "-reopen");

    const first = await prisma.case.create({
      data: { clientId: client.user.id, pfaId, pmbId, intakeSource: "DIGITAL_LINK" },
    });
    caseIds.push(first.id);

    await prisma.case.update({ where: { id: first.id }, data: { active: false, status: "CASE_CLOSED" } });

    const second = await prisma.case.create({
      data: { clientId: client.user.id, pfaId, pmbId, intakeSource: "DIGITAL_LINK" },
    });
    caseIds.push(second.id);

    expect(second.id).not.toBe(first.id);
  });

  it("under concurrent digital-intake requests for the same client, exactly one succeeds", async () => {
    const client = await makeUser("CLIENT", "-race");

    const [a, b] = await Promise.all([
      request(app)
        .post("/api/cases/intake")
        .set("Authorization", `Bearer ${client.token}`)
        .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} }),
      request(app)
        .post("/api/cases/intake")
        .set("Authorization", `Bearer ${client.token}`)
        .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const created = [a, b].find((r) => r.status === 201)!;
    caseIds.push(created.body.case.id);

    const activeCases = await prisma.case.findMany({ where: { clientId: client.user.id, active: true } });
    expect(activeCases).toHaveLength(1);
  }, 30000);
});
