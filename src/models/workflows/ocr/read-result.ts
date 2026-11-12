import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { OcrReviewSeedSchema } from "./review-seed.js";
import { ReadOcrReviewSeed } from "./read-review-seed.js";
import { OcrLookupOutcomeSchema, OcrResultCheckpointSchema } from "./result.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

export const ReadOcrResult = defineTaskContract({
  id: taskId("workflow:ocr/read-result"), title: "Retain identity outcomes", effect: "read",
  input: z.strictObject({ review: OcrReviewSeedSchema, outcomes: z.array(OcrLookupOutcomeSchema) }), output: OcrResultCheckpointSchema,
  errorCodes: ["INCONSISTENT_INPUTS", "OCR_REVIEW_REFUSED"], subject: { kind: "none", reason: "retains child observations without granting approval" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: { review: { digest: sha256Hex(canonicalJsonStringify(ReadOcrReviewSeed.example)) }, identities: [] },
});
