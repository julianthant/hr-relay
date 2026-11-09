import { defineTask } from "../../../workflow-kit/task.js";
import { ReadOcrSourcePages, ocrPageWorkInputs } from "../../../models/workflows/ocr/read-source-pages.js";

export const readOcrSourcePagesTask = defineTask(ReadOcrSourcePages, {
  sessions: [],
  async run({ input: { request, rendered }, ctx }) {
    let manifest;
    try {
      ({ manifest } = ocrPageWorkInputs(request, rendered));
    } catch (error) {
      return ctx.fail("INCONSISTENT_INPUTS", "OCR source pages or manual assertions do not match the document.", { cause: error });
    }
    const head = { document: manifest.document, pageCount: manifest.pageCount, fingerprint: manifest.fingerprint };
    ctx.recordData([{ direction: "read", field: "manifest", value: head }]);
    return { manifest: head };
  },
});
