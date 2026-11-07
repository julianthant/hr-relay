
import { defineTask } from "../../../../workflow-kit/task.js";
import { ExtractFormPage, OCR_EXTRACTION_REQUEST_HASH, OCR_EXTRACTION_RESPONSE_HASH } from "../../../../models/processing/ocr/extract-form-page.js";
import { admitOcrExtraction } from "../../../../models/ocr/extraction.js";
import { buildExtractionInstruction } from "../../../../models/ocr/instruction.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";


export const extractFormPageTask = defineTask(ExtractFormPage, {
  sessions: [],
  async run({ input, ctx }) {
    const instruction = buildExtractionInstruction(input.formType);
    const response = await ctx.providers["ocr.extract"].call({
      schemaHash: OCR_EXTRACTION_REQUEST_HASH,
      value: {
        formType: input.formType,
        instruction,
        page: input.page,
        sourcePage: input.sourcePage,
      },
    });

    if (response.state === "unavailable") {
      const { code, message } = response.reason;
      return ctx.fail(
        "provider-unavailable",
        `the ocr.extract provider is unavailable (${code}): ${message}`,
      );
    }
    if (response.state === "invalid-response") {

      return ctx.fail("unreadable-page", "The OCR provider returned an unusable response.");
    }

    if (response.value.schemaHash !== OCR_EXTRACTION_RESPONSE_HASH) return ctx.fail("unreadable-page", "The OCR response contract does not match.");
    const admission = admitOcrExtraction(JsonValueSchema.parse(response.value.value));
    if (!admission.admitted) {

      return ctx.fail(
        "incomplete-extraction",
        "The OCR provider did not answer every declared field.",
      );
    }

    const { extraction } = admission;
    if (extraction.formType !== input.formType || extraction.sourcePage !== input.sourcePage
      || extraction.sourceSha256 !== input.page.sha256 || extraction.source.kind !== "provider" || extraction.source.providerId !== "chatgpt-subscription") {
      return ctx.fail("unreadable-page", "The extracted page does not match the requested source.");
    }
    ctx.recordData([
      { direction: "read", field: "formType", value: extraction.formType },
      { direction: "read", field: "sourcePage", value: extraction.sourcePage },
      { direction: "read", field: "pageKind", value: extraction.pageKind },
      { direction: "read", field: "pageFingerprint", value: extraction.pageFingerprint },
      { direction: "read", field: "record", value: extraction.record },
      { direction: "read", field: "source", value: extraction.source },
      { direction: "read", field: "readAt", value: extraction.readAt },
      { direction: "read", field: "sourceSha256", value: extraction.sourceSha256 },
    ]);
    return extraction;
  },
});
