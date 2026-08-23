# PenPath (by PEMWO Connect) — Claude Code Build Instructions

> **How to use this file:** Save this as `CLAUDE.md` in the root of a new project folder,
> then open Claude Code in that folder and say: *"Read CLAUDE.md and start with Phase 0."*
> Claude Code will use this as its persistent context/spec throughout the build.

---

## 0. Project Summary

Build **PenPath**, an internal enterprise workflow application for **PEMWO Property Ltd.**,
a pension-equity & real estate facilitation company in Nigeria. PenPath manages the full
lifecycle of a pensioner accessing 25% of their RSA (Retirement Savings Account) balance to
fund a mortgage equity contribution, from intake through PFA/Mortgage Bank approval to fund
disbursement and case closure.

This is a **multi-role internal SaaS platform** (not a public consumer app) — client-facing
only for the pensioner's own case dashboard.

---

## 1. Tech Stack (recommended — adjust if the team has a preference)

- **Frontend:** React + TypeScript, Vite, TailwindCSS (design tokens below), React Router
- **Backend:** Node.js + TypeScript, Express or Fastify, REST API (or tRPC if preferred)
- **Database:** PostgreSQL (relational integrity matters here — cases, roles, audit trails)
- **ORM:** Prisma
- **Auth:** JWT-based session auth, role-based access control (RBAC) middleware
- **File storage:** S3-compatible storage (or local disk for dev) for scanned forms and
  generated PDFs
- **PDF generation:** `pdf-lib` or `puppeteer` (server-side HTML→PDF)
- **Notifications:** Email via SMTP/Resend/SendGrid; SMS via Termii or similar Nigerian SMS
  gateway (stub/mock for MVP if no account yet)
- **Testing:** Vitest/Jest for backend, React Testing Library for frontend

Claude Code should scaffold this as a **monorepo** (`/apps/web`, `/apps/api`, `/packages/shared`)
using pnpm workspaces or npm workspaces — keep it simple, don't over-engineer tooling.

---

## 2. Design System / Brand Tokens

White-dominant base with PEMWO's green/orange brand identity for accents. Define these as
Tailwind theme extensions / CSS variables:

```
--color-bg-base:        #FFFFFF
--color-bg-secondary:   #F7F8F7
--color-brand-primary:  #1B5E3A   /* deep forest green — nav, primary buttons, headers */
--color-brand-dark:     #124529   /* hover/pressed states */
--color-accent:         #C1592B   /* burnt orange — CTAs, highlights */
--color-accent-light:   #E08B5C   /* secondary accents, chart highlights */
--color-text-primary:   #1F2421
--color-text-muted:     #6B7570
--color-border:         #E2E5E3
--color-status-success: #3E8E5C   /* Approved / Completed */
--color-status-warning: #D98B3A   /* Query / Pending review */
--color-status-error:   #B3403A   /* Rejected */
```

Logo: green "P" mark with orange roofline accent, "PEMWO PROPERTY LIMITED" wordmark
(RC: 7681099). Use the green as the dominant brand color in nav/header, orange sparingly as
accent/status color — never as a large background fill.

---

## 3. User Roles (RBAC)

Implement as a `Role` enum with a `Permission` join table so Super Admin can grant/revoke
granular permissions independent of role defaults.

1. **Client / Pensioner** — own case only
2. **Customer Care** — complaint intake, case visibility (read), no case editing
3. **Operation Officer (Ops)** — full edit rights on assigned cases only
4. **Operation Supervisor** — assigns/reassigns cases to Ops Officers, sets per-officer case
   caps (default 6, configurable), views team workload
5. **Accounting** — Transfer Form queue, fee tracking/editing, sends to Mortgage Bank
6. **Management** — cross-case visibility, revenue dashboard, user activity monitoring, final
   payout authorization
