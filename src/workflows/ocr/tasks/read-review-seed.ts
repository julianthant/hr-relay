import { defineTask } from "../../../workflow-kit/task.js";
import { ReadOcrReviewSeed } from "../../../models/workflows/ocr/read-review-seed.js";
import { accountOcrPages } from "../../../models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed, compactOcrReviewSeed } from "../../../models/workflows/ocr/review-seed.js";

export const readOcrReviewSeedTask = defineTask(ReadOcrReviewSeed, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try {
      output = compactOcrReviewSeed(buildOcrReviewSeed({ ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }), roster: input.roster,
        accounting: accountOcrPages(input.manifest, input.readingId, input.outcomes, input.formType) }));
    } catch (error) {
      return ctx.fail("INCONSISTENT_INPUTS", "OCR child outcomes do not account for the original document.", { cause: error });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
