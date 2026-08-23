import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import type { Role } from "@penpath/shared";

const app = createApp();
const runId = Date.now();

const userIds: string[] = [];
const caseIds: string[] = [];
const institutionIds: string[] = [];

async function makeUser(role: Role, suffix = "") {
  const email = `intake-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}${suffix}`, email, passwordHash, role } });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

const pfaTemplate = [{ key: "membership_no", label: "Membership No", type: "text", required: true }];
const pmbTemplate = [{ key: "loan_ref", label: "Loan Ref", type: "text", required: true }];

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Ada Okoye",
  date_of_birth: "1965-01-01",
  nin: "12345678901",
  phone: "08010000000",
  residential_address: "1 Lekki Rd, Lagos",
  rsa_pin: "PEN123456789",
};

beforeAll(async () => {
  const pfa = await prisma.institution.create({
    data: { type: "PFA", name: `Test PFA ${runId}`, formTemplate: pfaTemplate },
  });
  const pmb = await prisma.institution.create({
    data: { type: "PMB", name: `Test PMB ${runId}`, formTemplate: pmbTemplate },
  });
  pfaId = pfa.id;
  pmbId = pmb.id;
  institutionIds.push(pfa.id, pmb.id);
});

afterAll(async () => {
  await prisma.formSubmission.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.document.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.statusHistory.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("business rule 1: one active case per client", () => {
  it("allows the first digital intake and rejects a second while it's active", async () => {
    const client = await makeUser("CLIENT");

    const first = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: { membership_no: "M1" }, pmbForm: { loan_ref: "L1" } });
    expect(first.status).toBe(201);
    caseIds.push(first.body.case.id);

    const second = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: { membership_no: "M2" }, pmbForm: { loan_ref: "L2" } });
    expect(second.status).toBe(409);
  });

  it("rejects incomplete required fields", async () => {
    const client = await makeUser("CLIENT", "-incomplete");
    const res = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ pfaId, pmbId, bioData: { full_name: "Missing Fields" }, pfaForm: {}, pmbForm: {} });
    expect(res.status).toBe(400);
  });
});

describe("business rule 5: intake source never changes the pipeline", () => {
  it("digital and physical scan intake produce structurally identical cases", async () => {
    const digitalClient = await makeUser("CLIENT", "-digital");
    const opsOfficer = await makeUser("OPS_OFFICER", "-scan");
    const supervisor = await makeUser("OPS_SUPERVISOR", "-parity");

    const digital = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${digitalClient.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: { membership_no: "M3" }, pmbForm: { loan_ref: "L3" } });
    expect(digital.status).toBe(201);
    caseIds.push(digital.body.case.id);

    const scan = await request(app)
      .post("/api/cases/scan-intake")
      .set("Authorization", `Bearer ${opsOfficer.token}`)
      .field("clientName", "Physical Client")
      .field("clientEmail", `intake-physical-${runId}@pemwo.local`)
      .field("pfaId", pfaId)
      .field("pmbId", pmbId)
      .field("bioData", JSON.stringify(bioData))
      .field("pfaForm", JSON.stringify({ membership_no: "M4" }))
      .field("pmbForm", JSON.stringify({ loan_ref: "L4" }))
      .attach("scannedForm", Buffer.from("fake scan bytes"), "scan.pdf");
    expect(scan.status).toBe(201);
    caseIds.push(scan.body.case.id);
    userIds.push(scan.body.case.client.id);

    // Same status, same fee defaults, same set of form types/versions — only intakeSource differs.
    expect(scan.body.case.status).toBe(digital.body.case.status);
    expect(scan.body.case.feeFlat).toBe(digital.body.case.feeFlat);
    expect(scan.body.case.feePercent).toBe(digital.body.case.feePercent);
    expect(scan.body.case.feeBasis).toBe(digital.body.case.feeBasis);
    expect(digital.body.case.intakeSource).toBe("DIGITAL_LINK");
    expect(scan.body.case.intakeSource).toBe("PHYSICAL_SCAN");

    const digitalDetail = await request(app)
      .get(`/api/cases/${digital.body.case.id}`)
      .set("Authorization", `Bearer ${supervisor.token}`);
    const scanDetail = await request(app)
      .get(`/api/cases/${scan.body.case.id}`)
      .set("Authorization", `Bearer ${supervisor.token}`);

    const formTypesOf = (c: { formSubmissions: { formType: string; version: number }[] }) =>
      c.formSubmissions.map((f) => `${f.formType}:${f.version}`).sort();
    expect(formTypesOf(scanDetail.body.case)).toEqual(formTypesOf(digitalDetail.body.case));

    // Only the physical path has a scanned Document attached.
    expect(digitalDetail.body.case.documents).toHaveLength(0);
    expect(scanDetail.body.case.documents).toHaveLength(1);
    expect(scanDetail.body.case.documents[0].type).toBe("scanned_original");
  });
});

