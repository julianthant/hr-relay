import { OcrReviewRecordSchema, OcrOperatorPagesSchema } from "./review-record.js";
import { z } from "zod";
import { admitOcrExtraction, answersFingerprint, SubmittedAnswerSchema, type AdmittedRecord } from "./extraction.js";
import { fieldOnPageKind, ocrForm } from "./form-registry.js";
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

export function ocrRecordName(fields: AdmittedRecord): string | null {
  const name = fields.answers.find(answer => ["employee.name", "printedName"].includes(answer.path));
  if (name?.state === "read") return String(name.value);
  const first = fields.answers.find(answer => answer.path === "firstName"), last = fields.answers.find(answer => answer.path === "lastName");
  return first?.state === "read" && last?.state === "read" ? `${last.value}, ${first.value}` : null;
}
export function initialOcrReviewRecords(seed: z.output<typeof OcrResultSchema>): z.output<typeof OcrReviewRecordSchema>[] {
  return seed.review.records.map(record => {
    const identities = seed.identities.filter(identity => identity.recordIds.includes(record.recordId));
    const outcome = identities.length === 1 ? identities[0]?.outcome : undefined;
    const status = outcome?.state === "done" && "activeStatus" in outcome.output ? outcome.output.activeStatus : undefined;
    const documentName = record.subjectName === null ? null : personMatchKey(record.subjectName);
    const observedName = status?.details.name == null ? null : personMatchKey(status.details.name);
    const observed = status?.ucpathSelection === "resolved" && status.details.ucpath === "Found"
      && status.details.foundInUcpath !== false && documentName !== null && documentName === observedName
      ? EidSchema.parse(status.details.eid) : null;
    const fieldEid = record.fields.answers.find(answer => ["employee.employeeId", "employeeId"].includes(answer.path));
    const conflicting = observed !== null && fieldEid?.state === "read" && fieldEid.value !== observed;
    return { recordId: record.recordId, fields: record.fields, assertedEid: conflicting ? null : observed, discarded: false };
  });
}

export function operatorOcrRecordId(seed: z.output<typeof OcrResultSchema>, commandId: string) {
  return StableRecordIdSchema.parse(`${seed.review.accounting.manifest.document.sha256}#operator-added-${seed.review.formType}-${CommandIdSchema.parse(commandId)}#1`);
}

export function operatorOcrFields(seed: z.output<typeof OcrResultSchema>, pages: z.output<typeof OcrOperatorPagesSchema>,
  values: Readonly<Record<string, z.input<typeof SubmittedAnswerSchema>>>, readAt: string): AdmittedRecord {
  const form = ocrForm(seed.review.formType);
  if (pages.length !== form.pageKinds.length || form.pageKinds.some((kind, index) => pages[index]?.pageKind !== kind)
    || pages.some(binding => !seed.review.accounting.manifest.pages.some(page => page.sourcePage === binding.sourcePage))
    || Object.keys(values).length !== form.fields.length || form.fields.some(field => values[field.path] === undefined)) {
    throw new Error("ocr-operator-record-source-invalid");
  }
  const readings = pages.map(binding => {
    const admitted = admitOcrExtraction({ formType: form.formType, ...binding,
      source: { kind: "operator", actorId: "local-operator" }, readAt,
      sourceSha256: seed.review.accounting.manifest.document.sha256,
      record: { answers: Object.fromEntries(form.fields.map(field => [field.path, fieldOnPageKind(field, binding.pageKind)
        ? values[field.path] : { state: "absent", reason: "not-on-form" }])) } });
    if (!admitted.admitted || admitted.extraction.record === null) throw new Error("ocr-operator-record-fields-invalid");
    return { ...binding, record: admitted.extraction.record };
  });
  const answers = form.fields.map(field => {
    const reading = readings.find(reading => fieldOnPageKind(field, reading.pageKind));
    const answer = reading?.record.answers.find(answer => answer.path === field.path);
    if (answer === undefined) throw new Error("ocr-operator-record-field-missing");
    return answer;
  }).sort((left, right) => left.path.localeCompare(right.path));
  return { answers, blockingPaths: [...new Set(readings.flatMap(reading => reading.record.blockingPaths))].sort(),
    answersFingerprint: answersFingerprint(answers) };
}

