import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const BRAND_GREEN = rgb(0x1b / 255, 0x5e / 255, 0x3a / 255);
const TEXT_PRIMARY = rgb(0x1f / 255, 0x24 / 255, 0x21 / 255);
const TEXT_MUTED = rgb(0x6b / 255, 0x75 / 255, 0x70 / 255);

/** Simple tabular report PDF, styled with the brand tokens — used for the
 * Management dashboard exports. */
export async function generateReportPdf(params: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: unknown[][];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([841.89, 595.28]); // A4 landscape, better for wide tables
  const margin = 40;
  const rowHeight = 16;
  let y = page.getHeight() - margin;

  const colWidth = (page.getWidth() - margin * 2) / params.columns.length;

  function ensureSpace() {
    if (y - rowHeight < margin) {
      page = doc.addPage([841.89, 595.28]);
      y = page.getHeight() - margin;
      drawHeaderRow();
    }
  }

  function drawHeaderRow() {
    params.columns.forEach((col, i) => {
      page.drawText(col, { x: margin + i * colWidth, y, size: 9, font: boldFont, color: BRAND_GREEN });
    });
    y -= rowHeight;
  }

  page.drawText("PEMWO PROPERTY LIMITED", { x: margin, y, size: 10, font, color: TEXT_MUTED });
  y -= 18;
  page.drawText(params.title, { x: margin, y, size: 16, font: boldFont, color: BRAND_GREEN });
  y -= 20;
  if (params.subtitle) {
    page.drawText(params.subtitle, { x: margin, y, size: 9, font, color: TEXT_MUTED });
    y -= 20;
  } else {
    y -= 4;
  }

  drawHeaderRow();

  for (const row of params.rows) {
    ensureSpace();
    row.forEach((cell, i) => {
      const text = cell === null || cell === undefined ? "" : String(cell);
      page.drawText(text.slice(0, 40), { x: margin + i * colWidth, y, size: 8, font, color: TEXT_PRIMARY });
    });
    y -= rowHeight;
  }

  return doc.save();
}
