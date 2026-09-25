import { z } from "zod";

import type { Clock } from "../domain/clock.js";
import type { IdFactory } from "../domain/identifiers.js";
import { deriveStableUuid } from "../domain/identifiers.js";
import { sha256Hex } from "../domain/sha256.js";
import { canonicalJsonStringify, JsonValueSchema } from "../domain/canonical-json.js";
import { FingerprintSchema, IsoInstantSchema, RunIdSchema } from "../domain/ids.js";
import { RuntimeVersionChangeSchema, runtimeVersionChangeReviewFingerprint } from "../domain/archive/runtime-version-change.js";
import { RuntimeVersionScopeSchema } from "../domain/archive/runtime-version.js";
import { ArchiveReportSchema } from "../domain/archive/report.js";
import type { AuthorityDatabase } from "../infra/sqlite/authority-database.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../infra/sqlite/storage-records.js";
import { createRunLifecycleStorage } from "../infra/sqlite/lifecycle-storage.js";
import type { ArchiveSnapshotSource } from "../services/archive/archive-service.js";
import { captureArchiveReport, genericArchiveSection } from "../services/archive/report-capture.js";
import { transferArchiveReport } from "../services/archive/archive-transfer.js";

export function createRuntimeVersionChanges(deps: Readonly<{
  database: AuthorityDatabase;
  clock: Clock;
  ids: IdFactory;
  archiveSnapshots: ArchiveSnapshotSource;
  afterTransferStep?: (runId: string, step: "captured" | "verified" | "cleaned" | "published") => void;
}>) {
  const storage = createRunLifecycleStorage(deps.database);
  const plan = (scopeInput: z.input<typeof RuntimeVersionScopeSchema>, actorId: string, changeId = deps.ids.uuid(),
    commandFingerprint = sha256Hex(canonicalJsonStringify({ scope: scopeInput, actorId, changeId }))) =>
    deps.database.withAuthorityTransaction(() => {
      const scope = RuntimeVersionScopeSchema.parse(scopeInput);
      const existing = deps.database.readRuntimeVersionChange(changeId);
      if (existing !== undefined) {
        if (existing.actorId !== actorId || existing.planCommandFingerprint !== commandFingerprint
          || canonicalJsonStringify(existing.scope) !== canonicalJsonStringify(scope)) {
          throw new Error("runtime-version-plan-command-conflict");
        }
        return existing;
      }
      const review = deps.database.reviewRuntimeVersionTransition(scope);
      const record = {
        schemaVersion: 3 as const,
        changeId, actorId, reviewedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()),
        authorityRevision: review.revision, scope, before: review.transition.before, after: review.transition.after,
        members: review.review.members, membershipDigest: review.review.membershipDigest,
        planCommandFingerprint: FingerprintSchema.parse(commandFingerprint),
      };
      const change = RuntimeVersionChangeSchema.parse({ ...record,
        reviewFingerprint: runtimeVersionChangeReviewFingerprint(record), state: "planned", completedRunIds: [],
      });
      return deps.database.writeRuntimeVersionChange(change);
    });

  const claim = (changeId: string, commandId: string, requestFingerprint: string) => deps.database.withAuthorityTransaction(() => {
    const row = deps.database.readRuntimeVersionChange(changeId);
    if (row === undefined) throw new Error("runtime-version-change-missing");
    if (row.state !== "planned") {
      if (row.applicationCommandId !== commandId || row.applicationRequestFingerprint !== requestFingerprint) {
        throw new Error("runtime-version-application-command-conflict");
      }
      return row;
    }
    const current = deps.database.reviewRuntimeVersionTransition(row.scope);
    if (current.revision !== row.authorityRevision
      || current.review.membershipDigest !== row.membershipDigest
      || canonicalJsonStringify(current.transition.after) !== canonicalJsonStringify(row.after)) {
      throw new Error("runtime-version-review-stale");
    }
    if (current.review.blockers.length > 0) throw new Error("runtime-version-active-blockers");
    const candidates = current.review.candidates;
    const candidateIds = new Set(candidates.map(member => member.runId));
    for (const member of candidates) {
      const run = deps.database.authority.runs.get(member.runId);
      if (run === undefined) throw new Error("runtime-version-source-stale");
      const parentId = run.envelope.parent?.runId;
      if (parentId !== undefined && !candidateIds.has(parentId)
        && deps.database.authority.runs.get(parentId) !== undefined) {
        throw new Error("runtime-version-parent-out-of-scope");
      }
      if (deps.database.authority.runs.listChildren(member.runId).some(child => !candidateIds.has(child.envelope.runId))) {
        throw new Error("runtime-version-child-out-of-scope");
      }
    }
    const affectedWorkflowIds = current.transition.affectedWorkflowIds;
    deps.database.claimRuntimeVersionTransition({ changeId, expectedRevision: row.authorityRevision,
      workflowIds: affectedWorkflowIds, after: row.after, expectedMembershipDigest: row.membershipDigest });
    const displays = deps.archiveSnapshots.snapshotBatch(candidates.map(member => member.runId));
    const captures = candidates.map(member => {
      const snapshot = storage.capture(member.runId);
      if (snapshot.run.version !== member.recordVersion || snapshot.run.lifecycle.state !== "terminal") {
        throw new Error("runtime-version-source-stale");
      }
      const display = displays.get(member.runId);
      if (display === undefined) throw new Error("archive-display-capture-missing");
      const files = (snapshot.records.find(group => group.table === "diagnostic_files")?.rows ?? []).map(record => {
        const { attachment } = DiagnosticAttachmentStorageRecordSchema.parse(JSON.parse(record.json));
        return { digest: attachment.digest, byteLength: attachment.byteLength, mediaType: attachment.mediaType,
          name: attachment.kind, artifactIds: [attachment.artifactId] };
      });
      const unique = [...new Map(files.map(file => [file.digest, file])).values()];
      for (const file of unique) storage.retainFile(file, storage.readSourceFile(file));
      const adoption = deps.database.readRuntimeVersionAdoption(member.runId);
      const report = captureArchiveReport({ snapshot,
        transferId: deriveStableUuid("archive-transfer", `${changeId}:${member.runId}`),
        capturedAt: deps.clock.now().toISOString(), files: unique,
        sections: [genericArchiveSection("Displayed run", JsonValueSchema.parse(display))],
        ...(adoption === undefined ? {} : { adoptedRuntimeVersion: { dashboard: adoption.dashboard, workflow: adoption.workflow } }),
      });
      if (report.content.runtimeVersion === undefined) throw new Error("runtime-version-capture-unattributed");
      return { runId: RunIdSchema.parse(member.runId), reportJson: canonicalJsonStringify(report),
        parentId: snapshot.run.envelope.parent?.runId };
    });
    const byId = new Map<string, typeof captures[number]>(captures.map(capture => [capture.runId, capture]));
    const depth = (runId: string, seen = new Set<string>()): number => {
      if (seen.has(runId)) throw new Error("runtime-version-run-parent-cycle");
      const parentId = byId.get(runId)?.parentId;
      if (parentId === undefined || !byId.has(parentId)) return 0;
      seen.add(runId);
      return 1 + depth(parentId, seen);
    };
    const pendingCaptures = captures
      .sort((left, right) => depth(right.runId) - depth(left.runId) || left.runId.localeCompare(right.runId))
      .map(({ runId, reportJson }) => ({ runId, reportJson }));
    return deps.database.writeRuntimeVersionChange({ ...row, state: "applying", applicationCommandId: commandId,
      applicationRequestFingerprint: FingerprintSchema.parse(requestFingerprint),
      claimedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()), pendingCaptures });
  });

  const apply = (changeId: string, commandId = changeId,
    requestFingerprint = sha256Hex(canonicalJsonStringify({ changeId, commandId }))) => {
    let row = claim(changeId, commandId, requestFingerprint);
    if (row.state === "applied") return row;
    if (deps.database.readRuntimeVersionAuthority().claim?.changeId !== changeId) throw new Error("runtime-version-claim-mismatch");
    for (const capture of row.pendingCaptures ?? []) {
      const report = ArchiveReportSchema.parse(JSON.parse(capture.reportJson));
      const member = row.members.find(value => value.runId === capture.runId);
      if (member === undefined || member.state !== "terminal"
        || report.content.transferId !== deriveStableUuid("archive-transfer", `${changeId}:${capture.runId}`)) {
        throw new Error("runtime-version-capture-member-mismatch");
      }
      storage.saveReport(report);
      storage.verifyReport(capture.runId, report.digest);
      transferArchiveReport(storage, report, member.recordVersion, step => deps.afterTransferStep?.(capture.runId, step));
      row = deps.database.withAuthorityTransaction(() => {
        const current = deps.database.readRuntimeVersionChange(changeId);
        if (current === undefined || current.state !== "applying") throw new Error("runtime-version-claim-missing");
        const frozen = current.pendingCaptures?.find(value => value.runId === capture.runId);
        if (frozen?.reportJson !== capture.reportJson) throw new Error("runtime-version-capture-conflict");
        return deps.database.writeRuntimeVersionChange({ ...current,
          completedRunIds: [...current.completedRunIds, capture.runId].sort(),
          pendingCaptures: current.pendingCaptures?.filter(value => value.runId !== capture.runId),
        });
      });
    }
    return deps.database.withAuthorityTransaction(() => {
      const current = deps.database.readRuntimeVersionChange(changeId);
      if (current === undefined || current.state !== "applying") throw new Error("runtime-version-claim-missing");
      if (current.pendingCaptures?.length !== 0
        || current.completedRunIds.length !== current.members.filter(member => member.state === "terminal").length) {
        throw new Error("runtime-version-transfer-incomplete");
      }
      const authority = deps.database.readRuntimeVersionAuthority();
      deps.database.publishRuntimeVersionTransition({ changeId, expectedRevision: authority.revision, next: current.after });
      const { pendingCaptures: _pendingCaptures, ...completed } = current;
      return deps.database.writeRuntimeVersionChange({ ...completed, state: "applied",
        completedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()) });
    });
  };

  return Object.freeze({ plan, apply });
}
