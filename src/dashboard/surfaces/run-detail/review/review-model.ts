import type { ReviewPage } from "../../../../models/dashboard/run-detail.js";
import { CANONICAL_FIELDS } from "../../../../models/fields/registry.js";
import { ocrForm } from "../../../../models/ocr/form-registry.js";
import { initialOcrReviewRecords, ocrRecordName, operatorOcrFields } from "../../../../models/ocr/review.js";
import { OcrOperatorPagesSchema, ocrRecordSourcePages, type OcrReviewRecord } from "../../../../models/ocr/review-record.js";
import { admitOcrExtraction, type SubmittedAnswer } from "../../../../models/ocr/extraction.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { OcrReviewCommandRequestSchema } from "../../../../rules/commands/commands.js";
import type { ReviewField, ReviewRecordView, ReviewSourcePage } from "./review-record-model.js";

const sourceField = (pageKind: string) => pageKind === "i9-section1" ? "section1" : pageKind === "i9-section2" ? "section2" : "sourcePage";
function operatorPages(record: OcrReviewRecord, values: Readonly<Record<string, string>>) {
  if (record.provenance === undefined) throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
  return OcrOperatorPagesSchema.parse(record.provenance.pages.map(page => ({ ...page,
    sourcePage: values[sourceField(page.pageKind)] === undefined ? page.sourcePage : Number(values[sourceField(page.pageKind)]) })));
}

export function ocrReviewCards(page: ReviewPage, sourcePageUrl: (runId: string, revision: number, page: number) => string,
  drafts: Readonly<Record<string, Readonly<Record<string, string>>>> = {}, includes: Readonly<Record<string, boolean>> = {}) {
  const review = page.ocr;
  if (review === undefined) throw new Error("RUN_REVIEW_OCR_UNAVAILABLE");
  const { revision } = review;
  const form = ocrForm(revision.seed.review.formType);
  const initial = initialOcrReviewRecords(revision.seed);
  return revision.records.map(record => {
    const source = revision.seed.review.records.find(source => source.recordId === record.recordId);
    if (source === undefined && record.provenance === undefined) throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
    const bindings = record.provenance === undefined ? undefined : operatorPages(record, drafts[record.recordId] ?? {});
    const sourcePages = bindings === undefined ? ocrRecordSourcePages(revision.seed.review.records, record) : [...new Set(bindings.map(page => page.sourcePage))];
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
    if (bindings !== undefined && form.formType === "i9") for (const binding of bindings) fields.push({ key: sourceField(binding.pageKind),
      label: binding.pageKind === "i9-section1" ? "Section 1 page" : "Section 2 page", section: "I-9", value: String(binding.sourcePage) });
    const labels = new Map(fields.map(field => [field.key, fields.some(other => other.key !== field.key && other.label === field.label)
      ? `${field.section}: ${field.label}` : field.label]));
    const approved = review.approvedSnapshots.some(snapshot => snapshot.revision === revision.revision && snapshot.selectedRecordIds.includes(record.recordId));
    const model: ReviewRecordView = { id: record.recordId, page: sourcePages[0],
      kind: form.formType,
      ...(record.provenance === undefined ? {} : { manualEntry: true, sourcePageCount: revision.seed.review.accounting.manifest.pages.length }),
      selected: includes[record.recordId] ?? !record.discarded, fields,
      warnings: [...(record.provenance === undefined ? [] : ["Operator-added record"]), ...record.fields.answers.flatMap(answer => record.fields.blockingPaths.includes(answer.path)
        ? [`${labels.get(answer.path) ?? answer.path} needs review`]
        : answer.state === "absent" && answer.reason === "illegible" ? [`${labels.get(answer.path) ?? answer.path} is illegible`] : [])] };
    const original = initial.find(record => record.recordId === model.id);
    if (record.provenance === undefined && original === undefined) throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
    const eidPath = form.fields.find(spec => spec.canonicalFieldId === "eid")?.path ?? "assertedEid";
    const originalView: ReviewRecordView | undefined = source === undefined || original === undefined ? undefined : { ...model, fields: fields.map(field => {
      if (field.key === eidPath && original.assertedEid !== null) return { ...field, value: original.assertedEid };
      if (field.key === "assertedEid") return { ...field, value: "" };
      const answer = source.fields.answers.find(answer => answer.path === field.key);
      if (answer === undefined) throw new Error("RUN_REVIEW_FIELD_UNAVAILABLE");
      return { ...field, value: answer.state === "read" ? String(answer.value) : answer.state === "unreadable" ? answer.raw : answer.reason === "not-on-form" ? "Not on form" : "" };
    }) };
    const manifest = revision.seed.review.accounting.manifest.pages;
    if (sourcePages.some(number => !manifest.some(page => page.sourcePage === number))) throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
    const pages: readonly ReviewSourcePage[] = (record.provenance === undefined ? manifest.filter(page => sourcePages.includes(page.sourcePage)) : manifest)
      .map(source => ({ page: source.sourcePage, identity: source.image.id, imageUrl: sourcePageUrl(page.runId, revision.revision, source.sourcePage) }));
    return { record: model, original: originalView, pages, name: ocrRecordName(record.fields) ?? (record.provenance === undefined ? `Page ${sourcePages[0]}` : "Unnamed record"),
      disposition: { label: record.discarded ? "Not approved" : approved ? "Approved" : "Pending", tone: approved ? "success" as const : "neutral" as const } };
  });
}

