import { PDFDocument } from "@cantoo/pdf-lib";
import { OnbaseImportError, OnbaseTargetSchema } from "../../../../models/systems/onbase/import-document.js";
import { OnbaseReadSourcePage } from "../../../../models/systems/onbase/read-source-page.js";
import { createHash } from "node:crypto";
import { defineTask } from "../../../../workflow-kit/task.js";
import { onbaseDriver } from "../driver-declaration.js";

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export async function extractOnbasePage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > source.getPageCount() || source.getForm().getFields().length !== 0)
    throw new OnbaseImportError("source-page-invalid");
  const document = await PDFDocument.create({ updateMetadata: false });
  const [page] = await document.copyPages(source, [pageNumber - 1]);
  if (page === undefined) throw new OnbaseImportError("source-page-missing");
  document.addPage(page);
  return document.save({ useObjectStreams: false });
}

export const readSourcePageTask = defineTask(onbaseDriver, OnbaseReadSourcePage, {
  sessions: [{ system: "onbase", access: "read", session: "reuse-worker", exclusive: true }],
  async run({ input, ctx }) {
    try {
      const stream = await ctx.artifacts.open(input.document), chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) throw new OnbaseImportError("source-chunk-not-bytes");
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > input.document.bytes) throw new OnbaseImportError("source-size-mismatch");
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      if (size !== input.document.bytes || digest(bytes) !== input.document.sha256) throw new OnbaseImportError("source-digest-mismatch");
      const page = await extractOnbasePage(bytes, input.sourcePage);
      const target = OnbaseTargetSchema.parse({ ...input, pageSha256: digest(page) });
      ctx.driver.bindSourcePage(target, page);
      ctx.recordData(Object.entries(target).map(([field, value]) => ({ direction: "read" as const, field, value })));
      return target;
    } catch (cause) { return ctx.fail("ONBASE_IMPORT_UNPROVED", "The selected source PDF page could not be verified.", { cause }); }
  },
});
