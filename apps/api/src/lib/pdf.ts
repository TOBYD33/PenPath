import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { UPLOADS_DIR } from "./upload.js";

const BRAND_GREEN = rgb(0x1b / 255, 0x5e / 255, 0x3a / 255);
const TEXT_PRIMARY = rgb(0x1f / 255, 0x24 / 255, 0x21 / 255);
const TEXT_MUTED = rgb(0x6b / 255, 0x75 / 255, 0x70 / 255);
const BORDER = rgb(0xe2 / 255, 0xe5 / 255, 0xe3 / 255);

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4

interface FormSection {
  title: string;
  data: Record<string, unknown>;
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Shared page chrome: masthead + section renderer + footer (page numbers,
 * generated-on timestamp), styled with the brand tokens from CLAUDE.md
 * Section 2. */
async function renderFormDocument(params: {
  title: string;
  subtitleLines: string[];
  sections: FormSection[];
}): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage(PAGE_SIZE);
  const margin = 50;
  let y = page.getHeight() - margin;

  function ensureSpace(lines: number) {
    if (y - lines * 16 < margin + 20) {
      page = doc.addPage(PAGE_SIZE);
      y = page.getHeight() - margin;
    }
  }

  page.drawText("PEMWO PROPERTY LIMITED", { x: margin, y, size: 10, font, color: TEXT_MUTED });
  y -= 20;
  page.drawText(params.title, { x: margin, y, size: 18, font: boldFont, color: BRAND_GREEN });
  y -= 22;
  for (const line of params.subtitleLines) {
    page.drawText(line, { x: margin, y, size: 10, font, color: TEXT_MUTED });
    y -= 14;
  }
  y -= 14;

  for (const section of params.sections) {
    ensureSpace(3);
    page.drawText(section.title, { x: margin, y, size: 13, font: boldFont, color: BRAND_GREEN });
    y -= 6;
    page.drawLine({
      start: { x: margin, y },
      end: { x: page.getWidth() - margin, y },
      thickness: 0.75,
      color: BORDER,
    });
    y -= 16;

    const entries = Object.entries(section.data);
    if (entries.length === 0) {
      ensureSpace(1);
      page.drawText("(no fields)", { x: margin, y, size: 10, font, color: TEXT_MUTED });
      y -= 16;
    }
    for (const [key, value] of entries) {
      ensureSpace(1);
      page.drawText(humanizeKey(key), { x: margin, y, size: 9, font, color: TEXT_MUTED });
      page.drawText(formatValue(value), { x: margin + 180, y, size: 10, font, color: TEXT_PRIMARY });
      y -= 16;
    }
    y -= 12;
  }

  const pages = doc.getPages();
  const generatedOn = new Date().toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
  pages.forEach((p, i) => {
    p.drawText(`Generated ${generatedOn}`, { x: margin, y: 24, size: 8, font, color: TEXT_MUTED });
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: p.getWidth() - margin - 60, y: 24, size: 8, font, color: TEXT_MUTED });
  });

  return doc;
}

/**
 * Renders the combined case packet PDF (bio-data + PFA + PMB submissions)
 * for the PFA submission step, and persists it as an upload since it's an
 * official record of what was submitted (Document row references this URL).
 */
export async function generateCasePacketPdf(params: {
  caseId: string;
  clientName: string;
  pfaName: string;
  pmbName: string;
  sections: FormSection[];
}): Promise<string> {
  const doc = await renderFormDocument({
    title: "Mortgage Equity Application Packet",
    subtitleLines: [`Case: ${params.caseId}`, `Client: ${params.clientName}`, `PFA: ${params.pfaName}  ·  PMB: ${params.pmbName}`],
    sections: params.sections,
  });

  const bytes = await doc.save();
  const filename = `${Date.now()}-${params.caseId}-packet.pdf`;
  await fs.writeFile(path.join(UPLOADS_DIR, filename), bytes);
  return `/uploads/${filename}`;
}

/**
 * Renders a single form set (e.g. just the bio-data, or just the PFA form)
 * as a standalone PDF, generated on demand — not persisted, since it's
 * derivable from the FormSubmission data at any time (Phase 9).
 */
export async function generateFormSetPdf(params: {
  caseId: string;
  clientName: string;
  formLabel: string;
  version: number;
  data: Record<string, unknown>;
}): Promise<Uint8Array> {
  const doc = await renderFormDocument({
    title: params.formLabel,
    subtitleLines: [`Case: ${params.caseId}`, `Client: ${params.clientName}`, `Version ${params.version}`],
    sections: [{ title: params.formLabel, data: params.data }],
  });
  return doc.save();
}
