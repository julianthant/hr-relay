import type { ReviewPage } from "../../../../models/dashboard/run-detail.js";
import { CANONICAL_FIELDS } from "../../../../models/fields/registry.js";
import { ocrForm } from "../../../../models/ocr/form-registry.js";
import { initialOcrReviewRecords, ocrRecordName } from "../../../../models/ocr/review.js";
import { admitOcrExtraction } from "../../../../models/ocr/extraction.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { OcrReviewCommandRequestSchema } from "../../../../rules/commands/commands.js";
import type { ReviewField, ReviewRecordView, ReviewSourcePage } from "./review-record-model.js";

export function ocrReviewCards(page: ReviewPage, sourcePageUrl: (runId: string, revision: number, page: number) => string,
  drafts: Readonly<Record<string, Readonly<Record<string, string>>>> = {}, includes: Readonly<Record<string, boolean>> = {}) {
  const review = page.ocr;
  if (review === undefined) throw new Error("RUN_REVIEW_OCR_UNAVAILABLE");
  const { revision } = review;
  const form = ocrForm(revision.seed.review.formType);
  const initial = initialOcrReviewRecords(revision.seed);
  return revision.records.map(record => {
    const source = revision.seed.review.records.find(source => source.recordId === record.recordId);
    if (source === undefined) throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
    const fields: ReviewField[] = form.fields.map(spec => {
      const answer = record.fields.answers.find(answer => answer.path === spec.path);
      if (answer === undefined) throw new Error("RUN_REVIEW_FIELD_UNAVAILABLE");
      const canonical = spec.canonicalFieldId === null ? undefined : CANONICAL_FIELDS[spec.canonicalFieldId];
      const localLabel = spec.path.split(".").at(-1)!.replace(/([a-z])([A-Z])/gu, "$1 $2");
      const label = canonical?.label ?? localLabel[0].toUpperCase() + localLabel.slice(1);
      const section = spec.path.startsWith("contact.") ? "Emergency contact" : "Employee";
      const kind = spec.localKind === "boolean" ? "boolean" : spec.canonicalFieldId === "relationship" ? "relationship"
        : spec.canonicalFieldId !== null && ["dob", "hireDate", "signatureDate"].includes(spec.canonicalFieldId) ? "date" : undefined;
      const eid = spec.canonicalFieldId === "eid";
      return { key: spec.path, label, section, kind, readOnly: answer.state === "absent" && answer.reason === "not-on-form",
        value: drafts[record.recordId]?.[spec.path] ?? (eid && record.assertedEid !== null ? record.assertedEid
          : answer.state === "read" ? String(answer.value) : answer.state === "unreadable" ? answer.raw : answer.reason === "not-on-form" ? "Not on form" : "") };
    });
    if (!form.fields.some(spec => spec.canonicalFieldId === "eid")) fields.unshift({ key: "assertedEid", label: CANONICAL_FIELDS.eid.label,
      section: "Employee", value: drafts[record.recordId]?.assertedEid ?? record.assertedEid ?? "" });
    const approved = review.approvedSnapshots.some(snapshot => snapshot.revision === revision.revision && snapshot.selectedRecordIds.includes(record.recordId));
    const model: ReviewRecordView = { id: record.recordId, page: source.sourcePage,
      kind: form.formType,
      selected: includes[record.recordId] ?? !record.discarded, fields,
      warnings: record.fields.answers.flatMap(answer => record.fields.blockingPaths.includes(answer.path)
        ? [`${fields.find(field => field.key === answer.path)?.label ?? answer.path} needs review`]
        : answer.state === "absent" && answer.reason === "illegible" ? [`${fields.find(field => field.key === answer.path)?.label ?? answer.path} is illegible`] : []) };
    const original = initial.find(record => record.recordId === model.id);
    if (original === undefined) throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
    const eidPath = form.fields.find(spec => spec.canonicalFieldId === "eid")?.path ?? "assertedEid";
    const originalView: ReviewRecordView = { ...model, fields: fields.map(field => {
      if (field.key === eidPath && original.assertedEid !== null) return { ...field, value: original.assertedEid };
      if (field.key === "assertedEid") return { ...field, value: "" };
      const answer = source.fields.answers.find(answer => answer.path === field.key);
      if (answer === undefined) throw new Error("RUN_REVIEW_FIELD_UNAVAILABLE");
      return { ...field, value: answer.state === "read" ? String(answer.value) : answer.state === "unreadable" ? answer.raw : answer.reason === "not-on-form" ? "Not on form" : "" };
    }) };
    const image = revision.seed.review.accounting.manifest.pages.find(page => page.sourcePage === source.sourcePage)?.image;
    if (image === undefined) throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
    const pages: readonly ReviewSourcePage[] = [{ page: source.sourcePage, identity: image.id, imageUrl: sourcePageUrl(page.runId, revision.revision, source.sourcePage) }];
    return { record: model, original: originalView, pages, name: ocrRecordName(record.fields) ?? `Page ${source.sourcePage}`,
      disposition: { label: record.discarded ? "Not approved" : approved ? "Approved" : "Pending", tone: approved ? "success" as const : "neutral" as const } };
  });
}

export function correctedOcrRecord(page: ReviewPage, recordId: string, values: Readonly<Record<string, string>>) {
  const revision = page.ocr?.revision;
  const record = revision?.records.find(record => record.recordId === recordId);
  const source = revision?.seed.review.records.find(record => record.recordId === recordId);
  const outcome = revision?.seed.review.accounting.outcomes.find(outcome => outcome.state === "done" && outcome.output.extractionId === source?.extractionId);
  if (revision === undefined || record === undefined || outcome?.state !== "done") throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
  const form = ocrForm(revision.seed.review.formType);
  if (Object.keys(values).some(path => path !== "assertedEid" && !form.fields.some(field => field.path === path))) throw new Error("RUN_REVIEW_FIELD_UNAVAILABLE");
  const eidPath = form.fields.find(spec => spec.canonicalFieldId === "eid")?.path ?? "assertedEid";
  const asserted = values[eidPath] === undefined ? undefined : EidSchema.safeParse(values[eidPath]);
  const assertedEid = asserted === undefined ? record.assertedEid : asserted.success ? asserted.data : null;
  if (eidPath === "assertedEid" && values.assertedEid !== undefined && values.assertedEid !== "" && assertedEid === null) throw new Error("RUN_REVIEW_EMPLOYEE_ID_INVALID");
  const { record: _record, pageFingerprint: _fingerprint, ...metadata } = outcome.output.extraction;
  const admitted = admitOcrExtraction({ ...metadata, record: { answers: Object.fromEntries(record.fields.answers.map(answer => {
    const value = values[answer.path];
    if (value !== undefined && answer.state === "absent" && answer.reason === "not-on-form") throw new Error("RUN_REVIEW_FIELD_READ_ONLY");
    return [answer.path, value === undefined ? answer.state === "absent" ? { state: "absent", reason: answer.reason }
      : { state: "read", raw: answer.raw, confidence: answer.confidence }
      : value.trim() === "" ? { state: "absent", reason: "blank" } : { state: "read", raw: value, confidence: 1 }];
  })) } });
  if (!admitted.admitted || admitted.extraction.record === null) throw new Error("RUN_REVIEW_CORRECTION_INVALID");
  return OcrReviewCommandRequestSchema.options[0].shape.payload.parse({ recordId, fields: admitted.extraction.record, assertedEid });
}
