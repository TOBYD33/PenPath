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
  const email = `complaint-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}${suffix}`, email, passwordHash, role } });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Funke Ade",
  date_of_birth: "1958-11-03",
  nin: "33344455566",
  phone: "08044455566",
  residential_address: "7 Bourdillon Rd, Lagos",
  rsa_pin: "PEN111222333",
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

beforeAll(async () => {
  const pfa = await prisma.institution.create({ data: { type: "PFA", name: `Complaint PFA ${runId}`, formTemplate: [] } });
  const pmb = await prisma.institution.create({ data: { type: "PMB", name: `Complaint PMB ${runId}`, formTemplate: [] } });
  pfaId = pfa.id;
  pmbId = pmb.id;
  institutionIds.push(pfa.id, pmb.id);
}, 30000);

afterAll(async () => {
  await prisma.complaint.deleteMany({ where: { id: { in: complaintIds } } });
  await prisma.formSubmission.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.statusHistory.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...caseIds, ...userIds, ...complaintIds] } } });
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}, 30000);

describe("complaint intake is flagged to the case's assigned officer", () => {
  it("a complaint raised by the client is auto-flagged to the assigned Ops Officer", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-flag");
    const officer = await makeUser("OPS_OFFICER", "-flag");
    const otherOfficer = await makeUser("OPS_OFFICER", "-flag-other");
    const { caseId, client } = await createAssignedCase(supervisor.token, officer.user.id, "-flag");

    const res = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ caseId, description: "My PFA submission seems stuck." });
    expect(res.status).toBe(201);
    expect(res.body.complaint.assignedOfficer.id).toBe(officer.user.id);
    complaintIds.push(res.body.complaint.id);

    const officerView = await request(app).get("/api/complaints").set("Authorization", `Bearer ${officer.token}`);
    expect(officerView.body.complaints.map((c: { id: string }) => c.id)).toContain(res.body.complaint.id);

    const otherOfficerView = await request(app).get("/api/complaints").set("Authorization", `Bearer ${otherOfficer.token}`);
    expect(otherOfficerView.body.complaints.map((c: { id: string }) => c.id)).not.toContain(res.body.complaint.id);
  });
});

describe("complaints are visible to all internal roles", () => {
  it("Customer Care, Accounting, and Management can all see a complaint they didn't raise", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-visibility");
    const officer = await makeUser("OPS_OFFICER", "-visibility");
    const customerCare = await makeUser("CUSTOMER_CARE", "-visibility");
    const accounting = await makeUser("ACCOUNTING", "-visibility");
    const management = await makeUser("MANAGEMENT", "-visibility");
    const { caseId, client } = await createAssignedCase(supervisor.token, officer.user.id, "-visibility");

    const raised = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ caseId, description: "Nobody has called me back." });
    expect(raised.status).toBe(201);
    complaintIds.push(raised.body.complaint.id);

    for (const { token } of [customerCare, accounting, management]) {
      const res = await request(app).get("/api/complaints").set("Authorization", `Bearer ${token}`);
      expect(res.body.complaints.map((c: { id: string }) => c.id)).toContain(raised.body.complaint.id);
    }
  });

  it("a client cannot see complaints on a case that isn't theirs", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-isolation");
    const officer = await makeUser("OPS_OFFICER", "-isolation");
    const { caseId, client } = await createAssignedCase(supervisor.token, officer.user.id, "-isolation");
    const otherClient = await makeUser("CLIENT", "-isolation-other");

    const raised = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ caseId, description: "Private complaint." });
    complaintIds.push(raised.body.complaint.id);

    const res = await request(app).get("/api/complaints").set("Authorization", `Bearer ${otherClient.token}`);
    expect(res.body.complaints.map((c: { id: string }) => c.id)).not.toContain(raised.body.complaint.id);
  });
});

describe("complaint status flow: Open -> In Progress -> Resolved", () => {
  it("Customer Care can progress a complaint through the flow, and it's audit-logged", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-flow");
    const officer = await makeUser("OPS_OFFICER", "-flow");
    const customerCare = await makeUser("CUSTOMER_CARE", "-flow");
    const { caseId, client } = await createAssignedCase(supervisor.token, officer.user.id, "-flow");

    const raised = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ caseId, description: "Status flow test." });
    const complaintId = raised.body.complaint.id;
    complaintIds.push(complaintId);
    expect(raised.body.complaint.status).toBe("OPEN");

    const inProgress = await request(app)
      .patch(`/api/complaints/${complaintId}`)
      .set("Authorization", `Bearer ${customerCare.token}`)
      .send({ status: "IN_PROGRESS" });
    expect(inProgress.status).toBe(200);
    expect(inProgress.body.complaint.status).toBe("IN_PROGRESS");

    const resolveWithoutNote = await request(app)
      .patch(`/api/complaints/${complaintId}`)
      .set("Authorization", `Bearer ${customerCare.token}`)
      .send({ status: "RESOLVED" });
    expect(resolveWithoutNote.status).toBe(400);

    const resolved = await request(app)
      .patch(`/api/complaints/${complaintId}`)
      .set("Authorization", `Bearer ${customerCare.token}`)
      .send({ status: "RESOLVED", resolutionNote: "Called the client and clarified the status." });
    expect(resolved.status).toBe(200);
    expect(resolved.body.complaint.status).toBe("RESOLVED");

    const backToOpen = await request(app)
      .patch(`/api/complaints/${complaintId}`)
      .set("Authorization", `Bearer ${customerCare.token}`)
      .send({ status: "IN_PROGRESS" });
    expect(backToOpen.status).toBe(409);

    const auditEntries = await prisma.auditLog.findMany({
      where: { entityType: "Complaint", entityId: complaintId, action: "COMPLAINT_STATUS_UPDATED" },
    });
    expect(auditEntries).toHaveLength(2);
  });

  it("an Ops Officer without complaint:manage cannot update complaint status", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-gate");
    const officer = await makeUser("OPS_OFFICER", "-gate");
    const { caseId, client } = await createAssignedCase(supervisor.token, officer.user.id, "-gate");

    const raised = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ caseId, description: "Gate test." });
    complaintIds.push(raised.body.complaint.id);

    const res = await request(app)
      .patch(`/api/complaints/${raised.body.complaint.id}`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ status: "IN_PROGRESS" });
    expect(res.status).toBe(403);
  });
});
