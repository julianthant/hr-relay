import { ReviewPageSchema, type RunDetailSectionResponse } from "../../../models/dashboard/run-detail.js";
import { readOcrReviewAuthority, readOcrSnapshotsAuthority } from "../lifecycle/ocr-review-authority.js";
import type { RunDetailQueryDeps } from "./run-detail-types.js";
import { hostedOcrRun } from "./ocr-record-members.js";
import { SectionUnavailableError } from "../commands/refusals.js";
import { deterministicUuid } from "../lifecycle/support.js";
import { ocrRecordName } from "../../../models/ocr/review.js";
import { runClaim } from "../../../models/run/record.js";
import { GateIdSchema } from "../../../rules/identity/ids.js";
import { ocrRecordSourcePages } from "../../../models/ocr/review-record.js";

export function buildOcrReviewSection(deps: RunDetailQueryDeps, requestedRunId: string): RunDetailSectionResponse {
  const canonical = deps.canonical;
  if (canonical === undefined) throw new SectionUnavailableError("OCR review authority is unavailable");
  return canonical.database.withAuthorityReadSnapshot(() => {
    const requested = canonical.reader.read(requestedRunId);
    const runId = (requested.state === "present" ? hostedOcrRun(canonical.database.authority, requested.run) : undefined)?.envelope.runId ?? requestedRunId;
    const review = readOcrReviewAuthority(canonical.database.authority, canonical.reader, runId);
    if (review === undefined) throw new SectionUnavailableError("OCR review has no published source reading");
    const snapshots = readOcrSnapshotsAuthority(canonical.database.authority, review);
    const { run } = review;
    const descriptor = canonical.descriptors.resolve(run.envelope.workflow);
    const current = descriptor?.contractFingerprint === run.envelope.contractFingerprint && descriptor.version === run.envelope.descriptorVersion;
    const busy = runClaim(run) !== undefined || run.cancelRequested === true || run.lifecycle.state === "parked-write"
      || run.lifecycle.state === "queued" && run.delegationRefresh !== undefined
      || run.lifecycle.state === "terminal" && ["cancelled", "discarded", "superseded"].includes(run.lifecycle.outcome)
      || canonical.database.authority.workerControls.resetForRun(runId) !== undefined;
    const editing = !current ? { state: "unavailable" as const, reason: "retained-workflow" as const }
      : snapshots.length > 0 ? { state: "unavailable" as const, reason: "approved" as const }
      : busy ? { state: "unavailable" as const, reason: "run-busy" as const }
      : { state: "available" as const, runVersion: run.version };
    return { section: "review", payload: ReviewPageSchema.parse({ runId,
      records: review.revision.records.map(record => {
        const pages = ocrRecordSourcePages(review.revision.seed.review.records, record).map(sourcePage => {
          const page = review.revision.seed.review.accounting.manifest.pages.find(page => page.sourcePage === sourcePage);
          if (page === undefined) throw new SectionUnavailableError("OCR record source page is unavailable");
          return page;
        });
        return { recordId: deterministicUuid(`ocr-review:${runId}:${record.recordId}`), runId, recordRevision: review.revision.revision,
          label: ocrRecordName(record.fields) ?? (record.provenance === undefined ? `Page ${pages[0].sourcePage}` : "Operator-added record"),
          state: record.discarded ? "rejected" : snapshots.some(snapshot => snapshot.revision === review.revision.revision
            && snapshot.selectedRecordIds.includes(record.recordId)) ? "accepted" : "pending",
          evidence: pages.map(page => `artifact:${page.image.id}`) };
      }),
      ocr: { revision: review.revision, digest: review.digest,
        editing, ...(editing.state === "available" && run.lifecycle.state === "parked-gate" && String(run.lifecycle.gateId) === "approve-records"
          ? { approval: { runId, gateId: GateIdSchema.parse("approve-records"), expectedVersion: run.version } } : {}),
        approvedSnapshots: snapshots, ...(review.invalidatedCorrections.length === 0 ? {} : { invalidatedCorrections: review.invalidatedCorrections }) } }) };
  });
}
