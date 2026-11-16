import { z } from "zod";
import { OcrReviewRecordSchema } from "../../ocr/review-record.js";
import { OcrApprovalReferenceSchema } from "./result.js";

export const ApprovedOcrRecordInputSchema = z.strictObject({
  approval: OcrApprovalReferenceSchema,
  record: OcrReviewRecordSchema,
}).superRefine(({ record }, context) => {
  if (record.discarded || record.assertedEid === null || record.fields.blockingPaths.length !== 0) {
    context.addIssue({ code: "custom", message: "An approved member requires a ready selected record" });
  }
});