export function blankOperatorOcrFields(seed: z.output<typeof OcrResultSchema>, pages: z.output<typeof OcrOperatorPagesSchema>, readAt: string) {
  return operatorOcrFields(seed, pages, Object.fromEntries(ocrForm(seed.review.formType).fields.map(field => [field.path,
    field.localKind === "boolean" ? { state: "read", raw: "false", confidence: 1 } : { state: "absent", reason: "blank" }])), readAt);
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
    || record.records.length < record.seed.review.records.length
    || new Set(record.records.map(entry => entry.recordId)).size !== record.records.length
    || record.seed.review.records.some((entry, index) => entry.recordId !== record.records[index]?.recordId || record.records[index]?.provenance !== undefined)
    || record.records.slice(record.seed.review.records.length).some(entry => entry.provenance === undefined
      || entry.recordId !== operatorOcrRecordId(record.seed, entry.provenance.commandId))
    || record.revision === 1 && record.origin.kind !== "checkpoint") {
    context.addIssue({ code: "custom", message: "OCR revision must retain its exact run, seed and record membership" });
  }
  for (const entry of record.records) {
    const fieldEid = entry.fields.answers.find(answer => ["employee.employeeId", "employeeId"].includes(answer.path));
    if (entry.assertedEid !== null && fieldEid?.state === "read" && fieldEid.value !== entry.assertedEid) {
      context.addIssue({ code: "custom", message: "The asserted identity must agree with the corrected employee ID" });
    }
    if (entry.provenance !== undefined) {
      try {
        const admitted = operatorOcrFields(record.seed, entry.provenance.pages,
          Object.fromEntries(entry.fields.answers.map(answer => [answer.path, answer.state === "absent" ? { state: "absent", reason: answer.reason }
            : { state: "read", raw: answer.raw, confidence: answer.confidence }])), entry.provenance.createdAt);
        if (canonicalJsonStringify(admitted) !== canonicalJsonStringify(entry.fields)) throw new Error("ocr-operator-record-fields-invalid");
      } catch {
        context.addIssue({ code: "custom", message: "Operator-added OCR records require canonical fields and exact source bindings" });
      }
      continue;
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
export const OcrReviewChangeSchema = z.strictObject({ sourcePage: PositiveIntSchema, revision: PositiveIntSchema });

function recordEvidence(seed: OcrReviewRevision["seed"], recordId: OcrReviewRevision["records"][number]["recordId"]) {
  const record = seed.review.records.find(record => record.recordId === recordId);
  if (record === undefined) return null;
  const { issues: _issues, ...facts } = record;
  return { formType: seed.review.formType, record: facts,
    identities: seed.identities.filter(identity => identity.recordIds.includes(recordId)).map(({ recordIds: _recordIds, ...identity }) => identity) };
}

export function rebuildOcrReviewRecords(seed: OcrReviewRevision["seed"], previous?: Pick<OcrReviewRevision, "seed" | "records" | "revision">) {
  const initial = initialOcrReviewRecords(seed);
  const unchanged = new Set<string>();
  const previousInitial = previous === undefined ? [] : initialOcrReviewRecords(previous.seed);
  const manual = previous?.records.filter(record => record.provenance !== undefined) ?? [];
  if (manual.some(record => record.provenance?.pages.some(binding => {
    const original = previous?.seed.review.accounting.manifest.pages.find(page => page.sourcePage === binding.sourcePage);
    const current = seed.review.accounting.manifest.pages.find(page => page.sourcePage === binding.sourcePage);
    return original === undefined || current === undefined || canonicalJsonStringify(original) !== canonicalJsonStringify(current);
  }))) throw new Error("ocr-operator-record-source-changed");
  return { records: [...initial.map(record => {
    const prior = previous?.records.find(prior => prior.recordId === record.recordId);
    if (previous === undefined || prior === undefined || canonicalJsonStringify(recordEvidence(previous.seed, record.recordId))
      !== canonicalJsonStringify(recordEvidence(seed, record.recordId))) return record;
    unchanged.add(record.recordId);
    return prior;
  }), ...manual],
    invalidatedCorrections: previous?.records.flatMap(record => {
      if (record.provenance !== undefined) return [];
      if (unchanged.has(record.recordId) || canonicalJsonStringify(record) === canonicalJsonStringify(previousInitial.find(prior => prior.recordId === record.recordId))) return [];
      const source = previous.seed.review.records.find(source => source.recordId === record.recordId);
      if (source === undefined) throw new Error("ocr-review-record-source-missing");
      return [{ recordId: record.recordId, sourcePage: source.sourcePage, revision: previous.revision + 1 }];
    }) ?? [] };
}

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
