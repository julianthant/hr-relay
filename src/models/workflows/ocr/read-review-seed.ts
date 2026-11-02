import { z } from "zod";
import { taskId, ItemIdSchema } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { OcrFormTypeSchema } from "../../ocr/form-registry.js";
import { OcrPageOutcomeSchema, accountOcrPages, ocrExtractionItemId } from "./page-accounting.js";
import { OcrReviewSeedInputSchema, OcrReviewSeedSchema, buildOcrReviewSeed } from "./review-seed.js";
import { OcrSourceManifestSchema, ocrPageInputs } from "./source-manifest.js";
import { ReadOcrSourcePages } from "./read-source-pages.js";
import { OCR_INPUT_EXAMPLE } from "./input.js";

const manifest = OcrSourceManifestSchema.parse(ReadOcrSourcePages.example.manifest);
export const ReadOcrReviewSeed = defineTaskContract({
  id: taskId("workflow:ocr/read-review-seed"), title: "Build source-bound review", effect: "read",
  input: OcrReviewSeedInputSchema.omit({ accounting: true }).extend({ manifest: OcrSourceManifestSchema,
    readingId: ItemIdSchema, formType: OcrFormTypeSchema, outcomes: z.array(OcrPageOutcomeSchema).min(1) }),
  output: OcrReviewSeedSchema, errorCodes: ["INCONSISTENT_INPUTS"],
  subject: { kind: "none", reason: "retains source evidence and identity proposals without confirming a person" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: buildOcrReviewSeed({ sourceRunId: OCR_INPUT_EXAMPLE.sourceRunId, roster: null,
    accounting: accountOcrPages(manifest, OCR_INPUT_EXAMPLE.readingId, [OcrPageOutcomeSchema.parse({ state: "failed",
      runId: "00000000-0000-4000-8000-000000000301", itemId: ocrExtractionItemId(ocrPageInputs(manifest, OCR_INPUT_EXAMPLE.readingId)[0]),
      failureId: "00000000-0000-4000-8000-000000000777" })]) }),
});
