import { prisma } from "./prisma.js";

/** Business rule 3: fee = flat + (percent% x dealValue). Rounded to the
 * nearest kobo (2dp) since this is a currency amount. */
export function computeFeeTotal(feeFlat: number, feePercent: number, dealValue: number): number {
  const total = feeFlat + (feePercent / 100) * dealValue;
  return Math.round(total * 100) / 100;
}

/** Org-wide fee defaults are a singleton row; create it on first read. */
export async function getOrCreateFeeDefault() {
  const existing = await prisma.feeDefault.findFirst({ orderBy: { updatedAt: "asc" } });
  if (existing) return existing;
  return prisma.feeDefault.create({ data: {} });
}
