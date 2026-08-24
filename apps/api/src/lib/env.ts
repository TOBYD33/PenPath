import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "8h",
  PORT: Number(process.env.PORT ?? 4000),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  // Notifications (Phase 10) — all optional. Any unset provider falls back
  // to a clearly-marked console stub, per CLAUDE.md Section 8 instructions.
  EMAIL_PROVIDER: (process.env.EMAIL_PROVIDER ?? "none") as "resend" | "smtp" | "none",
  EMAIL_FROM: process.env.EMAIL_FROM ?? "PenPath <noreply@pemwoproperty.com>",
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: Number(process.env.SMTP_PORT ?? 587),
  SMTP_SECURE: process.env.SMTP_SECURE === "true",
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,

  SMS_PROVIDER: (process.env.SMS_PROVIDER ?? "none") as "termii" | "none",
  TERMII_API_KEY: process.env.TERMII_API_KEY,
  TERMII_SENDER_ID: process.env.TERMII_SENDER_ID ?? "PenPath",
};
