import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PDFDocument } from "@cantoo/pdf-lib";
import { createOnbaseDriver } from "../../../../src/backend/systems/onbase/driver/interpreter.js";
import { ONBASE_EXAMPLE_INPUT, OnbaseInputSchema } from "../../../../src/models/systems/onbase/import-document.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { fakeOnbasePage } from "../browser/fake-onbase-page.js";

/** A real multi-page PDF and fake OnBase pages for Emergency Contact members that file a page to OnBase. */
export async function onbaseFilingFixture(pageCount = 2) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (let page = 0; page < pageCount; page++) pdf.addPage([100 + page, 200]);
  const bytes = await pdf.save();
  const document = OnbaseInputSchema.shape.document.parse({ ...ONBASE_EXAMPLE_INPUT.document,
    sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  const pages: ReturnType<typeof fakeOnbasePage>[] = [];
  return { bytes, document, pages,
    imports: () => pages.flatMap(page => page.actions).filter(action => action === "click:Import").length,
    saved: () => pages.flatMap(page => page.saved),
    session: (clock: () => Clock) => () => {
      const page = fakeOnbasePage();
      pages.push(page);
      return createOnbaseDriver(() => undefined, page.page, clock());
    },
    artifacts: { open: async () => Readable.from([Buffer.from(bytes)]), put: async (): Promise<never> => { throw new Error("unexpected artifact write"); } } };
}
