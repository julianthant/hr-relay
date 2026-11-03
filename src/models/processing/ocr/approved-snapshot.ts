import { z } from "zod";
import { StableRecordIdSchema } from "../../../rules/identity/ids.js";
import { OcrReviewRecordSchema } from "../../ocr/review-record.js";
import { OcrApprovedSnapshotSchema } from "../../ocr/review.js";
import { OcrApprovalReferenceSchema } from "../../workflows/ocr/result.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../workflows/person-lookup/input.js";
export const OcrApprovalReadRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("snapshot"), approval: OcrApprovalReferenceSchema }),
  z.strictObject({ kind: z.literal("record"), approval: OcrApprovalReferenceSchema, recordId: StableRecordIdSchema }),
]);
export const OcrApprovalReadResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("snapshot"), snapshot: OcrApprovedSnapshotSchema }),
  z.strictObject({ state: z.literal("record"), record: OcrReviewRecordSchema }),
  z.strictObject({ state: z.literal("refused"), code: z.literal("OCR_REVIEW_REFUSED") }),
  z.strictObject({ state: z.literal("unavailable"), code: z.literal("OCR_APPROVAL_UNAVAILABLE") }),
]);
export const record = OcrReviewRecordSchema.parse({ recordId: `${"b".repeat(64)}#emergency-contact#1`, discarded: false, assertedEid: PERSON_LOOKUP_EXAMPLE_EID,
  fields: { answers: [{ state: "read", path: "contact.name", raw: "Example Contact", value: "Example Contact", confidence: 1 }],
    blockingPaths: [], answersFingerprint: "a".repeat(64) } });
export const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: "00000000-0000-4000-8000-000000000001",
  sourceRunId: "00000000-0000-4000-8000-000000000002", revision: 1, reviewDigest: "a".repeat(64),
  selectedRecordIds: [record.recordId], records: [record], approvedBy: "local-operator", approvedAt: "2026-11-01T12:00:00.000Z" });
export const policy = {
  effect: "read", errorCodes: ["OCR_REVIEW_REFUSED", "OCR_APPROVAL_UNAVAILABLE"], providers: ["ocr.approved-snapshot"],
  subject: { kind: "none", reason: "Authenticates immutable OCR approval through the current person's admitted parent and member lineage" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" }, scenarios: ["ocr/approved-snapshot"],
} as const;
