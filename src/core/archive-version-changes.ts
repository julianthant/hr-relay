import { PositiveIntSchema, NonNegativeIntSchema, RunIdSchema } from "../domain/ids.js";
import { archivedRunReferenceFingerprint } from "../domain/archive/model.js";
import type { createRunLifecycleStorage } from "../infra/sqlite/lifecycle-storage.js";
import { lifecycleSourceDigest } from "../infra/sqlite/lifecycle-storage.js";
import type { Clock } from "../domain/clock.js";
import type { IdFactory } from "../domain/identifiers.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import type { RunRecordService } from "./run-record-service.js";
import type { ArchiveSnapshotSource } from "../services/archive/archive-service.js";
import type { TargetReference, VersionChange as RunVersionChange } from "./run-fan-out.js";
interface ArchiveCommandDependencies {
  authority: { withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result };
  lifecycle: Pick<RunRecordService, "lifecycleStorage">;
  clock: Clock;
  ids: IdFactory;
  appVersion: string;
  descriptors: { resolve(workflow: string): AnyWorkflowDescriptor | undefined };
  archiveSnapshots: ArchiveSnapshotSource;
}
export interface ArchiveCommandTools {
  applied(request: CommandRequest, targets: readonly TargetReference[], changes: readonly RunVersionChange[]): CommandApplication;
}
import type { CommandApplication } from "./command-application.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import { CommandIdentityConflictError, VersionScopeSchema, type CommandRequest, type CommandResult } from "../domain/commands.js";
import { JsonValueSchema, canonicalJsonStringify } from "../domain/canonical-json.js";
import { sha256Hex } from "../domain/sha256.js";
import { deriveStableUuid, lifecycleCommandId } from "../domain/identifiers.js";
import { runTarget } from "./run-fan-out.js";
import { assessVersionBump, resolveBumpEffect, describeBlocker } from "../services/archive/archive-service.js";
import { VersionChangeSchema, versionChangeReviewFingerprint, archiveVersionChange, type VersionChange } from "../domain/archive/change-record.js";
import { captureArchiveReport, genericArchiveSection } from "../services/archive/report-capture.js";
import { transferArchiveReport } from "../services/archive/archive-transfer.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../infra/sqlite/storage-records.js";
import { projectArchiveReport } from "../infra/sqlite/archive-records.js";

class ArchivePolicyRefusal extends Error {
  constructor(readonly result: Extract<CommandResult, { state: "rejected" | "conflict" }>) { super(result.message); }
}

type Request = Extract<CommandRequest, { family: "version-archive" }>;
type Apply = Extract<Request, { type: "apply-version-bump" }>;
type Storage = ReturnType<typeof createRunLifecycleStorage>;
const planTarget = (versionPlanId: string) => ({ family: "version-archive" as const, versionPlanId });

export function createVersionChanges(storage: Storage) {
  return Object.freeze({ read: storage.readVersionChange, write: storage.writeVersionChange });
}
function refuse(request: Request, code: Extract<CommandResult, { state: "rejected" }>["code"], message: string): never {
  throw new ArchivePolicyRefusal({ state: "rejected", commandId: request.commandId, code, message });
}
function assess(deps: ArchiveCommandDependencies, repos: AuthorityRepositories, scope: VersionChange["scope"]) {
  return assessVersionBump({ repositories: repos, appVersion: deps.appVersion, currentIdentity: workflowId => {
    const descriptor = deps.descriptors.resolve(workflowId);
    return descriptor === undefined ? undefined : { workflowId: descriptor.id, descriptorVersion: PositiveIntSchema.parse(descriptor.version), contractFingerprint: descriptor.contractFingerprint };
  } }, VersionScopeSchema.parse(scope));
}
function review(deps: ArchiveCommandDependencies, repos: AuthorityRepositories, input: Pick<VersionChange, "changeId" | "actorId" | "reviewedAt" | "scope" | "targetVersion" | "change" | "supersedes">): VersionChange {
  const assessment = assess(deps, repos, input.scope);
  const effect = resolveBumpEffect(input.change.kind, assessment);
  const storage = deps.lifecycle.lifecycleStorage();
  const members = effect.candidates.map(candidate => {
    const snapshot = storage.capture(candidate.runId);
    return { runId: candidate.runId, version: snapshot.run.version, sourceDigest: lifecycleSourceDigest(snapshot) };
  });
  const value = { ...input, observedAppVersion: deps.appVersion,
    targets: assessment.identities.map(identity => ({ workflow: identity.workflowId, version: identity.descriptorVersion, fingerprint: identity.contractFingerprint })),
    members, blockers: effect.blockers.map(blocker => blocker.runId), membershipDigest: sha256Hex(canonicalJsonStringify(members)) };
  return VersionChangeSchema.parse({ ...value, schemaVersion: 2, reviewFingerprint: versionChangeReviewFingerprint(value), state: "planned", completedRunIds: [] });
}
function requiredChange(storage: Storage, request: Apply) {
  const row = storage.readVersionChange(request.target.versionPlanId);
  if (row === undefined) refuse(request, "target-not-found", "Version change is unavailable; create a new review.");
  if (request.target.expectedVersion !== 1) throw new ArchivePolicyRefusal({ state: "conflict", commandId: request.commandId, currentVersion: NonNegativeIntSchema.parse(1), message: "Version review revision differs." });
  if (row.reviewFingerprint !== request.payload.planFingerprint) refuse(request, "schema-mismatch", "Version review fingerprint differs.");
  if (row.state === "superseded") refuse(request, "replan-required", `Review replaced by ${row.supersededBy}; confirm that review explicitly.`);
  return row;
}

