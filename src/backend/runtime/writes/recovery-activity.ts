import { randomUUID } from "node:crypto";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { RecoveryActivitySchema, recoveryActivitySpanPath } from "../../../models/run/recovery-activity.js";
import type { RunRecord } from "../../../models/run/record.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { deriveStableUuid } from "../../../rules/identity/identifiers.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import { TaskError } from "../../../workflow-kit/errors.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { drainBrowserActionNotes } from "../../logs/browser-action-drain.js";
import { createNoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { withBrowserActionNotes, type BrowserAction } from "../../systems/browser-shared/action-notes.js";
import type { RunConfigFingerprintBinding } from "../workers/worker-sessions.js";
import { WorkerSessionClosureUnprovedError } from "../workers/worker-sessions.js";
import { BrowserSessionClosureUnprovedError } from "../../../workflow-kit/session.js";
import { DuoCeremonyReleaseFailedError } from "../gates/duo-ceremony-gate.js";
import { beginBoundedTask, executeIdempotencyProbe, type ProbeReadDeps, type TransactionSessionHost } from "./write-sequencer.js";
import type { TransactionRuntimeNode } from "./write-resolution-binding.js";
import { UcpathReadTransactionFindings } from "../../../models/systems/ucpath/read-transaction-findings.js";
import { UcpathTerminationTargetSchema } from "../../../models/ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionFindingsReadSchema } from "../../../models/ui/ucpath-transaction-findings.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";

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

type RecoveryReadInput = Readonly<{
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
}>;

type RecoveryReadOptions = Omit<Parameters<typeof executeIdempotencyProbe>[1], "commitContract" | "commitInput" | "screenshotOwner">
  & { readonly screenshotOwner: NonNullable<Parameters<typeof executeIdempotencyProbe>[1]["screenshotOwner"]> };

export async function executeRecoveryProbe(input: RecoveryReadInput) {
  return (await executeRecoveryRead(input, (deps, options) => executeIdempotencyProbe(deps, {
    ...options, commitContract: input.node.commit.uses, commitInput: input.commitInput,
  }))).output;
}

export async function executeRecoveryFindings(input: RecoveryReadInput) {
  const target = UcpathTerminationTargetSchema.parse(input.commitInput);
  const contract = UcpathReadTransactionFindings;
  const task = input.probe.stores.stores.flatMap(store => Object.values(store.tasks)).find(candidate => candidate.contract.id === contract.id);
  const need = task?.impl.sessions[0];
  if (task === undefined || task.contract.effect !== "read" || task.impl.sessions.length !== 1 || need?.access !== "read"
    || need.system !== "ucpath" || task.driver?.system !== "ucpath"
    || deriveSchemaHash(task.contract.input, "input") !== deriveSchemaHash(contract.input, "input")
    || deriveSchemaHash(task.contract.output, "output") !== deriveSchemaHash(contract.output, "output")) {
    throw new RecoveryActivityError(new Error("ucpath-findings-registered-read-unavailable"));
  }
  const parsed = contract.input.parse({ emplId: target.emplId, expectedName: target.expectedName });
  return await executeRecoveryRead(input, async (deps, options) => {
    // This recovery read has native activity notes, not a workflow invocation declaration.
    return await deps.sessions.withDriver(need, options.instance, options.signal, async (driver, captureScreenshot) => {
      const invocation = beginBoundedTask(deps, contract.id, options.signal, async (signal, recordData) => {
        options.onTaskSignal?.(signal);
        const raw: unknown = await Reflect.apply(task.impl.run, undefined, [{ input: parsed, ctx: { driver, signal, recordData, log: deps.log,
          fail: (code: string, message: string, details?: Readonly<{ subject?: string; transient?: boolean; cause?: unknown }>): never => {
            throw new TaskError(contract.id, code, message, details);
          } } }]);
        return raw;
      });
      deps.retainCallback?.(invocation.settlement);
      const result = await invocation.bounded;
      const output = UcpathTransactionFindingsReadSchema.parse(result.raw);
      await captureScreenshot();
      return output;
    }, { ...options.screenshotOwner, taskId: contract.id });
  });
}

async function executeRecoveryRead<Output>(input: RecoveryReadInput,
  read: (deps: ProbeReadDeps, options: RecoveryReadOptions) => Promise<Output>) {
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
  let noteFailure: RecoveryActivityError | undefined;
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
  let outcome: Output | undefined;
  let failure: Error | undefined;
  let closureFailure: unknown;
  let probeFailure: Error | undefined;
  let taskSignal: AbortSignal | undefined;
  const acceptedActions: BrowserAction[] = [];
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
      let verdict: typeof outcome;
      try {
        verdict = await read({ ...probe, sessions, taskDeadlineMs: resources?.taskDeadlineMs ?? probe.taskDeadlineMs,
          retainCallback: settlement => { callbackSettlement = settlement; probe.retainCallback?.(settlement); } }, {
          instance, signal: input.signal,
          onTaskSignal: signal => { taskSignal = signal; },
          screenshotOwner: { nodeId: activity.nodeId, attempt: activity.attempt, log: probe.log },
        });
      } catch (error) {
        probeFailure = error instanceof Error ? error : new Error("Recovery probe failed", { cause: error });
      }
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
    }, () => {
      drainBrowserActionNotes({ actions: acceptedActions,
        emitAction: emit, warn: () => probe.log.warn("Recovery action note could not be recorded") });
      if (noteFailure !== undefined) throw noteFailure;
    }, action => {
      if (probeFailure !== undefined) throw probeFailure;
      input.signal.throwIfAborted();
      taskSignal?.throwIfAborted();
      try { assertOpen(); }
      catch (error) { noteFailure = new RecoveryActivityError(error); throw noteFailure; }
      acceptedActions.push(action);
    });
  } catch (error) {
    failure = error instanceof Error ? error : new Error("Recovery probe failed", { cause: error });
  }
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
  return { output: outcome!, activityId: activity.activityId };
}
