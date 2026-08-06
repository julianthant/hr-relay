/**
 * `ocr/extract-form-page` — the provider route's implementation.
 *
 * Three lines describe the whole design and each is deliberate:
 *
 *   1. build the SAME instruction the CLI hands an operator or a terminal agent;
 *   2. send it to the admitted provider client;
 *   3. run the answer through the SAME `admitOcrExtraction` gate.
 *
 * Nothing here interprets, repairs or supplements what the model returned. A
 * model that answered a different field set than the form declares fails
 * admission and becomes `incomplete-extraction`, carrying the gate's own
 * problem list — because a pipeline that quietly patched up a partial answer
 * would be reading a different form than the operator is.
 *
 * The `source` this task stamps is `provider`, and the gate does not read it.
 * That is the point: the only difference between this route and a person typing
 * JSON is provenance.
 */
import { z } from "zod";
import { defineTask } from "../../../base/task.js";
import { ExtractFormPage } from "../../../domain/contracts/ocr/extract-form-page.js";
import { admitOcrExtraction } from "../../../domain/ocr/extraction.js";
import { buildExtractionInstruction } from "../../../domain/ocr/instruction.js";
import { deriveSchemaHash } from "../../../domain/schema-bound-value.js";
import { JsonValueSchema } from "../../../domain/canonical-json.js";

/** What the adapter is asked for. Its identity travels with the payload. */
const ExtractionRequestSchema = z.strictObject({
  formType: z.string().min(1),
  instruction: z.string().min(1),
  pageArtifactId: z.string().min(1),
  pageSha256: z.string().min(1),
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
        pageArtifactId: input.page.id,
        pageSha256: input.page.sha256,
        sourcePage: input.sourcePage,
      },
    });

    if (response.state === "unavailable") {
      // The reason is STRUCTURED — a closed code plus its message, and a
      // `retryAt` when the budget says when. Flattening it to text would throw
      // away the one part an operator can act on.
      const { code, message, retryAt } = response.reason;
      return ctx.fail(
        "provider-unavailable",
        `the ocr.extract provider is unavailable (${code}): ${message}`
          + (retryAt === undefined ? "" : ` — retry at ${retryAt}`),
      );
    }
    if (response.state === "invalid-response") {
      // The adapter could not even parse what the model returned. That is a
      // page-level failure, not a field-level one, so it is not a submission
      // the gate could report problems about.
      return ctx.fail("unreadable-page", `the ocr.extract provider returned an unusable response: ${response.reason}`);
    }

    const admission = admitOcrExtraction(JsonValueSchema.parse(response.value.value));
    if (!admission.admitted) {
      // The model answered, but not the form. Carrying the gate's exact problem
      // list means the operator sees the same correction text a terminal agent
      // would have seen — one vocabulary for every route.
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
      { direction: "read", field: "answersFingerprint", value: extraction.answersFingerprint },
      { direction: "read", field: "blockingPaths", value: [...extraction.blockingPaths] },
    ]);
    return extraction;
  },
});
