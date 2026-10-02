import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { ArchiveReportSchema, type ArchiveReport } from "../../../models/archive/report.js";
import type { ArchiveDatabase } from "./archive-database.js";

export type PublishedArchiveReportProvenance = Readonly<{
  publicationState: "published";
  reportIntegrity: "verified";
}>;

const publishedArchiveReports = new WeakMap<ArchiveReport, PublishedArchiveReportProvenance>();

/** Attest a report only after the archive database has checked publication and sealed integrity. */
export function attestPublishedArchiveReport(report: ArchiveReport): ArchiveReport {
  publishedArchiveReports.set(report, { publicationState: "published", reportIntegrity: "verified" });
  return report;
}

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
  const provenance = publishedArchiveReports.get(input);
  const report = ArchiveReportSchema.parse(input);
  const { runId, transferId, itemId, attempt, runNumber, title, workflow, descriptorVersion, outcome, completedAt, capturedAt, sections, files } = report.content;
  const change = report.content.versionChange;
  const value = { state: "available" as const, runId, title, workflow, descriptorVersion, outcome, completedAt, capturedAt, sections, files,
    ...(report.content.runtimeVersion === undefined ? {} : { runtimeVersion: report.content.runtimeVersion }),
    ...(change === undefined ? {} : { versionChange: { changeId: change.review.changeId, change: change.review.change,
      scope: change.review.scope, targetVersion: change.review.targetVersion, reviewedAt: change.review.reviewedAt,
      appliedBy: change.application.actorId, startedAt: change.application.startedAt } }) };
  return { ...value, transferId, itemId, attempt, runNumber, ...provenance,
    archiveFingerprint: sha256Hex(canonicalJsonStringify(value)) };
}
