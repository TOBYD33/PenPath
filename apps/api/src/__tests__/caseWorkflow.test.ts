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
  const email = `workflow-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}${suffix}`, email, passwordHash, role } });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Ngozi Bassey",
  date_of_birth: "1963-07-14",
  nin: "77788899900",
  phone: "08055566677",
  residential_address: "12 Adeola Odeku St, VI, Lagos",
  rsa_pin: "PEN998877665",
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

  const assign = await request(app)
    .post(`/api/cases/${caseId}/assign`)
    .set("Authorization", `Bearer ${supervisorToken}`)
    .send({ officerId });
  expect(assign.status).toBe(200);

  return { caseId, client };
}

beforeAll(async () => {
  const pfa = await prisma.institution.create({ data: { type: "PFA", name: `Workflow PFA ${runId}`, formTemplate: [] } });
  const pmb = await prisma.institution.create({ data: { type: "PMB", name: `Workflow PMB ${runId}`, formTemplate: [] } });
  pfaId = pfa.id;
  pmbId = pmb.id;
  institutionIds.push(pfa.id, pmb.id);
}, 30000);

afterAll(async () => {
  await prisma.transferForm.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.formSubmission.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.document.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.statusHistory.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...caseIds, ...userIds] } } });
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}, 30000);

describe("full case lifecycle: intake through closure", () => {
  it("walks a case from NEW_APPLICATION to CASE_CLOSED through every workflow action", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-lifecycle");
    const officer = await makeUser("OPS_OFFICER", "-lifecycle");
    const accounting = await makeUser("ACCOUNTING", "-lifecycle");
    const management = await makeUser("MANAGEMENT", "-lifecycle");
    const { caseId, client } = await createAssignedCase(supervisor.token, officer.user.id, "-lifecycle");

    const readyForPfa = await request(app)
      .post(`/api/cases/${caseId}/ready-for-pfa`)
      .set("Authorization", `Bearer ${officer.token}`);
    expect(readyForPfa.status).toBe(200);
    expect(readyForPfa.body.case.status).toBe("SUBMITTED_TO_PFA");
    expect(readyForPfa.body.document.type).toBe("generated_pdf");
    expect(readyForPfa.body.document.url).toMatch(/^\/uploads\/.+\.pdf$/);

    const pfaApproved = await request(app)
      .post(`/api/cases/${caseId}/pfa-outcome`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ outcome: "PFA_APPROVED" });
    expect(pfaApproved.status).toBe(200);
    expect(pfaApproved.body.case.status).toBe("SUBMITTED_TO_PMB");

    const pmbApproved = await request(app)
      .post(`/api/cases/${caseId}/pmb-outcome`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ outcome: "PMB_APPROVED" });
    expect(pmbApproved.status).toBe(200);
    expect(pmbApproved.body.case.status).toBe("AWAITING_FUND_RELEASE");

    const confirmFunds = await request(app)
      .post(`/api/cases/${caseId}/confirm-funds-received`)
      .set("Authorization", `Bearer ${client.token}`);
    expect(confirmFunds.status).toBe(200);
    expect(confirmFunds.body.case.status).toBe("FUNDS_RELEASED_CONFIRMED");

    const triggerTransfer = await request(app)
      .post(`/api/cases/${caseId}/trigger-transfer-form`)
      .set("Authorization", `Bearer ${officer.token}`);
    expect(triggerTransfer.status).toBe(200);
    expect(triggerTransfer.body.case.status).toBe("TRANSFER_FORM_SENT");

    const submitTransfer = await request(app)
      .post(`/api/cases/${caseId}/transfer-form`)
      .set("Authorization", `Bearer ${client.token}`)
      .send({ bankName: "GTBank", accountNumber: "0123456789", amount: 4500000, mortgageRef: "MTG-001" });
    expect(submitTransfer.status).toBe(201);
    expect(submitTransfer.body.case.status).toBe("TRANSFER_SENT_TO_ACCOUNTING");
    expect(submitTransfer.body.transferForm.submittedAt).not.toBeNull();
    expect(submitTransfer.body.transferForm.sentToAccountingAt).not.toBeNull();

    const sendToPmb = await request(app)
      .post(`/api/cases/${caseId}/send-transfer-to-pmb`)
      .set("Authorization", `Bearer ${accounting.token}`);
    expect(sendToPmb.status).toBe(200);
    expect(sendToPmb.body.case.status).toBe("TRANSFER_SENT_TO_PMB");
    expect(sendToPmb.body.transferForm.sentToPmbAt).not.toBeNull();

    const confirmBank = await request(app)
      .post(`/api/cases/${caseId}/confirm-mortgage-bank`)
      .set("Authorization", `Bearer ${management.token}`);
    expect(confirmBank.status).toBe(200);
    expect(confirmBank.body.case.status).toBe("MORTGAGE_BANK_CONFIRMED");

    const payout = await request(app)
      .post(`/api/cases/${caseId}/process-payout`)
      .set("Authorization", `Bearer ${management.token}`);
    expect(payout.status).toBe(200);
    expect(payout.body.case.status).toBe("CASE_CLOSED");
    expect(payout.body.case.active).toBe(false);

    const history = await prisma.statusHistory.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } });
    const path = history.map((h) => h.toStatus);
    expect(path).toEqual([
      "NEW_APPLICATION",
      "SUBMITTED_TO_PFA",
      "PFA_APPROVED",
      "SUBMITTED_TO_PMB",
      "PMB_APPROVED",
      "AWAITING_FUND_RELEASE",
      "FUNDS_RELEASED_CONFIRMED",
      "TRANSFER_FORM_SENT",
      "TRANSFER_FORM_SUBMITTED",
      "TRANSFER_SENT_TO_ACCOUNTING",
      "TRANSFER_SENT_TO_PMB",
      "MORTGAGE_BANK_CONFIRMED",
      "MANAGEMENT_PAYOUT_PROCESSED",
      "CASE_CLOSED",
    ]);

    // Business rule 1: closing the case releases the one-active-case lock.
    const secondIntake = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(secondIntake.status).toBe(201);
    caseIds.push(secondIntake.body.case.id);
  }, 240000);
});

