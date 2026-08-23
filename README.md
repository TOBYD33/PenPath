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

Phase 0 (scaffold) complete: monorepo, Prisma schema, JWT auth + RBAC middleware, login flow,
Super Admin seed script. See CLAUDE.md Section 5 for the remaining build phases.
