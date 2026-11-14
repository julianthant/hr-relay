import { ReadApprovedOcrRecord } from "../../../models/processing/ocr/read-approved-record.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { RunClaimToken } from "../../../models/run/worker.js";
import { z } from "zod";
import { RunHistoryCommandSchema, type ClearRunHistoryResult, type RunHistoryStatus } from "../../../models/dashboard/run-history.js";
import {
RunExistenceSchema,
type RunExistence,
type RunRecordRefusal,
} from "../../../models/config/authority.js";
import type { RuntimeConfigClaimToken } from "../../../models/config/runtime-generation.js";
import type { DeletedRunRecord } from "../../../models/run/deleted-run.js";
import { nextAttemptEnvelope } from "../../../models/run/envelope.js";
import { runClaim,RunRecordSchema,runTransitionViolation,type RunRecord } from "../../../models/run/record.js";
import { interruptTransition, pendingInterruptOf } from "../../../rules/runs/run-interrupt.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { CanonicalCrashRecoveryRequestSchema } from "../../../models/run/worker.js";
import type { DelegationPlan } from "../../../models/workflow/delegation.js";
import type { AnyWorkflowRef } from "../../../models/workflow/graph.js";
import { retainedRunProtectedBindings,valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import {
RunLifecycleCommandAuditRecordSchema,
RunLifecycleCommandFenceSchema,
RunLifecycleCommandRecordSchema,
type RunLifecycleCommandOperationSchema,
} from "../../../rules/commands/commands.js";
import { deriveItemId,deriveTraceId,lifecycleCommandId,type IdFactory } from "../../../rules/identity/identifiers.js";
import {
CommandIdSchema,
FingerprintSchema,
NodeIdSchema,
RunIdSchema,
type Fingerprint,
} from "../../../rules/identity/ids.js";
import type { Clock } from "../../../rules/time/clock.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { createNoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";
import { taskSpanPath } from "../../logs/span-emitter.js";
import { authenticateParkedWriteRecheck,authenticateParkedWriteResolution } from "../../../rules/write-safety/parked-resolution.js";
import { deriveWriteAuthorityReason } from "../../../rules/write-safety/write-safety.js";
import { authorizeWorkflowDelegationRefresh, workflowDelegationAccounting, descriptorRuntimeNodes,workflowPlanning,type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import type { ChildRunBatchContext } from "../../runtime/execution/run-executor.js";
import { RuntimeLifetimeLock } from "../../storage/admission/lifetime-lock.js";
import type { AuthorityDatabase,AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { assertCanonicalRunCommandScope } from "../../storage/sqlite/command-record-row.js";
import { authenticateCancellationSource,authenticateDelegationResume,captureDelegationResume,prepareDelegationRetry,assertDelegationRetryUnwritten } from "../../storage/sqlite/delegation-authority.js";
import { DelegationRetryRequestSchema } from "../../storage/sqlite/delegation-contracts.js";
import { RunDeletionRefusedError } from "../../storage/sqlite/native-run-deletion.js";
import { continuationDelegationGroups } from "../../storage/sqlite/run-continuation-delegation.js";
import { captureRunContinuation,RunContinuationRefusedError,validateRunContinuation,continuationEvidenceDigest } from "../../storage/sqlite/run-continuation.js";
import {
ApplicationAdmissionRefusedError,
CanonicalAcknowledgePauseRequestSchema,
CanonicalCancellationTerminalizeRequestSchema,
CanonicalClaimNextRequestSchema,
CanonicalCreateRunRequestSchema,
CanonicalDeleteRequestSchema,
CanonicalFailureTerminalizeRequestSchema,
CanonicalListRunsRequestSchema,
CanonicalPauseRequestSchema,
CanonicalPurgeRequestSchema,
CanonicalRecoverRunRequestSchema,
CanonicalRenewClaimRequestSchema,
CanonicalRequeueRequestSchema,
CanonicalRetrySourceRequestSchema,
CanonicalSuccessTerminalizeRequestSchema,
CanonicalTerminalizeRequestSchema,
CanonicalTransitionRequestSchema,
CanonicalWorkerTransitionRequestSchema,
CanonicalWriteResolutionTransitionRequestSchema,
} from "../../storage/sqlite/run-store-contracts.js";
import { runSettingsAvailable,selectNewRunIdentity,selectRunRuntime } from "../settings/run-settings.js";
import { protectedSubjectDisplay } from "../start/protected-input.js";
import { assertRunRecoveryCommandScope,planDelegatedRetry,planRunRecovery } from "../start/recovery-plan.js";
import { authenticateWorkbookReferenceExecution } from "../workbooks.js";
import { admitDelegation } from "./delegation-admission.js";
import { assertOcrChildRetryCurrent,assertOcrRecoverySnapshotCurrent } from "./ocr-review-authority.js";
import { delegatedCandidateEligible,runRuntimeMatches } from "./run-claim-admission.js";
import { currentBuildId } from "../../runtime/build-id.js";

const TERMINAL_SELF_EDGE_REFUSAL = "terminal has no self-edge; a settled outcome is settled";

/** Identity and counters are minted inside the service's create transaction. */
export const CreateRunRequestSchema = CanonicalCreateRunRequestSchema;
export type CreateRunRequest = z.input<typeof CreateRunRequestSchema>;

export type RelatedRunChange = Readonly<{ runId: RunRecord["envelope"]["runId"]; before: number; after: number }>;

export type RunMutationOutcome =
  | Readonly<{ state: "applied" | "applied-already"; run: RunRecord; relatedRunChanges?: readonly RelatedRunChange[] }>
  | Readonly<{ state: "applied-already"; tombstone: DeletedRunRecord; appliedVersion: number }>
  | Readonly<{ state: "refused"; refusal: RunRecordRefusal }>;

export type RunDeletionOutcome =
  | Readonly<{ state: "deleted"; tombstones: readonly DeletedRunRecord[] }>
  | Readonly<{ state: "applied-already"; tombstones: readonly DeletedRunRecord[] }>
  | Readonly<{ state: "refused"; refusal: RunRecordRefusal }>
  | RunExistence;

export type RunPurgeOutcome =
  | Readonly<{ state: "purged" | "applied-already"; evidenceClass: "diagnostic-bundle"; purged: number }>
  | Readonly<{ state: "refused"; refusal: RunRecordRefusal }>;

/** Worker capability never includes command-family transition. */
export type WorkerRunLifecyclePort = Pick<RunRecordService,
  "claimNext" | "renewClaim" | "workerTransition" | "acknowledgePause" | "terminalize" | "requeue" | "admitDelegation" | "assertCurrentExecution" | "delegationRetryExecution">;

export interface RunContinuationPort {
  transition(input: z.input<typeof CanonicalWriteResolutionTransitionRequestSchema>): RunMutationOutcome | RunExistence;
}

export function workerRunLifecyclePort(service: RunRecordService): WorkerRunLifecyclePort {
  return Object.freeze({
    acknowledgePause: service.acknowledgePause.bind(service),
    claimNext: service.claimNext.bind(service), renewClaim: service.renewClaim.bind(service),
    workerTransition: service.workerTransition.bind(service), terminalize: service.terminalize.bind(service),
    requeue: service.requeue.bind(service),
    admitDelegation: service.admitDelegation.bind(service),
    assertCurrentExecution: service.assertCurrentExecution.bind(service),
    delegationRetryExecution: service.delegationRetryExecution.bind(service),
  });
}

export function runContinuationPort(service: RunRecordService): RunContinuationPort {
  return Object.freeze({ transition: (input: z.input<typeof CanonicalWriteResolutionTransitionRequestSchema>) =>
    service.transition(CanonicalWriteResolutionTransitionRequestSchema.parse(input)) });
}

export { lifecycleCommandId } from "../../../rules/identity/identifiers.js";

export class RunLifecycleRefusedError extends Error {
  constructor(readonly outcome: RunMutationOutcome | RunExistence) {
    super(`run lifecycle ${outcome.state === "refused" ? outcome.refusal.reason : outcome.state}`);
    this.name = "RunLifecycleRefusedError";
  }
}

export function requireLifecycleApplied(outcome: RunMutationOutcome | RunExistence): RunRecord {
  if ((outcome.state === "applied" || outcome.state === "applied-already") && "run" in outcome) return outcome.run;
  throw new RunLifecycleRefusedError(outcome);
}

export type RunRecoveryOutcome = RunMutationOutcome | RunExistence | Readonly<{
  state: "recovery-required"; run: RunRecord; writeIntentId: string; intentGeneration: number;
  parked: boolean; message: string;
}>;

type LifecycleOperation = z.infer<typeof RunLifecycleCommandOperationSchema>;
type LifecycleFence = z.input<typeof RunLifecycleCommandFenceSchema>;
type LifecycleJournalInspection =
  | Readonly<{ state: "new"; command: z.infer<typeof RunLifecycleCommandRecordSchema> }>
  | Readonly<{ state: "divergent" }>
  | Readonly<{
      state: "replay";
      command: z.infer<typeof RunLifecycleCommandRecordSchema>;
      result: z.infer<typeof RunLifecycleCommandAuditRecordSchema>["result"];
    }>;

export interface RunQueuedPublication { readonly title: string; readonly subtitle?: string; readonly actorId: string; }

export type RunRecordServiceDependencies = Readonly<{
  database: AuthorityDatabase;
  clock: Clock;
  ids: IdFactory;
  lifecycleEventProcessId?: number;
  /** Composition supplies the shared runQueuedSpanEvent builder and emitter. */
  publishQueued: (run: RunRecord, publication?: RunQueuedPublication) => void;
  /** Synchronous readiness assertion; runs after replay, before enqueue. */
  admitQueuedRun?: (run: RunRecord) => void;
  resolveDescriptor?: (workflowId: string) => AnyWorkflowDescriptor | undefined;
}>;


export class RunRecordService {
  constructor(
    private readonly dependencies: RunRecordServiceDependencies,
    private readonly hooks?: Readonly<{ afterCreateReservation?: () => void }>,
  ) {}

  read(input: string): RunExistence {
    const runId = RunIdSchema.parse(input);
    return this.dependencies.database.withAuthorityReadSnapshot(() => {
      const { runs, deletedRuns } = this.dependencies.database.authority;
      const tombstone = deletedRuns.get(runId);
      const run = runs.get(runId);
      if (tombstone !== undefined && run !== undefined) throw new Error(`run ${runId} has both lifecycle authority and a tombstone`);
      if (tombstone !== undefined) return RunExistenceSchema.parse({ state: "deleted", tombstone });
      if (run === undefined) return RunExistenceSchema.parse({ state: "absent", runId });
      return RunExistenceSchema.parse({ state: "present", run, disposition: "live" });
    });
  }

  /** Selected roots and direct children remain in one authority read transaction. */
  withRunTreeSnapshot<Result>(runIds: readonly string[], read: (runs: readonly RunRecord[]) => Result): Result {
    return this.dependencies.database.withAuthorityReadSnapshot(() => {
      const selected = new Map<string, RunRecord>();
      for (const input of new Set(runIds)) {
        const root = this.read(input);
        if (root.state !== "present" || root.disposition !== "live") throw new Error(`run ${input} has no live canonical row: run-tree-source-unavailable`);
        selected.set(root.run.envelope.runId, root.run);
        for (const child of this.dependencies.database.authority.runs.listChildren(root.run.envelope.runId)) {
          const current = this.read(child.envelope.runId);
          if (current.state !== "present" || current.disposition !== "live") throw new Error("run-tree-child-unavailable");
          selected.set(current.run.envelope.runId, current.run);
        }
      }
      return read([...selected.values()]);
    });
  }

  list(input: z.input<typeof CanonicalListRunsRequestSchema>) {
    const request = CanonicalListRunsRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityReadSnapshot(() => {
      const database = this.dependencies.database;
      const generation = database.getMeta().authorityGeneration;
      const cursor = request.cursor;
      if (cursor !== undefined && (cursor.generation !== generation
        || cursor.workflow !== request.workflow || cursor.disposition !== request.disposition)) {
        return { state: "refused" as const, refusal: { reason: "cursor-stale" as const } };
      }
      const offset = cursor === undefined ? 0 : cursor.offset;
      const rows = database.authority.runs.listPage({ offset, limit: request.limit + 1,
        ...(request.workflow === undefined ? {} : { workflow: request.workflow }) });
      const page = rows.slice(0, request.limit);
      return {
        state: "listed" as const,
        rows: page,
        ...(rows.length <= request.limit ? {} : {
          cursor: { generation, offset: offset + page.length, disposition: request.disposition,
            ...(request.workflow === undefined ? {} : { workflow: request.workflow }) },
        }),
      };
    });
  }

  create(input: CreateRunRequest, publication?: RunQueuedPublication): RunMutationOutcome {
    const request = CreateRunRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction(repositories => {
      const journal = this.inspectJournal(repositories, "create", request, { kind: "none" });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      if (request.parent !== undefined) {
        const parent = this.read(request.parent.runId);
        if (parent.state !== "present" || parent.run.envelope.workflow !== request.workflow) return refused({ reason: "parent-missing" });
      }
      return this.createCanonical(request, publication);
    });
  }

  assertCurrentExecution(input: unknown): void {
    try { this.dependencies.database.assertCurrentExecution(input); }
    catch (error) {
      if (error instanceof WorkerControlRefusal && error.message === "worker-execution-lost") throw new RunLifecycleRefusedError(refused({ reason: "lost" }));
      throw error;
    }
  }

  delegationRetryExecution(input: Readonly<{ runId: string; claim: RunClaimToken }>) {
    return this.dependencies.database.withAuthorityTransaction(repositories => {
      this.assertCurrentExecution(input);
      const run = repositories.runs.get(input.runId);
      if (run === undefined) throw new RunContinuationRefusedError("run-continuation-authority-unavailable");
      if (run.envelope.parent === undefined || run.envelope.retryOf === undefined || run.envelope.continuation === undefined) return;
      validateRunContinuation(repositories, run.envelope);
      const parent = repositories.runs.get(run.envelope.parent.runId);
      if (parent === undefined) throw new RunContinuationRefusedError("run-continuation-delegation-owner-mismatch");
      const authorization = this.parentRefreshAuthorization(repositories, run);
      const plan = authorization === undefined ? undefined : workflowDelegationAccounting(authorization, parent);
      if (plan === undefined) return;
      const approved = descriptorRuntimeNodes(plan.target).filter(node => node.kind === "task" && node.uses.id === ReadApprovedOcrRecord.id);
      if (approved.length === 0) return;
      const node = approved[0];
      if (approved.length !== 1 || node?.kind !== "task") throw new RunContinuationRefusedError("delegation-accounting-scope-unavailable");
      const selected = repositories.dependencies.groups(parent.envelope.runId).flatMap(({ group }) =>
        group.children.filter(member => member.child.envelope.runId === run.envelope.runId).map(member => ({ group, member })));
      const bound = selected[0];
      if (selected.length !== 1 || bound === undefined || bound.member.attempt !== "retry"
        || bound.member.history.at(-2) !== run.envelope.retryOf || bound.group.invocation.nodeId !== plan.joinNodeId
        || plan.target.id !== run.envelope.workflow || plan.target.version !== run.envelope.descriptorVersion
        || plan.target.contractFingerprint !== run.envelope.contractFingerprint)
        throw new RunContinuationRefusedError("run-continuation-delegation-owner-mismatch");
      const command = repositories.lifecycleJournal.getCommand(lifecycleCommandId("delegation-retry", {
        dependencyId: bound.member.dependency.dependencyId, previousRunId: run.envelope.retryOf }));
      if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-retry")
        throw new RunContinuationRefusedError("run-continuation-delegation-owner-mismatch");
      const retry = DelegationRetryRequestSchema.parse(command.request), source = repositories.commands.get(retry.sourceCommandId);
      if (retry.continuationOwner !== undefined || source?.family !== "run" || source.type !== "retry") return;
      const reference = run.envelope.continuation.checkpoints.find(row => row.nodeId === node.id);
      if (reference === undefined) return;
      const retained = repositories.runCheckpoints.get(run.envelope.workflow, run.envelope.itemId,
        node.id, reference.attempt, reference.claimGeneration);
      if (retained === undefined || retained.runId !== reference.runId || continuationEvidenceDigest(retained) !== reference.digest)
        throw new RunContinuationRefusedError("delegation-accounting-upstream-checkpoint-unavailable");
      if (repositories.runCheckpoints.listByAttempt(run.envelope.workflow, run.envelope.itemId, node.id, run.envelope.attempt)
        .some(record => record.runId === run.envelope.runId)) return;
      const previous = repositories.runs.get(run.envelope.retryOf);
      if (previous === undefined) throw new RunContinuationRefusedError("run-continuation-delegation-owner-mismatch");
      assertDelegationRetryUnwritten(repositories, previous, plan.target);
      return Object.freeze({ nodeId: node.id, assertRetained: (output: RunCheckpointRecord["output"]) => {
        this.assertCurrentExecution(input);
        if (canonicalJsonStringify(output) !== canonicalJsonStringify(retained.output))
          throw new RunContinuationRefusedError("delegation-accounting-upstream-checkpoint-changed");
      } });
    });
  }

  admitDelegation(context: ChildRunBatchContext, plans: readonly DelegationPlan<AnyWorkflowRef>[]) {
    return this.dependencies.database.withAuthorityTransaction(() => {
      this.assertCurrentExecution({ runId: context.run.envelope.runId, claim: context.claim });
      return admitDelegation(this.dependencies, context, plans, {
      create: (request, publication) => requireLifecycleApplied(this.createCanonical(request, publication, "retained")),
      inspectJournal: (repositories, operation, request, fence) => this.inspectJournal(repositories, operation, request, fence),
      recordJournal: (repositories, command, result) => this.recordJournal(repositories, command, result),
      release: request => this.requeue(request),
      });
    });
  }

  private createCanonical(input: CreateRunRequest, publication?: RunQueuedPublication, configSelection: "active" | "retained" = "active"): RunMutationOutcome {
    const request = CreateRunRequestSchema.parse(input);
    const outcome = this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "create", request, { kind: "none" });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      if (repositories.runs.admission().state !== "open") return refused({ reason: "policy-refused" });
      if (!this.runtimeMatches(request.runtimeConfig)) return refused({ reason: "runtime-stale" });
      if (!runSettingsAvailable(repositories, request)) return refused({ reason: "runtime-stale" });
      const runId = RunIdSchema.parse(this.dependencies.ids.uuid());
      if (repositories.deletedRuns.get(runId) !== undefined) return refused({ reason: "tombstoned" });
      if (repositories.runs.get(runId) !== undefined) return refused({ reason: "identity-conflict", field: "runId" });
      const itemId = deriveItemId(request.workflow, request.matchKey);
      if (request.retryOf !== undefined) {
        const source = this.read(request.retryOf);
        if (source.state !== "present" || source.run.envelope.workflow !== request.workflow
          || source.run.envelope.itemId !== itemId) return refused({ reason: "retry-of-missing" });
      }
      if (request.sessionId !== undefined) {
        const session = repositories.runSessions.get(request.sessionId);
        if (session === undefined || session.workflow !== request.workflow) {
          return refused({ reason: "identity-conflict", field: "sessionId" });
        }
      }
      const now = this.dependencies.clock.now().toISOString();
      const { commandId, code, matchKey, runtimeConfig, input: storedInput, sessionId, appVersion, ...envelope } = request;
      // These inputs govern admission/minting and are never copied into the envelope.
      void commandId; void matchKey; void runtimeConfig;
      const run = RunRecordSchema.parse({
        envelope: {
          ...(configSelection === "retained" ? envelope : selectNewRunIdentity(repositories, envelope)),
          runId, itemId, traceId: deriveTraceId(code, runId, this.dependencies.clock),
          buildId: approvalBuildId(repositories, envelope.parent),
          attempt: repositories.runs.nextItemAttempt({ workflow: request.workflow, itemId }),
          enqueuedAt: now,
        },
        input: storedInput, lifecycle: { state: "queued" }, claimGeneration: 0,
        runNumber: repositories.runs.nextWorkflowRunNumber(request.workflow),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(appVersion === undefined ? {} : { appVersion }),
        version: 1, createdAt: now, updatedAt: now,
      });
      this.hooks?.afterCreateReservation?.();
      this.dependencies.admitQueuedRun?.(run);
      repositories.runs.enqueue(run);
      this.recordJournal(repositories, journal.command, journalRun(run));
      this.dependencies.publishQueued(run, publication);
      return { state: "applied", run };
    });
    return outcome;
  }

  claimNext(input: unknown, admit?: (run: RunRecord) => void): RunMutationOutcome {
    const raw = z.record(z.string(), z.unknown()).parse(input);
    if (raw.runtimeConfig === undefined) return refused({ reason: "runtime-stale" });
    const request = CanonicalClaimNextRequestSchema.parse(input);
    const { workflow, workerId, runtimeConfig } = request;
    return this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "claim-next", request, { kind: "none" });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (!this.runtimeMatches(runtimeConfig)) return refused({ reason: "runtime-stale" });
      const slot = repositories.workerSlots.get(workerId);
      if (slot === undefined || slot.retiredAt !== null || slot.workflow !== workflow || slot.paused) return refused({ reason: "none-eligible" });
      if (journal.state === "replay") {
        const replayed = this.replayRun(journal.result);
        if (replayed.state !== "refused" && "run" in replayed && "workerId" in replayed.run.lifecycle
          && replayed.run.lifecycle.workerId !== workerId) return refused({ reason: "none-eligible" });
        return replayed;
      }
      const held = repositories.runs.listByWorker(workerId).find((run) => runClaim(run) !== undefined);
      if (held !== undefined) return refused({ reason: "worker-busy", runId: held.envelope.runId });
      const outcome = repositories.runs.claimEligible({
        workflow, workerId, runtimeConfig, configFingerprint: runtimeConfig.configFingerprint,
        now: this.dependencies.clock.now().toISOString(),
      }, admit, run => delegatedCandidateEligible(repositories, run, workflow, this.dependencies.resolveDescriptor));
      if (outcome.state === "refused") return outcome;
      if (outcome.state === "idle") return refused({ reason: "none-eligible" });
      if (outcome.state === "deferred") return refused({ reason: "none-eligible", notBefore: outcome.nextEligibleAt });
      this.recordJournal(repositories, journal.command, journalRun(outcome.run));
      return { state: "applied", run: outcome.run };
    });
  }

  transition(input: unknown): RunMutationOutcome | RunExistence {
    const request = CanonicalTransitionRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction((repositories) => {
      const journal = this.inspectJournal(repositories, "transition", request, {
        kind: "version",
        expectedVersion: request.expectedVersion,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const current = this.read(request.runId);
      if (current.state !== "present") return current;
      if (current.run.version !== request.expectedVersion) {
        return refused({ reason: "conflict", currentVersion: current.run.version });
      }
      if ("ocrReviewRevision" in request) {
        const source = repositories.commands.get(request.sourceCommandId);
        const revision = repositories.ocrReviews.latest(request.runId);
        if (source?.family !== "ocr-review" || source.requestedBy !== "local-operator" || source.source !== "dashboard"
          || source.target.runId !== request.runId || request.commandId !== lifecycleCommandId("operator-ocr-review", source.commandId)
          || source.target.expectedRevision + 1 !== request.ocrReviewRevision || revision?.revision !== request.ocrReviewRevision
          || revision.origin.kind !== "command" || revision.origin.commandId !== source.commandId
          || current.run.envelope.workflow !== "ocr") throw new OcrReviewRefusedError();
        assertCanonicalRunCommandScope(repositories, source);
        if (runClaim(current.run) !== undefined || current.run.lifecycle.state === "parked-write"
          || current.run.lifecycle.state === "queued" && current.run.delegationRefresh !== undefined
            && repositories.gateResults.get(`${request.runId}:approve-records`) === undefined
          || current.run.lifecycle.state === "terminal" && ["cancelled", "discarded", "superseded"].includes(current.run.lifecycle.outcome)) return refused({ reason: "invalid-state" });
        const result = repositories.runs.advanceRevision({ runId: request.runId, expectedVersion: request.expectedVersion,
          now: this.dependencies.clock.now().toISOString() });
        if (result.state === "conflict") return refused({ reason: "conflict", currentVersion: result.currentVersion });
        this.recordJournal(repositories, journal.command, journalRun(result.run), current.run.lifecycle);
        return { state: "applied" as const, run: result.run };
      }
      const cancellationSource = "cancellationSource" in request ? request.cancellationSource : undefined;
      if (cancellationSource !== undefined) {
        if (!("lifecycle" in request) || request.lifecycle.state !== "terminal" || request.lifecycle.outcome !== "cancelled"
          || request.commandId !== lifecycleCommandId("operator-cancel", { commandId: cancellationSource.commandId, runId: request.runId })) throw new Error("delegation-cancellation-request-mismatch");
        const source = authenticateCancellationSource(repositories, current.run, cancellationSource);
        if (source.family === "run" && current.run.envelope.runId === cancellationSource.rootRunId && source.target.expectedVersion !== request.expectedVersion) throw new Error("delegation-cancellation-version-mismatch");
      }
      if (cancellationSource !== undefined && "lifecycle" in request && current.run.lifecycle.state === "queued"
        && repositories.delegationManifests.listByParentRun(request.runId).length > 0) {
        repositories.dependencies.reconcile(request.runId, this.dependencies.clock.now().toISOString());
        if (repositories.dependencies.readiness(request.runId, "cancel").state !== "ready") {
          const requested = repositories.runs.requestCancellation({ runId: request.runId, expectedVersion: request.expectedVersion,
            now: this.dependencies.clock.now().toISOString(), cancellationSource });
          if (requested.state !== "applied") throw new Error("cancel request lost its transaction-local version fence");
          this.recordJournal(repositories, journal.command, journalRun(requested.run), current.run.lifecycle);
          return { state: "applied" as const, run: requested.run };
        }
      }
      if ("lifecycle" in request
        && request.lifecycle.state === "terminal"
        && request.lifecycle.outcome === "cancelled"
        && current.run.envelope.parent === undefined
        && current.run.envelope.shape === "operation") {
        const members: RunRecord[] = [];
        const summary = request.lifecycle.errorSummary === undefined ? {} : { errorSummary: request.lifecycle.errorSummary };
        const collect = (runId: string): void => {
          for (const child of repositories.runs.listChildren(runId)) {
            const edge = repositories.dependencies.lifecycleEdgeForChild(runId, child.envelope.runId);
            if (edge?.policy.cascadeCancel === "independent") continue;
            collect(child.envelope.runId);
            members.push(child);
          }
        };
        collect(current.run.envelope.runId);
        for (const member of members) {
          if (member.lifecycle.state === "terminal") continue;
          const claim = runClaim(member);
          if (claim !== undefined) {
            if (member.cancelRequested !== true) {
              const requested = repositories.runs.requestCancellation({
                runId: member.envelope.runId,
                expectedVersion: member.version,
                now: this.dependencies.clock.now().toISOString(),
                ...summary,
              });
              if (requested.state !== "applied") {
                throw new Error(`cancel tree lost member version fence for ${member.envelope.runId}`);
              }
            }
            continue;
          }
          const cancelled = this.transition({
            commandId: lifecycleCommandId("cascade-cancel-event", { commandId: journal.command.commandId, runId: member.envelope.runId }),
            runId: member.envelope.runId,
            expectedVersion: member.version,
            lifecycle: {
              state: "terminal",
              outcome: "cancelled",
              endedAt: request.lifecycle.endedAt,
              ...summary,
            },
          });
          if (cancelled.state !== "applied") {
            throw new Error(`cancel tree lost member version fence for ${member.envelope.runId}`);
          }
        }
        const stillActive = members
          .map((member) => repositories.runs.get(member.envelope.runId))
          .find((member) => member !== undefined && member.lifecycle.state !== "terminal");
        if (stillActive !== undefined) {
          let anchor = current.run;
          if (runClaim(anchor) !== undefined && anchor.cancelRequested !== true) {
            const requested = repositories.runs.requestCancellation({ runId: anchor.envelope.runId,
              expectedVersion: anchor.version, now: this.dependencies.clock.now().toISOString(), ...summary });
            if (requested.state !== "applied") throw new Error("cancel tree lost anchor version fence");
            anchor = requested.run;
          }
          this.recordJournal(repositories, journal.command, journalRun(anchor), current.run.lifecycle);
          return { state: "applied" as const, run: anchor };
        }
      }
      if (!("lifecycle" in request)) {
        if (runClaim(current.run) !== undefined) return refused({ reason: "owned-by-worker" });
        // A rename is presentation only, so a settled run still takes one; a priority bump does not.
        if (current.run.lifecycle.state === "terminal" && !("displayName" in request)) {
          return refused({
            reason: "illegal-transition",
            from: current.run.lifecycle.state,
            to: current.run.lifecycle.state,
            message: TERMINAL_SELF_EDGE_REFUSAL,
          });
        }
        const now = this.dependencies.clock.now().toISOString();
        if ("priority" in request && current.run.lifecycle.state !== "queued") return refused({ reason: "invalid-state" });
        if ("priority" in request && current.run.envelope.priority === "interactive") {
          return { state: "applied-already" as const, run: current.run };
        }
        const result = "displayName" in request
          ? repositories.runs.updatePresentation({ runId: request.runId, expectedVersion: request.expectedVersion,
            displayName: request.displayName, now })
          : repositories.runs.bumpPriority({ runId: request.runId, expectedVersion: request.expectedVersion, now });
        if (result.state === "conflict") return refused({ reason: "conflict", currentVersion: result.currentVersion });
        this.recordJournal(repositories, journal.command, journalRun(result.run), current.run.lifecycle);
        return { state: "applied" as const, run: result.run };
      }
      if (runClaim(current.run) !== undefined) {
        if (request.lifecycle.state !== "terminal" || request.lifecycle.outcome !== "cancelled") {
          return refused({ reason: "owned-by-worker" });
        }
        if (current.run.cancelRequested === true) return { state: "applied-already" as const, run: current.run };
        const requested = repositories.runs.requestCancellation({ runId: request.runId,
          expectedVersion: request.expectedVersion, now: this.dependencies.clock.now().toISOString(),
          ...(request.lifecycle.errorSummary !== undefined && { errorSummary: request.lifecycle.errorSummary }) });
        if (requested.state !== "applied") throw new Error("cancel request lost its transaction-local version fence");
        this.recordJournal(repositories, journal.command, journalRun(requested.run), current.run.lifecycle);
        return { state: "applied" as const, run: requested.run };
      }
      const isWriteResolution = "writeResolution" in request;
      if (isWriteResolution && current.run.lifecycle.state !== "parked-write") {
        return refused({ reason: "illegal-transition", from: current.run.lifecycle.state,
          to: request.lifecycle.state, message: "only a parked-write run has a write to resolve" });
      }
      if (isWriteResolution && current.run.lifecycle.state === "parked-write") {
        const resolution = request.writeResolution;
        const identity = resolution.kind === "operator" ? resolution.binding : resolution;
        const intent = repositories.writeIntents.get(identity.writeIntentId);
        const attempt = repositories.writeAttempts.get(identity.writeAttemptId);
        if (intent === undefined || attempt === undefined || intent.status === "observed-present"
          || intent.runId !== request.runId || intent.generation !== identity.generation || intent.currentAttemptId !== identity.writeAttemptId
          || intent.bindingProofDigest !== identity.bindingProofDigest || current.run.lifecycle.writeIntentId !== intent.writeIntentId
          || current.run.lifecycle.intentGeneration !== intent.generation) throw new Error("write-resolution-continuation-settlement-mismatch");
        const auditId = resolution.kind === "operator" ? resolution.binding.auditId
          : resolution.kind === "recheck" && intent.status === "parked" ? intent.recheck?.auditId : undefined;
        const audit = auditId === undefined ? undefined : repositories.commandAudits.get(auditId);
        if (resolution.kind === "recheck") {
          if (intent.status !== "parked" || intent.recheck?.commandId !== resolution.commandId
            || intent.recheck.nodeId !== request.startAt || intent.recheck.expectedRunVersion !== request.expectedVersion
            || request.commandId !== lifecycleCommandId("write-recheck", resolution.commandId)) throw new Error("write-recheck-continuation-binding-mismatch");
          authenticateParkedWriteRecheck(intent, attempt, repositories.commands.get(resolution.commandId),
            audit);
        } else {
          if (intent.status !== "committed" && intent.status !== "retryable") throw new Error("write-resolution-continuation-settlement-mismatch");
          const decision = resolution.kind === "operator" ? resolution.binding.decision : resolution.decision;
          if (decision === "present" ? intent.status !== "committed" : intent.status !== "retryable") throw new Error("write-resolution-continuation-settlement-mismatch");
          if (resolution.kind === "operator") {
            authenticateParkedWriteResolution(intent, attempt, repositories.commands.get(resolution.binding.commandId),
              audit);
            if (resolution.binding.expectedRunVersion !== request.expectedVersion || resolution.binding.runId !== request.runId
              || canonicalJsonStringify(intent.resolution) !== canonicalJsonStringify(resolution.binding)) throw new Error("write-resolution-continuation-binding-mismatch");
          } else if (intent.resolution !== undefined || (intent.status === "committed" ? attempt.outcome.state !== "committed"
            : attempt.outcome.state !== "safe-to-retry" || intent.settlement.state === "operator-confirmed-absent")) throw new Error("write-resolution-continuation-recovery-proof-mismatch");
        }
      }
      if (!isWriteResolution && current.run.lifecycle.state === "parked-write"
        && request.lifecycle.state === "queued") {
        return refused({ reason: "illegal-transition", from: current.run.lifecycle.state,
          to: request.lifecycle.state, message: "write resolution requires its continuation node" });
      }
      if (!isWriteResolution && current.run.lifecycle.state === "parked-gate"
        && request.lifecycle.state === "queued"
        && (request.lifecycle.requeuedFrom !== undefined || request.lifecycle.notBefore !== undefined)) {
        return refused({ reason: "illegal-transition", from: current.run.lifecycle.state,
          to: request.lifecycle.state, message: "gate resolution cannot add queued metadata" });
      }
      const violation = current.run.lifecycle.state === "terminal"
        && canonicalJsonStringify(current.run.lifecycle) === canonicalJsonStringify(request.lifecycle)
        ? TERMINAL_SELF_EDGE_REFUSAL
        : runTransitionViolation(current.run.lifecycle, request.lifecycle);
      if (violation !== undefined || request.lifecycle.state === "claimed"
        || (request.lifecycle.state === "terminal" && (request.lifecycle.outcome === "done" || request.lifecycle.outcome === "failed"))) {
        return refused({ reason: "illegal-transition", from: current.run.lifecycle.state,
          to: request.lifecycle.state, message: violation === undefined ? "transition requires the worker door" : violation });
      }
      if (request.lifecycle.state === "terminal") {
        const dependencyRefusal = terminalDependencyRefusal(repositories, request.runId, request.lifecycle.outcome === "cancelled" ? "cancel" : "join", this.dependencies.clock.now().toISOString());
        if (dependencyRefusal !== undefined) return refused(dependencyRefusal);
      }
      const now = this.dependencies.clock.now().toISOString();
      const result = isWriteResolution
        ? repositories.runs.resume({
            runId: request.runId,
            expectedVersion: request.expectedVersion,
            startAt: request.startAt,
            now,
          })
        : current.run.lifecycle.state === "parked-gate" && request.lifecycle.state === "queued"
        ? repositories.runs.resume({
            runId: request.runId,
            expectedVersion: request.expectedVersion,
            startAt: current.run.lifecycle.resumeAt,
            now,
          })
        : repositories.runs.transition({
            runId: request.runId,
            expectedVersion: request.expectedVersion,
            lifecycle: request.lifecycle,
            now,
          });
      if (result.state === "conflict") return refused({ reason: "conflict", currentVersion: result.currentVersion });
      this.recordJournal(repositories, journal.command, journalRun(result.run), current.run.lifecycle);
      return { state: "applied" as const, run: result.run };
    });
  }

  renewClaim(input: unknown): RunMutationOutcome {
    const request = CanonicalRenewClaimRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "renew-claim", request, {
        kind: "claim",
        workerId: request.claim.workerId,
        claimGeneration: request.claim.claimGeneration,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const current = this.read(request.runId);
      if (current.state !== "present") return refused({ reason: "lost" });
      try { this.assertCurrentExecution({ runId: request.runId, claim: request.claim }); }
      catch (error) {
        if (error instanceof RunLifecycleRefusedError && error.outcome.state === "refused" && error.outcome.refusal.reason === "lost") return error.outcome;
        throw error;
      }
      const outcome = repositories.runs.renewClaim({ runId: request.runId, claim: request.claim,
        now: this.dependencies.clock.now().toISOString() });
      if (outcome.state === "lost") return refused({ reason: "lost" });
      this.recordJournal(repositories, journal.command, journalRun(outcome.run));
      return { state: "applied", run: outcome.run };
    });
  }

  pause(input: unknown): RunMutationOutcome | RunExistence {
    return this.changePause(input, "pause");
  }

  resumePaused(input: unknown): RunMutationOutcome | RunExistence {
    return this.changePause(input, "resume");
  }

  private changePause(input: unknown, operation: "pause" | "resume"): RunMutationOutcome | RunExistence {
    const request = CanonicalPauseRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction(repositories => {
      const source = this.read(request.runId);
      // Resume before a requested pause takes effect withdraws it. The journal records that as a pause change, so the
      // Resume journal keeps the acknowledgement an accounting parent is bound to; a replay keeps its stored operation.
      const journaled = repositories.lifecycleJournal.getCommand(request.commandId);
      const withdrawn = operation === "resume" && (journaled === undefined
        ? source.state === "present" && pendingInterruptOf(source.run) === "pause-requested"
        : "kind" in journaled && journaled.kind === "run-lifecycle" && journaled.operation === "pause");
      const journal = this.inspectJournal(repositories, withdrawn ? "pause" : operation, request, { kind: "version", expectedVersion: request.expectedVersion });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      if (source.state !== "present") return source;
      const current = source.run;
      if (current.version !== request.expectedVersion) return refused({ reason: "conflict", currentVersion: current.version });
      const next = interruptTransition(current, { kind: operation });
      if (source.disposition !== "live" || next.state === "refused" && next.reason !== "not-paused") return refused({ reason: "invalid-state" });
      const admission = repositories.runs.admission();
      // A Resume during Pause all and quit ends that quit; any other hold keeps admission closed.
      if (operation === "resume" && admission.state !== "open" && admission.hold !== "quit") return refused({ reason: "policy-refused" });
      if (next.state === "refused") return refused({ reason: "invalid-state" });
      if (next.interrupt === pendingInterruptOf(current)) {
        this.recordJournal(repositories, journal.command, journalRun(current));
        return { state: "applied" as const, run: current };
      }
      // A withdrawn pause never took effect, so it leaves the envelope and any delegation acknowledgement as they are.
      const retryEvidence = operation === "resume" ? captureDelegationResume(repositories, request.runId) : [];
      if (retryEvidence === undefined) return refused({ reason: "policy-refused" });
      // Only a member-Retry hold still blocking the join outlives Resume; an acknowledged retry leaves nothing to hold.
      if (withdrawn && retryEvidence.length > 0 && repositories.dependencies.readiness(request.runId, "join").state === "blocked") return refused({ reason: "policy-refused" });
      const delegationResumed = withdrawn ? [] : retryEvidence;
      if (delegationResumed.length > 0 && !authenticateDelegationResume(repositories, request, delegationResumed)) return refused({ reason: "policy-refused" });
      const now = this.dependencies.clock.now().toISOString();
      const resumeDescriptor = operation === "resume" && delegationResumed.length > 0
        ? this.dependencies.resolveDescriptor?.(current.envelope.workflow) : undefined;
      if (operation === "resume" && delegationResumed.length > 0 && resumeDescriptor === undefined)
        throw new RunContinuationRefusedError("delegation-resume-definition-unavailable");
      const resumeAuthorization = resumeDescriptor === undefined ? undefined : authorizeWorkflowDelegationRefresh(resumeDescriptor, current);
      const accounting = resumeAuthorization === undefined ? undefined : workflowDelegationAccounting(resumeAuthorization, current);
      const accountingResume = accounting !== undefined && repositories.dependencies.groups(request.runId).some(({ group }) =>
        group.invocation.nodeId === accounting.joinNodeId && group.children.some(member => member.attempt === "retry"));
      if (operation === "resume" && admission.state !== "open") {
        const runtime = repositories.runtimeConfig.get();
        if (runtime === undefined) throw new ApplicationAdmissionRefusedError("application-runtime-unavailable");
        repositories.runs.releaseQuitAdmission({ commandId: lifecycleCommandId("quit-admission-release", request.commandId),
          runtimeGeneration: runtime.generation, releases: admission.commandId });
      }
      const result = repositories.runs.setPause({ runId: request.runId, expectedVersion: request.expectedVersion, now,
        ...(operation === "resume" && !accountingResume && !withdrawn ? { continuation: captureRunContinuation(repositories, current) } : {}),
        pause: next.interrupt === "paused" ? { state: "paused", requestedAt: now, pausedAt: now, commandId: request.commandId }
          : next.interrupt === "pause-requested" ? { state: "requested", requestedAt: now, commandId: request.commandId } : undefined },
        accountingResume ? resumeAuthorization : undefined);
      if (result.state === "conflict") return refused({ reason: "conflict", currentVersion: result.currentVersion });
      this.recordJournal(repositories, journal.command, journalRun(result.run));
      return { state: "applied" as const, run: result.run };
    });
  }

  acknowledgePause(input: unknown): RunMutationOutcome {
    const request = CanonicalAcknowledgePauseRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction(repositories => {
      const journal = this.inspectJournal(repositories, "acknowledge-pause", request, { kind: "claim", ...request.claim });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const source = this.read(request.runId);
      const next = source.state === "present" ? interruptTransition(source.run, { kind: "acknowledge-pause" }) : undefined;
      if (source.state !== "present" || next?.state !== "applied") return refused({ reason: "invalid-state" });
      this.assertCurrentExecution({ runId: request.runId, claim: request.claim });
      if (repositories.writeIntents.listByRun(request.runId).some(intent => intent.status === "attempting")) {
        return refused({ reason: "illegal-transition", from: source.run.lifecycle.state, to: "queued",
          message: "a pause cannot release a claim over an unfinished write" });
      }
      const now = this.dependencies.clock.now().toISOString();
      // A pause Resume withdrew after the step stopped releases the run unpaused, to continue from its checkpoint.
      const pause = next.interrupt === "paused" && source.run.pause !== undefined ? { ...source.run.pause, state: "paused" as const, pausedAt: now } : undefined;
      const result = repositories.runs.setPause({ runId: request.runId, claim: request.claim, expectedVersion: source.run.version, now, acknowledge: true, pause });
      if (result.state === "conflict") return refused({ reason: "lost" });
      this.recordJournal(repositories, journal.command, journalRun(result.run));
      return { state: "applied" as const, run: result.run };
    });
  }

  workerTransition(input: unknown): RunMutationOutcome {
    const request = CanonicalWorkerTransitionRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "worker-transition", request, {
        kind: "claim",
        workerId: request.claim.workerId,
        claimGeneration: request.claim.claimGeneration,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const current = this.read(request.runId);
      if (current.state !== "present") return refused({ reason: "lost" });
      if (request.expectedVersion !== undefined && current.run.version !== request.expectedVersion) return refused({ reason: "lost" });
      const held = runClaim(current.run);
      if (held === undefined || held.workerId !== request.claim.workerId
        || held.claimGeneration !== request.claim.claimGeneration) return refused({ reason: "lost" });
      const violation = runTransitionViolation(current.run.lifecycle, request.lifecycle);
      if (violation !== undefined || request.lifecycle.state === "terminal"
        || ("workerId" in request.lifecycle && request.lifecycle.workerId !== held.workerId)) {
        return refused({ reason: "illegal-transition", from: current.run.lifecycle.state,
          to: request.lifecycle.state, message: violation === undefined ? "worker transition cannot replace ownership or settle" : violation });
      }
      this.assertCurrentExecution({ runId: request.runId, claim: request.claim });
      if (request.lifecycle.state === "validating" || request.lifecycle.state === "running") {
        authenticateWorkbookReferenceExecution(repositories, current.run);
      }
      const result = repositories.runs.transition({ runId: request.runId, claim: request.claim,
        expectedVersion: current.run.version, lifecycle: request.lifecycle,
        now: this.dependencies.clock.now().toISOString() });
      if (result.state === "conflict") return refused({ reason: "lost" });
      this.recordJournal(repositories, journal.command, journalRun(result.run), current.run.lifecycle);
      return { state: "applied", run: result.run };
    });
  }

  recoverCrash(input: unknown, lock: RuntimeLifetimeLock): RunMutationOutcome {
    const request = CanonicalCrashRecoveryRequestSchema.parse(input);
    if (!(lock instanceof RuntimeLifetimeLock)) throw new Error("crash-recovery-lock-required");
    lock.assertHeld();
    return this.dependencies.database.withAuthorityTransaction(repositories => {
      const journal = this.inspectJournal(repositories, "recover-crash", request, {
        kind: "terminal", expectedVersion: request.expectedVersion, ...request.claim });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const previous = this.read(request.runId);
      if (previous.state !== "present") return refused({ reason: "lost" });
      const held = runClaim(previous.run);
      if (previous.run.version !== request.expectedVersion || held === undefined || held.workerId !== request.claim.workerId
        || held.claimGeneration !== request.claim.claimGeneration || Date.parse(request.now) < Date.parse(previous.run.envelope.enqueuedAt)) {
        throw new Error("crash-recovery-claim-changed");
      }
      if (previous.run.cancelRequested === true && repositories.writeIntents.listByRun(request.runId)
        .every(intent => intent.status === "committed" || intent.status === "observed-present")) {
        const cancelled = this.cancelClaim(repositories, { kind: "cancelled", commandId: request.commandId,
          runId: request.runId, expectedVersion: request.expectedVersion, claim: request.claim, endedAt: request.now });
        if (cancelled.state !== "applied") return cancelled;
        this.recordJournal(repositories, journal.command, journalRun(cancelled.run), previous.run.lifecycle);
        return cancelled;
      }
      const run = this.dependencies.database.recoverCrashedRun(request, lock);
      this.recordJournal(repositories, journal.command, journalRun(run), previous.run.lifecycle);
      return { state: "applied", run };
    });
  }

  terminalize(
    input: unknown,
    descriptor: AnyWorkflowDescriptor,
    factoryAuthorization?: object,
  ): RunMutationOutcome {
    const request = CanonicalTerminalizeRequestSchema.parse(input);
    if (request.kind === "cancelled") return this.terminalizeCancellation(request);
    try {
      return request.kind === "failure"
        ? this.terminalizeFailure({ commandId: request.commandId, terminal: request.terminal }, descriptor)
        : this.terminalizeSuccess({ commandId: request.commandId, terminal: request.terminal }, factoryAuthorization);
    } catch (error) {
      if (error instanceof WorkerControlRefusal && error.message === "worker-execution-lost") throw new RunLifecycleRefusedError(refused({ reason: "lost" }));
      throw error;
    }
  }

  private terminalizeCancellation(request: z.infer<typeof CanonicalCancellationTerminalizeRequestSchema>): RunMutationOutcome {
    return this.dependencies.database.withAuthorityTransaction((repositories) => {
      const journal = this.inspectJournal(repositories, "terminalize", request, {
        kind: "terminal", expectedVersion: request.expectedVersion,
        workerId: request.claim.workerId, claimGeneration: request.claim.claimGeneration,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const outcome = this.cancelClaim(repositories, request);
      if (outcome.state === "applied") {
        this.recordJournal(repositories, journal.command, journalRun(outcome.run));
      }
      return outcome;
    });
  }

  private cancelClaim(repositories: AuthorityRepositories,
    request: z.infer<typeof CanonicalCancellationTerminalizeRequestSchema>):
    Readonly<{ state: "applied"; run: RunRecord }> | Extract<RunMutationOutcome, { state: "refused" }> {
    const current = this.read(request.runId);
    if (current.state !== "present") return refused({ reason: "lost" });
    const held = runClaim(current.run);
    if (held === undefined || held.workerId !== request.claim.workerId
      || held.claimGeneration !== request.claim.claimGeneration || current.run.version !== request.expectedVersion) {
      return refused({ reason: "lost" });
    }
    if (current.run.cancelRequested !== true
      || !["claimed", "validating", "running"].includes(current.run.lifecycle.state)
      || repositories.writeIntents.listAttemptingByItem({ workflowId: current.run.envelope.workflow,
        itemId: current.run.envelope.itemId }).length > 0) {
      return refused({ reason: "illegal-transition", from: current.run.lifecycle.state, to: "terminal",
        message: "cancellation requires admitted intent outside an unfinished write" });
    }
    const dependencyRefusal = terminalDependencyRefusal(repositories, request.runId, "cancel", this.dependencies.clock.now().toISOString());
    if (dependencyRefusal !== undefined) return refused(dependencyRefusal);
    const outcome = repositories.runs.transition({ runId: request.runId, expectedVersion: request.expectedVersion,
      claim: request.claim, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: request.endedAt,
        ...(current.run.cancelSummary !== undefined && { errorSummary: current.run.cancelSummary }) },
      now: this.dependencies.clock.now().toISOString() });
    if (outcome.state !== "applied") return refused({ reason: "lost" });
    return { state: "applied", run: outcome.run };
  }

  private terminalizeFailure(input: unknown, descriptor: AnyWorkflowDescriptor): RunMutationOutcome {
    const request = CanonicalFailureTerminalizeRequestSchema.parse(input);
    const { authorization } = request.terminal;
    return this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "terminalize", request, {
        kind: "terminal",
        expectedVersion: authorization.expectedVersion,
        workerId: authorization.claim.workerId,
        claimGeneration: authorization.claim.claimGeneration,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayTerminalization(repositories, journal, "failed");
      const existence = this.read(authorization.runId);
      if (existence.state !== "present") return refused({ reason: "lost" });
      const claim = runClaim(existence.run);
      if (existence.run.version !== authorization.expectedVersion
        || claim === undefined
        || claim.workerId !== authorization.claim.workerId
        || claim.claimGeneration !== authorization.claim.claimGeneration) {
        return refused({ reason: "lost" });
      }
      if (!["claimed", "validating", "running"].includes(existence.run.lifecycle.state)) {
        return refused({
          reason: "illegal-transition",
          from: existence.run.lifecycle.state,
          to: "terminal",
          message: "only a claim-holding run may settle failed",
        });
      }
      if (existence.run.cancelRequested === true) {
        return refused({ reason: "illegal-transition", from: existence.run.lifecycle.state, to: "terminal",
          message: "an admitted cancellation must settle cancelled" });
      }
      const dependencyRefusal = terminalDependencyRefusal(repositories, authorization.runId, "join", this.dependencies.clock.now().toISOString());
      if (dependencyRefusal !== undefined) return refused(dependencyRefusal);
      const report = this.dependencies.database.terminalizeFailure(descriptor, request.terminal);
      this.recordJournal(repositories, journal.command, journalRun(report.run));
      return { state: report.state === "replayed" ? "applied-already" : "applied", run: report.run };
    });
  }

  private terminalizeSuccess(
    input: unknown,
    factoryAuthorization?: object,
  ): RunMutationOutcome {
    const request = CanonicalSuccessTerminalizeRequestSchema.parse(input);
    const { authorization } = request.terminal;
    return this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "terminalize", request, {
        kind: "terminal",
        expectedVersion: authorization.expectedVersion,
        workerId: authorization.claim.workerId,
        claimGeneration: authorization.claim.claimGeneration,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayTerminalization(repositories, journal, "done");
      const existence = this.read(authorization.runId);
      if (existence.state !== "present") return refused({ reason: "lost" });
      const claim = runClaim(existence.run);
      if (existence.run.version !== authorization.expectedVersion
        || claim === undefined
        || claim.workerId !== authorization.claim.workerId
        || claim.claimGeneration !== authorization.claim.claimGeneration) {
        return refused({ reason: "lost" });
      }
      if (existence.run.lifecycle.state !== "running") {
        return refused({
          reason: "illegal-transition",
          from: existence.run.lifecycle.state,
          to: "terminal",
          message: "only a running run may settle done",
        });
      }
      if (existence.run.cancelRequested === true) {
        return refused({ reason: "illegal-transition", from: existence.run.lifecycle.state, to: "terminal",
          message: "an admitted cancellation must settle cancelled" });
      }
      const dependencyRefusal = terminalDependencyRefusal(repositories, authorization.runId, "join", this.dependencies.clock.now().toISOString());
      if (dependencyRefusal !== undefined) return refused(dependencyRefusal);
      const report = this.dependencies.database.terminalizeSuccess(request.terminal, factoryAuthorization);
      this.recordJournal(repositories, journal.command, journalRun(report.run));
      return { state: report.state === "replayed" ? "applied-already" : "applied", run: report.run };
    });
  }

  requeue(input: unknown): RunRecoveryOutcome {
    const request = CanonicalRequeueRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction((repositories): RunRecoveryOutcome => {
      const journal = this.inspectJournal(repositories, "requeue", request, {
        kind: "version",
        expectedVersion: request.expectedVersion,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const existence = this.read(request.runId);
      if (existence.state !== "present") return existence;
      const { run } = existence;
      if (run.version !== request.expectedVersion) {
        return refused({ reason: "conflict", currentVersion: run.version });
      }
      const held = runClaim(run);
      if (held !== undefined) {
        if (request.claim !== undefined
          && (request.claim.workerId !== held.workerId
            || request.claim.claimGeneration !== held.claimGeneration)) {
          return refused({ reason: "lost" });
        }
        if (request.claim === undefined) {
          return refused({
            reason: "illegal-transition",
            from: run.lifecycle.state,
            to: "queued",
            message: "a claimed run requires its claim fence",
          });
        }

      } else if (!(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "interrupted")) {
        return refused({
          reason: "illegal-transition",
          from: run.lifecycle.state,
          to: "queued",
          message: "only an owned or terminal interrupted run may be requeued",
        });
      }
      const now = this.dependencies.clock.now().toISOString();
      let unfinished = repositories.writeIntents.listAttemptingByItem({
        workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
      })[0] ?? repositories.writeIntents.listByRun(request.runId).find(intent => intent.status === "parked");
      if (unfinished !== undefined) {
        let message = unfinished.status === "parked" ? unfinished.message
          : `run ${request.runId} has an unfinished attempting write intent ${unfinished.writeIntentId}; recovery must settle it before release`;
        if (held === undefined || (run.lifecycle.state !== "running" && unfinished.status !== "parked")) return {
          state: "recovery-required", run, writeIntentId: unfinished.writeIntentId,
          intentGeneration: unfinished.generation, parked: false, message,
        };
        if (unfinished.status === "parked" && unfinished.recheck !== undefined) {
          unfinished = repositories.writeIntents.parkRecheck({ writeIntentId: unfinished.writeIntentId, generation: unfinished.generation,
            expectedVersion: unfinished.version, commandId: unfinished.recheck.commandId, code: "unknown",
            message: "The write check lost its worker claim; check again to read the target system.",
            authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "authority-row", "recheck-claim-lost"), now });
          if (unfinished.status !== "parked") throw new Error("write-recheck-park-required");
          message = unfinished.message;
        }
        const parked = repositories.runs.transition({ runId: request.runId, expectedVersion: request.expectedVersion,
          claim: { workerId: held.workerId, claimGeneration: held.claimGeneration },
          lifecycle: { state: "parked-write", writeIntentId: unfinished.writeIntentId,
            intentGeneration: unfinished.generation, parkedAt: now, code: unfinished.status === "parked" ? unfinished.parkedCode : "unknown", message }, now });
        if (parked.state !== "applied") return refused({ reason: "lost" });
        this.recordJournal(repositories, journal.command, journalRun(parked.run));
        return { state: "recovery-required", run: parked.run, writeIntentId: unfinished.writeIntentId,
          intentGeneration: unfinished.generation, parked: true, message };
      }
      const result = run.cancelRequested === true && held !== undefined
        ? repositories.runs.transition({
            runId: request.runId,
            expectedVersion: request.expectedVersion,
            claim: request.claim ?? { workerId: held.workerId, claimGeneration: held.claimGeneration },
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
            now,
          })
        : repositories.runs.transition({
            runId: request.runId,
            expectedVersion: request.expectedVersion,
            ...(request.claim === undefined ? {} : { claim: request.claim }),
            lifecycle: {
              state: "queued",
              requeuedFrom: request.cause,
              ...(request.notBefore === undefined ? {} : { notBefore: request.notBefore }),
            },
            now,
          });
      if (result.state === "conflict") {
        return request.claim === undefined
          ? refused({ reason: "conflict", currentVersion: result.currentVersion })
          : refused({ reason: "lost" });
      }
      this.recordJournal(repositories, journal.command, journalRun(result.run));
      return { state: "applied", run: result.run };
    });
  }

  retry(input: unknown, descriptor: AnyWorkflowDescriptor, publication?: RunQueuedPublication): RunMutationOutcome | RunExistence {
    const request = CanonicalRetrySourceRequestSchema.parse(input);
    descriptorRuntimeNodes(descriptor);
    const outcome = this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome | RunExistence => {
      const journal = this.inspectJournal(repositories, "retry", request, {
        kind: "version",
        expectedVersion: request.expectedVersion,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const source = this.read(request.runId);
      if (source.state === "deleted") return refused({ reason: "source-deleted" });
      if (source.state === "absent") return source;
      const { run } = source;
      if (run.version !== request.expectedVersion) return refused({ reason: "conflict", currentVersion: run.version });
      if (repositories.runs.admission().state !== "open") return refused({ reason: "policy-refused" });
      if (source.disposition !== "live" || run.lifecycle.state !== "terminal") return refused({ reason: "invalid-state" });
      assertOcrChildRetryCurrent(repositories, this, run);
      const delegation = run.envelope.parent === undefined ? undefined : prepareDelegationRetry(repositories, run, { ...request, refreshAuthorization: this.parentRefreshAuthorization(repositories, run) });
      if (delegation !== undefined && (repositories.runtimeConfig.get()?.configSnapshotId !== run.envelope.configSnapshotId
        || request.runtimeConfig.configFingerprint !== run.envelope.configFingerprint)) return refused({ reason: "runtime-stale" });
      if (descriptor.id !== run.envelope.workflow || descriptor.version !== run.envelope.descriptorVersion
        || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
        return refused({ reason: "schema-mismatch", digest: run.envelope.contractFingerprint });
      }
      if (!this.runtimeMatches(request.runtimeConfig)) return refused({ reason: "runtime-stale" });
      const continuation = delegation === undefined ? undefined : planDelegatedRetry(repositories, descriptor, run, delegation.source.commandId, undefined, this.dependencies.database.evidenceSchemaHash?.bind(this.dependencies.database)).continuation;
      if (descriptor.enqueue === "reject-active" && repositories.runs.listByItem({
        workflow: run.envelope.workflow, itemId: run.envelope.itemId,
      }).some((entry) => entry.lifecycle.state !== "terminal")) return refused({ reason: "policy-refused" });
      const runId = RunIdSchema.parse(this.dependencies.ids.uuid());
      if (repositories.deletedRuns.get(runId) !== undefined) return refused({ reason: "tombstoned" });
      if (repositories.runs.get(runId) !== undefined) return refused({ reason: "identity-conflict", field: "runId" });
      const now = this.dependencies.clock.now().toISOString();
      const envelope = nextAttemptEnvelope(run.envelope, repositories.runs.nextItemAttempt({
        workflow: run.envelope.workflow, itemId: run.envelope.itemId,
      }));
      delete envelope.recovery;
      delete envelope.sourceBound;
      delete envelope.continuation;
      const next = RunRecordSchema.parse({
        envelope: { ...(delegation === undefined ? selectNewRunIdentity(repositories, envelope) : envelope), runId, traceId: deriveTraceId(descriptor.code, runId, this.dependencies.clock),
          retryOf: run.envelope.runId, enqueuedAt: now, buildId: approvalBuildId(repositories, envelope.parent),
          ...(continuation === undefined ? {} : { continuation }),
        },
        input: run.input, lifecycle: { state: "queued" }, claimGeneration: 0,
        runNumber: repositories.runs.nextWorkflowRunNumber(run.envelope.workflow),
        ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
        ...(request.appVersion === undefined ? {} : { appVersion: request.appVersion }),
        version: 1, createdAt: now, updatedAt: now,
      });
      this.dependencies.admitQueuedRun?.(next);
      repositories.runs.enqueue(next);
      this.recordJournal(repositories, journal.command, journalRun(next));
      const relatedRunChanges = delegation === undefined ? [] : this.activateDelegationRetry(repositories, delegation, run, next, now);
      this.dependencies.publishQueued(next, publication);
      return { state: "applied", run: next, relatedRunChanges };
    });
    return outcome;
  }

  recover(input: unknown, descriptor: AnyWorkflowDescriptor, publication?: RunQueuedPublication): RunMutationOutcome | RunExistence {
    const request = CanonicalRecoverRunRequestSchema.parse(input);
    descriptorRuntimeNodes(descriptor);
    const outcome = this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome | RunExistence => {
      if (request.continuationOwner === undefined) {
        const command = assertRunRecoveryCommandScope(repositories, request.sourceCommandId);
        if (command.target.runId !== request.runId
        || command.target.expectedVersion !== request.expectedVersion
        || request.commandId !== lifecycleCommandId("operator-recover-run", command.commandId))
          throw new RunContinuationRefusedError("run-recovery-command-binding-mismatch");
      }
      const journal = this.inspectJournal(repositories, "recover", request, {
        kind: "version",
        expectedVersion: request.expectedVersion,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const source = this.read(request.runId);
      if (source.state === "deleted") return refused({ reason: "source-deleted" });
      if (source.state === "absent") return source;
      const { run } = source;
      if (run.version !== request.expectedVersion) return refused({ reason: "conflict", currentVersion: run.version });
      if (repositories.runs.admission().state !== "open") return refused({ reason: "policy-refused" });
      if (source.disposition !== "live" || run.lifecycle.state !== "terminal" || !["failed", "interrupted"].includes(run.lifecycle.outcome)) return refused({ reason: "invalid-state" });
      if (run.envelope.parent !== undefined && run.lifecycle.outcome === "interrupted")
        throw new RunContinuationRefusedError("run-recovery-interrupted-child-terminal-proof-unavailable");
      assertOcrChildRetryCurrent(repositories, this, run, request.continuationOwner);
      const delegation = run.envelope.parent === undefined ? undefined : prepareDelegationRetry(repositories, run, { ...request, refreshAuthorization: this.parentRefreshAuthorization(repositories, run) });
      if (delegation !== undefined && (request.continuationOwner === undefined
        && repositories.runtimeConfig.get()?.configSnapshotId !== run.envelope.configSnapshotId
        || !runSettingsAvailable(repositories, run.envelope)
        || request.runtimeConfig.configFingerprint !== run.envelope.configFingerprint)) return refused({ reason: "runtime-stale" });
      if (descriptor.id !== run.envelope.workflow || descriptor.version !== run.envelope.descriptorVersion
        || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
        return refused({ reason: "schema-mismatch", digest: run.envelope.contractFingerprint });
      }
      if (!this.runtimeMatches(request.runtimeConfig)) return refused({ reason: "runtime-stale" });
      if (request.runtimeConfig.configFingerprint !== run.envelope.configFingerprint) return refused({ reason: "runtime-stale" });
      const plan = request.continuationOwner === undefined ? planRunRecovery(repositories, descriptor, run, request.sourceCommandId, this.dependencies.database.evidenceSchemaHash?.bind(this.dependencies.database))
        : planDelegatedRetry(repositories, descriptor, run, request.sourceCommandId, request.continuationOwner, this.dependencies.database.evidenceSchemaHash?.bind(this.dependencies.database));
      assertOcrRecoverySnapshotCurrent(repositories, this, run, workflowId => this.dependencies.resolveDescriptor?.(workflowId));
      const continuation = plan.continuation;
      if (descriptor.enqueue === "reject-active" && repositories.runs.listByItem({
        workflow: run.envelope.workflow, itemId: run.envelope.itemId,
      }).some((entry) => entry.lifecycle.state !== "terminal")) return refused({ reason: "policy-refused" });
      const runId = RunIdSchema.parse(this.dependencies.ids.uuid());
      if (repositories.deletedRuns.get(runId) !== undefined) return refused({ reason: "tombstoned" });
      if (repositories.runs.get(runId) !== undefined) return refused({ reason: "identity-conflict", field: "runId" });
      const now = this.dependencies.clock.now().toISOString();
      const envelope = nextAttemptEnvelope(run.envelope, repositories.runs.nextItemAttempt({
        workflow: run.envelope.workflow, itemId: run.envelope.itemId,
      }));
      delete envelope.recovery;
      delete envelope.sourceBound;
      delete envelope.continuation;
      const next = RunRecordSchema.parse({
        envelope: { ...(delegation === undefined ? selectNewRunIdentity(repositories, envelope) : envelope), runId, traceId: deriveTraceId(descriptor.code, runId, this.dependencies.clock),
          retryOf: run.envelope.runId, enqueuedAt: now, continuation,
        },
        input: run.input, lifecycle: { state: "queued" }, claimGeneration: 0,
        runNumber: repositories.runs.nextWorkflowRunNumber(run.envelope.workflow),
        ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
        ...(request.appVersion === undefined ? {} : { appVersion: request.appVersion }),
        version: 1, createdAt: now, updatedAt: now,
      });
      this.dependencies.admitQueuedRun?.(next);
      repositories.runs.enqueue(next);
      this.recordJournal(repositories, journal.command, journalRun(next));
      const relatedRunChanges = delegation === undefined ? [] : this.activateDelegationRetry(repositories, delegation, run, next, now, request.continuationOwner);
      this.dependencies.publishQueued(next, publication);
      return { state: "applied", run: next, relatedRunChanges };
    });
    return outcome;
  }

  private activateDelegationRetry(repositories: AuthorityRepositories, delegation: ReturnType<typeof prepareDelegationRetry>,
    run: RunRecord, next: RunRecord, now: string, continuationOwner?: z.infer<typeof DelegationRetryRequestSchema>["continuationOwner"]): RelatedRunChange[] {
    const retryRequest = DelegationRetryRequestSchema.parse({
      ...(continuationOwner === undefined ? {} : { continuationOwner }), commandId: lifecycleCommandId("delegation-retry", {
      dependencyId: delegation.child.dependency.dependencyId, previousRunId: run.envelope.runId }),
      sourceCommandId: delegation.source.commandId, invocationCommandId: delegation.group.invocation.commandId,
      manifestId: delegation.group.manifest.manifestId, dependencyId: delegation.child.dependency.dependencyId,
      expectedVersion: delegation.child.dependency.version, parentVersion: delegation.parent.version,
      originalRunId: delegation.child.original.envelope.runId, originalAttempt: delegation.child.original.envelope.attempt,
      previousRunId: run.envelope.runId, previousAttempt: run.envelope.attempt, resultDigest: delegation.terminal.result.resultDigest,
      replacementRunId: next.envelope.runId, replacementAttempt: next.envelope.attempt,
      planFingerprint: delegation.group.manifest.manifestFingerprint, policy: delegation.group.manifest.policy });
    const retryJournal = this.inspectJournal(repositories, "delegation-retry", retryRequest, { kind: "version", expectedVersion: retryRequest.expectedVersion });
    if (retryJournal.state !== "new") throw new Error("delegation-retry-replay-divergent");
    repositories.dependencies.activateRetry(retryRequest, now, delegation.refreshAuthorization ?? delegation.accountingAuthorization);
    this.recordJournal(repositories, retryJournal.command, journalRun(next));
    const change = this.holdParentAfterChildRetry(delegation, retryRequest);
    return change === undefined ? [] : [change];
  }

  private parentRefreshAuthorization(repositories: AuthorityRepositories, child: RunRecord) {
    const parent = child.envelope.parent === undefined ? undefined : repositories.runs.get(child.envelope.parent.runId);
    if (parent === undefined) return;
    const descriptor = this.dependencies.resolveDescriptor?.(parent.envelope.workflow);
    const authorization = descriptor === undefined ? undefined : authorizeWorkflowDelegationRefresh(descriptor, parent);
    if (authorization !== undefined && workflowDelegationAccounting(authorization, parent) !== undefined) return authorization;
    return parent.lifecycle.state === "parked-gate" || parent.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done"
      || parent.lifecycle.state === "queued" && parent.delegationRefresh !== undefined ? authorization : undefined;
  }

  private holdParentAfterChildRetry(delegation: ReturnType<typeof prepareDelegationRetry>, retry: z.infer<typeof DelegationRetryRequestSchema>) {
    const authorization = delegation.refreshAuthorization;
    if (authorization !== undefined) this.dependencies.database.withAuthorityTransaction(repositories =>
      repositories.dependencies.refreshAfterRetry(retry, authorization, this.dependencies.clock.now().toISOString()));
    const ownerId = retry.continuationOwner?.runId ?? delegation.parent.envelope.runId;
    const owner = this.read(ownerId);
    if (owner.state !== "present") throw new RunContinuationRefusedError("delegation-parent-unavailable");
    if (delegation.group.manifest.join !== "none" && delegation.group.manifest.policy.afterChildRetry === "manual-parent-resume" && owner.run.lifecycle.state !== "terminal") requireLifecycleApplied(this.pause({ commandId: lifecycleCommandId("delegation-manual-pause", retry.commandId),
      runId: ownerId, expectedVersion: owner.run.version }));
    const after = this.read(ownerId);
    if (after.state !== "present") throw new RunContinuationRefusedError("delegation-parent-unavailable");
    const before = ownerId === delegation.parent.envelope.runId ? delegation.parent.version : owner.run.version;
    return after.run.version === before ? undefined : { runId: ownerId, before, after: after.run.version };
  }

  continueDelegations(parent: RunRecord, sourceCommandId: string, relatedRunChanges: RelatedRunChange[] = []): readonly RunRecord[] {
    return this.dependencies.database.withAuthorityTransaction(repositories => {
      const replacements: RunRecord[] = [];
      for (const { group } of continuationDelegationGroups(repositories, parent.envelope)) {
        for (const member of group.children) {
          const child = member.child;
          if (child.lifecycle.state !== "terminal" || !["failed", "interrupted"].includes(child.lifecycle.outcome)) continue;
          const descriptor = this.dependencies.resolveDescriptor?.(child.envelope.workflow);
          if (descriptor === undefined) throw new Error("delegation-continuation-descriptor-unavailable");
          const outcome = this.recover({
            commandId: lifecycleCommandId("continuation-child-retry", { ownerRunId: parent.envelope.runId, previousRunId: child.envelope.runId }),
            sourceCommandId, runId: child.envelope.runId, expectedVersion: child.version,
            continuationOwner: { runId: parent.envelope.runId, version: parent.version, attempt: parent.envelope.attempt },
            runtimeConfig: selectRunRuntime(repositories), appVersion: parent.appVersion,
          }, descriptor, { ...protectedSubjectDisplay(retainedRunProtectedBindings(child), () => ({
            title: workflowPlanning(descriptor).title(child.input.parsed.value),
            subtitle: workflowPlanning(descriptor).subtitle(child.input.parsed.value),
          })), actorId: "local-operator" });
          if (outcome.state === "refused") throw new RunContinuationRefusedError(`run-continuation-child-${outcome.refusal.reason}`);
          const replacement = requireLifecycleApplied(outcome);
          if ((outcome.state === "applied" || outcome.state === "applied-already") && "run" in outcome) relatedRunChanges.push(...outcome.relatedRunChanges ?? []);
          replacements.push(replacement);
          replacements.push(...this.continueDelegations(replacement, sourceCommandId, relatedRunChanges));
        }
      }
      return replacements;
    });
  }

  delete(input: unknown): RunDeletionOutcome {
    const request = CanonicalDeleteRequestSchema.parse(input);
    try {
      return this.deleteTree(request);
    } catch (error) {
      if (error instanceof RunDeletionRefusedError) return refused({ reason: error.reason });
      throw error;
    }
  }

  historyStatus(): RunHistoryStatus {
    return this.dependencies.database.withAuthorityReadSnapshot(() => {
      const runs = this.dependencies.database.authority.runs.listWorkflows().flatMap(workflow => this.dependencies.database.authority.runs.listByWorkflow(workflow));
      return { state: "available", finishedRuns: runs.filter(run => run.lifecycle.state === "terminal").length,
        activeRuns: runs.filter(run => run.lifecycle.state !== "terminal").length };
    });
  }

  clearHistory(input: unknown): ClearRunHistoryResult {
    const request = RunHistoryCommandSchema.parse(input);
    try {
      return this.dependencies.database.withAuthorityTransaction((repositories): ClearRunHistoryResult => {
        const journal = this.inspectJournal(repositories, "clear-history", request, { kind: "none" });
        if (journal.state === "divergent") return { state: "refused", commandId: request.commandId, reason: "replay-divergent" };
        if (journal.state === "replay") {
          return this.replayHistoryDeletion(repositories, journal);
        }
        const runs = repositories.runs.listWorkflows().flatMap(workflow => repositories.runs.listByWorkflow(workflow));
        if (runs.some(run => run.lifecycle.state !== "terminal")) return { state: "refused", commandId: request.commandId, reason: "active-runs" };
        const leaves: RunRecord[] = [];
        const visited = new Set<string>();
        const collect = (run: RunRecord): void => {
          if (visited.has(run.envelope.runId)) throw new Error("run-history-parent-cycle");
          visited.add(run.envelope.runId);
          for (const child of repositories.runs.listChildren(run.envelope.runId)) collect(child);
          leaves.push(run);
        };
        for (const root of runs.filter(run => run.envelope.parent === undefined)) collect(root);
        if (visited.size !== runs.length) throw new Error("run-history-disconnected-members");
        const now = this.dependencies.clock.now().toISOString();
        const cascadeRunIds = leaves.map(run => run.envelope.runId);
        const deletions = leaves.map(run => ({ runId: run.envelope.runId, commandId: request.commandId, now, cascadeRunIds, origin: "storage" as const }));
        repositories.lifecycleJournal.insertCommand(journal.command);
        for (const deletion of deletions) repositories.runs.assertDeletionAllowed(deletion);
        for (const deletion of deletions) repositories.runs.delete(deletion);
        this.recordJournal(repositories, journal.command, { kind: "history-deletion", runIds: cascadeRunIds });
        return { state: "cleared", commandId: request.commandId, deletedRuns: leaves.length };
      });
    } catch (error) {
      if (error instanceof RunDeletionRefusedError) return { state: "refused", commandId: request.commandId, reason: error.reason };
      throw error;
    }
  }

  clearHistoryResult(input: unknown): ClearRunHistoryResult {
    const request = RunHistoryCommandSchema.parse(input);
    return this.dependencies.database.withAuthorityReadSnapshot(() => {
      const repositories = this.dependencies.database.authority;
      const journal = this.inspectJournal(repositories, "clear-history", request, { kind: "none" });
      if (journal.state === "new") return { state: "not-recorded", commandId: request.commandId };
      if (journal.state === "divergent") return { state: "refused", commandId: request.commandId, reason: "replay-divergent" };
      return this.replayHistoryDeletion(repositories, journal);
    });
  }

  private replayHistoryDeletion(repositories: AuthorityRepositories, journal: Extract<LifecycleJournalInspection, { state: "replay" }>): ClearRunHistoryResult {
    if (journal.result.kind !== "history-deletion") throw new Error("run-history-replay-result-mismatch");
    for (const id of journal.result.runIds) {
      if (repositories.deletedRuns.get(id)?.commandId !== journal.command.commandId || repositories.runs.get(id) !== undefined)
        throw new Error("run-history-replay-tombstone-mismatch");
    }
    return { state: "cleared", commandId: journal.command.commandId, deletedRuns: journal.result.runIds.length };
  }

  purge(input: unknown): RunPurgeOutcome {
    const request = CanonicalPurgeRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction((repositories): RunPurgeOutcome => {
      const journal = this.inspectJournal(repositories, "purge", request, { kind: "none" });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayPurge(journal.result);
      const bundle = repositories.diagnosticBundles.get(request.bundleId);
      const now = this.dependencies.clock.now().toISOString();
      if (bundle !== undefined
        && (bundle.retention.kind !== "ordinary"
          || Date.parse(bundle.retention.purgeAfter) > Date.parse(now))) {
        return refused({ reason: "retention-not-due" });
      }
      const disposition = repositories.diagnosticBundles.purge(request.bundleId, now);
      const purged = disposition === "purged" ? 1 : 0;
      this.recordJournal(repositories, journal.command, {
        kind: "purge",
        evidenceClass: request.evidenceClass,
        purged,
      });
      return { state: "purged", evidenceClass: request.evidenceClass, purged };
    });
  }

  private deleteTree(request: z.infer<typeof CanonicalDeleteRequestSchema>): RunDeletionOutcome {
    return this.dependencies.database.withAuthorityTransaction((repositories): RunDeletionOutcome => {
      const journal = this.inspectJournal(repositories, "delete", request,
        { kind: "version", expectedVersion: request.expectedVersion });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayDeletion(repositories, journal.result);
      const existence = this.read(request.runId);
      if (existence.state === "deleted") return refused({ reason: "tombstoned" });
      if (existence.state === "absent") return existence;
      const { run } = existence;
      if (run.version !== request.expectedVersion) return refused({ reason: "conflict", currentVersion: run.version });
      if (run.envelope.parent !== undefined) return refused({ reason: "is-member" });
      if (run.lifecycle.state !== "terminal") return refused({ reason: "not-terminal" });
      const leaves: RunRecord[] = [];
      const visited = new Set<string>();
      const collect = (parent: RunRecord): void => {
        if (visited.has(parent.envelope.runId)) throw new Error(`cycle in run parent tree ${parent.envelope.runId}`);
        visited.add(parent.envelope.runId);
        for (const child of repositories.runs.listChildren(parent.envelope.runId)) collect(child);
        leaves.push(parent);
      };
      collect(run);
      const active = leaves.find(member => member.lifecycle.state !== "terminal");
      if (active !== undefined) return refused({ reason: "tree-non-terminal", runId: active.envelope.runId });
      const now = this.dependencies.clock.now().toISOString();
      const requests = leaves.map(member => ({ runId: member.envelope.runId, commandId: request.commandId,
        now, cascadeRunIds: leaves.map(member => member.envelope.runId), origin: "queue" as const }));
      repositories.lifecycleJournal.insertCommand(journal.command);
      for (const deletion of requests) repositories.runs.assertDeletionAllowed(deletion);
      const tombstones = requests.map(deletion => repositories.runs.delete(deletion));
      this.recordJournal(repositories, journal.command, { kind: "deletion", runIds: tombstones.map(tombstone => tombstone.runId) });
      return { state: "deleted", tombstones };
    });
  }

  private runtimeMatches(token: RuntimeConfigClaimToken): boolean {
    return runRuntimeMatches(this.dependencies.database.authority, token);
  }

  private inspectJournal(
    repositories: AuthorityRepositories,
    operation: LifecycleOperation,
    request: unknown,
    fence: LifecycleFence,
  ): LifecycleJournalInspection {
    const parsedFence = RunLifecycleCommandFenceSchema.parse(fence);
    const commandId = CommandIdSchema.parse((request as { commandId?: unknown }).commandId);
    let fingerprintInput = request;
    if (operation === "create") {
      const create = CanonicalCreateRunRequestSchema.parse(request);
      fingerprintInput = valueFreeProtectedData(create, retainedRunProtectedBindings({
        envelope: { workflow: create.workflow }, input: create.input,
      }));
    }
    const requestFingerprint = FingerprintSchema.parse(sha256Hex(
      `hrauto:run-lifecycle-command:v1\0${operation}\0${canonicalJsonStringify(fingerprintInput)}`,
    ));
    const existing = repositories.lifecycleJournal.getCommand(commandId);
    const audit = repositories.lifecycleJournal.findAuditByCommand(commandId);
    if (existing === undefined) {
      if (audit !== undefined) throw new Error(`run lifecycle command ${commandId} has an audit without its command`);
      return {
        state: "new",
        command: RunLifecycleCommandRecordSchema.parse({
          kind: "run-lifecycle",
          commandId,
          operation,
          requestFingerprint,
          request: fingerprintInput,
          fence: parsedFence,
          recordedAt: this.dependencies.clock.now().toISOString(),

        }),
      };
    }
    if (!("kind" in existing) || existing.kind !== "run-lifecycle"
      || existing.operation !== operation
      || existing.requestFingerprint !== requestFingerprint
      || canonicalJsonStringify(existing.request) !== canonicalJsonStringify(fingerprintInput)
      || canonicalJsonStringify(existing.fence) !== canonicalJsonStringify(parsedFence)) {
      return { state: "divergent" };
    }
    if (audit === undefined) throw new Error(`run lifecycle command ${commandId} has no audit`);
    if (!("kind" in audit) || audit.kind !== "run-lifecycle"
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(existing)) {
      throw new Error(`run lifecycle command ${commandId} has a mismatched audit`);
    }
    return { state: "replay", command: existing, result: audit.result };
  }

  private recordLifecycleEvent(repositories: AuthorityRepositories, operation: LifecycleOperation,
    commandId: string, run: RunRecord): void {
    if (operation === "terminalize" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done"
      && run.delegationRefresh !== undefined) {
      const initial = repositories.runResults.getInitialSettlement(run.envelope.runId);
      const descriptor = this.dependencies.resolveDescriptor?.(run.envelope.workflow);
      const authorization = descriptor === undefined ? undefined : authorizeWorkflowDelegationRefresh(descriptor, run);
      const accounting = authorization === undefined ? undefined : workflowDelegationAccounting(authorization, run);
      const nodeId = accounting?.recompute.at(-1);
      if (initial !== undefined && initial.run.version < run.version && nodeId !== undefined)
        createNoteTimelineWriter({ repository: repositories.timelineEvents, clock: this.dependencies.clock }).emitRunLog({
          workflow: run.envelope.workflow, level: "step", message: "Member retry updated this outcome. The earlier receipt is retained.",
          address: { runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
            spanPath: taskSpanPath(run.envelope.traceId, NodeIdSchema.parse(nodeId), 1, run.claimGeneration) },
        }, run);
    }
    if (["claim-next", "transition", "worker-transition", "terminalize", "requeue", "recover-crash"].includes(operation)) {
      const lifecycle = run.lifecycle;
      if (lifecycle.state === "parked-write") {
        const intent = repositories.writeIntents.get(lifecycle.writeIntentId);
        if (intent === undefined || (intent.status !== "parked" && intent.status !== "attempting")
          || intent.generation !== lifecycle.intentGeneration
          || intent.workflowId !== run.envelope.workflow || intent.itemId !== run.envelope.itemId
          || intent.bindingProof.runId !== intent.runId || intent.bindingProof.attempt !== intent.runAttempt) {
          throw new Error("timeline-parked-write-owner-mismatch");
        }
        const owner = repositories.runs.get(intent.runId);
        if (owner === undefined || owner.envelope.workflow !== intent.workflowId || owner.envelope.itemId !== intent.itemId
          || owner.envelope.attempt < intent.runAttempt) throw new Error("timeline-parked-write-owner-mismatch");
        const spanPath = intent.bindingProof.afterPrepareSpanPath;
        const prefix = `${owner.envelope.traceId}/`;
        const parsedNode = NodeIdSchema.safeParse(spanPath.startsWith(prefix) && spanPath.endsWith("/prepare")
          ? spanPath.slice(prefix.length, -"/prepare".length) : undefined);
        if (!parsedNode.success) throw new Error("timeline-parked-write-node-mismatch");
        const nodeId = parsedNode.data;
        const now = this.dependencies.clock.now();
        repositories.timelineEvents.append({ schemaVersion: 1,
          eventId: lifecycleCommandId("timeline-lifecycle", commandId),
          workflow: run.envelope.workflow, scope: { kind: "run", runId: run.envelope.runId },
          occurredAt: lifecycle.parkedAt, recordedAt: now.toISOString(), retentionDate: localDatePart(now),
          source: { kind: "native" }, payload: { kind: "write-parked", workflow: run.envelope.workflow,
            runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
            nodeId, writeIntentId: intent.writeIntentId, generation: intent.generation },
        });
        return;
      }
      const event = operation === "claim-next" && lifecycle.state === "claimed"
        ? { t: "run.claimed", workerId: lifecycle.workerId, claimGeneration: run.claimGeneration }
        : lifecycle.state === "terminal"
          ? { t: "span.ended", kind: "run", outcome: lifecycle.outcome,
              ...(run.completion === undefined ? {} : run.completion.claim),
              ...(lifecycle.outcome === "failed" ? { failureId: lifecycle.failureId } : {}) }
          : lifecycle.state === "parked-gate"
            ? { t: "gate.opened", gate: lifecycle.gateId }
            : operation === "requeue" && lifecycle.state === "queued" && lifecycle.requeuedFrom !== undefined
              ? { t: "run.requeued", cause: lifecycle.requeuedFrom, nextAttempt: run.envelope.attempt }
              : undefined;
      if (event !== undefined) {
        const now = this.dependencies.clock.now();
        const occurredAt = lifecycle.state === "terminal" ? lifecycle.endedAt
          : lifecycle.state === "claimed" ? lifecycle.claimedAt
            : lifecycle.state === "parked-gate" ? lifecycle.parkedAt : run.updatedAt;
        repositories.timelineEvents.append({ schemaVersion: 1,
          eventId: lifecycleCommandId("timeline-lifecycle", commandId),
          workflow: run.envelope.workflow, scope: { kind: "run", runId: run.envelope.runId },
          occurredAt, recordedAt: now.toISOString(), retentionDate: localDatePart(now),
          source: { kind: "native" }, payload: { kind: "span", event: {
            ...event, pid: this.dependencies.lifecycleEventProcessId ?? process.pid, ts: occurredAt, workflow: run.envelope.workflow,
            runId: run.envelope.runId, attempt: run.envelope.attempt,
            traceId: run.envelope.traceId, spanPath: run.envelope.traceId,
          } },
        });
      }
    }
  }

  private recordJournal(
    repositories: AuthorityRepositories,
    command: z.infer<typeof RunLifecycleCommandRecordSchema>,
    result: z.input<typeof RunLifecycleCommandAuditRecordSchema>["result"],
    previousLifecycle?: RunRecord["lifecycle"],
  ): void {
    if (result.kind === "run") {
      const run = repositories.runs.get(result.runId);
      if (run === undefined) throw new Error("timeline-lifecycle-owner-missing");
      if (previousLifecycle === undefined
        || canonicalJsonStringify(previousLifecycle) !== canonicalJsonStringify(run.lifecycle)) {
        this.recordLifecycleEvent(repositories, command.operation, command.commandId, run);
      }
    }
    repositories.lifecycleJournal.insertCommand(command);
    repositories.lifecycleJournal.insertAudit({
      kind: "run-lifecycle",
      auditId: command.commandId,
      request: command,
      result,
      completedAt: this.dependencies.clock.now().toISOString(),
    });
    // A rename of a settled run is not its terminal evidence.
    const presentation = typeof command.request === "object" && command.request !== null && "displayName" in command.request;
    if (result.kind === "run" && !presentation) {
      this.dependencies.database.settleLifecycleTerminalEvidence(command.commandId);
      const run = repositories.runs.get(result.runId);
      if (run?.lifecycle.state === "terminal" && run.envelope.parent !== undefined) repositories.dependencies.reconcile(run.envelope.parent.runId, this.dependencies.clock.now().toISOString());
    }
  }

  private replayRun(
    result: z.infer<typeof RunLifecycleCommandAuditRecordSchema>["result"],
  ): RunMutationOutcome {
    if (result.kind !== "run") throw new Error(`expected a run replay, found ${result.kind}`);
    const existence = this.read(result.runId);
    if (existence.state === "deleted") {
      return { state: "applied-already", tombstone: existence.tombstone, appliedVersion: result.appliedVersion };
    }
    if (existence.state === "absent") {
      throw new Error(`applied run lifecycle command names ${result.runId}, which is absent without a tombstone`);
    }
    if (existence.run.lifecycle.state === "terminal" && existence.run.lifecycle.outcome !== "interrupted") {
      const resultRecord = this.dependencies.database.authority.runResults.get(result.runId);
      if (resultRecord === undefined) throw new Error("terminal-evidence-result-missing");
    }
    return { state: "applied-already", run: existence.run };
  }

  private replayTerminalization(
    repositories: AuthorityRepositories,
    journal: Extract<LifecycleJournalInspection, { state: "replay" }>,
    expectedKind: "failed" | "done",
  ): RunMutationOutcome {
    if (journal.result.kind !== "run" || journal.command.fence.kind !== "terminal") {
      throw new Error("terminalize replay does not carry a run result and terminal fence");
    }
    const existence = this.read(journal.result.runId);
    if (existence.state !== "present") return this.replayRun(journal.result);
    const { run } = existence;
    const settlement = repositories.runResults.getSettlement(journal.result.runId,journal.result.appliedVersion);
    const authorization = settlement?.run.completion;
    if (journal.result.appliedVersion !== journal.command.fence.expectedVersion + 1
      || run.version < journal.result.appliedVersion || settlement === undefined
      || settlement.run.lifecycle.state !== "terminal" || authorization === undefined
      || authorization.kind !== expectedKind
      || authorization.expectedVersion !== journal.command.fence.expectedVersion
      || authorization.claim.workerId !== journal.command.fence.workerId
      || authorization.claim.claimGeneration !== journal.command.fence.claimGeneration
      || expectedKind === "failed" && (authorization.kind !== "failed" || repositories.failures.get(authorization.failureId) === undefined)) {
      throw new Error(`terminalize replay for ${journal.result.runId} does not match its composite authority`);
    }
    return { state: "applied-already", run };
  }

  private replayDeletion(
    repositories: AuthorityRepositories,
    result: z.infer<typeof RunLifecycleCommandAuditRecordSchema>["result"],
  ): RunDeletionOutcome {
    if (result.kind !== "deletion") throw new Error(`expected a deletion replay, found ${result.kind}`);
    const tombstones = result.runIds.map((runId) => {
      const tombstone = repositories.deletedRuns.get(runId);
      if (tombstone === undefined) {
        throw new Error(`applied deletion command names ${runId}, which has no tombstone`);
      }
      return tombstone;
    });
    return { state: "applied-already", tombstones };
  }

  private replayPurge(
    result: z.infer<typeof RunLifecycleCommandAuditRecordSchema>["result"],
  ): RunPurgeOutcome {
    if (result.kind !== "purge" || result.evidenceClass !== "diagnostic-bundle") {
      throw new Error(`expected a diagnostic-bundle purge replay, found ${result.kind}`);
    }
    return {
      state: "applied-already",
      evidenceClass: "diagnostic-bundle",
      purged: result.purged,
    };
  }
}

function refused(refusal: RunRecordRefusal): Readonly<{ state: "refused"; refusal: RunRecordRefusal }> {
  return { state: "refused", refusal };
}

function journalRun(run: RunRecord) {
  const lifecycle = run.lifecycle;
  return { kind: "run" as const, runId: run.envelope.runId, appliedVersion: run.version,
    ...(run.envelope.continuation === undefined ? {} : { continuation: run.envelope.continuation }),
    ...(lifecycle.state === "terminal" && (lifecycle.outcome === "cancelled" || lifecycle.outcome === "discarded" || lifecycle.outcome === "superseded")
      ? { terminal: { outcome: lifecycle.outcome, endedAt: lifecycle.endedAt } } : {}),
  };
}

function terminalDependencyRefusal(repositories: AuthorityRepositories, rootRunId: string, intent: "join" | "cancel", now: string): RunRecordRefusal | undefined {
  repositories.dependencies.reconcile(rootRunId, now);
  const readiness = repositories.dependencies.readiness(rootRunId, intent);
  if (readiness.state === "ready") return undefined;
  return readiness.state === "blocked" ? { reason: "policy-refused" }
    : { reason: "tree-non-terminal", runId: RunIdSchema.parse(readiness.childRunId) };
}

/** A root run is approved under the current build; a delegated child carries its parent's approval. */
function approvalBuildId(repositories: AuthorityRepositories, parent: RunRecord["envelope"]["parent"]): Fingerprint {
  if (parent === undefined) return currentBuildId();
  const owner = repositories.runs.get(parent.runId);
  if (owner === undefined) throw new Error(`parent run ${parent.runId} is unavailable; a child cannot inherit its approval build`);
  return owner.envelope.buildId;
}
