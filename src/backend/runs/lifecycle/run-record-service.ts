import { deriveWriteAuthorityReason } from "../../../rules/write-safety/write-safety.js";
import { assertWorkerResetParkedWrite } from "../../storage/sqlite/worker-control.js";
import { RuntimeLifetimeLock } from "../../storage/admission/lifetime-lock.js";
import { WorkerControlRefusal, WorkerResetBindingSchema } from "../../../models/run/worker-control.js";
import { authenticateParkedWriteRecheck, authenticateParkedWriteResolution } from "../../../rules/write-safety/parked-resolution.js";
import { RunDeletionRefusedError } from "../../storage/sqlite/native-run-deletion.js";
import { runSettingsAvailable, selectNewRunIdentity } from "../settings/run-settings.js";
import { delegatedCandidateEligible, runRuntimeMatches } from "./run-claim-admission.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { z } from "zod";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import {
  RunExistenceSchema,
  type RunExistence,
  type RunRecordRefusal,
} from "../../../models/config/authority.js";
import {
  RunLifecycleCommandAuditRecordSchema,
  RunLifecycleCommandFenceSchema,
  RunLifecycleCommandRecordSchema,
  type RunLifecycleCommandOperationSchema,
} from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { RuntimeConfigClaimToken } from "../../../models/config/runtime-generation.js";
import { deriveItemId, deriveTraceId, lifecycleCommandId, type IdFactory } from "../../../rules/identity/identifiers.js";
import {
  IsoInstantSchema,
  CommandIdSchema,
  FingerprintSchema,
  RunIdSchema,
  NodeIdSchema,
} from "../../../rules/identity/ids.js";
import { nextAttemptEnvelope } from "../../../models/run/envelope.js";
import { RunRecordSchema, runClaim, runTransitionViolation, type RunRecord } from "../../../models/run/record.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { DeletedRunRecord } from "../../../models/run/deleted-run.js";
import {
  CanonicalCrashRecoveryRequestSchema,
  CanonicalCancellationTerminalizeRequestSchema,
  CanonicalWriteResolutionTransitionRequestSchema,
  CanonicalClaimNextRequestSchema,
  CanonicalCreateRunRequestSchema,
  CanonicalDeleteRequestSchema,
  CanonicalFailureTerminalizeRequestSchema,
  CanonicalListRunsRequestSchema,
  CanonicalPurgeRequestSchema,
  CanonicalRenewClaimRequestSchema,
  CanonicalRequeueRequestSchema,
  CanonicalRetrySourceRequestSchema,
  CanonicalSuccessTerminalizeRequestSchema,
  CanonicalTerminalizeRequestSchema,
  CanonicalTransitionRequestSchema,
  CanonicalWorkerTransitionRequestSchema,
} from "../../storage/sqlite/run-store-contracts.js";
import type { AuthorityDatabase, AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { authenticateCancellationSource, assertResetCancellationAdmission, prepareDelegationRetry } from "../../storage/sqlite/delegation-authority.js";
import { DelegationRetryRequestSchema } from "../../storage/sqlite/delegation-contracts.js";
import { admitDelegation } from "./delegation-admission.js";
import type { ChildRunContext } from "../../runtime/execution/run-executor.js";
import type { DelegationPlan } from "../../../models/workflow/delegation.js";
import type { AnyWorkflowRef } from "../../../models/workflow/graph.js";

const TERMINAL_SELF_EDGE_REFUSAL = "terminal has no self-edge; a settled outcome is settled";

/** Identity and counters are minted inside the service's create transaction. */
export const CreateRunRequestSchema = CanonicalCreateRunRequestSchema;
export type CreateRunRequest = z.input<typeof CreateRunRequestSchema>;

export type RunMutationOutcome =
  | Readonly<{ state: "applied" | "applied-already"; run: RunRecord }>
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
  "claimNext" | "renewClaim" | "workerTransition" | "terminalize" | "requeue" | "admitDelegation" | "assertCurrentExecution">;

export interface RunContinuationPort {
  transition(input: z.input<typeof CanonicalWriteResolutionTransitionRequestSchema>): RunMutationOutcome | RunExistence;
}

export function workerRunLifecyclePort(service: RunRecordService): WorkerRunLifecyclePort {
  return Object.freeze({
    claimNext: service.claimNext.bind(service), renewClaim: service.renewClaim.bind(service),
    workerTransition: service.workerTransition.bind(service), terminalize: service.terminalize.bind(service),
    requeue: service.requeue.bind(service),
    admitDelegation: service.admitDelegation.bind(service),
    assertCurrentExecution: service.assertCurrentExecution.bind(service),
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
  /** Composition supplies the shared runQueuedSpanEvent builder and emitter. */
  publishQueued: (run: RunRecord, publication?: RunQueuedPublication) => void;
  /** Synchronous readiness assertion; runs after replay, before enqueue. */
  admitQueuedRun?: (run: RunRecord) => void;
  resolveDescriptor?: (workflowId: string) => AnyWorkflowDescriptor | undefined;
  buildManifest?: import("../../../models/workflow/build-manifest.js").BuildManifest;
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

  assertCurrentExecution(input: unknown, allowAdmittedReset = false): void {
    try { this.dependencies.database.assertCurrentExecution(input, allowAdmittedReset); }
    catch (error) {
      if (error instanceof WorkerControlRefusal && error.message === "worker-execution-lost") throw new RunLifecycleRefusedError(refused({ reason: "lost" }));
      throw error;
    }
  }

  admitDelegation(context: ChildRunContext, plan: DelegationPlan<AnyWorkflowRef>) {
    return this.dependencies.database.withAuthorityTransaction(() => {
      this.assertCurrentExecution({ runId: context.run.envelope.runId, claim: context.claim });
      return admitDelegation(this.dependencies, context, plan, {
      create: (request, publication) => requireLifecycleApplied(this.createCanonical(request, publication)),
      inspectJournal: (repositories, operation, request, fence) => this.inspectJournal(repositories, operation, request, fence),
      recordJournal: (repositories, command, result) => this.recordJournal(repositories, command, result),
      release: request => this.requeue(request),
      });
    });
  }

  private createCanonical(input: CreateRunRequest, publication?: RunQueuedPublication): RunMutationOutcome {
    const request = CreateRunRequestSchema.parse(input);
    const outcome = this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "create", request, { kind: "none" });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
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
          ...selectNewRunIdentity(repositories, envelope), runId, itemId, traceId: deriveTraceId(code, runId, this.dependencies.clock),
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
      if (repositories.workerControls.pending(`worker-pool:${workflow}`).some(control => control.request.type === "plan-worker-count")) {
        return refused({ reason: "none-eligible" });
      }
      if (repositories.workerControls.pending(`worker-pool:${workflow}`).some(record => record.request.type === "stop-worker" && record.reset === undefined)) throw new Error("worker-reset-authority-unavailable");
      const slot = repositories.workerSlots.get(workerId), lease = repositories.workerLeases.get(workerId);
      if (repositories.workerControls.lifecycleForWorker(workerId) !== undefined
        || lease !== undefined && repositories.workerControls.initializingForWorker(workerId, lease.leaseGeneration) !== undefined) return refused({ reason: "none-eligible" });
      if (repositories.workerControls.resetForWorker(workerId) !== undefined) return refused({ reason: "none-eligible" });
      if (repositories.workerSlots.recovery(workerId) !== undefined || repositories.workerSlots.verification(workerId) !== undefined) return refused({ reason: "none-eligible" });
      if (slot === undefined || slot.retiredAt !== null || slot.workflow !== workflow
        || request.workerLifetime !== undefined && (slot.membershipRevision !== request.workerLifetime.membershipRevision
          || lease?.leaseGeneration !== request.workerLifetime.leaseGeneration || lease.lifecycle.state === "stopped")) return refused({ reason: "none-eligible" });
      if (request.workerLifetime === undefined) return refused({ reason: "none-eligible" });
      if (journal.state === "replay") {
        const replayed = this.replayRun(journal.result);
        if (replayed.state !== "refused" && "run" in replayed && "workerId" in replayed.run.lifecycle) {
          const owner = replayed.run.lifecycle.workerLifetime;
          if (owner === undefined || lease === undefined || owner.leaseGeneration !== lease.leaseGeneration
            || owner.membershipRevision !== slot.membershipRevision || replayed.run.lifecycle.workerId !== workerId) return refused({ reason: "none-eligible" });
        }
        return replayed;
      }
      const held = repositories.runs.listByWorker(workerId).find((run) => runClaim(run) !== undefined);
      if (held !== undefined) return refused({ reason: "worker-busy", runId: held.envelope.runId });
      const outcome = repositories.runs.claimEligible({
        workflow, workerId, ...(request.workerLifetime === undefined ? {} : { workerLifetime: request.workerLifetime }), runtimeConfig, configFingerprint: runtimeConfig.configFingerprint,
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
      const cancellationSource = "cancellationSource" in request ? request.cancellationSource : undefined;
      if (repositories.workerControls.resetForRun(request.runId) !== undefined && (cancellationSource === undefined || !("kind" in cancellationSource))) return refused({ reason: "policy-refused" });
      if (cancellationSource !== undefined) {
        if (!("lifecycle" in request) || request.lifecycle.state !== "terminal" || request.lifecycle.outcome !== "cancelled"
          || !("kind" in cancellationSource) && request.commandId !== lifecycleCommandId("operator-cancel", { commandId: cancellationSource.commandId, runId: request.runId })) throw new Error("delegation-cancellation-request-mismatch");
        const source = authenticateCancellationSource(repositories, current.run, cancellationSource);
        if ("kind" in cancellationSource) assertResetCancellationAdmission(repositories, current.run, cancellationSource, request);
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
              expectedVersion: anchor.version, now: this.dependencies.clock.now().toISOString() });
            if (requested.state !== "applied") throw new Error("cancel tree lost anchor version fence");
            anchor = requested.run;
          }
          this.recordJournal(repositories, journal.command, journalRun(anchor), current.run.lifecycle);
          return { state: "applied" as const, run: anchor };
        }
      }
      if (!("lifecycle" in request)) {
        if (runClaim(current.run) !== undefined) return refused({ reason: "owned-by-worker" });
        if (current.run.lifecycle.state === "terminal") {
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
          expectedVersion: request.expectedVersion, now: this.dependencies.clock.now().toISOString() });
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
      this.assertCurrentExecution({ runId: request.runId, claim: request.claim }, request.lifecycle.state === "parked-write");
      const retainedLifetime = "workerLifetime" in current.run.lifecycle ? current.run.lifecycle.workerLifetime : undefined;
      const lifecycle = "workerId" in request.lifecycle && request.lifecycle.workerLifetime === undefined && retainedLifetime !== undefined
        ? { ...request.lifecycle, workerLifetime: retainedLifetime } : request.lifecycle;
      const result = repositories.runs.transition({ runId: request.runId, claim: request.claim,
        expectedVersion: current.run.version, lifecycle,
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

  settleResetWork(input: unknown): void {
    const reset = WorkerResetBindingSchema.parse(input);
    this.dependencies.database.withAuthorityTransaction(repositories => {
      repositories.workerControls.assertResetGraph(reset);
      const record = repositories.workerControls.get(reset.commandId);
      if (record?.reset === undefined || canonicalJsonStringify(record.reset) !== canonicalJsonStringify(reset)
        || !["executing", "uncertain"].includes(record.phase.state)) throw new Error("worker-reset-settlement-owner-unavailable");
      const slot = repositories.workerSlots.get(reset.member.workerId), lease = repositories.workerLeases.get(reset.member.workerId);
      if (slot === undefined || slot.retiredAt !== null || slot.membershipRevision !== reset.member.membershipRevision || slot.workflow !== reset.member.workflowId
        || lease === undefined || lease.leaseGeneration !== reset.lifetime.leaseGeneration || lease.processId !== reset.lifetime.processId
        || lease.lifecycle.startedAt !== reset.lifetime.startedAt || lease.controlRevision !== reset.reservedControlRevision || lease.controlCommandId !== reset.commandId) throw new Error("worker-reset-settlement-lifetime-conflict");
      const members = reset.work.kind === "absent" ? [] : [reset.work.current, ...reset.work.cascade];
      for (const member of members) {
        const run = repositories.runs.get(member.runId);
        if (run === undefined || run.envelope.attempt !== member.attempt) throw new Error("worker-reset-settlement-run-conflict");
        if (repositories.writeIntents.listByRun(member.runId).some(intent => intent.status === "attempting")) throw new Error("worker-reset-write-callback-unresolved");
        if (member.state === "claimed" && run.lifecycle.state !== "terminal" && run.lifecycle.state !== "parked-write") {
          const claim = runClaim(run);
          if (claim?.workerId !== member.workerId || claim.claimGeneration !== member.claimGeneration) throw new Error("worker-reset-settlement-claim-conflict");
        }
      }
      for (const member of [...members].reverse()) {
        const run = repositories.runs.get(member.runId);
        if (run === undefined) throw new Error("worker-reset-settlement-run-conflict");
        const writes = repositories.writeIntents.listByRun(member.runId);
        if (run.lifecycle.state === "terminal") continue;
        if (run.lifecycle.state === "parked-write") {
          assertWorkerResetParkedWrite(repositories, run);
          continue;
        }
        if (writes.some(intent => intent.status === "parked")) throw new Error("worker-reset-write-release-unproved");
        if (member.state === "queued") {
          if (run.lifecycle.state !== "queued" || run.version !== member.version) throw new Error("worker-reset-cascade-changed");
          const outcome = this.transition({ commandId: lifecycleCommandId("reset-cascade-cancel", { commandId: reset.commandId, runId: member.runId }),
            runId: member.runId, expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: this.dependencies.clock.now().toISOString() },
            cancellationSource: { kind: "worker-reset", commandId: reset.commandId, rootRunId: reset.work.kind === "current" ? reset.work.current.runId : member.runId } });
          if (outcome.state !== "applied") throw new Error("worker-reset-cascade-cancel-refused");
        } else {
          const requested = repositories.runs.requestCancellation({ runId: member.runId, expectedVersion: run.version, now: this.dependencies.clock.now().toISOString() });
          if (requested.state !== "applied") throw new Error("worker-reset-cancel-request-refused");
          const outcome = this.terminalizeCancellation({ kind: "cancelled", commandId: lifecycleCommandId("reset-current-cancel", { commandId: reset.commandId, runId: member.runId }),
            runId: member.runId, expectedVersion: requested.run.version, claim: { workerId: member.workerId, claimGeneration: member.claimGeneration }, endedAt: IsoInstantSchema.parse(this.dependencies.clock.now().toISOString()),
            cancellationSource: { kind: "worker-reset", commandId: reset.commandId, rootRunId: reset.work.kind === "current" ? reset.work.current.runId : member.runId } });
          if (outcome.state !== "applied") throw new Error("worker-reset-cancel-refused");
        }
      }
    });
  }

  private terminalizeCancellation(request: z.infer<typeof CanonicalCancellationTerminalizeRequestSchema>): RunMutationOutcome {
    return this.dependencies.database.withAuthorityTransaction((repositories) => {
      const journal = this.inspectJournal(repositories, "terminalize", request, {
        kind: "terminal", expectedVersion: request.expectedVersion,
        workerId: request.claim.workerId, claimGeneration: request.claim.claimGeneration,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const current = this.read(request.runId);
      if (current.state !== "present") return refused({ reason: "lost" });
      const held = runClaim(current.run);
      if (held === undefined || held.workerId !== request.claim.workerId
        || held.claimGeneration !== request.claim.claimGeneration || current.run.version !== request.expectedVersion) {
        return refused({ reason: "lost" });
      }
      if (request.cancellationSource !== undefined) {
        if (!("kind" in request.cancellationSource)) throw new Error("delegation-cancellation-request-mismatch");
        assertResetCancellationAdmission(repositories, current.run, request.cancellationSource, request);
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
        claim: request.claim, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: request.endedAt },
        now: this.dependencies.clock.now().toISOString() });
      if (outcome.state !== "applied") return refused({ reason: "lost" });
      this.recordJournal(repositories, journal.command, journalRun(outcome.run));
      return { state: "applied", run: outcome.run };
    });
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
    return this.retrySource(input, descriptor, false, publication);
  }

  restart(input: unknown, descriptor: AnyWorkflowDescriptor, publication?: RunQueuedPublication): RunMutationOutcome | RunExistence {
    return this.retrySource(input, descriptor, true, publication);
  }

  private retrySource(input: unknown, descriptor: AnyWorkflowDescriptor, restart: boolean, publication?: RunQueuedPublication): RunMutationOutcome | RunExistence {
    const request = CanonicalRetrySourceRequestSchema.parse(input);
    descriptorRuntimeNodes(descriptor);
    const outcome = this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome | RunExistence => {
      const journal = this.inspectJournal(repositories, restart ? "restart" : "retry", request, {
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
      if (source.disposition !== "live" || run.lifecycle.state !== "terminal") return refused({ reason: "invalid-state" });
      if (repositories.workerControls.resetForRun(run.envelope.runId) !== undefined) return refused({ reason: "policy-refused" });
      if (run.envelope.parent !== undefined && restart) return refused({ reason: "policy-refused" });
      const delegation = run.envelope.parent === undefined ? undefined : prepareDelegationRetry(repositories, run, request);
      if (delegation !== undefined && (repositories.runtimeConfig.get()?.configSnapshotId !== run.envelope.configSnapshotId
        || request.runtimeConfig.configFingerprint !== run.envelope.configFingerprint)) return refused({ reason: "runtime-stale" });
      if (descriptor.id !== run.envelope.workflow || descriptor.version !== run.envelope.descriptorVersion
        || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
        return refused({ reason: "schema-mismatch", digest: run.envelope.contractFingerprint });
      }
      if (!this.runtimeMatches(request.runtimeConfig)) return refused({ reason: "runtime-stale" });
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
      const next = RunRecordSchema.parse({
        envelope: { ...selectNewRunIdentity(repositories, envelope), runId, traceId: deriveTraceId(descriptor.code, runId, this.dependencies.clock),
          retryOf: run.envelope.runId, enqueuedAt: now,
          ...(restart ? { recovery: "restart-from-start" } : {}),
        },
        input: run.input, lifecycle: { state: "queued" }, claimGeneration: 0,
        runNumber: repositories.runs.nextWorkflowRunNumber(run.envelope.workflow),
        ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
        ...(request.appVersion === undefined ? {} : { appVersion: request.appVersion }),
        version: 1, createdAt: now, updatedAt: now,
      });
      this.dependencies.admitQueuedRun?.(next);
      repositories.runs.enqueue(next);
      if (delegation !== undefined) {
        const retryRequest = DelegationRetryRequestSchema.parse({ commandId: lifecycleCommandId("delegation-retry", {
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
        repositories.dependencies.activateRetry(retryRequest, now);
        this.recordJournal(repositories, retryJournal.command, journalRun(next));
      }
      this.recordJournal(repositories, journal.command, journalRun(next));
      this.dependencies.publishQueued(next, publication);
      return { state: "applied", run: next };
    });
    return outcome;
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
            ...event, pid: process.pid, ts: occurredAt, workflow: run.envelope.workflow,
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
    if (result.kind === "run") {
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
    const authorization = run.completion;
    const failureCount = repositories.failures.listByRun(journal.result.runId).length;
    const result = repositories.runResults.get(journal.result.runId);
    if (journal.result.appliedVersion !== journal.command.fence.expectedVersion + 1
      || run.version < journal.result.appliedVersion
      || run.lifecycle.state !== "terminal"
      || authorization === undefined
      || authorization.kind !== expectedKind
      || authorization.expectedVersion !== journal.command.fence.expectedVersion
      || authorization.claim.workerId !== journal.command.fence.workerId
      || authorization.claim.claimGeneration !== journal.command.fence.claimGeneration
      || (expectedKind === "failed" ? failureCount !== 1 || result === undefined : failureCount !== 0 || result === undefined)) {
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
