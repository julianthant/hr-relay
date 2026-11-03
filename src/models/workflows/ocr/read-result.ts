import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { OcrReviewSeedSchema } from "./review-seed.js";
import { ReadOcrReviewSeed } from "./read-review-seed.js";
import { OcrLookupOutcomeSchema, OcrResultSchema } from "./result.js";

export const ReadOcrResult = defineTaskContract({
  id: taskId("workflow:ocr/read-result"), title: "Retain identity outcomes", effect: "read",
  input: z.strictObject({ review: OcrReviewSeedSchema, outcomes: z.array(OcrLookupOutcomeSchema) }), output: OcrResultSchema,
  errorCodes: ["INCONSISTENT_INPUTS", "OCR_REVIEW_REFUSED"], subject: { kind: "none", reason: "retains child observations without granting approval" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: { review: ReadOcrReviewSeed.example, identities: [] },
});
