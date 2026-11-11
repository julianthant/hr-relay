import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PDFDocument } from "pdf-lib";
import { createOnbaseDriver } from "../../../../src/backend/systems/onbase/driver/interpreter.js";
import { OnbaseInputSchema } from "../../../../src/models/systems/onbase/import-document.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { fakeOnbasePage, type SavedOnbaseFixture } from "../browser/fake-onbase-page.js";

const pdf = await PDFDocument.create({ updateMetadata: false }); pdf.addPage([100, 200]); pdf.addPage([300, 400]);
export const ONBASE_SOURCE_PDF = await pdf.save();
export const ONBASE_SOURCE_DOCUMENT = OnbaseInputSchema.shape.document.parse({ id: "11111111-2222-4333-8444-555555555555",
  sha256: createHash("sha256").update(ONBASE_SOURCE_PDF).digest("hex"), bytes: ONBASE_SOURCE_PDF.length, mediaType: "application/pdf" });

/** A fake OnBase client whose saved documents carry across sessions; `noMatch` fails the employee lookup before any import; `lostClick` loses the Import acknowledgement. */
export function onbaseChildFixture(options: { noMatch?: boolean; saved?: readonly SavedOnbaseFixture[] } = {}) {
  const control = { noMatch: options.noMatch === true, lostClick: false };
  let saved = [...options.saved ?? []];
  const pages: ReturnType<typeof fakeOnbasePage>[] = [];
  return { control, pages, saved: () => saved,
    imports: () => pages.flatMap(page => page.actions).filter(action => action === "click:Import").length,
    driver(clock: Clock) {
      const page = fakeOnbasePage({ noMatch: control.noMatch, lostClick: control.lostClick, saved });
      saved = page.saved; pages.push(page);
      return createOnbaseDriver(() => undefined, page.page, clock);
    },
    artifacts: { open: async () => Readable.from([ONBASE_SOURCE_PDF]), put: async () => { throw new Error("unexpected artifact write"); } } };
}
