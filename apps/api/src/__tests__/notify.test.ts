import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../lib/env.js";
import { notify } from "../lib/notify.js";

const originalEnv = { ...env };

function resetEnv() {
  Object.assign(env, originalEnv, {
    EMAIL_PROVIDER: "none",
    SMS_PROVIDER: "none",
    RESEND_API_KEY: undefined,
    SMTP_HOST: undefined,
    TERMII_API_KEY: undefined,
  });
}

describe("notify", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetEnv();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetEnv();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back to the console stub when no email provider is configured", async () => {
    await notify({ to: "client@example.com", subject: "Hello", body: "World" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[notify stub:email]"));
  });

  it("does not attempt SMS when no phone is provided", async () => {
    await notify({ to: "client@example.com", subject: "Hello", body: "World" });
    const smsLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes("sms"));
    expect(smsLogs).toHaveLength(0);
  });

  it("stubs SMS by default even when a phone is provided", async () => {
    await notify({ to: "client@example.com", phone: "08012345678", subject: "Hello", body: "World" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[notify stub:sms]"));
  });

  it("calls the Resend API when EMAIL_PROVIDER=resend and an API key is set", async () => {
    env.EMAIL_PROVIDER = "resend";
    env.RESEND_API_KEY = "test-key";

    await notify({ to: "client@example.com", subject: "Hello", body: "World" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ to: "client@example.com", subject: "Hello", text: "World" });
  });

  it("falls back to the stub with a warning if EMAIL_PROVIDER=resend but no API key is set", async () => {
    env.EMAIL_PROVIDER = "resend";
    await notify({ to: "client@example.com", subject: "Hello", body: "World" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY is not set"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[notify stub:email]"));
  });

  it("calls the Termii API when SMS_PROVIDER=termii and an API key is set", async () => {
    env.SMS_PROVIDER = "termii";
    env.TERMII_API_KEY = "termii-key";

    await notify({ to: "client@example.com", phone: "08012345678", subject: "Hello", body: "World" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.ng.termii.com/api/sms/send", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ to: "08012345678", sms: "World", api_key: "termii-key" });
  });

  it("falls back to the stub with a warning if SMS_PROVIDER=termii but no API key is set", async () => {
    env.SMS_PROVIDER = "termii";
    await notify({ to: "client@example.com", phone: "08012345678", subject: "Hello", body: "World" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("TERMII_API_KEY is not set"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[notify stub:sms]"));
  });
});
