import { z } from "zod";
import { AdmittedRecordSchema, admitOcrExtraction } from "./extraction.js";
import { OcrResultSchema } from "../workflows/ocr/result.js";
import { CommandIdSchema, EidSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, RunIdSchema, StableRecordIdSchema } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { TimelineCheckpointReferenceSchema } from "../events/timeline.js";
import { ArtifactRefSchema } from "../artifacts/artifacts.js";
import { personMatchKey } from "./stack.js";

export const OcrSourceUploadSchema = z.strictObject({
  artifact: ArtifactRefSchema.extend({ mediaType: z.literal("application/pdf"), bytes: z.number().int().positive().max(25 * 1024 * 1024) }),
  fileName: z.string().min(1).max(255), uploadedAt: IsoInstantSchema, uploadedBy: z.literal("local-operator"),
});

export const OcrReviewRecordSchema = z.strictObject({
  recordId: StableRecordIdSchema,
  fields: AdmittedRecordSchema,
  assertedEid: EidSchema.nullable(),
  discarded: z.boolean(),
});
export function initialOcrReviewRecords(seed: z.output<typeof OcrResultSchema>) {
  return seed.review.records.map(record => {
    const identities = seed.identities.filter(identity => identity.recordIds.includes(record.recordId));
    const outcome = identities.length === 1 ? identities[0]?.outcome : undefined;
    const status = outcome?.state === "done" ? outcome.output.activeStatus : undefined;
    const documentName = record.subjectName === null ? null : personMatchKey(record.subjectName);
    const observedName = status?.details.name == null ? null : personMatchKey(status.details.name);
    const observed = status?.ucpathSelection === "resolved" && status.details.ucpath === "Found"
      && status.details.foundInUcpath === true && documentName !== null && documentName === observedName
      ? EidSchema.parse(status.details.eid) : null;
    const fieldEid = record.fields.answers.find(answer => ["employee.employeeId", "employeeId"].includes(answer.path));
    const conflicting = observed !== null && fieldEid?.state === "read" && fieldEid.value !== observed;
    return { recordId: record.recordId, fields: record.fields, assertedEid: conflicting ? null : observed, discarded: false };
  });
}
export const OcrReviewRevisionSchema = z.strictObject({
  id: z.string().min(1), sourceRunId: RunIdSchema, revision: PositiveIntSchema,
  seed: OcrResultSchema,
  records: z.array(OcrReviewRecordSchema),
  origin: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("checkpoint"), key: z.string().min(1), digest: FingerprintSchema, checkpoint: TimelineCheckpointReferenceSchema }),
    z.strictObject({ kind: z.literal("command"), commandId: CommandIdSchema }),
  ]),
  actorId: z.literal("local-operator"), createdAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.id !== `${record.sourceRunId}#${record.revision}`
    || record.seed.review.sourceRunId !== undefined && record.seed.review.sourceRunId !== record.sourceRunId
    || record.records.length !== record.seed.review.records.length
    || record.records.some((entry, index) => entry.recordId !== record.seed.review.records[index]?.recordId)
    || (record.revision === 1) !== (record.origin.kind === "checkpoint")) {
    context.addIssue({ code: "custom", message: "OCR revision must retain its exact run, seed and record membership" });
  }
  for (const entry of record.records) {
    const fieldEid = entry.fields.answers.find(answer => ["employee.employeeId", "employeeId"].includes(answer.path));
    if (entry.assertedEid !== null && fieldEid?.state === "read" && fieldEid.value !== entry.assertedEid) {
      context.addIssue({ code: "custom", message: "The asserted identity must agree with the corrected employee ID" });
    }
    const source = record.seed.review.records.find(seed => seed.recordId === entry.recordId);
    const outcome = source === undefined ? undefined : record.seed.review.accounting.outcomes.find(outcome =>
      outcome.state === "done" && outcome.output.extractionId === source.extractionId);
    if (outcome?.state !== "done") continue;
    const { record: _fields, pageFingerprint: _fingerprint, ...metadata } = outcome.output.extraction;
    const admitted = admitOcrExtraction({ ...metadata, record: { answers: Object.fromEntries(entry.fields.answers.map(answer => [answer.path,
      answer.state === "absent" ? { state: "absent", reason: answer.reason }
        : { state: "read", raw: answer.raw, confidence: answer.confidence }])) } });
    if (!admitted.admitted || canonicalJsonStringify(admitted.extraction.record) !== canonicalJsonStringify(entry.fields)) {
      context.addIssue({ code: "custom", message: "OCR corrections must retain complete canonical fields for their source form" });
    }
  }
});
export type OcrReviewRevision = z.infer<typeof OcrReviewRevisionSchema>;
export function ocrReviewDigest(revision: OcrReviewRevision): string {
  return sha256Hex(`relay:ocr-review:v1\0${canonicalJsonStringify(OcrReviewRevisionSchema.parse(revision))}`);
}

export const OcrApprovedSnapshotSchema = z.strictObject({
  snapshotId: CommandIdSchema, sourceRunId: RunIdSchema, revision: PositiveIntSchema,
  reviewDigest: FingerprintSchema,
  selectedRecordIds: z.array(StableRecordIdSchema).min(1),
  records: z.array(OcrReviewRecordSchema).min(1),
  approvedBy: z.literal("local-operator"), approvedAt: IsoInstantSchema,
}).superRefine((snapshot, context) => {
  if (snapshot.selectedRecordIds.length !== snapshot.records.length
    || new Set(snapshot.selectedRecordIds).size !== snapshot.selectedRecordIds.length
    || snapshot.records.some((record, index) => record.recordId !== snapshot.selectedRecordIds[index]
      || record.discarded || record.fields.blockingPaths.length > 0 || record.assertedEid === null)) {
    context.addIssue({ code: "custom", message: "An OCR snapshot requires an exact nonempty ready selection with asserted identities" });
  }
});
export type OcrApprovedSnapshot = z.infer<typeof OcrApprovedSnapshotSchema>;
export function ocrSnapshotDigest(snapshot: OcrApprovedSnapshot): string {
  const { approvedAt: _at, approvedBy: _by, ...content } = OcrApprovedSnapshotSchema.parse(snapshot);
  return sha256Hex(`relay:ocr-approved:v1\0${canonicalJsonStringify(content)}`);
}