/** Kernel alone writes the final command journal/audit; cross-store work precedes it. */
export function executeArchiveCommand(deps: ArchiveCommandDependencies, repos: AuthorityRepositories,
  request: Request, now: string, tools: ArchiveCommandTools): CommandApplication {
  const storage = deps.lifecycle.lifecycleStorage();
  switch (request.type) {
    case "plan-version-bump": {
      if (request.target.scope.kind === "application" && request.target.scope.applicationVersion !== deps.appVersion) {
        refuse(request, "invalid-state", "Application review must name the running build.");
      }
      if (request.target.scope.kind === "workflows" && request.target.scope.workflowIds.some(id => deps.descriptors.resolve(id) === undefined)) refuse(request, "target-not-found", "Workflow is not registered.");
      const row = review(deps, repos, { changeId: deps.ids.uuid(), actorId: request.requestedBy, reviewedAt: now,
        scope: request.target.scope, targetVersion: request.payload.targetVersion, change: request.payload.changeRecord });
      storage.writeVersionChange(row);
      return tools.applied(request, [planTarget(row.changeId)], []);
    }
    case "apply-version-bump": {
      const row = requiredChange(storage, request);
      if (row.state !== "applied" || row.application?.commandId !== request.commandId
        || row.application.requestFingerprint !== sha256Hex(canonicalJsonStringify(request))) refuse(request, "invalid-state", "Version transfer is not complete for this command.");
      return tools.applied(request, [planTarget(row.changeId), ...row.members.map(member => runTarget(member.runId))], []);
    }
    case "delete-archived-run": {
      const receipt = repos.deletedRuns.get(request.target.archivedRunId);
      if (receipt === undefined || receipt.origin !== "archive" || receipt.commandId !== lifecycleCommandId("operator-delete-archive", request.commandId)) {
        refuse(request, "target-not-found", "Archive deletion has not completed for this command.");
      }
      return tools.applied(request, [runTarget(request.target.archivedRunId)], []);
    }
    case "relaunch-archived-run":
      refuse(request, "policy-refused", "Archive relaunch is retired. Saved reports cannot create or resume runs.");
  }
}

