import express from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { auditLogRouter } from "./routes/auditLog.js";
import { institutionsRouter } from "./routes/institutions.js";
import { settingsRouter } from "./routes/settings.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/audit-logs", auditLogRouter);
  app.use("/api/institutions", institutionsRouter);
  app.use("/api/settings", settingsRouter);

  return app;
}
