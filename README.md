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

128 automated tests pass, covering every numbered business rule in CLAUDE.md Section 6 plus a
role × endpoint access matrix and a full case lifecycle walk from intake to closure.