function prepareApply(deps: ArchiveCommandDependencies, request: Apply): CommandResult | undefined {
  const storage = deps.lifecycle.lifecycleStorage();
  return deps.authority.withAuthorityTransaction(repos => {
    repos.commands.assertIdentity(request);
    if (repos.commands.get(request.commandId) !== undefined) return undefined;
    if (storage.readVersionChange(request.target.versionPlanId) === undefined && repos.versionPlans.get(request.target.versionPlanId) !== undefined) refuse(request, "policy-refused", "Historical reviews have no current membership proof (generation 1 has no bump kind); re-plan explicitly.");
    const row = requiredChange(storage, request);
    const requestFingerprint = sha256Hex(canonicalJsonStringify(request));
    if (row.observedAppVersion !== deps.appVersion) refuse(request, "policy-refused", "Running build changed; re-plan and confirm the new review.");
    for (const target of row.targets) {
      const current = deps.descriptors.resolve(target.workflow);
      if (current === undefined || current.version !== target.version || current.contractFingerprint !== target.fingerprint) refuse(request, "policy-refused", "Workflow identities changed; re-plan and confirm the new review.");
    }
    if (row.application !== undefined) {
      if (row.application.commandId !== request.commandId || row.application.requestFingerprint !== requestFingerprint) throw new CommandIdentityConflictError();
      return undefined;
    }
    if (row.observedAppVersion !== deps.appVersion) refuse(request, "policy-refused", "Running build changed; re-plan and confirm the new review.");
    const current = review(deps, repos, { changeId: row.changeId, actorId: row.actorId, reviewedAt: row.reviewedAt,
      scope: row.scope, targetVersion: row.targetVersion, change: row.change, ...(row.supersedes === undefined ? {} : { supersedes: row.supersedes }) });
    if (canonicalJsonStringify(current.targets) !== canonicalJsonStringify(row.targets)) refuse(request, "policy-refused", "Workflow identities changed; re-plan and confirm the new review.");
    if (current.membershipDigest !== row.membershipDigest || canonicalJsonStringify(current.blockers) !== canonicalJsonStringify(row.blockers)) {
      const replacement = review(deps, repos, { changeId: deps.ids.uuid(), actorId: request.requestedBy, reviewedAt: deps.clock.now().toISOString(),
        scope: row.scope, targetVersion: row.targetVersion, change: row.change, supersedes: row.changeId });
      storage.replaceVersionChange(row.changeId, row.reviewFingerprint, replacement);
      return { state: "rejected" as const, commandId: request.commandId, code: "replan-required" as const,
        message: `Reviewed membership changed. Review-required: confirm replacement ${replacement.changeId}.` };
    }
    if (row.blockers.length > 0) refuse(request, "active-version-blockers", `Prior-version blockers: ${assess(deps, repos, row.scope).blockers.map(describeBlocker).join("; ")}`);
    storage.claimVersionChange({ changeId: row.changeId, reviewFingerprint: row.reviewFingerprint,
      application: { commandId: request.commandId, actorId: request.requestedBy, startedAt: request.requestedAt,
        appVersion: deps.appVersion, targets: row.targets, requestFingerprint } });
    return undefined;
  });
}

/** Every report is captured before the first cleanup; replay uses those exact bytes. */
function applyTransfer(deps: ArchiveCommandDependencies, request: Apply) {
  const storage = deps.lifecycle.lifecycleStorage();
  const row = requiredChange(storage, request);
  if (row.state === "applied") return;
  if (row.application === undefined) throw new Error("archive-claim-missing");
  const reports = deps.authority.withAuthorityTransaction(() => {
    const pending = row.members.map(member => ({ member, transferId: deriveStableUuid("archive-transfer", `${row.changeId}:${member.runId}`) }));
    const missing = pending.filter(({ member, transferId }) => storage.readPendingReport(member.runId, transferId) === undefined);
    const displays = deps.archiveSnapshots.snapshotBatch(missing.map(({ member }) => member.runId));
    return pending.map(({ member, transferId }) => {
      const saved = storage.readPendingReport(member.runId, transferId);
      if (saved !== undefined) return saved.report;
      const snapshot = storage.capture(member.runId);
      if (lifecycleSourceDigest(snapshot) !== member.sourceDigest || snapshot.run.version !== member.version) throw new Error("archive-reviewed-source-changed");
      const display = displays.get(member.runId);
      if (display === undefined) throw new Error("archive-display-capture-missing");
      const files = (snapshot.records.find(group => group.table === "diagnostic_files")?.rows ?? []).map(record => {
        const { attachment } = DiagnosticAttachmentStorageRecordSchema.parse(JSON.parse(record.json));
        return { digest: attachment.digest, byteLength: attachment.byteLength, mediaType: attachment.mediaType,
          name: attachment.kind, artifactIds: [attachment.artifactId] };
      });
      const unique = [...new Map(files.map(file => [file.digest, file])).values()];
      for (const file of unique) storage.retainFile(file, storage.readSourceFile(file));
      const report = captureArchiveReport({ snapshot, transferId, capturedAt: row.application!.startedAt,
        versionChange: archiveVersionChange(row), files: unique,
        sections: [genericArchiveSection("Displayed run", JsonValueSchema.parse(display))] });
      storage.saveReport(report); storage.verifyReport(member.runId, report.digest);
      return report;
    });
  });
  const byId = new Map(reports.map(report => [report.content.runId, report]));
  const depth = (runId: string, seen = new Set<string>()): number => {
    if (seen.has(runId)) throw new Error("archive-parent-cycle");
    seen.add(runId);
    const report = byId.get(RunIdSchema.parse(runId));
    if (report === undefined) return 0;
    const source = report.content.sources.find(value => value.kind === "authority-snapshot");
    if (source === undefined) throw new Error("archive-source-snapshot-missing");
    const snapshot = JSON.parse(source.json) as { run: { envelope: { parent?: { runId: string } } } };
    return snapshot.run.envelope.parent === undefined ? 0 : 1 + depth(snapshot.run.envelope.parent.runId, seen);
  };
  reports.sort((a, b) => depth(b.content.runId) - depth(a.content.runId) || a.content.runId.localeCompare(b.content.runId));
  for (const report of reports) {
    const member = row.members.find(value => value.runId === report.content.runId);
    if (member === undefined) throw new Error("archive-member-missing");
    transferArchiveReport(storage, report, member.version);
    const current = storage.readVersionChange(row.changeId);
    if (current === undefined) throw new Error("archive-change-missing");
    storage.writeVersionChange({ ...current, completedRunIds: [...new Set([...current.completedRunIds, member.runId])].sort() });
  }
  const current = storage.readVersionChange(row.changeId);
  if (current?.application === undefined) throw new Error("archive-change-missing");
  storage.writeVersionChange({ ...current, state: "applied", application: { ...current.application, completedAt: deps.clock.now().toISOString() } });
}

