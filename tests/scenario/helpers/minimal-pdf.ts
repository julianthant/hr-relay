/**
 * A hand-built, valid multi-page PDF — the fixture the extraction scenarios
 * rasterize.
 *
 * Built by hand rather than by a library on purpose. A fixture produced by a
 * PDF *writer* would only prove the reader agrees with that writer, and the
 * rebuild has no reason to take on a PDF writer for a read-only path. These are
 * literal PDF objects in the format the specification describes, so what the
 * reader is being asked to handle is a real document and not one library's idea
 * of one.
 *
 * Each page draws one short text run so a rendered page is distinguishable from
 * a blank one — a rasterizer that silently produced empty images would
 * otherwise pass.
 */

/** A valid PDF with `labels.length` pages, each showing its label. */
export function buildMinimalPdf(labels: readonly string[]): Buffer {
  if (labels.length === 0) throw new Error("a PDF fixture needs at least one page");

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  // 1 = catalog, 2 = pages tree, 3 = font; pages and contents follow.
  const firstPageObject = 4;
  for (const [index] of labels.entries()) {
    pageObjectNumbers.push(firstPageObject + index * 2);
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${
    pageObjectNumbers.map((number) => `${String(number)} 0 R`).join(" ")
  }] /Count ${String(labels.length)} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (const [index, label] of labels.entries()) {
    const pageNumber = pageObjectNumbers[index];
    const contentNumber = pageNumber + 1;
    const escaped = label.replace(/([\\()])/g, "\\$1");
    const stream = `BT /F1 24 Tf 72 700 Td (${escaped}) Tj ET`;
    objects[pageNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]`
      + ` /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentNumber)} 0 R >>`;
    objects[contentNumber] = `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`;
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = pdf.length;
    pdf += `${String(number)} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) {
    pdf += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R >>\n`
    + `startxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