describe("business rule 2: funds are never disbursed directly to the client", () => {
  it("only the client can confirm funds received, and only from AWAITING_FUND_RELEASE", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-rule2");
    const officer = await makeUser("OPS_OFFICER", "-rule2");
    const { caseId, client } = await createAssignedCase(supervisor.token, officer.user.id, "-rule2");

    const tooEarly = await request(app)
      .post(`/api/cases/${caseId}/confirm-funds-received`)
      .set("Authorization", `Bearer ${client.token}`);
    expect(tooEarly.status).toBe(409);

    const opsAttempt = await request(app)
      .post(`/api/cases/${caseId}/confirm-funds-received`)
      .set("Authorization", `Bearer ${officer.token}`);
    expect(opsAttempt.status).toBe(403);
  });
});

describe("rejection paths release the one-active-case lock", () => {
  it("PFA_REJECTED marks the case inactive immediately", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-reject");
    const officer = await makeUser("OPS_OFFICER", "-reject");
    const { caseId } = await createAssignedCase(supervisor.token, officer.user.id, "-reject");

    await request(app).post(`/api/cases/${caseId}/ready-for-pfa`).set("Authorization", `Bearer ${officer.token}`);
    const rejected = await request(app)
      .post(`/api/cases/${caseId}/pfa-outcome`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ outcome: "PFA_REJECTED", note: "Ineligible" });

    expect(rejected.status).toBe(200);
    expect(rejected.body.case.status).toBe("PFA_REJECTED");
    expect(rejected.body.case.active).toBe(false);
  }, 60000);
});

describe("workflow actions are gated to the assigned officer/override roles", () => {
  it("an unrelated Ops Officer cannot record outcomes on a case assigned to someone else", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-gate");
    const officer = await makeUser("OPS_OFFICER", "-gate-owner");
    const outsider = await makeUser("OPS_OFFICER", "-gate-outsider");
    const { caseId } = await createAssignedCase(supervisor.token, officer.user.id, "-gate");

    const res = await request(app)
      .post(`/api/cases/${caseId}/ready-for-pfa`)
      .set("Authorization", `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it("only Management can confirm the mortgage bank and process payout", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-mgmt-gate");
    const officer = await makeUser("OPS_OFFICER", "-mgmt-gate");
    const { caseId } = await createAssignedCase(supervisor.token, officer.user.id, "-mgmt-gate");

    const res = await request(app)
      .post(`/api/cases/${caseId}/confirm-mortgage-bank`)
      .set("Authorization", `Bearer ${officer.token}`);
    expect(res.status).toBe(403);
  });
});