export function runArchiveCommand(request: Request, deps: ArchiveCommandDependencies, executeAtomic: () => CommandResult) {
  try {
    // Even retired or absent targets must not bypass global command identity.
    const journaled = deps.authority.withAuthorityTransaction(repos => {
      repos.commands.assertIdentity(request); return repos.commands.get(request.commandId) !== undefined;
    });
    if (!journaled && (request.type === "delete-archived-run" || request.type === "relaunch-archived-run")) {
      const historical = deps.authority.withAuthorityTransaction(repos => repos.archivedRuns.get(request.target.archivedRunId));
      if (historical !== undefined) archivedRunReferenceFingerprint(historical);
    }
    if (journaled || request.type === "plan-version-bump" || request.type === "relaunch-archived-run") return executeAtomic();
    if (request.type === "apply-version-bump") {
      const refusal = prepareApply(deps, request);
      if (refusal !== undefined) return refusal;
      applyTransfer(deps, request);
    } else {
      const storage = deps.lifecycle.lifecycleStorage();
      const report = storage.readReport(request.target.archivedRunId);
      if (report !== undefined) {
        const view = projectArchiveReport(report);
        if (view.state !== "available" || view.archiveFingerprint !== request.target.archiveFingerprint) refuse(request, "schema-mismatch", "Archive reference differs.");
        // Canonical deletion binds the independently verified private report digest.
        const outcome = storage.deleteArchive({ commandId: lifecycleCommandId("operator-delete-archive", request.commandId), runId: report.content.runId, archiveFingerprint: report.digest, operatorRequest: request });
        if (outcome.state !== "deleted" && outcome.state !== "applied-already") refuse(request, "policy-refused", "Archive deletion refused.");
      } else {
        const receipt = deps.authority.withAuthorityTransaction(repos => repos.deletedRuns.get(request.target.archivedRunId));
        if (receipt?.commandId === lifecycleCommandId("operator-delete-archive", request.commandId)) {
          // The exact journal replay supplies every tree receipt and resumes
          // archive/file settlement without fabricating a removed report digest.
          const outcome = storage.deleteArchive({ commandId: receipt.commandId, runId: receipt.runId, operatorRequest: request });
          if (outcome.state !== "applied-already") throw new Error("archive-delete-replay-incomplete");
        }
      }
    }
    return executeAtomic();
  } catch (error) {
    if (error instanceof CommandIdentityConflictError) return { state: "rejected" as const, commandId: request.commandId, code: "command-divergent" as const, message: error.message };
    if (error instanceof ArchivePolicyRefusal) return error.result;
    throw error;
  }
}
