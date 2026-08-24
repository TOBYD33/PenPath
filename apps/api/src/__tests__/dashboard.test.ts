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
const complaintIds: string[] = [];
const institutionIds: string[] = [];

async function makeUser(role: Role, suffix = "") {
  const email = `dashboard-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}${suffix}`, email, passwordHash, role } });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Uche Nwosu",
  date_of_birth: "1962-09-09",
  nin: "44455566677",
  phone: "08077788899",
  residential_address: "5 Kofo Abayomi St, Lagos",
  rsa_pin: "PEN777888999",
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

  return { caseId, client };
}

async function walkCaseToClosure(caseId: string, officerToken: string, clientToken: string, managementToken: string, accountingToken: string) {
  await request(app).post(`/api/cases/${caseId}/ready-for-pfa`).set("Authorization", `Bearer ${officerToken}`);
  await request(app).post(`/api/cases/${caseId}/pfa-outcome`).set("Authorization", `Bearer ${officerToken}`).send({ outcome: "PFA_APPROVED" });
  await request(app).post(`/api/cases/${caseId}/pmb-outcome`).set("Authorization", `Bearer ${officerToken}`).send({ outcome: "PMB_APPROVED" });
  await request(app).post(`/api/cases/${caseId}/confirm-funds-received`).set("Authorization", `Bearer ${clientToken}`);
  await request(app).post(`/api/cases/${caseId}/trigger-transfer-form`).set("Authorization", `Bearer ${officerToken}`);
  await request(app)
    .post(`/api/cases/${caseId}/transfer-form`)
    .set("Authorization", `Bearer ${clientToken}`)
    .send({ bankName: "Zenith", accountNumber: "1112223334", amount: 4000000, mortgageRef: "MTG-DASH" });
  await request(app).post(`/api/cases/${caseId}/send-transfer-to-pmb`).set("Authorization", `Bearer ${accountingToken}`);
  await request(app).post(`/api/cases/${caseId}/confirm-mortgage-bank`).set("Authorization", `Bearer ${managementToken}`);
  const payout = await request(app).post(`/api/cases/${caseId}/process-payout`).set("Authorization", `Bearer ${managementToken}`);
  return payout;
}

beforeAll(async () => {
  const pfa = await prisma.institution.create({ data: { type: "PFA", name: `Dashboard PFA ${runId}`, formTemplate: [] } });
  const pmb = await prisma.institution.create({ data: { type: "PMB", name: `Dashboard PMB ${runId}`, formTemplate: [] } });
  pfaId = pfa.id;
  pmbId = pmb.id;
  institutionIds.push(pfa.id, pmb.id);
}, 30000);

afterAll(async () => {
  await prisma.complaint.deleteMany({ where: { id: { in: complaintIds } } });
  await prisma.transferForm.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.document.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.formSubmission.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.statusHistory.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...caseIds, ...userIds, ...complaintIds] } } });
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}, 30000);

describe("dashboards are gated by their permissions", () => {
  it("OPS_OFFICER cannot access the revenue dashboard", async () => {
    const officer = await makeUser("OPS_OFFICER", "-gate");
    const res = await request(app).get("/api/dashboard/revenue").set("Authorization", `Bearer ${officer.token}`);
    expect(res.status).toBe(403);
  });

  it("ACCOUNTING cannot access the activity dashboard (only Supervisor/Management/Super Admin)", async () => {
    const accounting = await makeUser("ACCOUNTING", "-gate");
    const res = await request(app).get("/api/dashboard/activity").set("Authorization", `Bearer ${accounting.token}`);
    expect(res.status).toBe(403);
  });

  it("MANAGEMENT can access both dashboards", async () => {
    const management = await makeUser("MANAGEMENT", "-gate");
    const revenue = await request(app).get(`/api/dashboard/revenue?pfaId=${pfaId}`).set("Authorization", `Bearer ${management.token}`);
    expect(revenue.status).toBe(200);
    const activity = await request(app).get("/api/dashboard/activity").set("Authorization", `Bearer ${management.token}`);
    expect(activity.status).toBe(200);
  });
});