export function correctedOcrRecord(page: ReviewPage, recordId: string, values: Readonly<Record<string, string>>) {
  const revision = page.ocr?.revision;
  const record = revision?.records.find(record => record.recordId === recordId);
  const source = revision?.seed.review.records.find(record => record.recordId === recordId);
  const outcome = revision?.seed.review.accounting.outcomes.find(outcome => outcome.state === "done" && outcome.output.extractionId === source?.extractionId);
  if (revision === undefined || record === undefined || record.provenance === undefined && outcome?.state !== "done") throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
  const form = ocrForm(revision.seed.review.formType);
  if (Object.keys(values).some(path => path !== "assertedEid" && !form.fields.some(field => field.path === path)
    && !record.provenance?.pages.some(page => sourceField(page.pageKind) === path))) throw new Error("RUN_REVIEW_FIELD_UNAVAILABLE");
  const eidPath = form.fields.find(spec => spec.canonicalFieldId === "eid")?.path ?? "assertedEid";
  const asserted = values[eidPath] === undefined ? undefined : EidSchema.safeParse(values[eidPath]);
  const assertedEid = asserted === undefined ? record.assertedEid : asserted.success ? asserted.data : null;
  if (eidPath === "assertedEid" && values.assertedEid !== undefined && values.assertedEid !== "" && assertedEid === null) throw new Error("RUN_REVIEW_EMPLOYEE_ID_INVALID");
  const answers: Record<string, SubmittedAnswer> = Object.fromEntries(record.fields.answers.map(answer => {
    const value = values[answer.path];
    if (value !== undefined && answer.state === "absent" && answer.reason === "not-on-form") throw new Error("RUN_REVIEW_FIELD_READ_ONLY");
    const submitted: SubmittedAnswer = value === undefined ? answer.state === "absent" ? { state: "absent", reason: answer.reason }
      : { state: "read", raw: answer.raw, confidence: answer.confidence }
      : value.trim() === "" ? { state: "absent", reason: "blank" } : { state: "read", raw: value, confidence: 1 };
    return [answer.path, submitted];
  }));
  if (record.provenance !== undefined) {
    const pages = operatorPages(record, values);
    return OcrReviewCommandRequestSchema.options[0].shape.payload.parse({ recordId, assertedEid, pages,
      fields: operatorOcrFields(revision.seed, pages, answers, record.provenance.createdAt) });
  }
  if (outcome?.state !== "done") throw new Error("RUN_REVIEW_SOURCE_UNAVAILABLE");
  const { record: _record, pageFingerprint: _fingerprint, ...metadata } = outcome.output.extraction;
  const admitted = admitOcrExtraction({ ...metadata, record: { answers } });
  if (!admitted.admitted || admitted.extraction.record === null) throw new Error("RUN_REVIEW_CORRECTION_INVALID");
  return OcrReviewCommandRequestSchema.options[0].shape.payload.parse({ recordId, fields: admitted.extraction.record, assertedEid });
}
