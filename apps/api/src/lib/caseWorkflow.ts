import { TERMINAL_CASE_STATUSES, type CaseStatus } from "@penpath/shared";
import { prisma } from "./prisma.js";

/**
 * Applies one or more sequential status transitions atomically, writing a
 * StatusHistory row for each hop (e.g. SUBMITTED_TO_PFA -> PFA_APPROVED ->
 * SUBMITTED_TO_PMB is two hops from one action). Business rule 1: once the
 * final status is terminal, the case is marked inactive so the client can
 * apply again.
 */
export async function applyStatusTransitions(params: {
  caseId: string;
  fromStatus: CaseStatus;
  steps: CaseStatus[];
  changedBy: string;
  note?: string;
}) {
  return prisma.$transaction(async (tx) => {
    let current = params.fromStatus;
    for (const to of params.steps) {
      await tx.statusHistory.create({
        data: { caseId: params.caseId, fromStatus: current, toStatus: to, changedBy: params.changedBy, note: params.note },
      });
      current = to;
    }
    const finalStatus = params.steps[params.steps.length - 1];
    const active = !TERMINAL_CASE_STATUSES.includes(finalStatus);
    return tx.case.update({ where: { id: params.caseId }, data: { status: finalStatus, active } });
  });
}
