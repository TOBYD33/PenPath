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

async function makeUser(role: Role, suffix = "", extra: { maxCaseLoad?: number } = {}) {
  const email = `assign-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({
    data: { name: `Test ${role}${suffix}`, email, passwordHash, role, ...extra },
  });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Chidi Eze",
  date_of_birth: "1968-03-02",
  nin: "10293847561",
  phone: "08099999999",
  residential_address: "9 Admiralty Way, Lagos",
  rsa_pin: "PEN000111222",
};

async function createCaseForNewClient(suffix: string) {
  const client = await makeUser("CLIENT", suffix);
  const res = await request(app)
    .post("/api/cases/intake")
    .set("Authorization", `Bearer ${client.token}`)
    .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
  expect(res.status).toBe(201);
  caseIds.push(res.body.case.id);
  return res.body.case.id as string;
}

beforeAll(async () => {
  const pfa = await prisma.institution.create({ data: { type: "PFA", name: `Assign PFA ${runId}`, formTemplate: [] } });
  const pmb = await prisma.institution.create({ data: { type: "PMB", name: `Assign PMB ${runId}`, formTemplate: [] } });
  pfaId = pfa.id;
  pmbId = pmb.id;
  institutionIds.push(pfa.id, pmb.id);
});

afterAll(async () => {
  await prisma.formSubmission.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.statusHistory.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...caseIds, ...userIds] } } });
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("case assignment is gated by case:assign", () => {
  it("OPS_SUPERVISOR sees the unassigned queue; OPS_OFFICER cannot", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-queue");
    const opsOfficer = await makeUser("OPS_OFFICER", "-queue");
    const caseId = await createCaseForNewClient("-queue");

    const queueRes = await request(app)
      .get("/api/cases/unassigned")
      .set("Authorization", `Bearer ${supervisor.token}`);
    expect(queueRes.status).toBe(200);
    expect(queueRes.body.cases.some((c: { id: string }) => c.id === caseId)).toBe(true);

    const forbidden = await request(app)
      .get("/api/cases/unassigned")
      .set("Authorization", `Bearer ${opsOfficer.token}`);
    expect(forbidden.status).toBe(403);
  });

  it("OPS_OFFICER cannot assign cases", async () => {
    const opsOfficer = await makeUser("OPS_OFFICER", "-noassign");
    const caseId = await createCaseForNewClient("-noassign");

    const res = await request(app)
      .post(`/api/cases/${caseId}/assign`)
      .set("Authorization", `Bearer ${opsOfficer.token}`)
      .send({ officerId: opsOfficer.user.id });
    expect(res.status).toBe(403);
  });
});

describe("assignment respects maxCaseLoad (default 6, Supervisor-configurable)", () => {
  it("assigns successfully and then the case appears in the officer's 'my cases' queue", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-happy");
    const officer = await makeUser("OPS_OFFICER", "-happy");
    const caseId = await createCaseForNewClient("-happy");

    const assignRes = await request(app)
      .post(`/api/cases/${caseId}/assign`)
      .set("Authorization", `Bearer ${supervisor.token}`)
      .send({ officerId: officer.user.id });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.case.assignedOfficer.id).toBe(officer.user.id);

    const myCases = await request(app).get("/api/cases").set("Authorization", `Bearer ${officer.token}`);
    expect(myCases.body.cases.map((c: { id: string }) => c.id)).toContain(caseId);
  });

  it("blocks assignment once the officer is at their case load cap", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-cap");
    const officer = await makeUser("OPS_OFFICER", "-cap", { maxCaseLoad: 1 });

    const firstCase = await createCaseForNewClient("-cap1");
    const firstAssign = await request(app)
      .post(`/api/cases/${firstCase}/assign`)
      .set("Authorization", `Bearer ${supervisor.token}`)
      .send({ officerId: officer.user.id });
    expect(firstAssign.status).toBe(200);

    const secondCase = await createCaseForNewClient("-cap2");
    const secondAssign = await request(app)
      .post(`/api/cases/${secondCase}/assign`)
      .set("Authorization", `Bearer ${supervisor.token}`)
      .send({ officerId: officer.user.id });
    expect(secondAssign.status).toBe(409);

    // Supervisor raises the cap via the scoped max-case-load endpoint, then it succeeds.
    const raiseCap = await request(app)
      .patch(`/api/cases/ops-officers/${officer.user.id}/max-case-load`)
      .set("Authorization", `Bearer ${supervisor.token}`)
      .send({ maxCaseLoad: 2 });
    expect(raiseCap.status).toBe(200);

    const retryAssign = await request(app)
      .post(`/api/cases/${secondCase}/assign`)
      .set("Authorization", `Bearer ${supervisor.token}`)
      .send({ officerId: officer.user.id });
    expect(retryAssign.status).toBe(200);
  });

  it("reports accurate workload via GET /api/cases/ops-officers", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-workload");
    const officer = await makeUser("OPS_OFFICER", "-workload");
    const caseId = await createCaseForNewClient("-workload");

    await request(app)
      .post(`/api/cases/${caseId}/assign`)
      .set("Authorization", `Bearer ${supervisor.token}`)
      .send({ officerId: officer.user.id });

    const res = await request(app).get("/api/cases/ops-officers").set("Authorization", `Bearer ${supervisor.token}`);
    expect(res.status).toBe(200);
    const entry = res.body.officers.find((o: { id: string }) => o.id === officer.user.id);
    expect(entry.currentCaseLoad).toBe(1);
    expect(entry.maxCaseLoad).toBe(6);
  });
});
