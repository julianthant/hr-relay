import { z } from "zod";
import { NodeIdSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { OcrApprovedSnapshotSchema } from "../../ocr/review.js";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { OcrWorkflowResultSchema } from "../../workflows/ocr/result.js";
import { OcrReviewCheckpointSchema } from "../../workflows/ocr/review-seed.js";

export const ReadApprovedOcrRecords = defineTaskContract({
  id: taskId("ocr/read-approved-records"), title: "Read approved OCR selections", effect: "read",
  input: z.strictObject({ delegationNodeId: NodeIdSchema, outcomes: z.array(childRunOutcomeSchema(OcrWorkflowResultSchema)).min(1) }),
  output: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("ready"), sources: z.array(z.strictObject({ snapshot: OcrApprovedSnapshotSchema, review: OcrReviewCheckpointSchema })).min(1) }),
    z.strictObject({ state: z.literal("refused"), code: z.literal("OCR_REVIEW_REFUSED") }),
  ]),
  errorCodes: ["OCR_REVIEW_REFUSED"], providers: ["ocr.review"],
  subject: { kind: "none", reason: "Reads only authenticated approved selections from this run's retained OCR children" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["ocr/approved-records"],
  example: { state: "refused", code: "OCR_REVIEW_REFUSED" },
});
