import type { VersionChange } from "./change-record.js";
import { archiveVersionChange } from "./change-record.js";
import { ArchiveReportSchema } from "./report.js";
import { LifecycleSourceSnapshotSchema, lifecycleSourceDigest } from "./lifecycle-source.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { deriveStableUuid } from "../../rules/identity/identifiers.js";

/** Authenticate private recovery payloads against the immutable reviewed claim. */
export function parsePendingCapture(change: VersionChange, capture: NonNullable<VersionChange["pendingCaptures"]>[number]) {
  const report = ArchiveReportSchema.parse(JSON.parse(capture.reportJson));
  const member = change.members.find(value => value.runId === capture.runId);
  const source = report.content.sources.find(value => value.kind === "authority-snapshot");
  if (source === undefined) throw new Error("version-change-capture-source-missing");
  const snapshot = LifecycleSourceSnapshotSchema.parse(JSON.parse(source.json));
  if (report.content.runId !== capture.runId || member?.sourceDigest !== report.content.sourceDigest
    || snapshot.run.envelope.runId !== capture.runId || snapshot.run.version !== member.version
    || lifecycleSourceDigest(snapshot) !== member.sourceDigest
    || report.content.capturedAt !== change.application?.startedAt
    || report.content.transferId !== deriveStableUuid("archive-transfer", `${change.changeId}:${capture.runId}`)
    || canonicalJsonStringify(report.content.versionChange) !== canonicalJsonStringify(archiveVersionChange(change))) {
    throw new Error("version-change-capture-mismatch");
  }
  return report;
}
