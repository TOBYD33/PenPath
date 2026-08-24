import { BIO_DATA_TEMPLATE, CLIENT_STATUS_LABELS, type FormTemplate } from "@penpath/shared";
import { prisma } from "./prisma.js";
import { validateFormData } from "./formValidation.js";
import { writeAuditLog } from "./audit.js";
import { getOrCreateFeeDefault } from "./feeEngine.js";

/**
 * Single source of truth for case creation — every intake path (client
 * digital intake, Ops scan intake, and the public client-link apply flow)
 * goes through this one function. Business rule 5: intakeSource is tagged
 * but never branches validation, approval, or workflow logic, so there
 * must only ever be one code path that creates a Case.
 */

export const caseListInclude = {
  client: { select: { id: true, name: true, email: true } },
  pfa: { select: { id: true, name: true } },
  pmb: { select: { id: true, name: true } },
  assignedOfficer: { select: { id: true, name: true } },
  assignedBy: { select: { id: true, name: true } },
  clientLink: {
    select: {
      id: true,
      clientName: true,
      clientPhone: true,
      clientEmail: true,
      generatedBy: { select: { id: true, name: true } },
    },
  },
} as const;

export const caseDetailInclude = {
  ...caseListInclude,
  formSubmissions: { orderBy: [{ formType: "asc" as const }, { version: "desc" as const }] },
  documents: { orderBy: { createdAt: "desc" as const } },
  statusHistory: { orderBy: { createdAt: "desc" as const } },
};

export function withClientLabel<T extends { status: string }>(kase: T) {
  return { ...kase, clientStatusLabel: CLIENT_STATUS_LABELS[kase.status as keyof typeof CLIENT_STATUS_LABELS] };
}

export async function getFormTemplates(pfaId: string, pmbId: string) {
  const [pfa, pmb] = await Promise.all([
    prisma.institution.findUnique({ where: { id: pfaId } }),
    prisma.institution.findUnique({ where: { id: pmbId } }),
  ]);
  if (!pfa || pfa.type !== "PFA" || !pfa.active) return { error: "Invalid or inactive PFA selected" as const };
  if (!pmb || pmb.type !== "PMB" || !pmb.active) return { error: "Invalid or inactive PMB selected" as const };
  return { pfa, pmb };
}

export function validateIntakeForms(
  bioData: unknown,
  pfaForm: unknown,
  pmbForm: unknown,
  pfaTemplate: FormTemplate,
  pmbTemplate: FormTemplate,
) {
  const errors = {
    bioData: validateFormData(BIO_DATA_TEMPLATE, bioData),
    pfaForm: validateFormData(pfaTemplate, pfaForm),
    pmbForm: validateFormData(pmbTemplate, pmbForm),
  };
  const hasErrors = errors.bioData.length || errors.pfaForm.length || errors.pmbForm.length;
  return hasErrors ? errors : null;
}

export async function assertOneActiveCase(clientId: string): Promise<boolean> {
  const existing = await prisma.case.findFirst({ where: { clientId, active: true } });
  return !existing;
}

/** True if `err` is Postgres rejecting our partial unique index on
 * (clientId) WHERE active — the DB-level backstop for business rule 1,
 * closing the check-then-insert race the app-level assertOneActiveCase
 * check alone can't fully prevent under concurrent requests. Case has no
 * other unique constraint besides its primary key, so any P2002 thrown
 * from creating one is this constraint. */
export function isOneActiveCaseViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

export async function createCaseWithForms(params: {
  clientId: string;
  pfaId: string;
  pmbId: string;
  intakeSource: "DIGITAL_LINK" | "PHYSICAL_SCAN";
  bioData: unknown;
  pfaForm: unknown;
  pmbForm: unknown;
  createdBy: string;
}) {
  const feeDefault = await getOrCreateFeeDefault();

  const kase = await prisma.case.create({
    data: {
      clientId: params.clientId,
      pfaId: params.pfaId,
      pmbId: params.pmbId,
      intakeSource: params.intakeSource,
      feeFlat: feeDefault.feeFlat,
      feePercent: feeDefault.feePercent,
      feeBasis: feeDefault.feeBasis,
      formSubmissions: {
        create: [
          { formType: "bio_data", data: params.bioData as object, version: 1 },
          { formType: "pfa_form", data: params.pfaForm as object, version: 1 },
          { formType: "pmb_form", data: params.pmbForm as object, version: 1 },
        ],
      },
      statusHistory: {
        create: [{ toStatus: "NEW_APPLICATION", changedBy: params.createdBy }],
      },
    },
    include: caseDetailInclude,
  });

  await writeAuditLog({
    userId: params.createdBy,
    action: "CASE_CREATED",
    entityType: "Case",
    entityId: kase.id,
    newValue: { id: kase.id, intakeSource: kase.intakeSource, status: kase.status },
  });

  return kase;
}
