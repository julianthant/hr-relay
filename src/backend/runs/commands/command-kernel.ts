import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { preflightRunnerTimeout } from "../../../models/preflight/preflight.js";
import { AssistantActionManifestSchema } from "../../../models/profiles/assistant-permissions.js";
import type { EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import { deriveSchemaHash, type SchemaBoundCanonicalValue } from "../../../models/validation/schema-bound-value.js";
import { AssistantModelPreferenceCommandRequestSchema, commandAssistantAvailability, CommandAdmissionRequestSchema, CommandIdentityConflictError, type CommandRequest, CommandRequestSchema, type CommandResult, CommandResultSchema, StartCommandRequestSchema } from "../../../rules/commands/commands.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { type PreflightAdmission, PreflightAdmissionRefusal, PreflightEvidenceExpiredError } from "../../../rules/preflight/preflight-admission.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { IntakeParser } from "../../../workflow-kit/intake-parser.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { withCanonicalRunCommandScope } from "../../storage/sqlite/command-record-row.js";
import { captureDelegationResume, delegationResumeCommandId } from "../../storage/sqlite/delegation-authority.js";
import { executeFailureResolution } from "../lifecycle/failure-resolution.js";
import { readOcrReviewAuthority, readOcrSnapshotsAuthority, reviseOcrReview } from "../lifecycle/ocr-review-authority.js";
import { runTarget, type TargetReference, type VersionChange } from "../lifecycle/run-fan-out.js";
import { lifecycleCommandId, type RunRecordService } from "../lifecycle/run-record-service.js";
import type { NotificationInbox } from "../notifications/inbox.js";
import { workflowPreflightScope } from "../start/preflight-scope.js";
import { applied, type CommandApplication } from "./command-application.js";
import { CommandRefusal, conflict, reject } from "./command-refusal.js";
import { isAdmittedUnsettled, replay } from "./command-replay.js";
import { executeResolveGate } from "./gate-command.js";
import { executeIntake, type IntakeProjectionResolver } from "./intake-commands.js";
import { executeNotification, notificationCommandReceipt } from "./notification-commands.js";
import { lifecycleRun, requireDescriptorMatchesEnvelope, requireRun, resolveDescriptorOrReject, type WorkflowDescriptorResolver } from "./run-command-context.js";
import { executeBump, executeCancel, executeDelete, executePresentation, executeRetry } from "./run-lifecycle-commands.js";
import { executeSettings, executeSettingsCommand, type SettingsApplicationExecutor, type SettingsCommitted } from "./settings-command.js";
import { executeStartRun, readStartPlan, type RunConfigIdentity } from "./start-command.js";
import { requiresOcrForStart } from "../start/ocr-readiness.js";
import { executeWorkerPoolCommand, type WorkerPoolRuntimeAdoption, workerPoolSerializationKey } from "./worker-pool-commands.js";
import { executeWriteResolution, type WriteResolutionExecutor } from "./write-resolution-command.js";
import type { z } from "zod";
import "./command-arms.js";

export interface CommandAuthority {
  readonly evidenceSchemaHash?: EvidenceSchemaReader;
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
  /** Runs `publish` after the enclosing authority transaction commits; a rollback drops it. */
  afterAuthorityCommit?(publish: () => void): void;
}

export interface CommandKernelDependencies {
  readonly ensureReceipt?: (runId: string) => unknown;
  readonly workbookRows?: Readonly<{
    resolve(repositories: AuthorityRepositories, command: Extract<CommandRequest, { type: "resolve-workbook-row" }>): unknown;
    resolveReference?(repositories: AuthorityRepositories, command: Extract<CommandRequest, { type: "resolve-workbook-reference-row" }>, capturedAt: string): SchemaBoundCanonicalValue | Readonly<{ state: "pending" }>;
  }>;
  readonly preflight?: PreflightAdmission;
  readonly ocrProviderAvailable?: () => boolean;
  readonly prepareOcrProvider?: (signal: AbortSignal) => Promise<void>;
  readonly applicationQuitAvailable?: boolean;
  readonly authority: CommandAuthority;
  readonly lifecycle: RunRecordService;
  readonly clock: Clock;
  readonly ids: IdFactory;

  readonly appVersion: string;
  readonly descriptors: WorkflowDescriptorResolver;
  readonly readableDescriptors?: WorkflowDescriptorResolver;
  readonly writeResolution: WriteResolutionExecutor;
  readonly workerRuntime: WorkerPoolRuntimeAdoption;
  readonly intakeParser: IntakeParser;
  readonly intakeProjections: IntakeProjectionResolver;
  readonly configIdentity: RunConfigIdentity;
  /** The strict settings-file CAS executor. An active settings command cannot exist without it. */
  readonly settings?: SettingsApplicationExecutor;
  /** Hears each committed ordinary settings change; protected settings, refusals, rollbacks and replays emit nothing. */
  readonly settingsCommitted?: SettingsCommitted;
  readonly authorityProfileId?: string;
  readonly authorityInstallationId?: string;
  readonly prepareAssistantModelPreference?: (request: z.infer<typeof AssistantModelPreferenceCommandRequestSchema>) => Promise<() => true>;
  readonly assistantSurface?: () => readonly Readonly<{ method: string; path: string }>[];
  readonly workflowSources?: Readonly<Record<string, "served" | "hidden">>;
  /** The pinned assistant workflow facts; a change stales every outstanding assistant proposal. */
  readonly assistantFactsSha256?: () => string;
  readonly assistantRevalidate?: (command: CommandRequest) => void;
  readonly failureResolution?: Readonly<{execute:typeof executeFailureResolution}>;
  readonly commandNotices?: Pick<NotificationInbox, "record">;


}

export interface CommandKernel {
  assistantAvailability(): ReturnType<typeof commandAssistantAvailability>;
  assistantManifest(): z.infer<typeof AssistantActionManifestSchema>;
  execute(input: unknown, parentCommandId?: string): CommandResult;

  executeStart(input: unknown): Promise<CommandResult>;
  executeWorkerPool(input: unknown): Promise<CommandResult>;
  executeAssistantModelPreference(input: unknown): Promise<CommandResult>;
}

function dispatchActive(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: CommandRequest,
  now: string,
  auditId: string,
): CommandApplication {
  switch (request.family) {
    case "assistant-model-preference": {
      if (request.requestedBy !== "local-operator" || request.source.startsWith("assistant")
        || repositories.assistantAuthorization.actionByCommand(request.commandId) !== undefined
        || dependencies.authorityProfileId !== request.target.profileId) reject(request, "invalid-state", "assistant-preference-operator-only");
      const prior = repositories.assistantModelPreference.get();
      const revision = prior?.revision ?? 0;
      if (revision !== request.target.expectedRevision) conflict(request, revision, "assistant-preference-cas-conflict");
      const nextRevision = revision + 1;
      const target = { family: "assistant-model-preference" as const, profileId: request.target.profileId, revision: nextRevision };
      return { ...applied(request, [target], [{ target, before: revision, after: nextRevision }]), afterAudit: () => {
        repositories.assistantModelPreference.setByCommand({ format: 1, id: "current", profileId: request.target.profileId,
          revision: nextRevision, preference: request.payload, commandId: request.commandId, auditId, updatedAt: now });
      } };
    }
    case "failure-resolution": return (dependencies.failureResolution?.execute ?? executeFailureResolution)(repositories, request, now);
    case "workflow-batch": {
      const batch = repositories.runSessions.get(request.target.batchId);
      if (batch === undefined) reject(request, "target-not-found", "Workflow batch no longer exists.");
      if (batch.version !== request.target.expectedVersion) conflict(request, batch.version, "Batch presentation changed; reload and try again.");
      const updated = repositories.runSessions.setGrouping(batch.sessionId, batch.version, request.payload.groupInQueue);
      const target = { family: "workflow-batch", batchId: batch.sessionId };
      return applied(request, [target], [{ target, before: batch.version, after: updated.version }]);
    }
    case "application": {
      if (request.type === "pause-all-and-quit" && dependencies.applicationQuitAvailable !== true) reject(request, "capability-unavailable", "Application quit host is unavailable.");
      if (request.requestedBy !== "local-operator" || request.source !== "dashboard") reject(request, "policy-refused", "Application commands require the dashboard operator.");
      if (repositories.runtimeConfig.get()?.generation !== request.target.runtimeGeneration) reject(request, "runtime-stale", "Application runtime changed.");
      const active = repositories.runs.listNonTerminal();
      const targets = new Map(request.payload.targets.map(target => [target.runId, target.expectedVersion]));
      if (targets.size !== request.payload.targets.length
        || active.length !== request.payload.targets.length
        || active.some(run => targets.get(run.envelope.runId) !== run.version)) {
        reject(request, "policy-refused", "Active run membership changed; reload before pausing all.");
      }
      const changes: VersionChange[] = [];
      for (const run of active) {
        if (run.lifecycle.state === "parked-write") continue;
        const next = lifecycleRun(request, dependencies.lifecycle.pause({
          commandId: lifecycleCommandId("application-pause", { commandId: request.commandId, runId: run.envelope.runId }),
          runId: run.envelope.runId, expectedVersion: run.version,
        }));
        changes.push({ target: runTarget(run.envelope.runId), before: run.version, after: next.version });
      }
      return applied(request, [{ family: "application", runtimeGeneration: request.target.runtimeGeneration }], changes);
    }
    case "start":
      if (repositories.runs.admission().state !== "open") reject(request, "policy-refused", "Relay is pausing work to quit.");
      repositories.runtimeConfig.requireSettingsCurrent();
      return executeStartRun(dependencies, repositories, request, now);
    case "worker-browser":
      if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "resume-worker") {
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return reject(request, "capability-unavailable", "Worker commands require the current asynchronous process owner.");
    case "ocr-review": {
      if (request.requestedBy !== "local-operator" || request.source !== "dashboard") reject(request, "policy-refused", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
      const current = readOcrReviewAuthority(repositories, dependencies.lifecycle, request.target.runId);
      if (current === undefined) reject(request, "invalid-state", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
      const descriptors = dependencies.readableDescriptors ?? dependencies.descriptors;
      const descriptor = resolveDescriptorOrReject({ ...dependencies, descriptors }, request, current.run.envelope.workflow);
      requireDescriptorMatchesEnvelope(request, descriptor, current.run);
      if (readOcrSnapshotsAuthority(repositories, current).length > 0) throw new OcrReviewRefusedError();
      if (current.revision.revision !== request.target.expectedRevision) conflict(request, current.revision.revision, ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
      const revision = repositories.ocrReviews.append(reviseOcrReview(current.revision, request, now), current.revision.revision);
      const updated = lifecycleRun(request, dependencies.lifecycle.transition({
        commandId: lifecycleCommandId("operator-ocr-review", request.commandId), runId: request.target.runId,
        expectedVersion: current.run.version, ocrReviewRevision: revision.revision, sourceCommandId: request.commandId,
      }));
      const target: TargetReference = { family: "ocr-review", runId: request.target.runId };
      return applied(request, [target, runTarget(request.target.runId)], [{ target, before: current.revision.revision, after: revision.revision },
        { target: runTarget(request.target.runId), before: current.run.version, after: updated.version }]);
    }
    case "gate":
      return executeResolveGate(dependencies, repositories, request, now, "operator");
    case "run": {
      switch (request.type) {
        case "pause":
        case "resume": {
          const current = requireRun(repositories, request, request.target.runId);
          const resumeEvidence = request.type === "resume" ? captureDelegationResume(repositories, current.envelope.runId) : [];
          if (resumeEvidence === undefined) reject(request, "policy-refused", "Child retries must settle before resuming their parent.");
          const next = lifecycleRun(request, dependencies.lifecycle[request.type === "pause" ? "pause" : "resumePaused"]({
            commandId: request.type === "resume" ? delegationResumeCommandId(request.commandId, resumeEvidence)
              : lifecycleCommandId("operator-pause", request.commandId),
            ...request.target,
          }));
          return applied(request, [runTarget(next.envelope.runId)], [{ target: runTarget(next.envelope.runId), before: current.version, after: next.version }]);
        }
        case "retry":
          repositories.runtimeConfig.requireSettingsCurrent();
          return executeRetry(dependencies, repositories, request, now);
        // Stop on a run: a claimed run's fenced write finishes and settles once, then the tree ends cancelled.
        case "cancel": return executeCancel(dependencies, repositories, request, now, true);
        case "delete": return executeDelete(dependencies, repositories, request, now);
        case "bump": return executeBump(dependencies, repositories, request, now);
        case "rename": return executePresentation(dependencies, repositories, request, now);
        case "resolve-workbook-reference-row": {
          if (dependencies.workbookRows?.resolveReference === undefined) return reject(request, "capability-unavailable", "Workbook reference row choices are unavailable.");
          const result = dependencies.workbookRows.resolveReference(repositories, request, now);
          if ("state" in result) return applied(request, [{ family: "gate", runId: request.target.runId, gateId: request.target.gateId }, runTarget(request.target.runId)], []);
          return executeResolveGate(dependencies, repositories, {
            ...request, family: "gate", type: "resolve-gate",
            target: { runId: request.target.runId, expectedVersion: request.target.expectedVersion, gateId: request.target.gateId },
            payload: { result },
          }, now, "workbook-reference");
        }
        case "resolve-workbook-row": {
          requireRun(repositories, request, request.target.runId);
          if (dependencies.workbookRows === undefined) return reject(request, "capability-unavailable", "Workbook row choices are unavailable.");
          dependencies.workbookRows.resolve(repositories, request);
          return applied(request, [runTarget(request.target.runId)], []);
        }
        case "recheck-write":
        case "resolve-write-absent":
        case "fail-read-back":
          return executeWriteResolution(dependencies, repositories, request, now, auditId);
      }
      break;
    }
    case "notification":
      return executeNotification(repositories, request, now);
    case "intake":
      if (request.type === "enqueue-intake-manifest") {
        if (repositories.runs.admission().state !== "open") reject(request, "policy-refused", "Relay is pausing work to quit.");
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return executeIntake(dependencies, repositories, request, now);
    case "settings":
      return executeSettings(dependencies, repositories, request);
  }
  throw new Error("command dispatch fell through an exhaustive family/action switch");
}

export function createCommandKernel(dependencies: CommandKernelDependencies): CommandKernel {
  const availability = () => commandAssistantAvailability((family, action) => {
    if (family === "assistant-model-preference" || family === "application" || family === "run" && action === "recover-run") return false;
    if (family === "settings") return dependencies.settings !== undefined;
    if (family === "failure-resolution") return dependencies.failureResolution !== undefined;
    if (family === "start" || family === "intake") return dependencies.workflowSources !== undefined
      && Object.entries(dependencies.workflowSources).some(([id, source]) => source === "served" && dependencies.descriptors.resolve(id) !== undefined
        && (family !== "intake" || dependencies.intakeProjections.resolve(id) !== undefined));
    return true;
  });

  // Validated ONCE at composition: a dependency satisfying both seams is a
  // wiring ambiguity, refused before any command can reach it.
  const pool = dependencies.workerRuntime.pool;
  // Serialize admission, asynchronous effects and settlement for each command target.
  const commandTails = new Map<string, Promise<void>>();
  const withCommandSerialization = async (
    key: string,
    work: () => Promise<CommandResult>,
  ): Promise<CommandResult> => {
    const previous = commandTails.get(key);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    commandTails.set(key, current);
    if (previous !== undefined) await previous;
    try {
      return await work();
    } finally {
      if (commandTails.get(key) === current) commandTails.delete(key);
      release();
    }
  };
  const admitCommand = (request: CommandRequest, parentCommandId?: string, preferenceCurrent?: () => true): CommandResult | undefined => {
    return dependencies.authority.withAuthorityTransaction((repositories) => {
      preferenceCurrent?.();
      if (request.family === "assistant-model-preference" && (request.requestedBy !== "local-operator"
        || request.source.startsWith("assistant") || dependencies.authorityProfileId !== request.target.profileId
        || repositories.assistantAuthorization.actionByCommand(request.commandId) !== undefined)) {
        reject(request, "invalid-state", "assistant-preference-operator-only");
      }
      repositories.commands.assertIdentity(request, parentCommandId);
      repositories.commands.insert(request, parentCommandId);
      if (repositories.commandAudits.findByCommand(request.commandId) === undefined) return undefined;
      if (request.family === "assistant-model-preference") repositories.assistantModelPreference.get();
      return replay(dependencies, repositories, request, IsoInstantSchema.parse(dependencies.clock.now().toISOString()));
    });
  };
  const failCommand = (error: unknown, request: CommandRequest, admitted: boolean, parentCommandId?: string): CommandResult => {
    if (error instanceof CommandIdentityConflictError) return CommandResultSchema.parse({
      state: "rejected", commandId: request.commandId, code: "command-divergent", message: error.message,
    });
    const refusal = error instanceof PreflightAdmissionRefusal ? CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: request.family !== "start" ? "capability-unavailable"
      : preflightRunnerTimeout(error) !== undefined ? "PREFLIGHT_TIMEOUT"
      : error instanceof PreflightEvidenceExpiredError ? "PREFLIGHT_EVIDENCE_EXPIRED"
      : error.reason === "observation-changed" || error.reason === "stale" ? "RUN_START_READINESS_CHANGED"
      : error.reason === "blocked" ? "RUN_START_READINESS_BLOCKED" : "RUN_START_READINESS_UNAVAILABLE", message: error.message })
      : error instanceof CommandRefusal ? error.result
      : error instanceof OcrReviewRefusedError ? CommandResultSchema.parse({ state: "rejected", commandId: request.commandId,
        code: error.code, message: ERROR_CATALOG.OCR_REVIEW_REFUSED.text })
      : undefined;
    // A failure during admission or replay leaves no row of this call to settle.
    if (!admitted) {
      if (refusal !== undefined) return refusal;
      throw error;
    }
    try {
      settleUnsettled(request, refusal ?? (parentCommandId === undefined ? undefined
        : CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "bulk-child-errored", message: ERROR_CATALOG.BULK_CHILD_ERRORED.text })),
      parentCommandId);
    } catch (settlementError) {
      throw new AggregateError([error, settlementError], `command ${request.commandId} failed and its outcome could not be recorded`, { cause: settlementError });
    }
    if (refusal !== undefined) return refusal;
    throw error;
  };
  const applyCommand = (request: CommandRequest, parentCommandId?: string, preferenceCurrent?: () => true): CommandResult => {
    let rollback: (() => void) | undefined;
    let commit: (() => void) | undefined;
    try {
      const result = dependencies.authority.withAuthorityTransaction((repositories) => {
        preferenceCurrent?.();
        const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
        const journalRequest = request;
        const auditId = dependencies.ids.uuid();
        const application = request.family === "ocr-review" || request.family === "start" || request.family === "run" && (request.type === "retry" || request.type === "cancel" || request.type === "resume")
          ? withCanonicalRunCommandScope(repositories, request,
            () => dispatchActive(dependencies, repositories, request, now, auditId), parentCommandId)
          : dispatchActive(dependencies, repositories, request, now, auditId);
        rollback = application.rollback;
        commit = application.commit;
        repositories.commandAudits.insert({
          auditId,
          request: journalRequest,
          result: application.result,
          completedAt: now,
          versionChanges: application.versionChanges,
          affectedDependencyIds: application.affectedDependencyIds,
          ...(application.writeResolution === undefined ? {} : {writeResolution:application.writeResolution}),
        });
        preferenceCurrent?.();
        application.afterAudit?.();
        if (application.settingsCurrent !== undefined) {
          repositories.settingsCurrent.advance({
            ...application.settingsCurrent,
            commandId: request.commandId,
            auditId,
            committedAt: now,
          });
        }
        return request.family === "notification" ? CommandResultSchema.parse({
          ...application.result,
          notificationReceipt: notificationCommandReceipt(request, application.versionChanges, now),
        }) : application.result;
      });
      const committedSettings = commit;
      rollback = undefined;
      commit = undefined;
      committedSettings?.();
      return result;
    } catch (error) {
      if (rollback !== undefined) {
        try {
          rollback();
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `command ${request.commandId} failed and its settings-file rollback also failed`,
            { cause: rollbackError },
          );
        }
      }
      return failCommand(error, request, true, parentCommandId);
    }
  };
  const executeSync = (request: CommandRequest, parentCommandId?: string, preferenceCurrent?: () => true): CommandResult => {
    if (request.family === "assistant-model-preference" && preferenceCurrent === undefined) return CommandResultSchema.parse({
      state: "rejected", commandId: request.commandId, code: "capability-unavailable", message: "assistant-preference-unavailable",
    });
    if (parentCommandId !== undefined && request.family !== "run") throw new Error("command-group children must be run commands");
    if (request.family === "settings") return executeSettingsCommand(dependencies, request);
    try {
      const replayed = admitCommand(request, parentCommandId, preferenceCurrent);
      if (replayed !== undefined) return replayed;
    } catch (error) {
      return failCommand(error, request, false, parentCommandId);
    }
    return applyCommand(request, parentCommandId, preferenceCurrent);
  };
  /** An admitted command settles with its typed refusal, or stays admitted with a recovery notice when its outcome is unknown. */
  const settleUnsettled = (request: CommandRequest, result: CommandResult | undefined, parentCommandId: string | undefined): void => {
    dependencies.authority.withAuthorityTransaction((repositories) => {
      if (!isAdmittedUnsettled(repositories, request)) return;
      if (result !== undefined) repositories.commandAudits.insert({ auditId: dependencies.ids.uuid(), request, result,
        completedAt: IsoInstantSchema.parse(dependencies.clock.now().toISOString()), versionChanges: [], affectedDependencyIds: [] });
      // A bulk child is reported in its batch notice; notification commands correct themselves on the next read.
      if (parentCommandId !== undefined || request.family === "notification" || dependencies.commandNotices === undefined) return;
      if (result === undefined) dependencies.commandNotices.record({ kind: "command-unknown", commandId: request.commandId });
      else if (result.state === "rejected" || result.state === "conflict") {
        dependencies.commandNotices.record({ kind: "command-refused", commandId: request.commandId, outcome: result.state });
      }
    });
  };
  return Object.freeze({
    assistantAvailability: availability,
    assistantManifest() {
      const entries = availability().filter(entry => entry.availability !== "unavailable" && (
        entry.family === "notification" || entry.family === "workflow-batch"
        || entry.family === "start" && dependencies.assistantRevalidate !== undefined
        || entry.family === "settings" && entry.action !== "apply-protected-settings"
        || entry.family === "worker-browser" && entry.action === "spawn-worker" && dependencies.assistantRevalidate !== undefined
        || entry.family === "run" && (entry.action === "pause" || entry.action === "resume" || entry.action === "cancel") && dependencies.assistantRevalidate !== undefined
      )).map(entry => ({ family: entry.family, action: entry.action, classification: entry.classification, subject: entry.family === "start" ? "classified" as const : "none" as const }));
      const identity = { commands: availability(), schema: deriveSchemaHash(CommandRequestSchema, "input"),
        surface: dependencies.assistantSurface?.() ?? null,
        knowledge: dependencies.assistantFactsSha256?.() ?? null,
        workflows: dependencies.workflowSources === undefined ? null : Object.entries(dependencies.workflowSources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
      const revision = Number.parseInt(sha256Hex(canonicalJsonStringify(identity)).slice(0, 12), 16) + 1;
      return AssistantActionManifestSchema.parse({ revision, entries });
    },
    execute(input: unknown, parentCommandId?: string): CommandResult {
      const request = CommandAdmissionRequestSchema.parse(input);
      if (request.family === "assistant-model-preference") {
        if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("Command request exceeds 256 KiB");
        return executeSync(request, parentCommandId);
      }
      dependencies.assistantRevalidate?.(request);
  if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
      return executeSync(request, parentCommandId);
    },
    async executeStart(input: unknown): Promise<CommandResult> {
      const request = StartCommandRequestSchema.parse(input);
      if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
      return withCommandSerialization(`start:${request.target.startPlanId}`, async () => {
        let admitted = false;
        const assertEffectCurrent = (): true => { dependencies.assistantRevalidate?.(request); return true; };
        try {
          assertEffectCurrent();
          const replayed = admitCommand(request, undefined, assertEffectCurrent);
          if (replayed !== undefined) return replayed;
          admitted = true;
          const { scope, needsOcr } = dependencies.authority.withAuthorityTransaction(repositories => {
            const { descriptor, plan } = readStartPlan(dependencies, repositories, request, dependencies.clock.now().toISOString());
            return { scope: workflowPreflightScope(descriptor, plan), needsOcr: dependencies.prepareOcrProvider !== undefined
              && requiresOcrForStart(repositories, descriptor, plan) };
          });
          if (dependencies.preflight !== undefined) {
            try {
              await dependencies.preflight.prepare(scope, new AbortController().signal);
            } catch (error) {
              if (error instanceof PreflightAdmissionRefusal) throw error;
              throw new PreflightAdmissionRefusal("unavailable", "Preflight detectors could not verify readiness.", { cause: error });
            }
            dependencies.preflight.assertReady(scope);
          }
          if (needsOcr) await dependencies.prepareOcrProvider?.(new AbortController().signal);
        } catch (error) {
          return failCommand(error, request, admitted);
        }
        return applyCommand(request, undefined, assertEffectCurrent);
      });
    },
    async executeAssistantModelPreference(input: unknown): Promise<CommandResult> {
      const request = AssistantModelPreferenceCommandRequestSchema.parse(input);
      if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("Command request exceeds 256 KiB");
      if (request.requestedBy !== "local-operator" || request.source.startsWith("assistant")
        || dependencies.authorityProfileId !== request.target.profileId || dependencies.prepareAssistantModelPreference === undefined) return CommandResultSchema.parse({
          state: "rejected", commandId: request.commandId, code: "capability-unavailable", message: "assistant-preference-unavailable",
        });
      const current = await dependencies.prepareAssistantModelPreference(request);
      const assertCurrent = (): true => {
        const value: unknown = current();
        if (value instanceof Promise) void value.catch(() => {});
        if (value !== true) throw new Error("assistant-model-preference-authority-not-current");
        return true;
      };
      assertCurrent();
      const result = executeSync(request, undefined, assertCurrent);
      try { assertCurrent(); }
      catch (error) {
        if (result.state === "applied" || result.state === "already-applied") {
          throw new Error("assistant-model-preference-committed-currentness-unproved", { cause: error });
        }
        throw error;
      }
      return result;
    },
    async executeWorkerPool(input: unknown): Promise<CommandResult> {
      const request = CommandAdmissionRequestSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
      if (request.family !== "worker-browser") {
        throw new Error(
          `executeWorkerPool settles only worker-browser commands; received ${request.family}/${request.type}`,
        );
      }
      try {
        dependencies.assistantRevalidate?.(request);
        return await withCommandSerialization(
          `pool:${workerPoolSerializationKey(request)}`,
          () => {
            dependencies.assistantRevalidate?.(request);
            return executeWorkerPoolCommand(dependencies, pool, request);
          },
        );
      } catch (error) {
        // Typed admission and settlement refusals return results; process-effect failures remain structured throws.
        if (error instanceof CommandIdentityConflictError) return CommandResultSchema.parse({
          state: "rejected", commandId: request.commandId, code: "command-divergent", message: error.message,
        });
        if (error instanceof CommandRefusal) return error.result;
        throw error;
      }
    },
  });
}
