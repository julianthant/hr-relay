import { defineTask } from "../../../workflow-kit/task.js";
import { ReadOcrResult } from "../../../models/workflows/ocr/read-result.js";
import { bindOcrLookupOutcomes } from "../../../models/workflows/ocr/lookup.js";

export const readOcrResultTask = defineTask(ReadOcrResult, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try {
      output = { review: input.review, identities: bindOcrLookupOutcomes(input.review, input.outcomes) };
    } catch (error) {
      return ctx.fail("INCONSISTENT_INPUTS", "OCR lookup outcomes do not match the reviewed records.", { cause: error });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
