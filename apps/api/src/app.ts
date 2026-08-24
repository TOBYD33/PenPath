import express from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { auditLogRouter } from "./routes/auditLog.js";
import { institutionsRouter } from "./routes/institutions.js";
import { settingsRouter } from "./routes/settings.js";
import { casesRouter } from "./routes/cases.js";
import { complaintsRouter } from "./routes/complaints.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { UPLOADS_DIR } from "./lib/upload.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());
  app.use("/uploads", express.static(UPLOADS_DIR));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/audit-logs", auditLogRouter);
  app.use("/api/institutions", institutionsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/cases", casesRouter);
  app.use("/api/complaints", complaintsRouter);
  app.use("/api/dashboard", dashboardRouter);

  return app;
}
