import { z } from "zod";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../base/workflow.js";
import { CURRENT_ARCHIVE_SCHEMA_GENERATION } from "../domain/archive/model.js";
import {
  RunExistenceSchema,
  type RunExistence,
  type RunRecordRefusal,
} from "../domain/authority.js";
import {
  RunLifecycleCommandAuditRecordSchema,
  RunLifecycleCommandFenceSchema,
  RunLifecycleCommandRecordSchema,
  type RunLifecycleCommandOperationSchema,
} from "../domain/commands.js";
import { canonicalJsonStringify } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import type { RuntimeConfigClaimToken } from "../domain/config/runtime-generation.js";
import { deriveItemId, deriveTraceId, type IdFactory } from "../domain/identifiers.js";
import {
  CommandIdSchema,
  FingerprintSchema,
  RunIdSchema,
} from "../domain/ids.js";
import { nextAttemptEnvelope } from "../domain/run/envelope.js";
import { RunRecordSchema, runClaim, runTransitionViolation, type RunRecord } from "../domain/run/record.js";
import { sha256Hex } from "../domain/sha256.js";
import type { DeletedRunRecord } from "../domain/run/deleted-run.js";
import {
  CanonicalArchiveRequestSchema,
  CanonicalClaimNextRequestSchema,
  CanonicalCreateRunRequestSchema,
  CanonicalDeleteArchivedRequestSchema,
  CanonicalDeleteRequestSchema,
  CanonicalFailureTerminalizeRequestSchema,
  CanonicalListRunsRequestSchema,
  CanonicalPurgeRequestSchema,
  CanonicalRelaunchRequestSchema,
  CanonicalRenewClaimRequestSchema,
  CanonicalRequeueRequestSchema,
  CanonicalRetrySourceRequestSchema,
  CanonicalSuccessTerminalizeRequestSchema,
  CanonicalTerminalizeRequestSchema,
  CanonicalTransitionRequestSchema,
  CanonicalWorkerTransitionRequestSchema,
} from "../infra/sqlite/run-store-contracts.js";
import { ArchiveRelaunchStorageRecordSchema } from "../infra/sqlite/storage-records.js";
import type { AuthorityDatabase, AuthorityRepositories } from "../infra/sqlite/authority-database.js";

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

export type RunRecordServiceDependencies = Readonly<{
  database: AuthorityDatabase;
  clock: Clock;
  ids: IdFactory;
  /** Composition supplies the shared runQueuedSpanEvent builder and emitter. */
  publishQueued: (run: RunRecord) => void;
}>;

/** D330: one lifecycle authority; projections never enter this service. */
export class RunRecordService {
  constructor(
    private readonly dependencies: RunRecordServiceDependencies,
    private readonly hooks?: Readonly<{ afterCreateReservation?: () => void }>,
  ) {}

  read(input: string): RunExistence {
    const runId = RunIdSchema.parse(input);
    return this.dependencies.database.withAuthorityReadSnapshot(() => {
      const { runs, deletedRuns, archivedRuns } = this.dependencies.database.authority;
      const tombstone = deletedRuns.get(runId);
      const run = runs.get(runId);
      if (tombstone !== undefined && run !== undefined) throw new Error(`run ${runId} has both lifecycle authority and a tombstone`);
      if (tombstone !== undefined) return RunExistenceSchema.parse({ state: "deleted", tombstone });
      if (run === undefined) return RunExistenceSchema.parse({ state: "absent", runId });
      const archived = archivedRuns.isArchived(runId);
      if (archived && run.lifecycle.state !== "terminal") throw new Error(`archived run ${runId} is not terminal`);
      return RunExistenceSchema.parse({
        state: "present", run,
        disposition: archived ? "archived" : "live",
      });
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
      const workflows = request.workflow === undefined
        ? database.authority.runs.listWorkflows() : [request.workflow];
      const rows = workflows.flatMap((workflow) => database.authority.runs.listByWorkflow(workflow))
        .filter((run) => database.authority.archivedRuns.isArchived(run.envelope.runId)
          === (request.disposition === "archived"))
        .sort(compareRuns);
      const offset = cursor === undefined ? 0 : cursor.offset;
      const page = rows.slice(offset, offset + request.limit);
      return {
        state: "listed" as const,
        rows: page,
        ...(offset + page.length >= rows.length ? {} : {
          cursor: { generation, offset: offset + page.length, disposition: request.disposition,
            ...(request.workflow === undefined ? {} : { workflow: request.workflow }) },
        }),
      };
    });
  }