7. **Admin** — manages PFA/PMB institutions and form templates, fee structure defaults
8. **Super Admin** (single account for v1) — full user/role/permission management, cross-system
   audit log, emergency case override. Architecture must allow adding more Super Admin accounts
   later without a schema change.

---

## 4. Core Data Model (Prisma schema — build this first)

```prisma
model User {
  id            String   @id @default(cuid())
  name          String
  email         String   @unique
  phone         String?
  passwordHash  String
  role          Role
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  casesAssigned Case[]   @relation("AssignedOfficer")
  maxCaseLoad   Int?     @default(6) // only relevant for Ops role, Supervisor-editable
}

enum Role {
  CLIENT
  CUSTOMER_CARE
  OPS_OFFICER
  OPS_SUPERVISOR
  ACCOUNTING
  MANAGEMENT
  ADMIN
  SUPER_ADMIN
}

model Institution {
  id       String   @id @default(cuid())
  type     InstitutionType // PFA or PMB
  name     String
  active   Boolean  @default(true)
  formTemplate Json  // dynamic field schema
  createdAt DateTime @default(now())
}

enum InstitutionType {
  PFA
  PMB
}

model Case {
  id                String   @id @default(cuid())
  clientId          String
  client            User     @relation(fields: [clientId], references: [id])
  pfaId             String
  pfa               Institution @relation("PFA", fields: [pfaId], references: [id])
  pmbId             String
  pmb               Institution @relation("PMB", fields: [pmbId], references: [id])
  assignedOfficerId String?
  assignedOfficer   User?    @relation("AssignedOfficer", fields: [assignedOfficerId], references: [id])
  intakeSource      IntakeSource // DIGITAL_LINK or PHYSICAL_SCAN
  status            CaseStatus @default(NEW_APPLICATION)
  pensionBalance    Decimal?
  dealValue         Decimal?     // e.g. 25% accessed amount, or full balance — configurable basis
  feeFlat           Decimal  @default(100000)
  feePercent        Decimal  @default(8)
  feeBasis          FeeBasis @default(ACCESSED_AMOUNT) // ACCESSED_AMOUNT or FULL_BALANCE
  feeTotal          Decimal? // computed, editable
  feeManuallyEdited Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  formSubmissions   FormSubmission[]
  documents         Document[]
  statusHistory     StatusHistory[]
  complaints        Complaint[]
  transferForm      TransferForm?
}

enum IntakeSource {
  DIGITAL_LINK
  PHYSICAL_SCAN
}

enum CaseStatus {
  NEW_APPLICATION
  BIO_DATA_SUBMITTED
  UNDER_OPS_REVIEW
  SUBMITTED_TO_PFA
  PFA_APPROVED
  PFA_QUERY
  PFA_REJECTED
  SUBMITTED_TO_PMB
  PMB_APPROVED
  PMB_QUERY
  PMB_REJECTED
  AWAITING_FUND_RELEASE
  FUNDS_RELEASED_CONFIRMED
  TRANSFER_FORM_SENT
  TRANSFER_FORM_SUBMITTED
  TRANSFER_SENT_TO_ACCOUNTING
  TRANSFER_SENT_TO_PMB
  MORTGAGE_BANK_CONFIRMED
  MANAGEMENT_PAYOUT_PROCESSED
  CASE_CLOSED
}

enum FeeBasis {
  ACCESSED_AMOUNT
  FULL_BALANCE
}

model FormSubmission {
  id        String   @id @default(cuid())
  caseId    String
  case      Case     @relation(fields: [caseId], references: [id])
  formType  String   // e.g. "bio_data", "pfa_form", "pmb_form", "supplementary_1"..n
  data      Json
  version   Int      @default(1)
  editedBy  String?
  editedAt  DateTime?
  createdAt DateTime @default(now())
}

model Document {
  id        String   @id @default(cuid())
  caseId    String
  case      Case     @relation(fields: [caseId], references: [id])
  type      String   // "scanned_original", "generated_pdf", "signed_consent"
  url       String
  version   Int      @default(1)
  createdAt DateTime @default(now())
}

model StatusHistory {
  id        String   @id @default(cuid())
  caseId    String
  case      Case     @relation(fields: [caseId], references: [id])
  fromStatus CaseStatus?
  toStatus   CaseStatus
  changedBy  String
  note       String?
  createdAt  DateTime @default(now())
}

model TransferForm {
  id            String   @id @default(cuid())
  caseId        String   @unique
  case          Case     @relation(fields: [caseId], references: [id])
  bankName      String
  accountNumber String
  amount        Decimal
  mortgageRef   String
  submittedAt   DateTime?
  sentToAccountingAt DateTime?
  sentToPmbAt   DateTime?
}

model Complaint {
  id          String   @id @default(cuid())
  caseId      String
  case        Case     @relation(fields: [caseId], references: [id])
  raisedById  String
  assignedOfficerId String?
  status      ComplaintStatus @default(OPEN)
  description String
  resolutionNote String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum ComplaintStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
}

model AuditLog {
  id        String   @id @default(cuid())
  userId    String
  action    String
  entityType String
  entityId  String
  oldValue  Json?
  newValue  Json?
  createdAt DateTime @default(now())
}
```