describe("business rule 6: only the assigned Ops Officer (or an override role) can edit pre-approval", () => {
  it("blocks an unassigned Ops Officer, allows the assigned officer, allows a Supervisor override, and blocks edits after SUBMITTED_TO_PFA", async () => {
    const client = await makeUser("CLIENT", "-editflow");
    const assignedOfficer = await makeUser("OPS_OFFICER", "-assigned");
    const otherOfficer = await makeUser("OPS_OFFICER", "-other");
    const supervisor = await makeUser("OPS_SUPERVISOR", "-editflow");

    const intake = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: { membership_no: "M5" }, pmbForm: { loan_ref: "L5" } });
    expect(intake.status).toBe(201);
    const caseId = intake.body.case.id;
    caseIds.push(caseId);

    // Not yet assigned to anyone: even the "assigned officer"-to-be can't edit yet.
    const beforeAssignment = await request(app)
      .patch(`/api/cases/${caseId}/form-submissions/bio_data`)
      .set("Authorization", `Bearer ${assignedOfficer.token}`)
      .send({ data: { ...bioData, full_name: "Should Fail" } });
    expect(beforeAssignment.status).toBe(403);

    await prisma.case.update({ where: { id: caseId }, data: { assignedOfficerId: assignedOfficer.user.id } });

    const unassignedAttempt = await request(app)
      .patch(`/api/cases/${caseId}/form-submissions/bio_data`)
      .set("Authorization", `Bearer ${otherOfficer.token}`)
      .send({ data: { ...bioData, full_name: "Should Still Fail" } });
    expect(unassignedAttempt.status).toBe(403);

    const assignedEdit = await request(app)
      .patch(`/api/cases/${caseId}/form-submissions/bio_data`)
      .set("Authorization", `Bearer ${assignedOfficer.token}`)
      .send({ data: { ...bioData, full_name: "Edited By Assigned Officer" } });
    expect(assignedEdit.status).toBe(200);
    expect(assignedEdit.body.formSubmission.version).toBe(2);

    const supervisorEdit = await request(app)
      .patch(`/api/cases/${caseId}/form-submissions/bio_data`)
      .set("Authorization", `Bearer ${supervisor.token}`)
      .send({ data: { ...bioData, full_name: "Edited By Supervisor Override" } });
    expect(supervisorEdit.status).toBe(200);
    expect(supervisorEdit.body.formSubmission.version).toBe(3);

    const auditEntries = await prisma.auditLog.findMany({
      where: { entityType: "FormSubmission", entityId: supervisorEdit.body.formSubmission.id },
    });
    expect(auditEntries).toHaveLength(1);
    expect((auditEntries[0].oldValue as { full_name: string }).full_name).toBe("Edited By Assigned Officer");
    expect((auditEntries[0].newValue as { full_name: string }).full_name).toBe("Edited By Supervisor Override");

    await prisma.case.update({ where: { id: caseId }, data: { status: "SUBMITTED_TO_PFA" } });

    const afterSubmission = await request(app)
      .patch(`/api/cases/${caseId}/form-submissions/bio_data`)
      .set("Authorization", `Bearer ${assignedOfficer.token}`)
      .send({ data: { ...bioData, full_name: "Too Late" } });
    expect(afterSubmission.status).toBe(403);
  });
});
