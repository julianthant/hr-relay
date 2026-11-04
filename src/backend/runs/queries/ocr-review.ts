import { ReviewPageSchema, type RunDetailSectionResponse } from "../../../models/dashboard/run-detail.js";
import { readOcrReviewAuthority, readOcrSnapshotsAuthority } from "../lifecycle/ocr-review-authority.js";
import type { RunDetailQueryDeps } from "./run-detail-types.js";
import { SectionUnavailableError } from "../commands/refusals.js";
import { deterministicUuid } from "../lifecycle/support.js";

export function buildOcrReviewSection(deps: RunDetailQueryDeps, runId: string): RunDetailSectionResponse {
  const canonical = deps.canonical;
  if (canonical === undefined) throw new SectionUnavailableError("OCR review authority is unavailable");
  return canonical.database.withAuthorityReadSnapshot(() => {
    const review = readOcrReviewAuthority(canonical.database.authority, canonical.reader, runId);
    if (review === undefined) throw new SectionUnavailableError("OCR review has no published source reading");
    const snapshots = readOcrSnapshotsAuthority(canonical.database.authority, review);
    return { section: "review", payload: ReviewPageSchema.parse({ runId,
      records: review.revision.records.map(record => {
        const source = review.revision.seed.review.records.find(seed => seed.recordId === record.recordId);
        const page = review.revision.seed.review.accounting.manifest.pages.find(page => page.sourcePage === source?.sourcePage);
        if (source === undefined || page === undefined) throw new SectionUnavailableError("OCR record source page is unavailable");
        const name = record.fields.answers.find(answer => ["employee.name", "printedName"].includes(answer.path));
        const first = record.fields.answers.find(answer => answer.path === "firstName"), last = record.fields.answers.find(answer => answer.path === "lastName");
        return { recordId: deterministicUuid(`ocr-review:${runId}:${record.recordId}`), runId, recordRevision: review.revision.revision,
          label: name?.state === "read" ? String(name.value) : first?.state === "read" && last?.state === "read"
            ? `${last.value}, ${first.value}` : `Page ${source.sourcePage}`,
          state: record.discarded ? "rejected" : snapshots.some(snapshot => snapshot.revision === review.revision.revision
            && snapshot.selectedRecordIds.includes(record.recordId)) ? "accepted" : "pending",
          evidence: [`artifact:${page.image.id}`] };
      }),
      ocr: { revision: review.revision, digest: review.digest,
        approvedSnapshots: snapshots, ...(review.invalidatedCorrections.length === 0 ? {} : { invalidatedCorrections: review.invalidatedCorrections }) } }) };
  });
}
