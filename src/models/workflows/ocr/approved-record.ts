import { z } from "zod";
import { OcrReviewRecordSchema } from "../../ocr/review-record.js";
import { OcrApprovalReferenceSchema } from "./result.js";

export function requireReadyApprovedRecord({ record }: { record: z.output<typeof OcrReviewRecordSchema> }, context: z.RefinementCtx) {
  if (record.discarded || record.assertedEid === null || record.fields.blockingPaths.length !== 0) {
    context.addIssue({ code: "custom", message: "An approved member requires a ready selected record" });
  }
}
export const ApprovedOcrRecordInputSchema = z.strictObject({
  approval: OcrApprovalReferenceSchema,
  record: OcrReviewRecordSchema,
}).superRefine(requireReadyApprovedRecord);
