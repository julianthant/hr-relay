import { z } from "zod";
import { OcrApprovedSnapshotSchema } from "../../ocr/review.js";
import { OcrReviewRecordSchema } from "../../ocr/review-record.js";
import { OcrApprovalReferenceSchema } from "../../workflows/ocr/result.js";
import { ApprovedOcrRecordInputSchema } from "../../workflows/ocr/approved-record.js";
import { StableRecordIdSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

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
const record = OcrReviewRecordSchema.parse({ recordId: `${"b".repeat(64)}#emergency-contact#1`, discarded: false, assertedEid: "10000001",
  fields: { answers: [{ state: "read", path: "contact.name", raw: "Example Contact", value: "Example Contact", confidence: 1 }],
    blockingPaths: [], answersFingerprint: "a".repeat(64) } });
const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: "00000000-0000-4000-8000-000000000001",
  sourceRunId: "00000000-0000-4000-8000-000000000002", revision: 1, reviewDigest: "a".repeat(64),
  selectedRecordIds: [record.recordId], records: [record], approvedBy: "local-operator", approvedAt: "2026-11-01T12:00:00.000Z" });
const policy = {
  effect: "read", errorCodes: ["OCR_REVIEW_REFUSED", "OCR_APPROVAL_UNAVAILABLE"], providers: ["ocr.approved-snapshot"],
  subject: { kind: "none", reason: "Authenticates immutable OCR approval through the current person's admitted parent and member lineage" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" }, scenarios: ["ocr/approved-snapshot"],
} as const;
export const ReadApprovedOcrSnapshot = defineTaskContract({ ...policy, id: taskId("ocr/read-approved-snapshot"),
  title: "Read approved OCR snapshot", input: OcrApprovalReferenceSchema,
  output: z.strictObject({ snapshot: OcrApprovedSnapshotSchema }), example: { snapshot } });
export const ReadApprovedOcrRecord = defineTaskContract({ ...policy, id: taskId("ocr/read-approved-record"),
  title: "Verify approved OCR member", operation: { version: 1, id: "authenticate-approved-record", system: "local", session: { kind: "local", id: "ocr-authority" },
    actions: [{ id: "verify-approved-record", kind: "verify", label: "Verify the current released record and native member binding" }] }, input: ApprovedOcrRecordInputSchema,
  output: z.strictObject({ record: OcrReviewRecordSchema }), example: { record } });
