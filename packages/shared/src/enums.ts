export const ROLES = [
  "CLIENT",
  "CUSTOMER_CARE",
  "OPS_OFFICER",
  "OPS_SUPERVISOR",
  "ACCOUNTING",
  "MANAGEMENT",
  "ADMIN",
  "SUPER_ADMIN",
] as const;
export type Role = (typeof ROLES)[number];

export const INTERNAL_ROLES: Role[] = ROLES.filter((r) => r !== "CLIENT");

export const INSTITUTION_TYPES = ["PFA", "PMB"] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

export const INTAKE_SOURCES = ["DIGITAL_LINK", "PHYSICAL_SCAN"] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export const FEE_BASES = ["ACCESSED_AMOUNT", "FULL_BALANCE"] as const;
export type FeeBasis = (typeof FEE_BASES)[number];

export const COMPLAINT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const CASE_STATUSES = [
  "NEW_APPLICATION",
  "BIO_DATA_SUBMITTED",
  "UNDER_OPS_REVIEW",
  "SUBMITTED_TO_PFA",
  "PFA_APPROVED",
  "PFA_QUERY",
  "PFA_REJECTED",
  "SUBMITTED_TO_PMB",
  "PMB_APPROVED",
  "PMB_QUERY",
  "PMB_REJECTED",
  "AWAITING_FUND_RELEASE",
  "FUNDS_RELEASED_CONFIRMED",
  "TRANSFER_FORM_SENT",
  "TRANSFER_FORM_SUBMITTED",
  "TRANSFER_SENT_TO_ACCOUNTING",
  "TRANSFER_SENT_TO_PMB",
  "MORTGAGE_BANK_CONFIRMED",
  "MANAGEMENT_PAYOUT_PROCESSED",
  "CASE_CLOSED",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Business rule 4: every case must show a single, clear status to the client. */
export const CLIENT_STATUS_LABELS: Record<CaseStatus, string> = {
  NEW_APPLICATION: "Application received",
  BIO_DATA_SUBMITTED: "Application received",
  UNDER_OPS_REVIEW: "Being reviewed by our team",
  SUBMITTED_TO_PFA: "Submitted to your Pension Fund Administrator",
  PFA_APPROVED: "Approved by your Pension Fund Administrator",
  PFA_QUERY: "Your Pension Fund Administrator has a query — action needed",
  PFA_REJECTED: "Your Pension Fund Administrator declined this application",
  SUBMITTED_TO_PMB: "Submitted to your Mortgage Bank",
  PMB_APPROVED: "Approved by your Mortgage Bank",
  PMB_QUERY: "Your Mortgage Bank has a query — action needed",
  PMB_REJECTED: "Your Mortgage Bank declined this application",
  AWAITING_FUND_RELEASE: "Awaiting fund release to your Mortgage Bank",
  FUNDS_RELEASED_CONFIRMED: "Funds released — confirmed",
  TRANSFER_FORM_SENT: "Please complete your transfer form",
  TRANSFER_FORM_SUBMITTED: "Transfer form submitted",
  TRANSFER_SENT_TO_ACCOUNTING: "Transfer form being processed",
  TRANSFER_SENT_TO_PMB: "Transfer sent to your Mortgage Bank",
  MORTGAGE_BANK_CONFIRMED: "Confirmed by your Mortgage Bank",
  MANAGEMENT_PAYOUT_PROCESSED: "Payout processed",
  CASE_CLOSED: "Case closed",
};

export const TERMINAL_CASE_STATUSES: CaseStatus[] = ["CASE_CLOSED", "PFA_REJECTED", "PMB_REJECTED"];