---

## 5. Build Phases (build and test in this order — do not skip ahead)

### Phase 0 — Scaffold
- Initialize monorepo, TypeScript config, Prisma + PostgreSQL connection, base Express/Fastify
  server, base React app with Tailwind + design tokens above, auth scaffolding (JWT login,
  RBAC middleware). Seed script with one Super Admin account.

### Phase 1 — Auth & Roles
- Login flow, role-based route protection (frontend + backend).
- Super Admin panel: create/suspend users, assign/reassign roles, grant/revoke permissions,
  full audit log view.

### Phase 2 — Admin Panel: Institutions & Form Templates
- CRUD for PFA and PMB institutions (multiple supported from day one).
- Dynamic form template builder (JSON schema-driven forms) so each institution's form fields
  are configurable without code changes.
- Fee structure defaults (₦100,000 flat + 8%, configurable basis: accessed amount vs. full
  balance).

### Phase 3 — Client Intake (Digital + Physical)
- Client-facing form: select PFA, select PMB, fill bio-data + dynamic PFA/PMB form fields.
- Ops-facing "Scan Intake" flow: upload scanned physical form as a Document, then key in field
  values against the same dynamic form schema (OCR is explicitly OUT of scope for v1 — build
  the manual re-keying flow, but structure the code so an OCR pre-fill step can be added later
  without changing the form schema).
- Both paths write to the same `Case` + `FormSubmission` models — confirm intake source is
  tagged but never branches downstream logic.
- Build the **editable-before-approval** flow: assigned Ops Officer can edit any
  `FormSubmission` field pre-`SUBMITTED_TO_PFA`; every edit creates a new `FormSubmission`
  version and an `AuditLog` entry (old value → new value).

### Phase 4 — Case Assignment (Supervisor)
- Operation Supervisor view: unassigned case queue, manual assignment to a specific Ops
  Officer, respecting/enforcing `maxCaseLoad` (default 6, Supervisor can adjust per officer).
- Ops Officer view: "my cases" queue.

### Phase 5 — Case Workflow Engine
- Implement the full `CaseStatus` state machine per the model above. Each transition:
  - writes a `StatusHistory` row (who, when, from→to, optional note)
  - triggers a notification (email/SMS stub OK for MVP) to relevant parties
