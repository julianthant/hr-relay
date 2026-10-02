import type { createRunLifecycleStorage } from "./sqlite/lifecycle-storage.js";
import type { ArchiveReport } from "../../domain/archive/report.js";

/** Resumable A baseline: every cross-store boundary is durable and replay-bound. */
export function transferArchiveReport(storage: ReturnType<typeof createRunLifecycleStorage>, report: ArchiveReport,
  expectedVersion: number, afterStep?: (step: "captured" | "verified" | "cleaned" | "published") => void) {
  storage.saveReport(report); afterStep?.("captured");
  storage.verifyReport(report.content.runId,report.digest); afterStep?.("verified");
  storage.transfer({runId:report.content.runId,digest:report.digest,expectedVersion}); afterStep?.("cleaned");
  storage.publishReport(report.content.runId,report.digest); afterStep?.("published");
  return storage.readReport(report.content.runId);
}

import { lifecycleSourceDigest } from "../../domain/archive/lifecycle-source.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { deriveStableUuid } from "../../domain/identifiers.js";
import { archivedRunReferenceFingerprint } from "../../domain/archive/model.js";
import { captureArchiveReport, genericArchiveSection } from "./archive/report-capture.js";
import { DiagnosticAttachmentStorageRecordSchema } from "./sqlite/storage-records.js";

type Storage = ReturnType<typeof createRunLifecycleStorage>;
type HistoricalSource = ReturnType<Storage["historicalArchiveSource"]>;

/** L supplies the immutable inspected bundle across retries and owns physical retirement. */
export function convertHistoricalArchives(storage: Storage, inspected: HistoricalSource, capturedAt: string,
  afterStep?: (runId: string, step: "captured" | "verified" | "cleaned" | "published") => void) {
  if (sha256Hex(canonicalJsonStringify(inspected.source)) !== inspected.digest) throw new Error("archive-historical-source-digest-mismatch");
  const { plans, applications, archives } = inspected.source;
  if (new Set(plans.map(value => value.versionPlanId)).size !== plans.length
    || new Set(applications.map(value => value.applicationId)).size !== applications.length
    || new Set(archives.map(value => value.archive.runId)).size !== archives.length) throw new Error("archive-historical-duplicate-identity");
  for (const plan of plans) if (plan.state === "applied" && applications.filter(value => value.versionPlanId === plan.versionPlanId).length !== 1) throw new Error("archive-historical-pair-mismatch");
  for (const application of applications) {
    const plan = plans.find(value => value.versionPlanId === application.versionPlanId);
    if (plan === undefined || plan.state !== "applied" || plan.plan.targetVersion !== application.targetVersion
      || canonicalJsonStringify(plan.plan.scope) !== canonicalJsonStringify(application.scope)
      || plan.plan.changeFingerprint !== application.changeFingerprint) throw new Error("archive-historical-pair-mismatch");
  }
  for (const entry of archives) {
    archivedRunReferenceFingerprint(entry.archive);
    const application = applications.find(value => value.applicationId === entry.archive.applicationId);
    if (application === undefined || !application.archivedRunIds.includes(entry.archive.runId)
      || entry.source.run.envelope.runId !== entry.archive.runId) throw new Error("archive-historical-membership-mismatch");
  }
  const reports = archives.map(({ archive, source }) => {
    const transferId = deriveStableUuid("historical-archive-conversion", archive.runId);
    const pending = storage.readPendingReport(archive.runId, transferId);
    if (pending !== undefined) {
      if (pending.report.content.sourceDigest !== lifecycleSourceDigest(source)) throw new Error("archive-historical-replay-mismatch");
      return pending.report;
    }
    const files = (source.records.find(group => group.table === "diagnostic_files")?.rows ?? []).map(row => {
      const { attachment } = DiagnosticAttachmentStorageRecordSchema.parse(JSON.parse(row.json));
      return { digest: attachment.digest, byteLength: attachment.byteLength, mediaType: attachment.mediaType, name: attachment.kind, artifactIds: [attachment.artifactId] };
    });
    const unique = [...new Map(files.map(file => [file.digest, file])).values()];
    for (const file of unique) storage.retainFile(file, storage.readSourceFile(file));
    const report = captureArchiveReport({ snapshot: source, transferId, capturedAt, files: unique,
      sections: [genericArchiveSection("Historical displayed run", JsonValueSchema.parse(archive))] });
    storage.saveReport(report); storage.verifyReport(archive.runId, report.digest);
    return report;
  });
  const depth = (runId: string, seen = new Set<string>()): number => {
    if (seen.has(runId)) throw new Error("archive-historical-parent-cycle");
    seen.add(runId);
    const parent = archives.find(entry => entry.archive.runId === runId)?.source.run.envelope.parent;
    return parent === undefined ? 0 : 1 + depth(parent.runId, seen);
  };
  reports.sort((a, b) => depth(b.content.runId) - depth(a.content.runId));
  for (const report of reports) {
    const source = archives.find(entry => entry.archive.runId === report.content.runId)?.source;
    if (source === undefined) throw new Error("archive-historical-source-missing");
    transferArchiveReport(storage, report, source.run.version, step => afterStep?.(report.content.runId, step));
  }
  const absentHistoricalMembers = applications.flatMap(application => application.archivedRunIds.filter(runId => !archives.some(entry => entry.archive.runId === runId)).map(runId => ({ applicationId: application.applicationId, runId })));
  return { sourceDigest: inspected.digest, absentHistoricalMembers, reports: reports.map(report => ({ runId: report.content.runId, transferId: report.content.transferId,
    sourceDigest: report.content.sourceDigest, reportDigest: report.digest })),
    retainedVersionSources: { plans, applications },
    dispositions: ["L must convert retained plan/application identities and retire historical tables only after this verified report conversion.",
      "Historical relaunch lineage and command/audit/batch/descendant records remain subject to L's reference-aware retirement policy."] };
}
