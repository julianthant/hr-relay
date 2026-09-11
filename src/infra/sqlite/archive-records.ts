import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { ArchiveReportSchema, type ArchiveReport } from "../../domain/archive/report.js";
import type { ArchiveDatabase } from "./archive-database.js";

/** A uses the shared transfer fence for publication and canonical ownership for reads. */
export function createArchiveRecords(storage: { saveReport: ArchiveDatabase["capture"]; verifyReport: ArchiveDatabase["verify"]; publishReport(runId: string, digest: string): void; readReport: ArchiveDatabase["readPublishedReport"] }) {
  return Object.freeze({
    capture: (report: ArchiveReport) => storage.saveReport(report),
    verify: (runId: string, digest: string) => storage.verifyReport(runId, digest),
    publish: (runId: string, digest: string) => storage.publishReport(runId, digest),
    read: (runId: string) => storage.readReport(runId),
  });
}

/** No source/workflow parser and no original source bytes or private source digests. */
export function projectArchiveReport(input: ArchiveReport | undefined) {
  if (input === undefined) return { state: "unavailable" as const };
  const report = ArchiveReportSchema.parse(input);
  const { runId, title, workflow, descriptorVersion, outcome, completedAt, capturedAt, sections, files } = report.content;
  const change = report.content.versionChange;
  const value = { state: "available" as const, runId, title, workflow, descriptorVersion, outcome, completedAt, capturedAt, sections, files,
    ...(change === undefined ? {} : { versionChange: { changeId: change.review.changeId, change: change.review.change,
      scope: change.review.scope, targetVersion: change.review.targetVersion, reviewedAt: change.review.reviewedAt,
      appliedBy: change.application.actorId, startedAt: change.application.startedAt } }) };
  return { ...value, archiveFingerprint: sha256Hex(canonicalJsonStringify(value)) };
}
