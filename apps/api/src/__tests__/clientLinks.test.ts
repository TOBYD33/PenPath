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
const linkIds: string[] = [];
const caseIds: string[] = [];
const institutionIds: string[] = [];

async function makeUser(role: Role, suffix = "") {
  const email = `link-test-${role.toLowerCase()}${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.create({ data: { name: `Test ${role}${suffix}`, email, passwordHash, role } });
  userIds.push(user.id);
  return { user, token: signToken({ sub: user.id, role: user.role, email: user.email }) };
}

let pfaId: string;
let pmbId: string;

const bioData = {
  full_name: "Kemi Adeyemi",
  date_of_birth: "1964-06-21",
  nin: "99988877766",
  phone: "08099988877",
  residential_address: "8 Bishop Oluwole St, VI, Lagos",
  rsa_pin: "PEN666777888",
};

beforeAll(async () => {
  const pfa = await prisma.institution.create({ data: { type: "PFA", name: `Link PFA ${runId}`, formTemplate: [] } });
  const pmb = await prisma.institution.create({ data: { type: "PMB", name: `Link PMB ${runId}`, formTemplate: [] } });
  pfaId = pfa.id;
  pmbId = pmb.id;
  institutionIds.push(pfa.id, pmb.id);
}, 30000);

afterAll(async () => {
  await prisma.clientLink.deleteMany({ where: { id: { in: linkIds } } });
  await prisma.formSubmission.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.statusHistory.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...caseIds, ...userIds, ...linkIds] } } });
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}, 30000);

describe("business rule 1 (of this feature): only Admin/Super Admin/case:generate-link holders can generate links", () => {
  it("ADMIN and SUPER_ADMIN can generate links by default", async () => {
    const admin = await makeUser("ADMIN", "-gen");
    const superAdmin = await makeUser("SUPER_ADMIN", "-gen");

    for (const { token } of [admin, superAdmin]) {
      const res = await request(app).post("/api/links").set("Authorization", `Bearer ${token}`).send({});
      expect(res.status).toBe(201);
      linkIds.push(res.body.clientLink.id);
    }
  });

  it("CUSTOMER_CARE is denied by default, gains access once granted case:generate-link, and loses it again on revoke", async () => {
    const superAdmin = await makeUser("SUPER_ADMIN", "-grantor");
    const care = await makeUser("CUSTOMER_CARE", "-grantee");

    const before = await request(app).post("/api/links").set("Authorization", `Bearer ${care.token}`).send({});
    expect(before.status).toBe(403);

    const grant = await request(app)
      .put(`/api/users/${care.user.id}/permissions/case:generate-link`)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ granted: true });
    expect(grant.status).toBe(200);

    const after = await request(app).post("/api/links").set("Authorization", `Bearer ${care.token}`).send({});
    expect(after.status).toBe(201);
    linkIds.push(after.body.clientLink.id);

    const revoke = await request(app)
      .put(`/api/users/${care.user.id}/permissions/case:generate-link`)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ granted: false });
    expect(revoke.status).toBe(200);

    const afterRevoke = await request(app).post("/api/links").set("Authorization", `Bearer ${care.token}`).send({});
    expect(afterRevoke.status).toBe(403);
  });
});

describe("public apply flow reuses the shared case-creation pipeline", () => {
  it("creates a case identical in shape to digital/scan intake, tags DIGITAL_LINK, and marks the link USED", async () => {
    const admin = await makeUser("ADMIN", "-flow");

    const genRes = await request(app)
      .post("/api/links")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ clientEmail: `link-applicant-${runId}@pemwo.local`, clientName: "Kemi Adeyemi" });
    expect(genRes.status).toBe(201);
    const link = genRes.body.clientLink;
    linkIds.push(link.id);
    expect(genRes.body.url).toContain(`/apply/${link.token}`);

    // GET is public — no Authorization header at all.
    const getRes = await request(app).get(`/api/apply/${link.token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.prefill.clientEmail).toBe(`link-applicant-${runId}@pemwo.local`);
    expect(getRes.body.pfas.some((p: { id: string }) => p.id === pfaId)).toBe(true);

    const postRes = await request(app).post(`/api/apply/${link.token}`).send({
      pfaId,
      pmbId,
      bioData,
      pfaForm: {},
      pmbForm: {},
    });
    expect(postRes.status).toBe(201);
    expect(postRes.body.case.intakeSource).toBe("DIGITAL_LINK");
    expect(postRes.body.case.status).toBe("NEW_APPLICATION");
    expect(Number(postRes.body.case.feeFlat)).toBe(100000);
    caseIds.push(postRes.body.case.id);

    const linkAfter = await prisma.clientLink.findUnique({ where: { id: link.id } });
    expect(linkAfter?.status).toBe("USED");
    expect(linkAfter?.caseId).toBe(postRes.body.case.id);

    // Appears in the unassigned queue exactly like any other case, with an
    // intake-source badge distinguishing it (no separate assignment path).
    const queueRes = await request(app).get("/api/cases/unassigned").set("Authorization", `Bearer ${admin.token}`);
    const queued = queueRes.body.cases.find((c: { id: string }) => c.id === postRes.body.case.id);
    expect(queued).toBeDefined();
    expect(queued.intakeSource).toBe("DIGITAL_LINK");
  }, 30000);

  it("rejects reuse of an already-used token (single-use)", async () => {
    const admin = await makeUser("ADMIN", "-reuse");
    const genRes = await request(app)
      .post("/api/links")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ clientEmail: `link-reuse-${runId}@pemwo.local` });
    linkIds.push(genRes.body.clientLink.id);

    const first = await request(app)
      .post(`/api/apply/${genRes.body.clientLink.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(first.status).toBe(201);
    caseIds.push(first.body.case.id);

    const second = await request(app)
      .post(`/api/apply/${genRes.body.clientLink.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(second.status).toBe(404);
    expect(second.body.error).toMatch(/invalid or has expired/i);
  }, 40000);

  it("rejects an expired token on GET and POST, and flips its status to EXPIRED", async () => {
    const admin = await makeUser("ADMIN", "-expiry");
    const genRes = await request(app).post("/api/links").set("Authorization", `Bearer ${admin.token}`).send({});
    linkIds.push(genRes.body.clientLink.id);

    await prisma.clientLink.update({ where: { id: genRes.body.clientLink.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const getRes = await request(app).get(`/api/apply/${genRes.body.clientLink.token}`);
    expect(getRes.status).toBe(404);

    const dbLink = await prisma.clientLink.findUnique({ where: { id: genRes.body.clientLink.id } });
    expect(dbLink?.status).toBe("EXPIRED");

    const postRes = await request(app)
      .post(`/api/apply/${genRes.body.clientLink.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(postRes.status).toBe(404);
  });

  it("rejects a nonexistent token with the same generic message (no information leak)", async () => {
    const res = await request(app).get("/api/apply/not-a-real-token");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });
});

describe("link revocation", () => {
  it("the generator can revoke their own unused link; a different non-admin cannot", async () => {
    const care1 = await makeUser("CUSTOMER_CARE", "-revoke1");
    const care2 = await makeUser("CUSTOMER_CARE", "-revoke2");
    const superAdmin = await makeUser("SUPER_ADMIN", "-revoke-grant");

    await request(app)
      .put(`/api/users/${care1.user.id}/permissions/case:generate-link`)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ granted: true });
    await request(app)
      .put(`/api/users/${care2.user.id}/permissions/case:generate-link`)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ granted: true });

    const genRes = await request(app).post("/api/links").set("Authorization", `Bearer ${care1.token}`).send({});
    linkIds.push(genRes.body.clientLink.id);

    const forbidden = await request(app)
      .post(`/api/links/${genRes.body.clientLink.id}/revoke`)
      .set("Authorization", `Bearer ${care2.token}`);
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .post(`/api/links/${genRes.body.clientLink.id}/revoke`)
      .set("Authorization", `Bearer ${care1.token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.clientLink.status).toBe("REVOKED");

    const postRes = await request(app)
      .post(`/api/apply/${genRes.body.clientLink.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(postRes.status).toBe(404);
  });

  it("a used link cannot be revoked", async () => {
    const admin = await makeUser("ADMIN", "-revoke-used");
    const genRes = await request(app)
      .post("/api/links")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ clientEmail: `link-revoke-used-${runId}@pemwo.local` });
    linkIds.push(genRes.body.clientLink.id);

    const submit = await request(app)
      .post(`/api/apply/${genRes.body.clientLink.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(submit.status).toBe(201);
    caseIds.push(submit.body.case.id);

    const revoke = await request(app).post(`/api/links/${genRes.body.clientLink.id}/revoke`).set("Authorization", `Bearer ${admin.token}`);
    expect(revoke.status).toBe(409);
  }, 40000);
});

describe("case assignment is now also available to Admin (widened case:assign default)", () => {
  it("ADMIN can assign a case, and Case.assignedById records who did it", async () => {
    const admin = await makeUser("ADMIN", "-assign");
    const officer = await makeUser("OPS_OFFICER", "-assign");
    const client = await makeUser("CLIENT", "-assign");

    const intake = await request(app)
      .post("/api/cases/intake")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ pfaId, pmbId, bioData, pfaForm: {}, pmbForm: {} });
    expect(intake.status).toBe(201);
    caseIds.push(intake.body.case.id);

    const assign = await request(app)
      .post(`/api/cases/${intake.body.case.id}/assign`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ officerId: officer.user.id });
    expect(assign.status).toBe(200);

    const dbCase = await prisma.case.findUnique({ where: { id: intake.body.case.id } });
    expect(dbCase?.assignedById).toBe(admin.user.id);
    expect(dbCase?.assignedOfficerId).toBe(officer.user.id);

    const auditEntries = await prisma.auditLog.findMany({
      where: { entityType: "Case", entityId: intake.body.case.id, action: "CASE_ASSIGNED" },
    });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].userId).toBe(admin.user.id);
  });
});
