import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";

const notifyMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/notify.js", () => ({ notify: (...args: unknown[]) => notifyMock(...args) }));

const { createApp } = await import("../app.js");
const app = createApp();

const runId = Date.now();
const userIds: string[] = [];

async function makeUser(suffix: string, overrides: { active?: boolean } = {}) {
  const email = `reset-test-${suffix}-${runId}@pemwo.local`;
  const passwordHash = await bcrypt.hash("OriginalPass123!", 10);
  const user = await prisma.user.create({
    data: { name: `Reset Test ${suffix}`, email, passwordHash, role: "CLIENT", active: overrides.active ?? true },
  });
  userIds.push(user.id);
  return user;
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function extractToken(body: string): string {
  const match = body.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error(`No token found in notify body: ${body}`);
  return match[1];
}

afterAll(async () => {
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  notifyMock.mockClear();
});

describe("forgot-password does not leak whether an email exists", () => {
  it("returns the same generic message whether or not the email is registered", async () => {
    const user = await makeUser("exists");

    const known = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: `nobody-${runId}@pemwo.local` });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);

    expect(notifyMock).toHaveBeenCalledTimes(1); // only for the real user
  });

  it("does not send a reset link for an inactive (suspended) account", async () => {
    const suspended = await makeUser("suspended", { active: false });
    const res = await request(app).post("/api/auth/forgot-password").send({ email: suspended.email });
    expect(res.status).toBe(200);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("full reset flow", () => {
  it("lets a user reset their password and immediately invalidates the old one", async () => {
    const user = await makeUser("flow");

    await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    const body = notifyMock.mock.calls[0][0].body as string;
    const token = extractToken(body);

    const reset = await request(app).post("/api/auth/reset-password").send({ token, password: "NewPassword456!" });
    expect(reset.status).toBe(200);

    const loginWithNew = await request(app).post("/api/auth/login").send({ email: user.email, password: "NewPassword456!" });
    expect(loginWithNew.status).toBe(200);

    const loginWithOld = await request(app).post("/api/auth/login").send({ email: user.email, password: "OriginalPass123!" });
    expect(loginWithOld.status).toBe(401);
  });

  it("rejects reusing an already-consumed token", async () => {
    const user = await makeUser("reuse");

    await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    const token = extractToken(notifyMock.mock.calls[0][0].body as string);

    const first = await request(app).post("/api/auth/reset-password").send({ token, password: "FirstPass456!" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/auth/reset-password").send({ token, password: "SecondPass456!" });
    expect(second.status).toBe(400);
  });

  it("rejects a garbage/unknown token", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "not-a-real-token", password: "WhateverPass456!" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const user = await makeUser("expired");
    const rawToken = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post("/api/auth/reset-password").send({ token: rawToken, password: "TooLatePass456!" });
    expect(res.status).toBe(400);
  });

  it("using one outstanding token invalidates any other still-outstanding token for the same user", async () => {
    const user = await makeUser("multi");

    await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    const tokenA = extractToken(notifyMock.mock.calls[0][0].body as string);
    await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    const tokenB = extractToken(notifyMock.mock.calls[1][0].body as string);

    const useA = await request(app).post("/api/auth/reset-password").send({ token: tokenA, password: "UseAPass456!" });
    expect(useA.status).toBe(200);

    const useB = await request(app).post("/api/auth/reset-password").send({ token: tokenB, password: "UseBPass456!" });
    expect(useB.status).toBe(400);
  });
});
