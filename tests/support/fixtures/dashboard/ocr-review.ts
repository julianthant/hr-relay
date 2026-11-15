import { ReviewPageSchema } from "../../../../src/models/dashboard/run-detail.js";
import { OcrReviewRevisionSchema, initialOcrReviewRecords } from "../../../../src/models/ocr/review.js";
import { accountOcrPages } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed } from "../../../../src/models/workflows/ocr/review-seed.js";
import { sourceFixture, donePage, READING_ID, SOURCE_RUN_ID, READ_AT } from "../ocr/source-pages.js";
import type { OcrFormType } from "../../../../src/models/ocr/form-registry.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";

export function ocrReviewPageFixture(runId: string = SOURCE_RUN_ID, revision = 1, formType: OcrFormType = "emergency-contact") {
  const source = sourceFixture(2, formType);
  const seed = { review: buildOcrReviewSeed({ sourceRunId: RunIdSchema.parse(runId), roster: null,
    accounting: accountOcrPages(source.manifest, READING_ID, source.inputs.map((input, index) => donePage(input, index === 0 ? "Example, Avery" : "Example, Robin")), formType) }), identities: [] };
  const review = OcrReviewRevisionSchema.parse({ id: `${runId}#${revision}`, sourceRunId: runId, revision, seed,
    records: initialOcrReviewRecords(seed), actorId: "local-operator", createdAt: READ_AT,
    origin: revision === 1 ? { kind: "checkpoint", key: "fixture-read-result", digest: "a".repeat(64),
      checkpoint: { workflowId: "ocr", itemId: READING_ID, nodeId: "read-result", attempt: 1, claimGeneration: 1, runId, outputDigest: "a".repeat(64), writtenAt: READ_AT } }
      : { kind: "command", commandId: "00000000-0000-4000-8000-000000000108" } });
  return ReviewPageSchema.parse({ runId, ocr: { revision: review, digest: "a".repeat(64), approvedSnapshots: [], editing: { state: "unavailable", reason: "run-busy" } },
    records: review.records.map((record, index) => ({ runId, recordId: `00000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
      recordRevision: revision, label: index === 0 ? "Example, Avery" : "Example, Robin", state: "pending", evidence: [`artifact:${source.manifest.pages[index].image.id}`] })) });
}
