import { authenticateDelegationRetryPause, delegationAccountingExecution } from "../../storage/sqlite/delegation-authority.js";
import { RunContinuationRefusedError } from "../../storage/sqlite/run-continuation.js";
import { RunClaimTokenSchema } from "../../../models/run/worker.js";
import { parseCanonicalInputSnapshot } from "../../../models/workflow/canonical-input.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { z } from "zod";
import { TaskError } from "../../../workflow-kit/errors.js";
import type { AnyTask } from "../../../workflow-kit/task.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import { descriptorRuntimeNodes } from "../../../workflow-kit/workflow.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { drainBrowserActionNotes } from "../../logs/browser-action-drain.js";
import type { BrowserAction } from "../../systems/browser-shared/action-notes.js";
import type { TaskId } from "../../../rules/identity/ids.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { Fingerprint, IsoInstant, NodeId } from "../../../rules/identity/ids.js";
import { RunLifecycleSchema, RunRecordSchema, runClaim, type RunLifecycle, type RunRecord } from "../../../models/run/record.js";
import { pendingInterruptOf } from "../../../rules/runs/run-interrupt.js";
import type { TerminalDependencyEvidence, TerminalNotRunReason } from "../../../models/run/result.js";
import { FailureRecordSchema, type FailureRecord } from "../../../models/trust/failure.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { RuntimeScope } from "../../../models/workflow/graph.js";
import { planStepOmissions } from "../../../models/workflow/step-omission.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { buildEntryValidationFailureRecord } from "./run-failure.js";
import { ExecutorSpanEventSchema, runSpanPath } from "../../logs/span-emitter.js";
import { runWorkbookReferenceTypeIds } from "../../../models/dashboard/workbooks.js";
import type { RunPreviewStep } from "../../../models/run/result.js";
import { buildTerminalAuthorization } from "../../runs/lifecycle/terminal-authorization.js";
import { lifecycleCommandId, requireLifecycleApplied, RunLifecycleRefusedError, type RunMutationOutcome } from "../../runs/lifecycle/run-record-service.js";
import type { ClaimedRunInput, RunExecutionContext, RunExecutionState, RunExecutorDependencies, TaskRuntimeNode } from "./run-execution-contract.js";
import { RunAbandonedError, RunCancellationRequestedError, RunControlAbortError, RunExecutionOutcomeSchema, RunPauseRequestedError, RunTerminalAdmissionLostError, type RunExecutionOutcome } from "./run-execution-outcome.js";
import { prepareRunPlan } from "./run-execution-plan.js";
import { walkRunPlan } from "./run-execution-walk.js";

// Bound inputs compare in their JSON form: an optional field bound to undefined is absent.
function boundInputIdentity(value: unknown): string {
  return canonicalJsonStringify(JSON.parse(JSON.stringify(value)));
}

function labelOf(node: TaskRuntimeNode): string {
  return node.label ?? node.uses.title;
}

function taskIndexOf(stores: TaskStoreRegistry): ReadonlyMap<string, AnyTask> {
  const index = new Map<string, AnyTask>();
  for (const store of stores.stores) {
    for (const task of Object.values(store.tasks)) index.set(task.contract.id, task);
  }
  return index;
}

