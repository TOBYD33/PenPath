import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Role } from "@penpath/shared";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { computeFeeTotal } from "../lib/feeEngine.js";

const app = createApp();
const runId = Date.now();

const userIds: string[] = [];
const caseIds: string[] = [];
const institutionIds: string[] = [];

async function makeUser(role: Role, suffix = "") {
  const email = `fee-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}${suffix}`, email, passwordHash, role } });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Emeka Obi",
  date_of_birth: "1960-05-20",
  nin: "22233344455",
  phone: "08033322211",
  residential_address: "3 Marina Rd, Lagos",
  rsa_pin: "PEN555444333",
};

async function createAssignedCase(supervisorToken: string, officerId: string, clientSuffix: string) {
  const client = await makeUser("CLIENT", clientSuffix);
  const intake = await request(app)
    .post("/api/cases/intake")
    .set("Authorization", `Bearer ${client.token}`)
    .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
  expect(intake.status).toBe(201);
  const caseId = intake.body.case.id as string;
  caseIds.push(caseId);

  await request(app).post(`/api/cases/${caseId}/assign`).set("Authorization", `Bearer ${supervisorToken}`).send({ officerId });

  return {
    caseId,
    client,
    feeFlat: Number(intake.body.case.feeFlat),
    feePercent: Number(intake.body.case.feePercent),
  };
}

beforeAll(async () => {
  const pfa = await prisma.institution.create({ data: { type: "PFA", name: `Fee PFA ${runId}`, formTemplate: [] } });
  const pmb = await prisma.institution.create({ data: { type: "PMB", name: `Fee PMB ${runId}`, formTemplate: [] } });
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

describe("computeFeeTotal", () => {
  it("computes flat + percent x dealValue", () => {
    expect(computeFeeTotal(100000, 8, 5000000)).toBe(500000);
    expect(computeFeeTotal(100000, 8, 0)).toBe(100000);
  });
});

describe("business rule 3: fee auto-calculates on dealValue change, and never silently recalculates over a manual edit", () => {
  it("auto-calculates feeTotal when dealValue is set", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-auto");
    const officer = await makeUser("OPS_OFFICER", "-auto");
    const { caseId, feeFlat, feePercent } = await createAssignedCase(supervisor.token, officer.user.id, "-auto");

    const res = await request(app)
      .patch(`/api/cases/${caseId}/financials`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ dealValue: 5000000 });

    expect(res.status).toBe(200);
    expect(Number(res.body.case.feeTotal)).toBe(computeFeeTotal(feeFlat, feePercent, 5000000));
    expect(res.body.case.feeManuallyEdited).toBe(false);
  });

  it("recalculates again on a further dealValue change while not manually edited", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-recalc");
    const officer = await makeUser("OPS_OFFICER", "-recalc");
    const { caseId, feeFlat, feePercent } = await createAssignedCase(supervisor.token, officer.user.id, "-recalc");

    await request(app).patch(`/api/cases/${caseId}/financials`).set("Authorization", `Bearer ${officer.token}`).send({ dealValue: 2000000 });
    const second = await request(app)
      .patch(`/api/cases/${caseId}/financials`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ dealValue: 3000000 });

    expect(Number(second.body.case.feeTotal)).toBe(computeFeeTotal(feeFlat, feePercent, 3000000));
  });

  it("Accounting/Management can manually override, and it is audit-logged and sticky", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-override");
    const officer = await makeUser("OPS_OFFICER", "-override");
    const accounting = await makeUser("ACCOUNTING", "-override");
    const { caseId } = await createAssignedCase(supervisor.token, officer.user.id, "-override");

    await request(app).patch(`/api/cases/${caseId}/financials`).set("Authorization", `Bearer ${officer.token}`).send({ dealValue: 5000000 });

    const overrideRes = await request(app)
      .patch(`/api/cases/${caseId}/fee`)
      .set("Authorization", `Bearer ${accounting.token}`)
      .send({ feeTotal: 350000, note: "Negotiated discount" });
    expect(overrideRes.status).toBe(200);
    expect(Number(overrideRes.body.case.feeTotal)).toBe(350000);
    expect(overrideRes.body.case.feeManuallyEdited).toBe(true);

    const auditEntries = await prisma.auditLog.findMany({
      where: { entityType: "Case", entityId: caseId, action: "FEE_MANUALLY_OVERRIDDEN" },
    });
    expect(auditEntries).toHaveLength(1);
    expect((auditEntries[0].newValue as { feeTotal: number }).feeTotal).toBe(350000);

    // Rule 3: a subsequent dealValue change must NOT silently recalculate the fee.
    const afterDealValueChange = await request(app)
      .patch(`/api/cases/${caseId}/financials`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ dealValue: 9000000 });
    expect(Number(afterDealValueChange.body.case.feeTotal)).toBe(350000);
    expect(afterDealValueChange.body.case.dealValue).not.toBeNull();
  });

  it("OPS_OFFICER without fee:override cannot manually override the fee", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-noaccess");
    const officer = await makeUser("OPS_OFFICER", "-noaccess");
    const { caseId } = await createAssignedCase(supervisor.token, officer.user.id, "-noaccess");

    const res = await request(app)
      .patch(`/api/cases/${caseId}/fee`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ feeTotal: 1 });
    expect(res.status).toBe(403);
  });

  it("new cases pick up the current org-wide fee defaults", async () => {
    const superAdmin = await makeUser("SUPER_ADMIN", "-defaults");
    const currentDefaults = await request(app).get("/api/settings/fee-defaults").set("Authorization", `Bearer ${superAdmin.token}`);

    const client = await makeUser("CLIENT", "-defaults");
    const intake = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(intake.status).toBe(201);
    caseIds.push(intake.body.case.id);

    expect(Number(intake.body.case.feeFlat)).toBe(Number(currentDefaults.body.feeDefault.feeFlat));
    expect(Number(intake.body.case.feePercent)).toBe(Number(currentDefaults.body.feeDefault.feePercent));
    expect(intake.body.case.feeBasis).toBe(currentDefaults.body.feeDefault.feeBasis);
  });
});