- Build status-specific actions:
  - Ops: mark `Ready for PFA Submission` → generate PDF packet (Document) → `SUBMITTED_TO_PFA`
  - Ops: record PFA outcome (`PFA_APPROVED` / `PFA_QUERY` / `PFA_REJECTED`) → if approved,
    `SUBMITTED_TO_PMB`
  - Ops: record PMB outcome similarly → if approved, `AWAITING_FUND_RELEASE`
  - Client: "Confirm Funds Received" action → `FUNDS_RELEASED_CONFIRMED` → notifies assigned
    Ops Officer
  - Ops: trigger Transfer Form → client fills → `TransferForm` created,
    `TRANSFER_FORM_SUBMITTED`
  - Accounting: reviews Transfer Form, sends to PMB → `TRANSFER_SENT_TO_PMB`
  - Management: records PMB confirmation → processes payout →
    `MANAGEMENT_PAYOUT_PROCESSED` → `CASE_CLOSED`, visible to Accounting + Ops simultaneously

### Phase 6 — Fee Engine
- Auto-calculate `feeTotal` per case on `dealValue` change, using `feeFlat` + `feePercent` ×
  `feeBasis`-selected amount.
- Allow manual override by Accounting/Management (`feeManuallyEdited = true`), logged in
  `AuditLog`.

### Phase 7 — Customer Care & Complaints
- Complaint intake tied to `caseId`, visible to all internal roles, flagged to the case's
  `assignedOfficerId`. Status flow: Open → In Progress → Resolved.

### Phase 8 — Management Dashboard
- **Revenue Dashboard:** total/per-case revenue, filterable by date range, Ops Officer, PFA,
  PMB; pipeline value vs. realized revenue; monthly trend chart.
- **User Activity Monitoring:** cases opened/closed per Ops Officer, average time-in-stage,
  login activity, complaints resolved per Customer Care agent.
- CSV/PDF export for reporting.

### Phase 9 — Document Engine Polish
- PDF generation for every form set (styled with brand tokens).
- Version history UI — show diffs between form submission versions.

### Phase 10 — Notifications
- Wire up real email/SMS provider (or leave clearly marked stub/mock functions if credentials
  aren't available yet) for every major status transition.

### Phase 11 — QA Pass
- Enforce the **one active application per pensioner** rule at the database/API level.
- RBAC test coverage: verify each role can only access what it should.
- End-to-end test of the full case lifecycle from intake → close.

---

## 6. Non-Negotiable Business Rules (validate these explicitly in code, with tests)

1. A pensioner may have only **one active case** at a time (one-time-access rule).
2. Funds are conceptually disbursed **to the mortgage lender**, never directly to the client —
   the workflow must reflect this (client only *confirms* release, never receives funds
   directly in the flow).
3. Fee = `₦100,000 flat + (feePercent% × dealValue per feeBasis)`, always editable with audit
   log, never silently recalculated over a manual edit.
4. Every case must show a single, clear status to the client (map internal `CaseStatus` enum
   to plain-language labels in the client dashboard).
5. Intake source (digital vs. scanned) must never change downstream validation or workflow
   logic — same schema, same pipeline.
6. Only the assigned Ops Officer (or a Supervisor/Admin/Super Admin override) can edit a case's
   forms.
7. Super Admin is the only role that can view **all** users' activity, including Management's.

---

## 7. What NOT to build in v1 (explicitly out of scope)

- No live API integration with any PFA or Mortgage Bank system.
- No OCR/automated field extraction from scanned forms (manual re-keying only).
- No multi-Super-Admin conflict resolution — single Super Admin account is sufficient.
- No automatic/round-robin case assignment — Supervisor assigns manually.

---

## 8. Instructions to Claude Code

1. Read this file fully before writing any code.
2. Confirm the tech stack choice with the user before scaffolding if they haven't already
   approved it (or proceed with the defaults above if told to just start).
3. Work phase by phase, in order. After each phase, run and report test results before moving
   to the next phase.
4. Use the exact Prisma schema in Section 4 as the starting point — extend, don't restructure,
   unless a genuine bug is found.
5. Apply the design tokens in Section 2 consistently — do not introduce ad hoc colors.
6. Every business rule in Section 6 must have at least one automated test.
7. Ask before deviating from anything specified here — this document is the source of truth
   for the build.
