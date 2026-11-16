import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { OcrReviewRecordSchema } from "../../ocr/review-record.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ApprovedOcrRecordInputSchema } from "../../workflows/ocr/approved-record.js";
import { policy,record } from "./approved-snapshot.js";
export const ReadApprovedOcrRecord = defineTaskContract({ ...policy, id: taskId("ocr/read-approved-record"),
  title: "Verify approved OCR member", input: ApprovedOcrRecordInputSchema,
  output: z.strictObject({ record: OcrReviewRecordSchema }), example: { record } });