export async function executeClaimedRun(
  deps: RunExecutorDependencies,
  input: ClaimedRunInput,
): Promise<RunExecutionOutcome> {
  const initial = RunRecordSchema.parse(input.run);
  const claim = RunClaimTokenSchema.parse(input.claim);
  const { descriptor, clock } = deps;
  const envelope = initial.envelope;
  const runId = envelope.runId;
  if (envelope.workflow !== descriptor.id
    || envelope.descriptorVersion !== descriptor.version
    || envelope.contractFingerprint !== descriptor.contractFingerprint) {
    throw new Error(
      `run ${runId} is bound to ${envelope.workflow} v${String(envelope.descriptorVersion)} `
      + `/ ${envelope.contractFingerprint}, not descriptor ${descriptor.id} `
      + `v${String(descriptor.version)} / ${descriptor.contractFingerprint}; the worker is miswired`,
    );
  }
  if (initial.lifecycle.state !== "claimed") {
    throw new Error(`run ${runId} is ${initial.lifecycle.state}; the executor starts from a fresh claim`);
  }
  const claimedAt = initial.lifecycle.claimedAt;
  z.number().int().positive().parse(deps.taskDeadlineMs);

  const nodes = descriptorRuntimeNodes(descriptor);
  const omissionPlan = planStepOmissions(
    {
      nodes: nodes.map((node) => ({ id: String(node.id), kind: node.kind, dependsOn: node.dependsOn.map(String) })),
      timeline: descriptor.timeline,
      stepOmissions: descriptor.stepOmissions,
    },
    envelope.stepOmissions ?? [],
  );
  const runs = deps.authority.authority.runs;
  const instant = () => IsoInstantSchema.parse(clock.now().toISOString());

  const getRun = (): RunRecord => {
    const current = runs.get(runId);
    if (current === undefined) throw new Error(`run ${runId} disappeared from authority mid-execution`);
    return current;
  };

  const requireOriginalClaim = (current: RunRecord): void => {
    const held = runClaim(current);
    if (held === undefined || held.workerId !== claim.workerId || held.claimGeneration !== claim.claimGeneration) {
      throw new RunAbandonedError("lost original execution claim");
    }
  };

  const checkPause = (current: RunRecord): void => {
    if (pendingInterruptOf(current) === "pause-requested") {
      requireOriginalClaim(current);
      throw new RunPauseRequestedError("paused");
    }
  };

  const pauseAtBoundary = (): void => {
    checkCancellation();
    checkPause(getRun());
  };

  const workerTransition = (current: RunRecord, lifecycle: RunLifecycle): RunMutationOutcome => deps.lifecycle.workerTransition({
    commandId: lifecycleCommandId("executor-transition", { runId, generation: claim.claimGeneration, version: current.version }),
    runId, claim, lifecycle,
    ...(lifecycle.state === "parked-gate" ? { expectedVersion: current.version } : {}),
  });

  const transitionTo = async (lifecycle: RunLifecycle): Promise<RunRecord> => {
    if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
    const current = getRun();
    checkCancellation(current);
    return requireLifecycleApplied(workerTransition(current, lifecycle));
  };

  const runningLifecycle = (currentNodeId?: NodeId): RunLifecycle => RunLifecycleSchema.parse({
    state: "running",
    workerId: claim.workerId,
    claimedAt,
    heartbeatAt: instant(),
    ...(currentNodeId === undefined ? {} : { currentNodeId }),
  });

  const runSpanIdentity = {
    runId,
    attempt: envelope.attempt,
    traceId: envelope.traceId,
    spanPath: runSpanPath(envelope.traceId),
  } as const;

  const drainBrowserActions = (spanPath: string, actions: readonly BrowserAction[], screenshotTaskId?: TaskId): void => {
    const sink = deps.taskNotes;
    const screenshotFailures: unknown[] = [];
    if (sink === undefined) {
      if (screenshotTaskId !== undefined && actions.some(action => action.kind === "screenshot")) {
        throw new TaskError(screenshotTaskId, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Screenshot action persistence is unavailable");
      }
      return;
    }
    const address = { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath };
    drainBrowserActionNotes({ actions,
      emitAction: action => { sink.emitRunAction({
          workflow: descriptor.id,
          address,
          action,
        }, getRun()); },
      warn: () => deps.log.warn("browser action note could not be recorded"),
      onFailure: (action, error) => { if (screenshotTaskId !== undefined && action.kind === "screenshot") screenshotFailures.push(error); },
    });
    if (screenshotTaskId !== undefined && screenshotFailures.length > 0) {
      throw new TaskError(screenshotTaskId, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Screenshot action could not be persisted", {
        cause: new AggregateError(screenshotFailures, "Screenshot action persistence failed"),
      });
    }
  };

  const emit = (event: Readonly<Record<string, unknown>>): void => {
    deps.emitter.emit(ExecutorSpanEventSchema.parse({
      ts: instant(),
      workflow: descriptor.id,
      ...event,
    }));
  };

  const checkCancellation = (current = getRun()): void => {
    if (pendingInterruptOf(current) === "stop-requested") throw new RunCancellationRequestedError("cancelled");
  };


  const terminalizeAsFailure = async (failure: FailureRecord): Promise<RunExecutionOutcome> => {
    const capture = deps.diagnostics;
    const prepared = capture === undefined ? undefined : await capture.captureForFailure({
      failure,
      configFingerprint: envelope.configFingerprint,
      descriptorFingerprint: descriptor.contractFingerprint,
    });
    let disposed = false;
    try {
    const bound = prepared === undefined
      ? failure
      : FailureRecordSchema.parse({ ...failure, diagnosticBundleId: prepared.bundleId });
    checkCancellation();
    // The member-Retry hold check and failure admission share one transaction so no Retry or Pause commits between them.
    const settle = (repositories?: AuthorityRepositories): "held" | "settled" | RunTerminalAdmissionLostError => {
      const current = getRun();
      requireOriginalClaim(current);
      if (repositories !== undefined && pendingInterruptOf(current) === "pause-requested"
        && authenticateDelegationRetryPause(repositories, descriptor, current, initial.version)) {
        requireLifecycleApplied(deps.lifecycle.acknowledgePause({
          commandId: lifecycleCommandId("executor-pause", { runId, generation: claim.claimGeneration, commandId: current.pause?.commandId }),
          runId, claim,
        }));
        return "held";
      }
      const authorization = buildTerminalAuthorization({
        run: current,
        authorizedAt: instant(),
        consequence: { kind: "failed", failure: bound },
      });
      const outcome = deps.lifecycle.terminalize({ kind: "failure",
        commandId: lifecycleCommandId("failure", { runId, failureId: bound.failureId }),
        terminal: { failure: bound, authorization },
      }, descriptor);
      if (outcome.state === "refused" && outcome.refusal.reason === "lost")
        return new RunTerminalAdmissionLostError(outcome, authorization.expectedVersion);
      requireLifecycleApplied(outcome);
      if (prepared !== undefined && capture !== undefined) capture.persist(prepared);
      return "settled";
    };
    if (prepared !== undefined && deps.authority.withAuthorityTransaction === undefined) {
      throw new Error(
        `run ${runId} has a diagnostic capture port but no authority transaction to settle its bundle with the failure`,
      );
    }
    if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
    const settled = deps.authority.withAuthorityTransaction === undefined ? settle() : deps.authority.withAuthorityTransaction(settle);
    if (settled instanceof RunTerminalAdmissionLostError) throw settled;
    if (settled === "held") {
      disposed = true;
      if (prepared !== undefined && capture !== undefined) capture.discard(prepared);
      return RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: "paused" });
    }
    // Emitted after commit so a logging fault can neither roll back the failure nor discard its committed bundle.
    disposed = true;
    deps.debugEvents?.emit({ category: "worker", phase: "failed", area: "run-execution", reason: "run-failed",
      code: bound.code, correlationId: bound.failureId }, { kind: "run", runId }, envelope.workflow);
    return RunExecutionOutcomeSchema.parse({ state: "failed", runId, failureId: bound.failureId });
    } catch (error) {
      if (!disposed && prepared !== undefined && capture !== undefined) {
        try { capture.discard(prepared); } catch (cleanup) { throw new AggregateError([error, cleanup], "diagnostic-failure-settlement-disposal-failed", { cause: cleanup }); }
      }
      throw error;
    }
  };

  const interpret = async (): Promise<RunExecutionOutcome> => {
    /* ── validating: ref workflow-model entry validation, before any browser ────── */
    await transitionTo({ state: "validating", workerId: claim.workerId, claimedAt, heartbeatAt: instant() });

    pauseAtBoundary();
    const accounting = deps.authority.withAuthorityTransaction?.(repositories => {
      const current = getRun();
      checkPause(current);
      return delegationAccountingExecution(repositories, descriptor, current);
    });
    const assertAccounting = (): void => { pauseAtBoundary(); accounting?.assertCurrent(); };

    const problems: string[] = [];
    let canonicalInput: JsonValue | undefined;
    try {
      canonicalInput = JsonValueSchema.parse(parseCanonicalInputSnapshot(descriptor.canonicalInput, initial.input.parsed, { owner: { kind: "run-input", id: runId }, source: initial.input, schemaReader: deps.authority.evidenceSchemaHash?.bind(deps.authority) }));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "canonical input snapshot failed to parse");
    }

    const taskIndex = taskIndexOf(deps.stores);
    const outputs: Record<string, JsonValue> = {};
    const checkpointRecords = new Map<string, RunCheckpointRecord>();
    const childResultEvidence = new Map<string, Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>>();
    const gateResultEvidence = new Map<string, Extract<TerminalDependencyEvidence, { state: "gate-resolved" }>>();
    const skippedReasons = new Map<string, Exclude<TerminalNotRunReason, "operator-asserted">>();

    const assertedRecords = new Map<string, Readonly<{ step: string; assertedAt: IsoInstant; output: Readonly<{ schemaHash: Fingerprint; value: JsonValue }> }>>();



    const dryRunSteps = new Map<string, RunPreviewStep>();
    const previewOnly = new Set<string>();

    const scopeFor = (dependsOn: readonly NodeId[]): RuntimeScope => {
      if (canonicalInput === undefined) {
        throw new Error(`run ${runId} has no validated canonical input; entry validation must have refused`);
      }
      const picked: Record<string, JsonValue> = {};
      const asserted: string[] = [];
      for (const dependency of dependsOn) {
        const value = outputs[String(dependency)];
        if (value !== undefined) picked[String(dependency)] = value;
        if (value !== undefined && omissionPlan.asserted.has(String(dependency))) asserted.push(String(dependency));
      }
      return { input: canonicalInput, outputs: Object.freeze(picked), references: runWorkbookReferenceTypeIds(getRun().input.workbookReferences),
        ...(asserted.length === 0 ? {} : { asserted }),
        ...(envelope.dryRun ? { dryRun: { transactions: [...dryRunSteps.values()].filter(step => step.state === "transaction-preview") } } : {}),
        protectedInputBindings: retainedRunProtectedBindings(getRun()) };
    };

    const context: RunExecutionContext = {
      deps, input, initial, claim, descriptor, clock, envelope, runId, nodes, omissionPlan, instant, getRun,
      requireOriginalClaim, pauseAtBoundary, workerTransition, transitionTo, runningLifecycle, runSpanIdentity,
      drainBrowserActions, emit, checkCancellation, terminalizeAsFailure, boundInputIdentity, labelOf,
    };
    const state: RunExecutionState = {
      accounting, assertAccounting, canonicalInput, taskIndex, outputs, checkpointRecords, childResultEvidence,
      gateResultEvidence, skippedReasons, assertedRecords, dryRunSteps, previewOnly, scopeFor,
    };
    const preparedPlan = prepareRunPlan(context, state, problems);
    if (problems.length > 0) {
      const failure = buildEntryValidationFailureRecord({
        run: getRun(),
        failureId: deps.ids.uuid(),
        problems,
        occurredAt: instant(),
      });
      return await terminalizeAsFailure(failure);
    }

    /* ── running: walk the plan in declaration order ─────────────────────── */
    await transitionTo(runningLifecycle());


    for (const record of preparedPlan.patchedInserts) {
      deps.authority.authority.runCheckpoints.insert(record);
    }
    return walkRunPlan(context, state, preparedPlan);
  };

  const handleInterruption = async (error: unknown):
    Promise<{ state: "handled"; outcome: RunExecutionOutcome } | { state: "unhandled"; failure: unknown }> => {
    let failure = error;
    // An aborted run settles a requested pause or cancellation from durable state; any other abort abandons.
    if (input.signal.aborted && failure instanceof RunAbandonedError && !(failure instanceof RunPauseRequestedError)) {
      try {
        const current = getRun(); requireOriginalClaim(current); checkCancellation(); checkPause(current);
        // Resume withdrew the pause that stopped this step: release the run to continue from its checkpoint.
        if (input.signal.reason instanceof RunControlAbortError) throw new RunPauseRequestedError("resumed");
      } catch (control) { failure = control; }
    }
    if (failure instanceof RunTerminalAdmissionLostError || failure instanceof RunPauseRequestedError) {
      try {
        const current = getRun();
        requireOriginalClaim(current);
        checkCancellation(current);
        // Resume can withdraw Pause between a lost terminal admission and this read.
        if (!(failure instanceof RunTerminalAdmissionLostError) || current.version > failure.admissionVersion) {
          if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
          const released = requireLifecycleApplied(deps.lifecycle.acknowledgePause({
            commandId: lifecycleCommandId("executor-pause", { runId, generation: claim.claimGeneration, ...(current.pause === undefined ? {} : { commandId: current.pause.commandId }) }),
            runId, claim,
          }));
          const unpausedReason = failure instanceof RunPauseRequestedError ? "resumed" : "requeued";
          return { state: "handled", outcome: RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: released.pause === undefined ? unpausedReason : "paused" }) };
        }
      } catch (pauseFailure) { failure = pauseFailure; }
    }
    // A command can commit cancellation between a boundary read and terminal admission.
    // Settle it here, after any enclosing evidence transaction has unwound.
    if (failure instanceof RunLifecycleRefusedError) {
      try { checkCancellation(); } catch (cancellation) { failure = cancellation; }
    }
    if (failure instanceof RunCancellationRequestedError) {
      try {
        if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
        const settle = () => requireLifecycleApplied(deps.lifecycle.terminalize({
          kind: "cancelled", commandId: lifecycleCommandId("cancel", { runId, generation: claim.claimGeneration }),
          runId, expectedVersion: getRun().version, claim, endedAt: instant(),
        }, descriptor));
        if (deps.authority.withAuthorityTransaction === undefined) settle();
        else deps.authority.withAuthorityTransaction(settle);
      } catch (cancellation) { failure = cancellation; }
    }
    if (failure instanceof RunAbandonedError || (failure instanceof RunLifecycleRefusedError
      && failure.outcome.state === "refused" && failure.outcome.refusal.reason === "lost")) {
      return { state: "handled", outcome: RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: failure.message }) };
    }
    return { state: "unhandled", failure };
  };

  try {
    return await interpret();
  } catch (error) {
    const interrupted = await handleInterruption(error);
    if (interrupted.state === "handled") return interrupted.outcome;
    const failure = interrupted.failure;
    if (failure instanceof RunContinuationRefusedError) {
      try {
        return await terminalizeAsFailure(buildEntryValidationFailureRecord({
          run: getRun(), failureId: deps.ids.uuid(), code: failure.code, problems: [failure.message], occurredAt: instant(),
        }));
      } catch (terminalFailure) {
        const terminal = await handleInterruption(terminalFailure);
        if (terminal.state === "handled") return terminal.outcome;
        throw terminal.failure;
      }
    }
    throw failure;
  }
}