  create(input: CreateRunRequest): RunMutationOutcome {
    const request = CreateRunRequestSchema.parse(input);
    const outcome = this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "create", request, { kind: "none" });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      if (!this.runtimeMatches(request.runtimeConfig)
        || request.configFingerprint !== request.runtimeConfig.configFingerprint) return refused({ reason: "runtime-stale" });
      const snapshot = repositories.configSnapshots.get(request.configSnapshotId);
      if (snapshot === undefined || snapshot.fingerprint !== request.configFingerprint) return refused({ reason: "runtime-stale" });
      const runId = RunIdSchema.parse(this.dependencies.ids.uuid());
      if (repositories.deletedRuns.get(runId) !== undefined) return refused({ reason: "tombstoned" });
      if (repositories.runs.get(runId) !== undefined) return refused({ reason: "identity-conflict", field: "runId" });
      const itemId = deriveItemId(request.workflow, request.matchKey);
      if (request.parent !== undefined) {
        const parent = this.read(request.parent.runId);
        if (parent.state !== "present" || parent.run.envelope.workflow !== request.workflow) {
          return refused({ reason: "parent-missing" });
        }
      }
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
          ...envelope, runId, itemId, traceId: deriveTraceId(code, runId, this.dependencies.clock),
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
      repositories.runs.enqueue(run);
      this.recordJournal(repositories, journal.command, journalRun(run));
      return { state: "applied", run };
    });
    if (outcome.state === "applied") {
      this.dependencies.database.afterAuthorityCommit(() => this.dependencies.publishQueued(outcome.run));
    }
    return outcome;
  }

  claimNext(input: unknown): RunMutationOutcome {
    const raw = z.record(z.string(), z.unknown()).parse(input);
    if (raw.runtimeConfig === undefined) return refused({ reason: "runtime-stale" });
    const request = CanonicalClaimNextRequestSchema.parse(input);
    const { workflow, workerId, runtimeConfig } = request;
    return this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome => {
      const journal = this.inspectJournal(repositories, "claim-next", request, { kind: "none" });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      if (!this.runtimeMatches(runtimeConfig)) return refused({ reason: "runtime-stale" });
      const held = repositories.runs.listByWorker(workerId).find((run) => runClaim(run) !== undefined);
      if (held !== undefined) return refused({ reason: "worker-busy", runId: held.envelope.runId });
      const outcome = repositories.runs.claimEligible({
        workflow, workerId, runtimeConfig, configFingerprint: runtimeConfig.configFingerprint,
        now: this.dependencies.clock.now().toISOString(),
      });
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
      if (current.disposition === "archived") return refused({ reason: "already-archived" });
      if ("lifecycle" in request
        && request.lifecycle.state === "terminal"
        && request.lifecycle.outcome === "cancelled"
        && current.run.envelope.parent === undefined
        && current.run.envelope.shape === "operation") {
        const members: RunRecord[] = [];
        const collect = (runId: string): void => {
          for (const child of repositories.runs.listChildren(runId)) {
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
          const cancelled = repositories.runs.transition({
            runId: member.envelope.runId,
            expectedVersion: member.version,
            lifecycle: {
              state: "terminal",
              outcome: "cancelled",
              endedAt: request.lifecycle.endedAt,
            },
            now: this.dependencies.clock.now().toISOString(),
          });
          if (cancelled.state !== "applied") {
            throw new Error(`cancel tree lost member version fence for ${member.envelope.runId}`);
          }
        }
        const stillActive = members
          .map((member) => repositories.runs.get(member.envelope.runId))
          .find((member) => member !== undefined && member.lifecycle.state !== "terminal");
        if (stillActive !== undefined) {
          this.recordJournal(repositories, journal.command, journalRun(current.run));
          return { state: "applied" as const, run: current.run };
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
        this.recordJournal(repositories, journal.command, journalRun(result.run));
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
        this.recordJournal(repositories, journal.command, journalRun(requested.run));
        return { state: "applied" as const, run: requested.run };
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
        const activeMember = findNonTerminalTreeMember(repositories, request.runId);
        if (activeMember !== undefined) {
          return refused({ reason: "tree-non-terminal", runId: activeMember.envelope.runId });
        }
      }
      const now = this.dependencies.clock.now().toISOString();
      const result = current.run.lifecycle.state === "parked-gate" && request.lifecycle.state === "queued"
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
      this.recordJournal(repositories, journal.command, journalRun(result.run));
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
      const held = runClaim(current.run);
      if (held === undefined || held.workerId !== request.claim.workerId
        || held.claimGeneration !== request.claim.claimGeneration) return refused({ reason: "lost" });
      const violation = runTransitionViolation(current.run.lifecycle, request.lifecycle);
      if (violation !== undefined || request.lifecycle.state === "terminal"
        || ("workerId" in request.lifecycle && request.lifecycle.workerId !== held.workerId)) {
        return refused({ reason: "illegal-transition", from: current.run.lifecycle.state,
          to: request.lifecycle.state, message: violation === undefined ? "worker transition cannot replace ownership or settle" : violation });
      }
      const result = repositories.runs.transition({ runId: request.runId, claim: request.claim,
        expectedVersion: current.run.version, lifecycle: request.lifecycle,
        now: this.dependencies.clock.now().toISOString() });
      if (result.state === "conflict") return refused({ reason: "lost" });
      this.recordJournal(repositories, journal.command, journalRun(result.run));
      return { state: "applied", run: result.run };
    });
  }

  terminalize(
    input: unknown,
    descriptor: AnyWorkflowDescriptor,
    factoryAuthorization?: object,
  ): RunMutationOutcome {
    const request = CanonicalTerminalizeRequestSchema.parse(input);
    return request.kind === "failure"
      ? this.terminalizeFailure({ commandId: request.commandId, terminal: request.terminal }, descriptor)
      : this.terminalizeSuccess(
          { commandId: request.commandId, terminal: request.terminal },
          factoryAuthorization,
        );
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
      const activeMember = findNonTerminalTreeMember(repositories, authorization.runId);
      if (activeMember !== undefined) {
        return refused({ reason: "tree-non-terminal", runId: activeMember.envelope.runId });
      }
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
      const activeMember = findNonTerminalTreeMember(repositories, authorization.runId);
      if (activeMember !== undefined) {
        return refused({ reason: "tree-non-terminal", runId: activeMember.envelope.runId });
      }
      const report = this.dependencies.database.terminalizeSuccess(request.terminal, factoryAuthorization);
      this.recordJournal(repositories, journal.command, journalRun(report.run));
      return { state: report.state === "replayed" ? "applied-already" : "applied", run: report.run };
    });
  }

  requeue(input: unknown): RunMutationOutcome | RunExistence {
    const request = CanonicalRequeueRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome | RunExistence => {
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
      if (existence.disposition === "archived") return refused({ reason: "invalid-state" });
      const held = runClaim(run);
      if (held !== undefined) {
        if (request.claim !== undefined
          && (request.claim.workerId !== held.workerId
            || request.claim.claimGeneration !== held.claimGeneration)) {
          return refused({ reason: "lost" });
        }
        if (request.claim === undefined && request.staleBefore === undefined) {
          return refused({
            reason: "illegal-transition",
            from: run.lifecycle.state,
            to: "queued",
            message: "a claimed run requires its claim fence or an expired-heartbeat recovery admission",
          });
        }
        if (request.staleBefore !== undefined
          && Date.parse(held.heartbeatAt) >= Date.parse(request.staleBefore)) {
          return refused({ reason: "heartbeat-live" });
        }
      } else if (!(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "interrupted")) {
        return refused({
          reason: "illegal-transition",
          from: run.lifecycle.state,
          to: "queued",
          message: "only an owned, expired, or terminal interrupted run may be requeued",
        });
      }
      const now = this.dependencies.clock.now().toISOString();
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

  retry(input: unknown, descriptor: AnyWorkflowDescriptor): RunMutationOutcome | RunExistence {
    return this.retrySource(input, descriptor, false);
  }

  restart(input: unknown, descriptor: AnyWorkflowDescriptor): RunMutationOutcome | RunExistence {
    return this.retrySource(input, descriptor, true);
  }

  relaunch(input: unknown, descriptor: AnyWorkflowDescriptor): RunMutationOutcome | RunExistence {
    const request = CanonicalRelaunchRequestSchema.parse(input);
    descriptorRuntimeNodes(descriptor);
    const outcome = this.dependencies.database.withAuthorityTransaction((repositories): RunMutationOutcome | RunExistence => {
      const journal = this.inspectJournal(repositories, "relaunch", request, { kind: "none" });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const archived = repositories.archivedRuns.get(request.archivedRunId);
      if (archived === undefined) {
        const tombstone = repositories.deletedRuns.get(request.archivedRunId);
        return tombstone === undefined
          ? { state: "absent", runId: request.archivedRunId }
          : refused({ reason: "source-deleted" });
      }
      if (archived.contentDigest !== request.contentDigest) {
        return refused({ reason: "schema-mismatch", digest: request.contentDigest });
      }
      const create = request.create;
      if (descriptor.id !== archived.workflowId || create.workflow !== descriptor.id) {
        return refused({ reason: "workflow-unregistered" });
      }
      if (create.descriptorVersion !== descriptor.version
        || create.contractFingerprint !== descriptor.contractFingerprint
        || canonicalJsonStringify(create.input.raw) !== canonicalJsonStringify(archived.input.raw)) {
        return refused({ reason: "schema-mismatch", digest: archived.contentDigest });
      }
      if (!this.runtimeMatches(create.runtimeConfig)
        || create.configFingerprint !== create.runtimeConfig.configFingerprint) {
        return refused({ reason: "runtime-stale" });
      }
      const snapshot = repositories.configSnapshots.get(create.configSnapshotId);
      if (snapshot === undefined || snapshot.fingerprint !== create.configFingerprint) {
        return refused({ reason: "runtime-stale" });
      }
      if (create.sessionId !== undefined) {
        const session = repositories.runSessions.get(create.sessionId);
        if (session === undefined || session.workflow !== create.workflow) {
          return refused({ reason: "identity-conflict", field: "sessionId" });
        }
      }
      const runId = RunIdSchema.parse(this.dependencies.ids.uuid());
      if (repositories.deletedRuns.get(runId) !== undefined) return refused({ reason: "tombstoned" });
      if (repositories.runs.get(runId) !== undefined) return refused({ reason: "identity-conflict", field: "runId" });
      const now = this.dependencies.clock.now().toISOString();
      const itemId = deriveItemId(create.workflow, create.matchKey);
      const { code, matchKey, runtimeConfig, input: storedInput, sessionId, appVersion, ...envelope } = create;
      void matchKey; void runtimeConfig;
      const run = RunRecordSchema.parse({
        envelope: {
          ...envelope,
          runId,
          itemId,
          traceId: deriveTraceId(code, runId, this.dependencies.clock),
          attempt: repositories.runs.nextItemAttempt({ workflow: create.workflow, itemId }),
          enqueuedAt: now,
        },
        input: storedInput,
        lifecycle: { state: "queued" },
        claimGeneration: 0,
        runNumber: repositories.runs.nextWorkflowRunNumber(create.workflow),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(appVersion === undefined ? {} : { appVersion }),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      repositories.runs.enqueue(run);
      repositories.archiveRelaunches.insert(ArchiveRelaunchStorageRecordSchema.parse({
        archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
        runId,
        archivedRunId: archived.runId,
        relaunchedIdentity: {
          workflowId: descriptor.id,
          descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint,
        },
        relaunchedBy: request.relaunchedBy,
        relaunchedAt: now,
      }));
      this.recordJournal(repositories, journal.command, journalRun(run));
      return { state: "applied", run };
    });
    if (outcome.state === "applied") {
      this.dependencies.database.afterAuthorityCommit(() => this.dependencies.publishQueued(outcome.run));
    }
    return outcome;
  }

  private retrySource(input: unknown, descriptor: AnyWorkflowDescriptor, restart: boolean): RunMutationOutcome | RunExistence {
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
      if (run.envelope.parent !== undefined) return refused({ reason: "policy-refused" });
      if (descriptor.id !== run.envelope.workflow || descriptor.version !== run.envelope.descriptorVersion
        || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
        return refused({ reason: "schema-mismatch", digest: run.envelope.contractFingerprint });
      }
      if (!this.runtimeMatches(request.runtimeConfig)
        || run.envelope.configFingerprint !== request.runtimeConfig.configFingerprint) return refused({ reason: "runtime-stale" });
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
      const next = RunRecordSchema.parse({
        envelope: { ...envelope, runId, traceId: deriveTraceId(descriptor.code, runId, this.dependencies.clock),
          retryOf: run.envelope.runId, enqueuedAt: now,
          ...(restart ? { recovery: "restart-from-start" } : {}),
        },
        input: run.input, lifecycle: { state: "queued" }, claimGeneration: 0,
        runNumber: repositories.runs.nextWorkflowRunNumber(run.envelope.workflow),
        ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
        ...(request.appVersion === undefined ? {} : { appVersion: request.appVersion }),
        version: 1, createdAt: now, updatedAt: now,
      });
      repositories.runs.enqueue(next);
      this.recordJournal(repositories, journal.command, journalRun(next));
      return { state: "applied", run: next };
    });
    if (outcome.state === "applied") {
      this.dependencies.database.afterAuthorityCommit(() => this.dependencies.publishQueued(outcome.run));
    }
    return outcome;
  }

  archive(input: unknown): RunMutationOutcome | RunExistence {
    const request = CanonicalArchiveRequestSchema.parse(input);
    return this.dependencies.database.withAuthorityTransaction((repositories) => {
      const journal = this.inspectJournal(repositories, "archive", request, {
        kind: "version",
        expectedVersion: request.expectedVersion,
      });
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayRun(journal.result);
      const current = this.read(request.archive.runId);
      if (current.state !== "present") return current;
      const existing = repositories.archivedRuns.get(request.archive.runId);
      if (existing !== undefined) {
        if (canonicalJsonStringify(existing) === canonicalJsonStringify(request.archive)) {
          return { state: "applied-already" as const, run: current.run };
        }
        return refused({ reason: "already-archived" });
      }
      if (current.run.version !== request.expectedVersion) return refused({ reason: "conflict", currentVersion: current.run.version });
      if (current.run.lifecycle.state !== "terminal") return refused({ reason: "not-terminal" });
      if (repositories.archivedRuns.bindingMismatches(request.archive).length !== 0) {
        return refused({ reason: "schema-mismatch", digest: request.archive.contentDigest });
      }
      repositories.archivedRuns.insert(request.archive);
      const updated = repositories.runs.advanceRevision({ runId: request.archive.runId,
        expectedVersion: request.expectedVersion, now: this.dependencies.clock.now().toISOString() });
      if (updated.state !== "applied") throw new Error("archive lost its transaction-local version fence");
      this.recordJournal(repositories, journal.command, journalRun(updated.run));
      return { state: "applied" as const, run: updated.run };
    });
  }

  delete(input: unknown) {
    const request = CanonicalDeleteRequestSchema.parse(input);
    return this.deleteTree({ ...request, origin: "queue" });
  }

  deleteArchived(input: unknown) {
    const request = CanonicalDeleteArchivedRequestSchema.parse(input);
    return this.deleteTree({ ...request, origin: "archive" });
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

  private deleteTree(request: Readonly<{ commandId: string; runId: string }> & (
    | Readonly<{ origin: "queue"; expectedVersion: number }>
    | Readonly<{ origin: "archive"; contentDigest: string }>
  )): RunDeletionOutcome {
    return this.dependencies.database.withAuthorityTransaction((repositories): RunDeletionOutcome => {
      const journal = this.inspectJournal(
        repositories,
        request.origin === "queue" ? "delete" : "delete-archived",
        request,
        request.origin === "queue"
          ? { kind: "version", expectedVersion: request.expectedVersion }
          : { kind: "none" },
      );
      if (journal.state === "divergent") return refused({ reason: "replay-divergent" });
      if (journal.state === "replay") return this.replayDeletion(repositories, journal.result);
      const existence = this.read(request.runId);
      if (existence.state === "deleted") return refused({ reason: "tombstoned" });
      if (existence.state === "absent") return existence;
      const { run } = existence;
      if (request.origin === "queue") {
        if (run.version !== request.expectedVersion) return refused({ reason: "conflict", currentVersion: run.version });
        if (existence.disposition === "archived") return refused({ reason: "use-archive-door" });
      } else {
        const archive = repositories.archivedRuns.get(request.runId);
        if (archive === undefined || archive.contentDigest !== request.contentDigest) {
          return refused({ reason: "schema-mismatch", digest: FingerprintSchema.parse(request.contentDigest) });
        }
      }
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
      const active = leaves.find((member) => member.lifecycle.state !== "terminal");
      if (active !== undefined) return refused({ reason: "tree-non-terminal", runId: active.envelope.runId });
      const now = this.dependencies.clock.now().toISOString();
      const tombstones = leaves.map((member) => {
        const runId = member.envelope.runId;
        return repositories.runs.delete({ runId, commandId: request.commandId, now,
          origin: repositories.archivedRuns.isArchived(runId) ? "archive" : "queue" });
      });
      this.recordJournal(repositories, journal.command, {
        kind: "deletion",
        runIds: tombstones.map((tombstone) => tombstone.runId),
      });
      return { state: "deleted" as const, tombstones };
    });
  }

  private runtimeMatches(token: RuntimeConfigClaimToken): boolean {
    const { runtimeConfig, settingsCurrent } = this.dependencies.database.authority;
    const active = runtimeConfig.get();
    if (active === undefined || active.generation !== token.generation
      || active.settingsRevision !== token.settingsRevision
      || active.settingsFingerprint !== token.settingsFingerprint
      || active.configFingerprint !== token.configFingerprint) return false;
    const settings = settingsCurrent.get();
    // The never-applied baseline has no settings_current journal row (D331.4).
    return settings === undefined ? token.settingsRevision === 1
      : settings.revision === token.settingsRevision && settings.settingsFingerprint === token.settingsFingerprint;
  }

  private inspectJournal(
    repositories: AuthorityRepositories,
    operation: LifecycleOperation,
    request: unknown,
    fence: LifecycleFence,
  ): LifecycleJournalInspection {
    const parsedFence = RunLifecycleCommandFenceSchema.parse(fence);
    const commandId = CommandIdSchema.parse((request as { commandId?: unknown }).commandId);
    const requestFingerprint = FingerprintSchema.parse(sha256Hex(
      `hrauto:run-lifecycle-command:v1\0${operation}\0${canonicalJsonStringify(request)}`,
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
          fence: parsedFence,
          recordedAt: this.dependencies.clock.now().toISOString(),
        }),
      };
    }
    if (!("kind" in existing) || existing.kind !== "run-lifecycle"
      || existing.operation !== operation
      || existing.requestFingerprint !== requestFingerprint
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

  private recordJournal(
    repositories: AuthorityRepositories,
    command: z.infer<typeof RunLifecycleCommandRecordSchema>,
    result: z.input<typeof RunLifecycleCommandAuditRecordSchema>["result"],
  ): void {
    repositories.lifecycleJournal.insertCommand(command);
    repositories.lifecycleJournal.insertAudit({
      kind: "run-lifecycle",
      auditId: command.commandId,
      request: command,
      result,
      completedAt: this.dependencies.clock.now().toISOString(),
    });
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
    const authorization = repositories.terminalAuthorizations.get(journal.result.runId);
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
      || (expectedKind === "failed" ? failureCount !== 1 || result !== undefined : failureCount !== 0 || result === undefined)) {
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
  return { kind: "run" as const, runId: run.envelope.runId, appliedVersion: run.version };
}

function findNonTerminalTreeMember(
  repositories: AuthorityRepositories,
  rootRunId: string,
): RunRecord | undefined {
  const visited = new Set<string>();
  const visit = (parentRunId: string): RunRecord | undefined => {
    if (visited.has(parentRunId)) throw new Error(`cycle in run parent tree ${parentRunId}`);
    visited.add(parentRunId);
    for (const child of repositories.runs.listChildren(parentRunId)) {
      if (child.lifecycle.state !== "terminal") return child;
      const nested = visit(child.envelope.runId);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return visit(rootRunId);
}

function compareRuns(left: RunRecord, right: RunRecord): number {
  const priority = Number(left.envelope.priority === "bulk") - Number(right.envelope.priority === "bulk");
  if (priority !== 0) return priority;
  const time = Date.parse(left.envelope.enqueuedAt) - Date.parse(right.envelope.enqueuedAt);
  if (time !== 0) return time;
  return left.envelope.runId < right.envelope.runId ? -1 : left.envelope.runId === right.envelope.runId ? 0 : 1;
}
