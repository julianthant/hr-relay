
import { z } from "zod";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ArtifactRefSchema } from "../../../../models/artifacts/artifacts.js";
import { ExtractFormPage } from "../../../../models/processing/ocr/extract-form-page.js";
import { admitOcrExtraction } from "../../../../models/ocr/extraction.js";
import { OcrFormTypeSchema } from "../../../../models/ocr/form-registry.js";
import { buildExtractionInstruction } from "../../../../models/ocr/instruction.js";
import { deriveSchemaHash } from "../../../../models/validation/schema-bound-value.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";


const ExtractionRequestSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  instruction: z.string().min(1),
  page: ArtifactRefSchema,
  sourcePage: z.number().int().positive(),
});

const REQUEST_SCHEMA_HASH = deriveSchemaHash(ExtractionRequestSchema, "input");

export const extractFormPageTask = defineTask(ExtractFormPage, {
  sessions: [],
  async run({ input, ctx }) {
    const instruction = buildExtractionInstruction(input.formType);
    const response = await ctx.providers["ocr.extract"].call({
      schemaHash: REQUEST_SCHEMA_HASH,
      value: {
        formType: input.formType,
        instruction,
        page: input.page,
        sourcePage: input.sourcePage,
      },
    });

    if (response.state === "unavailable") {
      if (response.reason.code === "adapter-unavailable") {
        return ctx.fail("ocr-provider-not-connected", "OCR provider not connected");
      }

      const { code, message, retryAt } = response.reason;
      return ctx.fail(
        "provider-unavailable",
        `the ocr.extract provider is unavailable (${code}): ${message}`
          + (retryAt === undefined ? "" : ` — retry at ${retryAt}`),
      );
    }
    if (response.state === "invalid-response") {

      return ctx.fail("unreadable-page", `the ocr.extract provider returned an unusable response: ${response.reason}`);
    }

    const admission = admitOcrExtraction(JsonValueSchema.parse(response.value.value));
    if (!admission.admitted) {

      return ctx.fail(
        "incomplete-extraction",
        `the ocr.extract provider did not answer the ${input.formType} form as declared:\n`
          + admission.problems.map((problem) => `  - ${problem}`).join("\n"),
      );
    }

    const { extraction } = admission;
    ctx.recordData([
      { direction: "read", field: "formType", value: extraction.formType },
      { direction: "read", field: "sourcePage", value: extraction.sourcePage },
      { direction: "read", field: "pageKind", value: extraction.pageKind },
      { direction: "read", field: "pageFingerprint", value: extraction.pageFingerprint },
      { direction: "read", field: "hasRecord", value: extraction.record !== null },
    ]);
    return extraction;
  },
});
