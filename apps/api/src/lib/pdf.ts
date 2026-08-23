import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { UPLOADS_DIR } from "./upload.js";

const BRAND_GREEN = rgb(0x1b / 255, 0x5e / 255, 0x3a / 255);
const TEXT_PRIMARY = rgb(0x1f / 255, 0x24 / 255, 0x21 / 255);
const TEXT_MUTED = rgb(0x6b / 255, 0x75 / 255, 0x70 / 255);

interface FormSection {
  title: string;
  data: Record<string, unknown>;
}

/**
 * Renders a simple case packet PDF (bio-data + PFA + PMB submissions) for
 * the PFA submission step. Styled with the brand tokens from CLAUDE.md
 * Section 2. Phase 9 polishes this further (per-form-set styling, version
 * diff UI) — this is the functional baseline Phase 5 needs.
 */
export async function generateCasePacketPdf(params: {
  caseId: string;
  clientName: string;
  pfaName: string;
  pmbName: string;
  sections: FormSection[];
}): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([595.28, 841.89]); // A4
  const margin = 50;
  let y = page.getHeight() - margin;

  function ensureSpace(lines: number) {
    if (y - lines * 16 < margin) {
      page = doc.addPage([595.28, 841.89]);
      y = page.getHeight() - margin;
    }
  }

  page.drawText("PEMWO PROPERTY LIMITED", { x: margin, y, size: 10, font, color: TEXT_MUTED });
  y -= 20;
  page.drawText("Mortgage Equity Application Packet", { x: margin, y, size: 18, font: boldFont, color: BRAND_GREEN });
  y -= 24;
  page.drawText(`Case: ${params.caseId}`, { x: margin, y, size: 10, font, color: TEXT_MUTED });
  y -= 14;
  page.drawText(`Client: ${params.clientName}`, { x: margin, y, size: 10, font, color: TEXT_MUTED });
  y -= 14;
  page.drawText(`PFA: ${params.pfaName}  ·  PMB: ${params.pmbName}`, { x: margin, y, size: 10, font, color: TEXT_MUTED });
  y -= 28;

  for (const section of params.sections) {
    ensureSpace(3);
    page.drawText(section.title, { x: margin, y, size: 13, font: boldFont, color: BRAND_GREEN });
    y -= 18;

    const entries = Object.entries(section.data);
    if (entries.length === 0) {
      ensureSpace(1);
      page.drawText("(no fields)", { x: margin, y, size: 10, font, color: TEXT_MUTED });
      y -= 16;
    }
    for (const [key, value] of entries) {
      ensureSpace(1);
      page.drawText(`${key}: ${String(value)}`, { x: margin, y, size: 10, font, color: TEXT_PRIMARY });
      y -= 16;
    }
    y -= 12;
  }

  const bytes = await doc.save();
  const filename = `${Date.now()}-${params.caseId}-packet.pdf`;
  await fs.writeFile(path.join(UPLOADS_DIR, filename), bytes);
  return `/uploads/${filename}`;
}
