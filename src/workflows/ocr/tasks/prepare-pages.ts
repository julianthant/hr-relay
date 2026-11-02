import { defineTask } from "../../../workflow-kit/task.js";
import { PrepareOcrPages } from "../../../models/workflows/ocr/prepare-pages.js";
import { buildOcrSourceManifest, ocrPageInputs } from "../../../models/workflows/ocr/source-manifest.js";
import { bindCanonicalManualOcrReading } from "../../../models/workflows/ocr/page-accounting.js";

export const prepareOcrPagesTask = defineTask(PrepareOcrPages, {
  sessions: [],
  async run({ input: { request, rendered }, ctx }) {
    let output;
    try {
      const manifest = buildOcrSourceManifest(request.document, rendered);
      const pages = ocrPageInputs(manifest, request.readingId, request.formType);
      const reading = request.reading;
      if (reading.kind === "manual" && (reading.assertions.length !== pages.length
        || new Set(reading.assertions.map(assertion => assertion.sourcePage)).size !== pages.length)) {
        throw new Error("Manual OCR requires one assertion for every original page.");
      }
      output = { manifest, pages: pages.map(page => {
        if (reading.kind === "subscription") return { page, reading };
        const assertion = reading.assertions.find(assertion => assertion.sourcePage === page.sourcePage);
        if (assertion === undefined) throw new Error("Manual OCR assertion is missing an original page.");
        bindCanonicalManualOcrReading(page, reading.actorId, assertion.extraction);
        return { page, reading: { kind: "manual" as const, actorId: reading.actorId, extraction: assertion.extraction } };
      }) };
    } catch (error) {
      return ctx.fail("INCONSISTENT_INPUTS", "OCR source pages or manual assertions do not match the document.", { cause: error });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
