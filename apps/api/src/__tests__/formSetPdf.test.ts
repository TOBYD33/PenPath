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
  const email = `pdf-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}${suffix}`, email, passwordHash, role } });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Grace Ibe",
  date_of_birth: "1959-04-12",
  nin: "55566677788",
  phone: "08066677788",
  residential_address: "2 Ozumba Mbadiwe, Lagos",
  rsa_pin: "PEN444555666",
};

beforeAll(async () => {
  const pfa = await prisma.institution.create({ data: { type: "PFA", name: `PDF PFA ${runId}`, formTemplate: [] } });
  const pmb = await prisma.institution.create({ data: { type: "PMB", name: `PDF PMB ${runId}`, formTemplate: [] } });
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

describe("on-demand form-set PDF generation", () => {
  it("generates a PDF for a specific historical version and for the latest", async () => {
    const supervisor = await makeUser("OPS_SUPERVISOR", "-pdf");
    const officer = await makeUser("OPS_OFFICER", "-pdf");
    const client = await makeUser("CLIENT", "-pdf");
    const outsider = await makeUser("CLIENT", "-pdf-outsider");

    const intake = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(intake.status).toBe(201);
    const caseId = intake.body.case.id as string;
    caseIds.push(caseId);

    await request(app).post(`/api/cases/${caseId}/assign`).set("Authorization", `Bearer ${supervisor.token}`).send({ officerId: officer.user.id });
    await request(app)
      .patch(`/api/cases/${caseId}/form-submissions/bio_data`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ data: { ...bioData, full_name: "Grace Ibe-Okafor" } });

    const latestPdf = await request(app)
      .get(`/api/cases/${caseId}/form-submissions/bio_data/pdf`)
      .set("Authorization", `Bearer ${officer.token}`);
    expect(latestPdf.status).toBe(200);
    expect(latestPdf.headers["content-type"]).toContain("application/pdf");
    expect(latestPdf.headers["content-disposition"]).toContain("bio_data-v2.pdf");
    expect(Buffer.from(latestPdf.body).slice(0, 4).toString()).toBe("%PDF");

    const v1Pdf = await request(app)
      .get(`/api/cases/${caseId}/form-submissions/bio_data/pdf?version=1`)
      .set("Authorization", `Bearer ${officer.token}`);
    expect(v1Pdf.status).toBe(200);
    expect(v1Pdf.headers["content-disposition"]).toContain("bio_data-v1.pdf");

    // The client on their own case can also download it.
    const clientPdf = await request(app)
      .get(`/api/cases/${caseId}/form-submissions/bio_data/pdf`)
      .set("Authorization", `Bearer ${client.token}`);
    expect(clientPdf.status).toBe(200);

    // A different client cannot.
    const forbidden = await request(app)
      .get(`/api/cases/${caseId}/form-submissions/bio_data/pdf`)
      .set("Authorization", `Bearer ${outsider.token}`);
    expect(forbidden.status).toBe(403);

    const missingVersion = await request(app)
      .get(`/api/cases/${caseId}/form-submissions/bio_data/pdf?version=99`)
      .set("Authorization", `Bearer ${officer.token}`);
    expect(missingVersion.status).toBe(404);
  }, 60000);
});