describe("revenue dashboard: realized vs pipeline", () => {
  it("counts a closed case's fee as realized revenue and an open case's fee as pipeline value", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-revenue");
    const officer = await makeUser("OPS_OFFICER", "-revenue");
    const accounting = await makeUser("ACCOUNTING", "-revenue");
    const management = await makeUser("MANAGEMENT", "-revenue");

    const closedCase = await createAssignedCase(supervisor.token, officer.user.id, "-closed");
    await request(app)
      .patch(`/api/cases/${closedCase.caseId}/financials`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ dealValue: 4000000 });
    const closeResult = await walkCaseToClosure(closedCase.caseId, officer.token, closedCase.client.token, management.token, accounting.token);
    expect(closeResult.status).toBe(200);
    expect(closeResult.body.case.status).toBe("CASE_CLOSED");
    const closedFee = Number(closeResult.body.case.feeTotal);

    const pipelineCase = await createAssignedCase(supervisor.token, officer.user.id, "-pipeline");
    const pipelineFinancials = await request(app)
      .patch(`/api/cases/${pipelineCase.caseId}/financials`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ dealValue: 2000000 });
    const pipelineFee = Number(pipelineFinancials.body.case.feeTotal);

    const res = await request(app)
      .get(`/api/dashboard/revenue?officerId=${officer.user.id}`)
      .set("Authorization", `Bearer ${management.token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRealizedRevenue).toBeGreaterThanOrEqual(closedFee);
    expect(res.body.totalPipelineValue).toBeGreaterThanOrEqual(pipelineFee);

    const closedEntry = res.body.cases.find((c: { id: string }) => c.id === closedCase.caseId);
    const pipelineEntry = res.body.cases.find((c: { id: string }) => c.id === pipelineCase.caseId);
    expect(closedEntry.status).toBe("CASE_CLOSED");
    expect(closedEntry.closedAt).not.toBeNull();
    expect(pipelineEntry.closedAt).toBeNull();
  }, 240000);

  // Scoped to this file's own PFA: an unfiltered query would scan every case
  // in the shared dev database, including rows from other test files whose
  // institutions may be mid-deletion in a concurrently running afterAll.
  it("CSV export returns a text/csv attachment", async () => {
    const management = await makeUser("MANAGEMENT", "-csv");
    const res = await request(app).get(`/api/dashboard/revenue/export?pfaId=${pfaId}`).set("Authorization", `Bearer ${management.token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("Client,PFA,PMB,Officer,Status,Fee Total,Created,Closed");
  });

  it("PDF export returns a valid PDF", async () => {
    const management = await makeUser("MANAGEMENT", "-pdf");
    const res = await request(app)
      .get(`/api/dashboard/revenue/export?pfaId=${pfaId}&format=pdf`)
      .set("Authorization", `Bearer ${management.token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.from(res.body).slice(0, 4).toString()).toBe("%PDF");
  });
});

describe("activity dashboard: cases closed, login activity, complaints resolved", () => {
  it("tracks casesClosed for the officer and complaintsResolved for the Customer Care agent who resolved them", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-activity");
    const officer = await makeUser("OPS_OFFICER", "-activity");
    const customerCare = await makeUser("CUSTOMER_CARE", "-activity");
    const management = await makeUser("MANAGEMENT", "-activity");
    const accounting = await makeUser("ACCOUNTING", "-activity");

    // A fresh login updates lastLoginAt.
    await request(app).post("/api/auth/login").send({ email: officer.user.email, password: "Password123!" });

    const { caseId, client } = await createAssignedCase(supervisor.token, officer.user.id, "-activity");
    await request(app).patch(`/api/cases/${caseId}/financials`).set("Authorization", `Bearer ${officer.token}`).send({ dealValue: 1000000 });
    await walkCaseToClosure(caseId, officer.token, client.token, management.token, accounting.token);

    const raised = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ caseId, description: "Activity dashboard test complaint." });
    complaintIds.push(raised.body.complaint.id);
    await request(app)
      .patch(`/api/complaints/${raised.body.complaint.id}`)
      .set("Authorization", `Bearer ${customerCare.token}`)
      .send({ status: "RESOLVED", resolutionNote: "Resolved for dashboard test." });

    const res = await request(app).get("/api/dashboard/activity").set("Authorization", `Bearer ${management.token}`);
    expect(res.status).toBe(200);

    const officerStats = res.body.opsOfficers.find((o: { id: string }) => o.id === officer.user.id);
    expect(officerStats.casesClosed).toBeGreaterThanOrEqual(1);
    expect(officerStats.casesAssigned).toBeGreaterThanOrEqual(1);
    expect(officerStats.lastLoginAt).not.toBeNull();
    expect(officerStats.avgDaysToClose).not.toBeNull();

    const careStats = res.body.customerCareAgents.find((a: { id: string }) => a.id === customerCare.user.id);
    expect(careStats.complaintsResolved).toBeGreaterThanOrEqual(1);
  }, 240000);
});
