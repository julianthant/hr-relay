import { randomUUID } from "node:crypto";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { RecoveryActivitySchema, recoveryActivitySpanPath } from "../../../models/run/recovery-activity.js";
import type { RunRecord } from "../../../models/run/record.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { deriveStableUuid } from "../../../rules/identity/identifiers.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import { TaskError } from "../../../workflow-kit/errors.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { createConfirmedInvocation } from "../../logs/confirmed-invocation.js";
import { drainBrowserActionNotes } from "../../logs/browser-action-drain.js";
import { createNoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { withBrowserActionNotes, type BrowserAction } from "../../systems/browser-shared/action-notes.js";
import type { RunConfigFingerprintBinding } from "../workers/worker-sessions.js";
import { WorkerSessionClosureUnprovedError } from "../workers/worker-sessions.js";
import { BrowserSessionClosureUnprovedError } from "../../../workflow-kit/session.js";
import { DuoCeremonyReleaseFailedError } from "../gates/duo-ceremony-gate.js";
import { executeIdempotencyProbe, type ProbeReadDeps, type TransactionSessionHost } from "./write-sequencer.js";
import type { TransactionRuntimeNode } from "./write-resolution-binding.js";

export class RecoveryActivityError extends WorkerControlRefusal {
  readonly code = "WRITE_RECOVERY_ACTIVITY_UNAVAILABLE";
  constructor(cause: unknown) {
    super(ERROR_CATALOG.WRITE_RECOVERY_ACTIVITY_UNAVAILABLE.text, { cause });
  }
}

function containsFailure(error: unknown, matches: (error: unknown) => boolean): boolean {
  if (matches(error)) return true;
  if (error instanceof AggregateError && error.errors.some(cause => containsFailure(cause, matches))) return true;
  return error instanceof Error && error.cause !== undefined && containsFailure(error.cause, matches);
}

export async function executeRecoveryProbe(input: Readonly<{
  operation: "diagnostic-recovery" | "parked-write-check";
  repositories: AuthorityRepositories;
  run: RunRecord;
  intent: Exclude<WriteIntentRecord, { status: "observed-present" }>;
  descriptor: AnyWorkflowDescriptor;
  node: TransactionRuntimeNode;
  commitInput: unknown;
  signal: AbortSignal;
  probe: ProbeReadDeps;
  sessions: Pick<TransactionSessionHost, "withDriver" | "closeAll"> & RunConfigFingerprintBinding;
  configureRun?: () => Readonly<{ taskDeadlineMs: number }>;
}>) {
  input.signal.throwIfAborted();
  const { run, intent, probe, sessions, repositories } = input;
  const instance = run.envelope.resolvedInstance[intent.system];
  if (instance === undefined) throw new RecoveryActivityError(new Error("recovery-instance-unavailable"));
  const runVersion = run.version;
  const activity = RecoveryActivitySchema.parse({ activityId: randomUUID(), operation: input.operation,
    runId: run.envelope.runId, workflow: run.envelope.workflow, attempt: run.envelope.attempt,
    traceId: run.envelope.traceId, nodeId: input.node.id, writeIntentId: intent.writeIntentId,
    generation: intent.generation, writeAttemptId: intent.currentAttemptId, openedAt: probe.clock.now().toISOString() });
  const started = { schemaVersion: 1 as const, eventId: activity.activityId, workflow: activity.workflow,
    scope: { kind: "run" as const, runId: activity.runId }, occurredAt: activity.openedAt,
    recordedAt: activity.openedAt, retentionDate: localDatePart(new Date(activity.openedAt)),
    payload: { kind: "recovery-activity-started" as const, ...activity }, source: { kind: "native" as const } };
  try {
    if (repositories.timelineEvents.append(started).state !== "inserted") throw new Error("recovery-activity-already-opened");
  } catch (error) { throw new RecoveryActivityError(error); }

  let active = true;
  let noteFailure: unknown;
  const endId = deriveStableUuid("recovery-activity-ended", activity.activityId);
  const assertOpen = (): void => {
    const saved = repositories.timelineEvents.get(activity.activityId);
    const current = repositories.runs.get(activity.runId);
    const currentIntent = repositories.writeIntents.get(activity.writeIntentId);
    if (!active || saved?.payload.kind !== "recovery-activity-started"
      || canonicalJsonStringify(saved.payload) !== canonicalJsonStringify(started.payload)
      || repositories.timelineEvents.get(endId) !== undefined || current?.version !== runVersion
      || current.envelope.attempt !== activity.attempt || current.envelope.traceId !== activity.traceId
      || currentIntent === undefined || currentIntent.status === "observed-present"
      || currentIntent.currentAttemptId !== activity.writeAttemptId || currentIntent.generation !== activity.generation) {
      throw new Error("recovery-activity-not-open");
    }
  };
  const notes = createNoteTimelineWriter({ repository: repositories.timelineEvents, clock: probe.clock,
    recoveryActivity: { activity, assertOpen } });
  const address = { runId: activity.runId, attempt: activity.attempt, traceId: activity.traceId,
    spanPath: recoveryActivitySpanPath(activity) };
  const emit = (action: BrowserAction): void => {
    try { notes.emitRunAction({ workflow: activity.workflow, address, action }, run); }
    catch (error) { noteFailure = new RecoveryActivityError(error); throw noteFailure; }
  };
  let outcome: Awaited<ReturnType<typeof executeIdempotencyProbe>> | undefined;
  let failure: unknown;
  let closureFailure: unknown;
  try {
    outcome = await withBrowserActionNotes(probe.clock, async () => {
      try { await sessions.closeAll("parked"); }
      catch (error) {
        closureFailure = error;
        throw error;
      }
      let resources: Readonly<{ taskDeadlineMs: number }> | undefined;
      try {
        resources = input.configureRun?.();
        sessions.bindRunConfigFingerprint(FingerprintSchema.parse(run.envelope.configFingerprint), run.envelope.browserMode,
          { runId: activity.runId, descriptorFingerprint: run.envelope.contractFingerprint });
      } catch (error) { throw new RecoveryActivityError(error); }
      let callbackSettlement: Promise<unknown> | undefined;
      let probeFailure: unknown;
      let acceptingActions = true;
      let verdict: typeof outcome;
      try {
        const snapshot = run.envelope.operationDisplaySnapshot;
        verdict = await executeIdempotencyProbe({ ...probe, sessions, taskDeadlineMs: resources?.taskDeadlineMs ?? probe.taskDeadlineMs,
          retainCallback: settlement => { callbackSettlement = settlement; probe.retainCallback?.(settlement); } }, {
          commitContract: input.node.commit.uses, commitInput: input.commitInput,
          instance, signal: input.signal,
          screenshotOwner: { nodeId: activity.nodeId, attempt: activity.attempt, log: probe.log },
          actionBinderForInput: (taskId, parsedInput) => {
            try {
            const system = probe.stores.stores.flatMap(store => Object.values(store.tasks))
              .find(task => task.contract.id === taskId)?.driver?.system;
            const invocation = snapshot === undefined ? undefined : createConfirmedInvocation({ binding: {
              snapshot, runId: activity.runId, attempt: activity.attempt, claimGeneration: run.claimGeneration,
              taskAttempt: 1, nodeId: activity.nodeId, taskId, contractRole: "probe",
              parsedInput: JsonValueSchema.parse(parsedInput), protectedBindings: retainedRunProtectedBindings(run),
              runInput: run.input.parsed.value,
              ...(input.descriptor.operationDisplay?.capability === "complete" ? { transforms: input.descriptor.operationDisplay.transforms } : {}),
              ...(run.envelope.parent === undefined ? {} : { childInvocation: { parentRunId: run.envelope.parent.runId, edgeId: run.envelope.parent.edgeId } }),
            }, clock: probe.clock, traceId: activity.traceId, registeredDriverSystem: system });
            return action => {
              try {
                if (!acceptingActions) throw probeFailure;
                input.signal.throwIfAborted();
                assertOpen();
                return invocation?.binder(action) ?? action;
              } catch (error) {
                if (!acceptingActions || input.signal.aborted) throw error;
                noteFailure = new RecoveryActivityError(error); throw noteFailure;
              }
            };
            } catch (error) { noteFailure = new RecoveryActivityError(error); throw noteFailure; }
          },
        });
      } catch (error) { acceptingActions = false; probeFailure = error; }
      const cleanup: unknown[] = [];
      try { await sessions.closeAll("parked"); } catch (error) { closureFailure = error; cleanup.push(error); }
      try { await callbackSettlement; } catch (error) { cleanup.push(error); }
      try { sessions.releaseRunConfigFingerprint(); } catch (error) { closureFailure ??= error; cleanup.push(error); }
      const custodyFailure = cleanup.find(error => error instanceof WorkerSessionClosureUnprovedError
        || error instanceof BrowserSessionClosureUnprovedError || error instanceof DuoCeremonyReleaseFailedError);
      if (custodyFailure !== undefined && cleanup.length === 1 && probeFailure === undefined) throw custodyFailure;
      if (cleanup.length > 0) throw new RecoveryActivityError(new AggregateError(
        probeFailure === undefined ? cleanup : [probeFailure, ...cleanup], "Recovery probe cleanup failed"));
      if (probeFailure !== undefined) throw probeFailure;
      return verdict!;
    }, actions => {
      const status = drainBrowserActionNotes({ actions,
        emitAction: emit, warn: () => probe.log.warn("Recovery action note could not be recorded") });
      if (status.failed > 0) throw noteFailure;
    });
  } catch (error) { failure = error; }
  active = false;
  let endFailure: unknown;
  try {
    const endedAt = probe.clock.now().toISOString();
    repositories.timelineEvents.append({ ...started, eventId: endId, occurredAt: endedAt, recordedAt: endedAt,
      retentionDate: localDatePart(new Date(endedAt)), payload: { kind: "recovery-activity-ended", ...activity, endedAt } });
  } catch (error) {
    endFailure = error;
  }
  const failures = [failure, noteFailure, endFailure].filter(error => error !== undefined);
  if (closureFailure !== undefined || failures.some(error => containsFailure(error, cause =>
    cause instanceof WorkerSessionClosureUnprovedError || cause instanceof BrowserSessionClosureUnprovedError
      || cause instanceof DuoCeremonyReleaseFailedError))) {
    if (failures.length === 1 && failure === closureFailure
      && (failure instanceof WorkerSessionClosureUnprovedError || failure instanceof BrowserSessionClosureUnprovedError
        || failure instanceof DuoCeremonyReleaseFailedError)) throw failure;
    throw new BrowserSessionClosureUnprovedError(failures, "Recovery probe resource closure is unproved");
  }
  if (endFailure !== undefined) throw new RecoveryActivityError(new AggregateError(failures, "Recovery activity close failed"));
  if (noteFailure !== undefined) throw noteFailure;
  if (containsFailure(failure, error => error instanceof TaskError && error.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED")) {
    throw new RecoveryActivityError(failure);
  }
  if (failure !== undefined) throw failure;
  return outcome!;
}
