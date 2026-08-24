import { env } from "./env.js";

export interface NotifyParams {
  to: string; // email
  phone?: string | null;
  subject: string;
  body: string;
}

/**
 * Notification dispatch for every major case status transition (Phase 10).
 * Providers are opt-in via env vars — CLAUDE.md Section 8 explicitly calls
 * for "clearly marked stub/mock functions if credentials aren't available
 * yet", so with nothing configured this falls back to a console stub
 * rather than failing. Once EMAIL_PROVIDER/SMS_PROVIDER and the matching
 * credentials are set, real sends go out with zero call-site changes.
 */
export async function notify(params: NotifyParams): Promise<void> {
  await sendEmail(params.to, params.subject, params.body);
  if (params.phone) {
    await sendSms(params.phone, params.body);
  }
}

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (env.EMAIL_PROVIDER === "resend") {
    if (!env.RESEND_API_KEY) {
      console.warn("[notify] EMAIL_PROVIDER=resend but RESEND_API_KEY is not set — falling back to stub");
      return stubEmail(to, subject, body);
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text: body }),
      });
      if (!res.ok) console.error(`[notify] Resend email failed (${res.status}): ${await res.text()}`);
    } catch (err) {
      console.error("[notify] Resend email request failed:", err);
    }
    return;
  }

  if (env.EMAIL_PROVIDER === "smtp") {
    if (!env.SMTP_HOST) {
      console.warn("[notify] EMAIL_PROVIDER=smtp but SMTP_HOST is not set — falling back to stub");
      return stubEmail(to, subject, body);
    }
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });
      await transporter.sendMail({ from: env.EMAIL_FROM, to, subject, text: body });
    } catch (err) {
      console.error("[notify] SMTP email send failed:", err);
    }
    return;
  }

  return stubEmail(to, subject, body);
}

async function sendSms(phone: string, body: string): Promise<void> {
  if (env.SMS_PROVIDER === "termii") {
    if (!env.TERMII_API_KEY) {
      console.warn("[notify] SMS_PROVIDER=termii but TERMII_API_KEY is not set — falling back to stub");
      return stubSms(phone, body);
    }
    try {
      const res = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phone,
          from: env.TERMII_SENDER_ID,
          sms: body,
          type: "plain",
          channel: "generic",
          api_key: env.TERMII_API_KEY,
        }),
      });
      if (!res.ok) console.error(`[notify] Termii SMS failed (${res.status}): ${await res.text()}`);
    } catch (err) {
      console.error("[notify] Termii SMS request failed:", err);
    }
    return;
  }

  return stubSms(phone, body);
}

function stubEmail(to: string, subject: string, body: string): void {
  console.log(`[notify stub:email] to=${to} subject="${subject}" body="${body}"`);
}

function stubSms(phone: string, body: string): void {
  console.log(`[notify stub:sms] to=${phone} body="${body}"`);
}
