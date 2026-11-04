import type { ReviewPage } from "../../../../models/dashboard/run-detail.js";
import { CANONICAL_FIELDS } from "../../../../models/fields/registry.js";
import { ocrForm } from "../../../../models/ocr/form-registry.js";
import { ocrRecordName } from "../../../../models/ocr/review.js";
import type { ReviewField, ReviewRecordView, ReviewSourcePage } from "./review-record-model.js";

export function ocrReviewCards(page: ReviewPage, sourcePageUrl: (runId: string, revision: number, page: number) => string) {
  const review = page.ocr;
  if (review === undefined) throw new Error("RUN_REVIEW_OCR_UNAVAILABLE");
  const { revision } = review;
  const form = ocrForm(revision.seed.review.formType);
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
      const kind = answer.state === "read" && typeof answer.value === "boolean" ? "boolean" : undefined;
      return { key: spec.path, label, section, kind, readOnly: true,
        value: answer.state === "read" ? String(answer.value) : answer.state === "unreadable" ? answer.raw : answer.reason === "not-on-form" ? "Not on form" : answer.reason === "illegible" ? "Illegible" : "" };
    });
    const approved = review.approvedSnapshots.some(snapshot => snapshot.revision === revision.revision && snapshot.selectedRecordIds.includes(record.recordId));
    const model: ReviewRecordView = { id: record.recordId, page: source.sourcePage,
      kind: form.formType,
      selected: !record.discarded, fields,
      warnings: record.fields.blockingPaths.map(path => `${fields.find(field => field.key === path)?.label ?? path} needs review`) };
    const pages: readonly ReviewSourcePage[] = [{ page: source.sourcePage, imageUrl: sourcePageUrl(page.runId, revision.revision, source.sourcePage) }];
    return { record: model, pages, name: ocrRecordName(record.fields) ?? `Page ${source.sourcePage}`,
      disposition: { label: record.discarded ? "Not approved" : approved ? "Approved" : "Pending", tone: approved ? "success" as const : "neutral" as const } };
  });
}
