# PenPath

Internal workflow platform for PEMWO Property Ltd. See [CLAUDE.md](./CLAUDE.md) for the full spec.

## Stack

- `apps/api` — Express + TypeScript + Prisma (PostgreSQL), JWT auth, RBAC middleware
- `apps/web` — React + Vite + TypeScript + Tailwind (PEMWO brand tokens)
- `packages/shared` — roles, case status, permissions shared between API and web

## Getting started

Requires Node 20+, pnpm, and a running PostgreSQL instance.

```bash
pnpm install

# apps/api/.env and apps/web/.env are already created from .env.example —
# edit apps/api/.env with your real DATABASE_URL

pnpm --filter @penpath/api prisma:migrate   # creates tables
pnpm seed                                    # creates the Super Admin (see apps/api/.env for credentials)

pnpm dev:api    # http://localhost:4000
pnpm dev:web    # http://localhost:5173
```

## Testing

```bash
pnpm test
```

## Deployment

**Frontend (`apps/web`) → Vercel.** Import the repo, set the project's Root Directory to
`apps/web`. Vercel auto-detects Vite; no custom build command needed — the root `postinstall`
script builds `packages/shared` before anything else runs. Set one env var:

- `VITE_API_URL` = your deployed API's URL (e.g. `https://penpath-api.onrender.com`)

**Backend (`apps/api`) → Render.** A `render.yaml` blueprint is included at the repo root — use
"New > Blueprint" and point it at this repo, or configure a Node web service manually with:

- Build command: `pnpm install && pnpm --filter @penpath/shared build && pnpm --filter @penpath/api build && pnpm --filter @penpath/api exec prisma migrate deploy`
- Start command: `node apps/api/dist/server.js`

Required env vars (see `apps/api/.env.example` for the full list): `DATABASE_URL`, `DIRECT_URL`,
`JWT_SECRET`, `CORS_ORIGIN` (your Vercel URL), `FRONTEND_URL` (same, used in password-reset
emails).

**Important — use the direct connection, not the pooler, for `DATABASE_URL` in production.**
Render runs a normal persistent server, not serverless functions, so it doesn't need pgbouncer's
connection pooling — and Prisma's interactive transactions (used by the workflow engine and
password reset) can intermittently fail against Supabase's transaction-mode pooler (port 6543).
Set `DATABASE_URL` to the same direct connection string as `DIRECT_URL` (port 5432) in Render's
env vars, even though local dev uses the pooled one.

After the first deploy, seed the Super Admin once via Render's Shell tab:
`pnpm --filter @penpath/api seed`

## Status

All 12 build phases (0–11) from CLAUDE.md Section 5 are complete:

- **Phase 0–1** — monorepo scaffold, Prisma schema, JWT auth + RBAC, Super Admin panel (users, permissions, audit log)
- **Phase 2** — PFA/PMB institution CRUD, dynamic form template builder, fee structure defaults
- **Phase 3** — client digital intake + Ops scan intake, editable-before-approval form versioning
- **Phase 4** — Supervisor case assignment with `maxCaseLoad` enforcement, Ops Officer "My Cases"
- **Phase 5** — full `CaseStatus` workflow engine, PDF packet generation, transfer form flow, notification hooks
- **Phase 6** — fee engine: auto-calculated `feeTotal`, audited manual override
- **Phase 7** — complaint intake, Open → In Progress → Resolved flow
- **Phase 8** — Management dashboards (revenue, activity) with CSV/PDF export
- **Phase 9** — polished per-form-set PDF generation, version-history UI with diffs
- **Phase 10** — real email (Resend/SMTP) and SMS (Termii) providers, stub fallback when unconfigured
- **Phase 11** — DB-level one-active-case constraint, full RBAC coverage matrix

135 automated tests pass, covering every numbered business rule in CLAUDE.md Section 6 plus a
role × endpoint access matrix, a full case lifecycle walk from intake to closure, and a
self-service password reset flow.
