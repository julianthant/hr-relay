import { WorkerLogChannelError } from "../../storage/events/log-mutations.js";
import { AuthenticatedRunContinuation } from "../../storage/sqlite/run-continuation-delegation.js";
import { readRunCheckpoint, RunContinuationRefusedError, readContinuationGate } from "../../storage/sqlite/run-continuation.js";
import { DryRunSampleSchema, type DryRunBinding } from "../../../models/workflow/dry-run.js";
import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { z } from "zod";
import { TaskError, wrapUnhandledTaskError } from "../../../workflow-kit/errors.js";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import { runtimeNodeLabel, workflowDryRunSupport, workflowPreviewDependencyIds, workflowTerminalResultExecution } from "../../../workflow-kit/workflow.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { TransactionDryRunPreviewSchema, TransactionOutcomeSchema, type TransactionDryRunPreview } from "../../../rules/write-safety/write-safety-primitives.js";
import { withBrowserActionNotes } from "../../systems/browser-shared/action-notes.js";
import { GateIdSchema, TaskIdSchema, type NodeId } from "../../../rules/identity/ids.js";
import { RunLifecycleSchema, runClaim, type RunRecord } from "../../../models/run/record.js";
import { pendingInterruptOf } from "../../../rules/runs/run-interrupt.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { auditCheckpointFreshness, RunCheckpointRecordSchema, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { applyCheckpointPatches } from "../checkpoints/checkpoint-patch.js";
import type { RuntimeFlowNode, RuntimeScope } from "../../../models/workflow/graph.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { jsonLeafPaths } from "../../runs/provenance/task-provenance.js";
import { buildEntryValidationFailureRecord, buildNodeFailureRecord, type FailureEvidenceCause } from "./run-failure.js";
import { buildRunPreviewResult, buildRunResult } from "../../runs/lifecycle/run-result.js";
import { taskSpanPath } from "../../logs/span-emitter.js";
import { AnyRunPreviewStepSchema, resolveDelegationEvidenceOutput, terminalGateDependencyRecord, type RunResultRecord, type TerminalDependencyEvidence } from "../../../models/run/result.js";
import { buildTerminalAuthorization } from "../../runs/lifecycle/terminal-authorization.js";
import { lifecycleCommandId, requireLifecycleApplied, RunLifecycleRefusedError } from "../../runs/lifecycle/run-record-service.js";
import { WorkerSessionClosureUnprovedError } from "../workers/worker-sessions.js";
import { DelegationPendingSchema, resolveExecutableChildOutput } from "./durable-child-executor.js";
import type { ChildRunRuntimeNode, RunExecutionContext, RunExecutionState } from "./run-execution-contract.js";
import { RunAbandonedError, RunExecutionOutcomeSchema, RunTerminalAdmissionLostError, type RunExecutionOutcome } from "./run-execution-outcome.js";
import type { RunExecutionPlan } from "./run-execution-plan.js";
import { createTaskExecution } from "./run-execution-task.js";
import { WriteParkedError } from "./run-execution-write.js";

export async function walkRunPlan(
  context: RunExecutionContext,
  state: RunExecutionState,
  preparedPlan: RunExecutionPlan,
): Promise<RunExecutionOutcome> {
  const {
    deps, input, initial, claim, descriptor, clock, envelope, runId, nodes, omissionPlan, instant, getRun,
    requireOriginalClaim, pauseAtBoundary, workerTransition, transitionTo, runningLifecycle, runSpanIdentity,
    drainBrowserActions, emit, checkCancellation, terminalizeAsFailure, boundInputIdentity, labelOf,
  } = context;
  const {
    accounting, assertAccounting, canonicalInput, outputs, checkpointRecords, childResultEvidence,
    gateResultEvidence, skippedReasons, assertedRecords, dryRunSteps, previewOnly, scopeFor,
  } = state;
  const {
    plan, continuationAuthority, boundAt, sourceScopeFor, reachesChild, startAt, startIndex,
    completedOwnDelegation, retainedTransaction,
  } = preparedPlan;

  const dependencyEvidenceFor = (
    nodeIds: readonly NodeId[],
    purpose: string,
  ): readonly TerminalDependencyEvidence[] => nodeIds.map((dependency) => {
    const child = childResultEvidence.get(String(dependency));
    if (child !== undefined) return child;
    const gate = gateResultEvidence.get(String(dependency));
    if (gate !== undefined) return gate;
    const asserted = assertedRecords.get(String(dependency));
    if (asserted !== undefined) {
      return { state: "asserted" as const, nodeId: dependency, step: asserted.step, assertedAt: asserted.assertedAt, output: asserted.output };
    }
    const record = checkpointRecords.get(String(dependency));
    if (record !== undefined) return { state: "resolved" as const, nodeId: dependency, checkpoint: record };
    const reason = skippedReasons.get(String(dependency));
    if (reason !== undefined) return { state: "not-run" as const, nodeId: dependency, reason };
    throw new Error(
      `${purpose} dependency "${dependency}" has neither a checkpoint-backed output nor a closed not-run reason`,
    );
  });

  // Commit terminal state and result in one authority transaction.
  const settleSuccess = async (
    current: RunRecord,
    built: Readonly<{ record: RunResultRecord; authorization: object }>,
  ): Promise<RunExecutionOutcome> => {
    if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
    checkCancellation();
    requireOriginalClaim(current);
    const authorization = buildTerminalAuthorization({
      run: current,
      authorizedAt: built.record.createdAt,
      consequence: { kind: "done", result: built.record },
    });
    const settle = () => {
      assertAccounting();
      const outcome = deps.lifecycle.terminalize({ kind: "success",
        commandId: lifecycleCommandId("success", { runId, resultDigest: built.record.resultDigest,
          ...(current.delegationRefresh === undefined ? {} : { refreshCommandId: current.delegationRefresh.commandId, claimGeneration: current.claimGeneration }) }),
        terminal: { result: built.record, authorization },
      }, descriptor, built.authorization);
      if (outcome.state === "refused" && outcome.refusal.reason === "lost")
        throw new RunTerminalAdmissionLostError(outcome, authorization.expectedVersion);
      requireLifecycleApplied(outcome);
    };
    if (accounting === undefined) settle();
    else if (deps.authority.withAuthorityTransaction !== undefined) deps.authority.withAuthorityTransaction(settle);
    else throw new Error("delegation-accounting-transaction-unavailable");
    return RunExecutionOutcomeSchema.parse({ state: "done", runId });
  };

  const markUnavailable = (node: RuntimeFlowNode): void => {
    previewOnly.add(String(node.id));
    dryRunSteps.set(String(node.id), { nodeId: node.id, state: "unavailable", reason: "requires-unsubmitted-output" });
    deps.taskNotes?.emitRunLog({ workflow: descriptor.id,
      address: { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath: `${envelope.traceId}/${node.id}` },
      level: "warn", message: "Dry run: this stage is unavailable because it requires an unsubmitted result.",
    }, getRun());
  };
  const branchExcluded = new Set<string>();

  const excludedByBranch = (node: RuntimeFlowNode): boolean => {
    if (branchExcluded.has(String(node.id))) return true;
    for (const dependency of node.dependsOn) {
      if (branchExcluded.has(String(dependency))) {
        branchExcluded.add(String(node.id));
        return true;
      }
    }
    return false;
  };

  const failNode = (
    node: RuntimeFlowNode,
    taskId: string | undefined,
    error: unknown,
    secondaryCauses: readonly FailureEvidenceCause[] = [],
  ): Promise<RunExecutionOutcome> => terminalizeAsFailure(buildNodeFailureRecord({
    run: getRun(),
    failureId: deps.ids.uuid(),
    nodeId: node.id,
    ...(taskId === undefined ? {} : { taskId: TaskIdSchema.parse(taskId) }),
    error,
    secondaryCauses,
    occurredAt: instant(),
    writes: deps.authority.withAuthorityTransaction?.(repositories => AuthenticatedRunContinuation.authenticate(repositories, getRun().envelope)
      .writeRunIds().flatMap(id => repositories.writeIntents.listByRun(id))) ?? [],
  }));

  const abortReason = (fallback: string): RunAbandonedError => new RunAbandonedError(
    input.signal.reason instanceof Error ? input.signal.reason.message : fallback,
  );

  const interruptBeforeFence = (nodeId: string): void => {
    if (input.signal.aborted) throw abortReason(`run ${runId} was aborted during ${nodeId}`);
    pauseAtBoundary();
  };

  const { projectionsFor, resumePendingProjections, executeTaskNode } = createTaskExecution(context, state, preparedPlan, failNode, abortReason);

  const recordCheckpointReplay = (nodeId: string, record: RunCheckpointRecord): void => {
    const now = deps.clock.now();
    deps.authority.authority.timelineEvents.append({ schemaVersion: 1,
      eventId: lifecycleCommandId("timeline-checkpoint-replayed", { runId, nodeId: nodeId, claimGeneration: claim.claimGeneration }),
      workflow: descriptor.id, scope: { kind: "run", runId }, occurredAt: now.toISOString(),
      recordedAt: now.toISOString(), retentionDate: localDatePart(now), source: { kind: "native" },
      payload: { kind: "checkpoint-replayed", runId, workflow: descriptor.id, attempt: envelope.attempt,
        claimGeneration: claim.claimGeneration, checkpoint: timelineCheckpointReference(record) },
    });
  };

  const CONDITION_SKIP = { outcome: "skipped", notRunReason: "condition-false" } as const;
  /** A task span for a node that owns no task execution, so its timeline step reads settled. */
  const emitSettledSpan = (node: RuntimeFlowNode, end: Readonly<{ outcome: "done" }> | typeof CONDITION_SKIP,
    spanPath = taskSpanPath(envelope.traceId, node.id, 1, claim.claimGeneration)): void => {
    emit({ t: "span.started", kind: "task", ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath, name: runtimeNodeLabel(node) });
    emit({ t: "span.ended", kind: "task", ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath, ...end });
  };
  /** Whether this attempt's timeline already closed the task span at `spanPath` (an ordinary reclaim re-reads a settled join). */
  const spanEnded = (spanPath: string): boolean => {
    const timeline = deps.authority.authority.timelineEvents;
    for (let after = 0; ;) {
      const page = timeline.page({ runId, after, limit: 1000 });
      if (page.some(({ payload }) => payload.kind === "span" && payload.event.t === "span.ended" && payload.event.kind === "task"
        && payload.event.attempt === envelope.attempt && payload.event.spanPath === spanPath)) return true;
      const last = page.at(-1);
      if (page.length < 1000 || last === undefined) return false;
      after = last.cursor;
    }
  };
  const recordConditionSkip = (node: RuntimeFlowNode): void => {
    skippedReasons.set(String(node.id), "condition-false");
    if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "condition-false" });
    emitSettledSpan(node, CONDITION_SKIP);
  };

  const childSourceEvidence = (node: ChildRunRuntimeNode) => {
    const entry = plan.get(String(node.id));
    if (entry === undefined) throw new Error("delegation-branch-plan-unavailable");
    if (entry.mode === "replay-child"
      && canonicalJsonStringify(completedOwnDelegation(node)) !== canonicalJsonStringify(entry.evidence)) {
      throw new RunContinuationRefusedError("run-gate-resume-child-authority-changed");
    }
    if (accounting?.plan.retain.includes(String(node.id)) && entry.mode === "replay-child") return entry.evidence;
    if (accounting?.plan.joinNodeId === node.id) return undefined;
    const sourceEvidence = continuationAuthority?.delegation(String(node.id), String(node.edgeId));
    if (sourceEvidence !== undefined) {
      const admitted = continuationAuthority?.delegationScope(String(node.id), String(node.edgeId)) ?? [];
      const original = node.bind(sourceScopeFor(sourceEvidence.parentRunId, node.dependsOn, (_source, dependency) => {
        const entry = admitted.find(row => row.nodeId === dependency);
        return entry !== undefined && "checkpoint" in entry ? entry.checkpoint : undefined;
      }, false));
      const continued = node.bind(scopeFor(node.dependsOn));
      if (boundInputIdentity(original) !== boundInputIdentity(continued)
        || sourceEvidence.manifest.cardinality !== node.cardinality || sourceEvidence.manifest.join !== node.join
        || canonicalJsonStringify(sourceEvidence.manifest.policy) !== canonicalJsonStringify(node.policy)
        || sourceEvidence.manifest.inputSchemaHash !== deriveSchemaHash(node.target.input, "input")) throw new RunContinuationRefusedError("run-continuation-child-input-mismatch");
    }
    return sourceEvidence;
  };
  const childBatchOutputs = new Map<string, JsonValue>();

  for (const [index, node] of nodes.entries()) {
    pauseAtBoundary();
    if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "exercised" });
    checkCancellation();
    if (input.signal.aborted) throw abortReason(`run ${runId} execution was aborted`);
    let entry = plan.get(String(node.id));
    if (entry === undefined) throw new Error(`node "${node.id}" has no execution plan entry`);
    if (entry.mode === "skipped-branch") {
      if (!excludedByBranch(node)) throw new RunContinuationRefusedError("run-gate-resume-branch-changed");
      skippedReasons.set(String(node.id), "branch-not-selected");
      continue;
    }
    if (entry.mode === "replay") {
      if (entry.deferred) {
        if (node.kind !== "task") throw new RunContinuationRefusedError("run-continuation-deferred-task-required");
        if (excludedByBranch(node)) { skippedReasons.set(String(node.id), "branch-not-selected"); continue; }
        const scope = scopeFor(node.dependsOn);
        if (node.when !== undefined && !evaluateNodeCondition(node.when, scope)) {
          skippedReasons.set(String(node.id), "condition-false"); continue;
        }
        if (node.dependsOn.some(dependency => !Object.hasOwn(scope.outputs, String(dependency)) && !skippedReasons.has(String(dependency)))) {
          throw new RunContinuationRefusedError("run-continuation-task-context-unavailable");
        }
        if (envelope.continuation !== undefined
          && boundInputIdentity(node.uses.input.parse(node.bind(sourceScopeFor(entry.record.runId, node.dependsOn, boundAt(entry.record)))))
            !== boundInputIdentity(node.uses.input.parse(node.bind(scope)))) {
          throw new RunContinuationRefusedError("run-continuation-task-input-mismatch");
        }
        const freshness = auditCheckpointFreshness({ workflowId: descriptor.id, runId, startAt: startAt ?? node.id, nodes,
          replayed: [{ nodeId: node.id, taskId: node.uses.id, freshness: node.uses.freshness, provenance: entry.record.provenance }],
          scheduled: nodes.filter(candidate => plan.get(String(candidate.id))?.mode === "execute" && !retainedTransaction(candidate)).map(candidate => candidate.id),
          now: clock.now(), attempt: envelope.attempt, ...(envelope.freshnessOverride === undefined ? {} : { overrides: envelope.freshnessOverride }) });
        if (freshness.length > 0) {
          await transitionTo(runningLifecycle(node.id));
          return await failNode(node, node.uses.id, new TaskError(node.uses.id, "RESUME_VALIDATION_FAILED", freshness.join("\n")));
        }
        if (entry.patches !== undefined) {
          let patched: ReturnType<typeof applyCheckpointPatches>;
          try {
            patched = applyCheckpointPatches({ replayed: entry.record, patches: entry.patches, outputSchema: node.uses.output,
              attempt: envelope.attempt, claimGeneration: claim.claimGeneration, runId, writtenAt: instant() });
          } catch (error) {
            if (error instanceof WorkerLogChannelError) throw error;
            return await terminalizeAsFailure(buildEntryValidationFailureRecord({ run: getRun(), failureId: deps.ids.uuid(),
              problems: [`injected correction for node "${node.id}" was refused: ${error instanceof Error ? error.message : String(error)}`], occurredAt: instant() }));
          }
          if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
          deps.authority.authority.runCheckpoints.insert(patched.record);
          entry = { mode: "replay", record: patched.record };
        }
        outputs[String(node.id)] = entry.record.output.value;
        checkpointRecords.set(String(node.id), entry.record);
      }
      recordCheckpointReplay(String(node.id), entry.record);
      if (node.kind === "task") {
        const owed = await resumePendingProjections(node, entry.record);
        if (owed !== undefined) return owed;
      }
      continue;
    }
    if (entry.mode === "skipped-condition") {
      // An explicit start re-walks nodes whose skip this run already recorded.
      if (startIndex !== undefined && envelope.continuation === undefined) {
        skippedReasons.set(String(node.id), "condition-false");
        if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "condition-false" });
      } else recordConditionSkip(node);
      continue;
    }
    if (entry.mode === "replay-gate") {
      if (node.kind !== "gate") throw new Error(`node "${node.id}" is not a gate but planned a gate replay`);
      const stored = readContinuationGate(deps.authority.authority, envelope, String(node.id));
      if (stored === undefined) throw new Error(`gate "${node.id}" stored result disappeared mid-execution`);
      if (canonicalJsonStringify(stored) !== canonicalJsonStringify(entry.record)
        || node.resolvedBy === "operator" && node.when !== undefined && !evaluateNodeCondition(node.when, scopeFor(node.dependsOn))) {
        throw new RunContinuationRefusedError("run-gate-resume-result-changed");
      }
      terminalGateDependencyRecord(node.id, stored);
      const expectedHash = deriveSchemaHash(node.result, "output");
      if ((deps.authority.evidenceSchemaHash?.({ kind: "gate-result", id: canonicalJsonStringify([stored.runId, stored.gateId]) }, stored, stored.result.schemaHash, expectedHash) ?? stored.result.schemaHash) !== expectedHash) {
        throw new Error(
          `gate "${node.id}" stored result is bound to schema ${stored.result.schemaHash}, `
          + `and this descriptor's gate schema is ${expectedHash}`,
        );
      }
      outputs[String(node.id)] = JsonValueSchema.parse(node.result.parse(stored.result.value));
      gateResultEvidence.set(String(node.id), { state: "gate-resolved", nodeId: node.id, gate: stored });
      continue;
    }

    if (excludedByBranch(node)) {
      skippedReasons.set(String(node.id), "branch-not-selected");
      if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "branch-not-selected" });
      continue;
    }
    if (entry.mode === "omitted" || entry.mode === "manual") {
      const reason = omissionPlan.stopped.has(String(node.id)) ? "required-evidence-unavailable" : "step-omitted";
      skippedReasons.set(String(node.id), reason);
      if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "step-omitted" });
      const spanPath = taskSpanPath(envelope.traceId, node.id, 1, claim.claimGeneration);
      emit({
        t: "span.started", kind: "task",
        ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
        name: node.kind === "task" ? labelOf(node) : node.kind === "transaction" ? (node.label ?? node.commit.uses.title) : String(node.id),
      });
      emit({
        t: "span.ended", kind: "task",
        ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
        outcome: "skipped",
        notRunReason: reason,
      });
      continue;
    }
    if (entry.mode === "asserted") {
      if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "operator-asserted" });

      const assertion = omissionPlan.asserted.get(String(node.id));
      if (assertion === undefined || node.kind !== "task") {
        throw new Error(`node "${node.id}" was planned as asserted but the omission plan does not assert a task there`);
      }
      await transitionTo(runningLifecycle(node.id));
      if (entry.replay !== undefined) {

        const replayed = entry.replay;
        recordCheckpointReplay(String(node.id), replayed);
        if (replayed.assertion === undefined) throw new Error(`node "${node.id}" planned an assertion replay over an unmarked row`);
        outputs[String(node.id)] = replayed.output.value;
        checkpointRecords.set(String(node.id), replayed);
        assertedRecords.set(String(node.id), Object.freeze({
          step: replayed.assertion.step,
          assertedAt: replayed.assertion.assertedAt,
          output: Object.freeze({ ...replayed.output,
            ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }) }),
        }));
        const replaySpanPath = taskSpanPath(envelope.traceId, node.id, 1, claim.claimGeneration);
        emit({
          t: "span.started", kind: "task",
          ...runSpanIdentity, spanPath: replaySpanPath, parentSpanPath: runSpanIdentity.spanPath,
          name: labelOf(node),
        });
        emit({
          t: "span.ended", kind: "task",
          ...runSpanIdentity, spanPath: replaySpanPath, parentSpanPath: runSpanIdentity.spanPath,
          outcome: "skipped",
          notRunReason: "operator-asserted",
        });
        continue;
      }
      const scope = scopeFor(node.dependsOn);
      const assertedAt = instant();
      let produced: unknown;
      try {
        produced = assertion.produce({ facts: assertion.facts, scope, assertedAt });
      } catch (error) {
        if (error instanceof WorkerLogChannelError) throw error;
        return await failNode(node, node.uses.id, error);
      }
      const parsed = node.uses.output.safeParse(produced);
      if (!parsed.success) {
        return await failNode(node, node.uses.id, new Error(
          `step "${assertion.step}" producer for node "${node.id}" returned a value the node's output schema refuses at: `
          + [...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join(".") || "(root)"))].join(", "),
        ));
      }
      const value = JsonValueSchema.parse(parsed.data);
      if (projectionsFor(String(node.id)).length > 0) {
        return await failNode(node, node.uses.id, new Error(
          `node "${node.id}" declares artifact projections and cannot be asserted; an assertion projects nothing`,
        ));
      }

      const outputSchemaHash = deriveSchemaHash(node.uses.output, "output");
      const assertedRecord = RunCheckpointRecordSchema.parse({
        workflowId: descriptor.id,
        itemId: envelope.itemId,
        nodeId: String(node.id),
        attempt: envelope.attempt,
        claimGeneration: claim.claimGeneration,
        runId,
        output: { schemaHash: outputSchemaHash, value,
          ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }) },
        descriptorVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
        implFingerprint: taskImplFingerprint(node.uses),
        provenance: jsonLeafPaths(value).map((path) => ({
          path, source: "operator", observedAt: assertedAt, originalObservedAt: assertedAt,
        })),
        writtenAt: instant(),
        assertion: { step: assertion.step, assertedAt },
      });
      if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
      deps.authority.authority.runCheckpoints.insert(assertedRecord);
      checkpointRecords.set(String(node.id), assertedRecord);
      outputs[String(node.id)] = value;
      assertedRecords.set(String(node.id), Object.freeze({
        step: assertion.step,
        assertedAt,
        output: Object.freeze({ schemaHash: outputSchemaHash, value,
          ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }) }),
      }));
      const spanPath = taskSpanPath(envelope.traceId, node.id, 1, claim.claimGeneration);
      emit({
        t: "span.started", kind: "task",
        ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
        name: labelOf(node),
      });
      emit({
        t: "span.ended", kind: "task",
        ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
        outcome: "skipped",
        notRunReason: "operator-asserted",
      });
      continue;
    }

    if (envelope.dryRun && node.kind !== "transaction" && node.dependsOn.some(id => previewOnly.has(String(id)))) {
      markUnavailable(node);
      continue;
    }
    switch (node.kind) {
      case "task": {
        await transitionTo(runningLifecycle(node.id));
        const scope = scopeFor(node.dependsOn);
        if (node.when !== undefined) {
          const condition = evaluateNodeCondition(node.when, scope);
          if (!condition) {
            recordConditionSkip(node);
            continue;
          }
        }
        if (envelope.dryRun && node.dryRun === "stop-before-publish") {
          try {
            node.uses.input.parse(node.bind(scope));
          } catch (error) {
            if (error instanceof WorkerLogChannelError) throw error;
            return await failNode(node, node.uses.id, wrapUnhandledTaskError(node.uses.id, error));
          }
          previewOnly.add(String(node.id));
          dryRunSteps.set(String(node.id), { nodeId: node.id, state: "publication-preview" });
          deps.taskNotes?.emitRunLog({ workflow: descriptor.id,
            address: { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath: `${envelope.traceId}/${node.id}` },
            level: "step", message: "Dry run: this save was prepared and checked. Nothing was saved.",
          }, getRun());
          continue;
        }
        const outcome = await executeTaskNode(node, scope);
        if (outcome !== undefined) return outcome;
        continue;
      }
      case "branch": {
        await transitionTo(runningLifecycle(node.id));
        const scope = scopeFor(node.dependsOn);
        const selected = node.choose(scope);
        if (!Object.hasOwn(node.cases, selected)) {
          return await failNode(node, undefined, new Error(
            `branch "${node.id}" chose "${String(selected)}", which is not a declared case `
            + `(${Object.keys(node.cases).join(", ")})`,
          ));
        }
        for (const [caseKey, targets] of Object.entries(node.cases)) {
          if (caseKey === selected) continue;
          for (const target of targets) branchExcluded.add(String(target));
        }
        outputs[String(node.id)] = JsonValueSchema.parse({ selected });
        continue;
      }
      case "parallel": {
        await transitionTo(runningLifecycle(node.id));
        if (node.join !== "all") {
          return await failNode(node, undefined, new Error(
            `parallel "${node.id}" join "${node.join}" is not interpretable by this runtime; `
            + "the all-settled arm lands with its owning milestone (capability-unavailable)",
          ));
        }
        const branches: Record<string, readonly string[]> = {};
        for (const branch of node.branches) branches[branch.id] = branch.nodes;
        outputs[String(node.id)] = JsonValueSchema.parse({ join: node.join, branches });
        continue;
      }
      case "gate": {
        if (node.resolvedBy === "operator" && node.when !== undefined
          && !evaluateNodeCondition(node.when, scopeFor(node.dependsOn))) {
          if (readContinuationGate(deps.authority.authority, envelope, String(node.id)) !== undefined) {
            return await failNode(node, undefined, new Error(`inapplicable gate "${node.id}" carries a stored operator result; evidence changed`));
          }
          recordConditionSkip(node);
          continue;
        }
        await transitionTo(runningLifecycle(node.id));
        await deps.sessions.closeAll("parked");
        // A new version can carry Cancel or change the version a source gate must bind.
        for (;;) {
          const current = getRun();
          requireOriginalClaim(current);
          checkCancellation(current);
          let sourceBinding: unknown;
          if (node.resolvedBy !== "operator") {
            if (deps.gateSources === undefined || canonicalInput === undefined) {
              return await failNode(node, undefined, new Error(
                `gate "${node.id}" is resolved by ${node.resolvedBy}, but its registered source runtime is unavailable`,
              ));
            }
            try {
              sourceBinding = deps.gateSources.bind(node, {
                run: current,
                canonicalInput,
                dependencyOutputs: scopeFor(node.dependsOn).outputs,
                parkedVersion: current.version + 1,
              });
            } catch (error) {
              if (error instanceof WorkerLogChannelError) throw error;
              return await failNode(node, undefined, error instanceof Error
                ? error
                : new Error(`gate "${node.id}" source binding failed`, { cause: error }));
            }
          }
          const resumeAt = nodes[index + 1]?.id ?? node.id;
          if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
          const outcome = workerTransition(current, RunLifecycleSchema.parse({
            state: "parked-gate",
            gateId: GateIdSchema.parse(String(node.id)),
            parkedAt: instant(),
            resumeAt,
            ...(sourceBinding === undefined ? {} : { sourceBinding }),
          }));
          if (outcome.state === "refused" && outcome.refusal.reason === "lost" && getRun().version > current.version) continue;
          requireLifecycleApplied(outcome);
          return RunExecutionOutcomeSchema.parse({ state: "parked-gate", runId, gateId: String(node.id) });
        }
      }
      case "transaction": {
        await transitionTo(runningLifecycle(node.id));
        if (deps.writeSequencer === undefined) {
          return await failNode(node, node.commit.uses.id, new TaskError(
            node.commit.uses.id,
            "capability-unavailable",
            `transaction node "${node.id}" requires the ref write-safety write sequencer, which is not wired; `
            + "refusing to skip a write node",
          ));
        }
        const transactionScope = scopeFor(node.dependsOn);
        if (!envelope.dryRun && envelope.continuation !== undefined) {
          const settled = readRunCheckpoint(deps.authority.authority, envelope, String(node.id), true);
          // A run's own settlement replays from its receipt: its input is fixed, so a later re-read is an observation, not a correction.
          // A child-run dependency keeps the guard, which alone authenticates the original member authority.
          const checkpoint = settled?.runId === runId && envelope.injected === undefined && !reachesChild(node.dependsOn) ? undefined : settled;
          if (checkpoint !== undefined) {
            const originalScope = sourceScopeFor(checkpoint.runId, node.dependsOn, boundAt(checkpoint), true, node.id);
            const mappings = (scope: RuntimeScope) => ({ prepare: node.prepare.uses.input.parse(node.prepare.bind(scope)),
              commit: node.commit.uses.input.parse(node.commit.bind(scope)) });
            if (canonicalJsonStringify(mappings(originalScope)) !== canonicalJsonStringify(mappings(transactionScope))) {
              throw new RunContinuationRefusedError("run-continuation-transaction-input-mismatch");
            }
          }
        }
        let previewBinding: DryRunBinding | undefined;
        if (envelope.dryRun) {
          try {
            previewBinding = node.previewBind?.(transactionScope);
            if (previewBinding !== undefined) previewBinding = { ...previewBinding, samples: previewBinding.samples.map(sample => DryRunSampleSchema.parse(sample)) };
          }
          catch (error) { if (error instanceof WorkerLogChannelError) throw error; return await failNode(node, node.prepare.uses.id, error); }
          if (node.dependsOn.some(id => previewOnly.has(String(id))) && previewBinding === undefined) {
            markUnavailable(node);
            continue;
          }
        }
        try {
          const captureLog: Pick<TaskLogger, "warn"> = {
            warn(message, fields) {
              deps.log.warn(message, fields);
              deps.taskNotes?.emitRunLog({ workflow: descriptor.id,
                address: { runId, attempt: envelope.attempt, traceId: envelope.traceId,
                  spanPath: `${envelope.traceId}/${String(node.id)}/commit` },
                level: "warn", message, fields,
              }, getRun());
            },
          };
          if (envelope.dryRun) {
            const samples = [...(previewBinding?.samples ?? [])];
            for (const sample of samples) deps.taskNotes?.emitRunLog({ workflow: descriptor.id,
              address: { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath: `${envelope.traceId}/${node.id}/prepare` },
              level: "step", message: "dry-run sample", fields: { field: sample.field, value: canonicalJsonStringify(sample.value) },
            }, getRun());
            let preview: TransactionDryRunPreview;
            try {
              preview = TransactionDryRunPreviewSchema.parse(await withBrowserActionNotes(clock, () => deps.writeSequencer!.executeDryRun({
                descriptor, node, run: getRun(), claim,
                scope: transactionScope,
                dryRun: true, captureLog,
                ...(previewBinding === undefined ? {} : { previewBinding }),
                signal: input.signal,
              }), (actions) => drainBrowserActions(runSpanIdentity.spanPath, actions.filter(action => action.kind !== "screenshot")),
                action => { if (action.kind === "screenshot") drainBrowserActions(runSpanIdentity.spanPath, [action], node.commit.uses.id); }));
            } catch (error) {
              if (error instanceof WorkerLogChannelError) throw error;
              if (error instanceof RunAbandonedError) throw error;
              interruptBeforeFence(node.id);
              return await failNode(node, node.commit.uses.id, error);
            }
            emit({
              t: "transaction.previewed",
              ...runSpanIdentity,
              node: node.id,

              subject: preview.outcome.state === "would-prepare"
                ? preview.outcome.subject.state
                : "not-observed",
              externalCommit: "none",
            });
            dryRunSteps.set(String(node.id), { nodeId: node.id, state: "transaction-preview", preview, samples: preview.outcome.state === "would-prepare" ? samples : [] });
            previewOnly.add(String(node.id));
            continue;
          }
          const raw = await withBrowserActionNotes(clock, () => deps.writeSequencer!.executeTransaction({
            descriptor, node, run: getRun(), claim,
            scope: transactionScope,
            dryRun: envelope.dryRun, captureLog,
            signal: input.signal,
          }), (actions) => drainBrowserActions(runSpanIdentity.spanPath, actions.filter(action => action.kind !== "screenshot")),
              action => { if (action.kind === "screenshot") drainBrowserActions(runSpanIdentity.spanPath, [action], node.commit.uses.id); });
          const OutcomeSchema = z.strictObject({
            disposition: z.enum(["committed", "already-present"]),
            proofSource: z.enum([
              "normal-output", "recovery-probe", "operator-attestation", "durable-intent", "live-probe",
            ]),
            output: node.commit.uses.output,
            proof: JsonValueSchema,
          });
          const settled = JsonValueSchema.parse(OutcomeSchema.parse(raw));
          outputs[String(node.id)] = settled;

          // A transaction terminal dependency refers to its durable outcome wrapper, not its declared inner output.
          const stored = readRunCheckpoint(deps.authority.authority, envelope, String(node.id));
          if (stored === undefined) {
            throw new Error(
              `transaction node "${node.id}" settled but run ${runId} has no durable checkpoint for it; `
              + "beat ⑦ writes one in the same authority transaction as the settlement",
            );
          }
          const record = stored;
          const storedOutcome = TransactionOutcomeSchema.parse(record.output.value);
          const projected = JsonValueSchema.parse(OutcomeSchema.parse({
            disposition: storedOutcome.disposition,
            proofSource: storedOutcome.proofSource,
            output: storedOutcome.output.value,
            proof: storedOutcome.proof.value,
          }));
          if (canonicalJsonStringify(projected) !== canonicalJsonStringify(settled)) {
            throw new Error(
              `transaction node "${node.id}" durable checkpoint does not carry the settlement `
              + `the sequencer reported for run ${runId}`,
            );
          }
          checkpointRecords.set(String(node.id), record);
        } catch (error) {
          if (error instanceof WorkerLogChannelError) throw error;
          if (error instanceof RunAbandonedError) throw error;
          if (error instanceof WriteParkedError) {

            const parked = getRun();
            if (parked.lifecycle.state !== "parked-write"
              || parked.lifecycle.writeIntentId !== error.writeIntentId
              || parked.lifecycle.intentGeneration !== error.intentGeneration) {
              throw new Error(
                `transaction node "${node.id}" raised WriteParkedError for intent ${error.writeIntentId} `
                + `generation ${String(error.intentGeneration)}, but run ${runId} is `
                + `"${parked.lifecycle.state}" in authority; the park signal does not match durable state`,
                { cause: error },
              );
            }
            return RunExecutionOutcomeSchema.parse({
              state: "parked-write",
              runId,
              writeIntentId: error.writeIntentId,
              intentGeneration: error.intentGeneration,
              code: error.parkCode,
            });
          }
          // An attempting intent means the failure came after the fence: keep the claim for recovery, never pause or fail.
          // Once recovery has taken the claim, the claim check abandons the run instead.
          if (deps.authority.withAuthorityTransaction?.(repositories =>
            repositories.writeIntents.listByRun(runId).some(intent => intent.status === "attempting")) === true) {
            requireOriginalClaim(getRun());
            throw error;
          }
          interruptBeforeFence(node.id);
          return await failNode(node, node.commit.uses.id, error);
        }
        continue;
      }
      case "child-run": {
        const parallel = nodes.find(candidate => candidate.kind === "parallel"
          && candidate.branches.some(branch => branch.nodes.includes(node.id)));
        const owner = parallel?.kind === "parallel" ? parallel : node;
        await transitionTo(runningLifecycle(owner.id));
        const unresolved = deps.authority.withAuthorityTransaction?.(repositories =>
          repositories.writeIntents.listAttemptingByItem({ workflowId: envelope.workflow, itemId: envelope.itemId })[0]
            ?? repositories.writeIntents.listByRun(runId).find(intent => intent.status === "parked"));
        if (unresolved !== undefined) {
          const current = getRun();
          if (deps.beforeConfirmedWrite !== undefined) await deps.beforeConfirmedWrite();
          const recovery = deps.lifecycle.requeue({ commandId: lifecycleCommandId("delegation-write-recovery", { runId, version: current.version }),
            runId, expectedVersion: current.version, claim, cause: "recovery" });
          if (recovery.state !== "recovery-required" || recovery.writeIntentId !== unresolved.writeIntentId
            || recovery.intentGeneration !== unresolved.generation) throw new Error("delegation-write-recovery-unproved");
          const parked = getRun();
          if (!recovery.parked || parked.lifecycle.state !== "parked-write" || parked.lifecycle.writeIntentId !== unresolved.writeIntentId
            || parked.lifecycle.intentGeneration !== unresolved.generation || runClaim(parked) !== undefined) throw new Error("delegation-write-recovery-unproved");
          await deps.sessions.closeAll("parked");
          return RunExecutionOutcomeSchema.parse({ state: "parked-write", runId, writeIntentId: parked.lifecycle.writeIntentId,
            intentGeneration: parked.lifecycle.intentGeneration, code: parked.lifecycle.code });
        }
        if (deps.childRuns === undefined) {
          return await failNode(owner, undefined, new Error(
            `child-run node "${node.id}" requires the delegation executor seam, which is not wired `
            + "(capability-unavailable); refusing to skip a delegation",
          ));
        }
        try {
          await deps.sessions.closeAll("parked");
          if (input.signal.aborted) throw abortReason(`run ${runId} was aborted before ${node.id}`);
          checkCancellation();
          requireOriginalClaim(getRun());
          const sourceEvidence = childSourceEvidence(node);
          let raw: unknown;
          if (sourceEvidence !== undefined) {
            const resolution = deps.authority.withAuthorityTransaction?.(repositories => resolveExecutableChildOutput(sourceEvidence, node.target.result,
              repositories.failures, envelope.parent?.edgeId, deps.authority.evidenceSchemaHash?.bind(deps.authority)));
            if (resolution === undefined) throw new Error("delegation-outcome-authority-unavailable");
            raw = resolution.output;
          }
          else if (childBatchOutputs.has(node.id)) raw = childBatchOutputs.get(node.id);
          else {
            const leafIds = owner.kind === "child-run" ? [owner.id] : owner.branches.flatMap(branch => branch.nodes);
            const leaves = leafIds.flatMap(id => {
              const leaf = nodes.find(candidate => candidate.id === id);
              if (leaf?.kind !== "child-run") return [];
              childSourceEvidence(leaf);
              return [{ node: leaf, scope: scopeFor(leaf.dependsOn) }];
            });
            const returned = await deps.childRuns.executeChildRuns({ descriptor, owner, run: getRun(), claim, leaves, signal: input.signal });
            if (DelegationPendingSchema.safeParse(returned).success) raw = returned;
            else {
              const values = z.record(z.string(), JsonValueSchema).parse(returned);
              for (const [id, value] of Object.entries(values)) childBatchOutputs.set(id, value);
              raw = childBatchOutputs.get(node.id);
            }
          }
          if (input.signal.aborted) throw abortReason(`run ${runId} was aborted during ${node.id}`);
          const pending = DelegationPendingSchema.safeParse(raw);
          if (pending.success) {
            if (entry.mode === "replay-child") throw new RunContinuationRefusedError("run-gate-resume-child-unsettled");
            const released = getRun();
            if (pending.data.runId !== runId || released.lifecycle.state !== "queued" || runClaim(released) !== undefined
              || pendingInterruptOf(released) === "stop-requested" || Number(released.claimGeneration) !== Number(claim.claimGeneration)) throw new Error("delegation-release-unproved");
            const manifest = deps.authority.withAuthorityTransaction?.(repositories => {
              const wait = repositories.dependencies.wait(runId, descriptor);
              if (wait?.admissionCommandId !== pending.data.admissionCommandId || wait.nodeId !== owner.id
                || !wait.manifests.some(manifest => manifest.manifestId === pending.data.manifestId)) throw new Error("delegation-release-authority-unavailable");
              const manifest = repositories.delegationManifests.get(pending.data.manifestId);
              if (manifest === undefined || manifest.parentRunId !== runId || !nodes.some(candidate => candidate.kind === "child-run" && candidate.edgeId === manifest.edgeId
                && (owner.kind === "child-run" ? candidate.id === owner.id : owner.branches.some(branch => branch.nodes.includes(candidate.id))))) throw new Error("delegation-release-manifest-unavailable");
              repositories.dependencies.readiness(runId, "join");
              return manifest;
            });
            if (manifest === undefined || owner.kind === "child-run" && node.await === "none") throw new Error("delegation-release-authority-unavailable");
            await deps.sessions.closeAll("parked");
            return RunExecutionOutcomeSchema.parse({ ...pending.data, state: "yielded-delegation" });
          }
          pauseAtBoundary();
          requireOriginalClaim(getRun());
          const resolved = deps.authority.withAuthorityTransaction?.(repositories => {
            assertAccounting();
            deps.lifecycle.assertCurrentExecution({ runId, claim });
            const evidence = sourceEvidence ?? repositories.dependencies.evidence(runId, node.id);
            if (entry.mode === "replay-child" && canonicalJsonStringify(evidence) !== canonicalJsonStringify(entry.evidence))
              throw new RunContinuationRefusedError("run-gate-resume-child-authority-changed");
            const resolution = resolveDelegationEvidenceOutput(evidence, node.target.result, deps.authority.evidenceSchemaHash?.bind(deps.authority));
            if (canonicalJsonStringify(raw) !== canonicalJsonStringify(resolution.output)) throw new Error("delegation-outcome-value-mismatch");
            return { evidence, resolution };
          });
          if (resolved === undefined) throw new Error("delegation-outcome-authority-unavailable");
          const { evidence, resolution } = resolved;
          childResultEvidence.set(String(node.id), evidence);
          if (resolution.kind === "preview") {
            if (!envelope.dryRun) throw new Error("delegation-preview-dry-run-required");
            previewOnly.add(String(node.id));
            dryRunSteps.set(String(node.id), { nodeId: node.id, state: "delegation-preview" });
            continue;
          }
          outputs[String(node.id)] = JsonValueSchema.parse(resolution.output);
          // A settled join reads done, or not needed when it bound no members, once per manifest; its dry-run and dependency accounting stay resolved.
          const joinSpanPath = `${envelope.traceId}/${node.id}#join-${evidence.manifest.manifestId}`;
          if (entry.mode !== "replay-child" && evidence.manifest.join !== "none" && !spanEnded(joinSpanPath)) {
            emitSettledSpan(node, evidence.manifest.children.length === 0 ? CONDITION_SKIP : { outcome: "done" }, joinSpanPath);
          }
        } catch (error) {
          if (error instanceof WorkerLogChannelError) throw error;
          if (error instanceof RunAbandonedError || error instanceof WorkerSessionClosureUnprovedError
            || error instanceof RunLifecycleRefusedError && error.outcome.state === "refused" && error.outcome.refusal.reason === "lost") throw error;
          if (runClaim(getRun())?.claimGeneration !== claim.claimGeneration) throw error;
          deps.lifecycle.assertCurrentExecution({ runId, claim });
          return await failNode(owner, undefined, error);
        }
        continue;
      }
    }
  }

  // The last node's boundary: an abort pauses, cancels or abandons the run instead of settling it done.
  if (input.signal.aborted) throw abortReason(`run ${runId} was aborted before its terminal settlement`);
  assertAccounting();
  if (envelope.dryRun) {
    const support = workflowDryRunSupport(descriptor);
    if (support.state === "supported") {
      const steps = AnyRunPreviewStepSchema.array().parse(nodes.map(node => dryRunSteps.get(String(node.id))));
      return settleSuccess(getRun(), buildRunPreviewResult(descriptor, getRun(), steps,
        dependencyEvidenceFor(workflowPreviewDependencyIds(descriptor, steps), "dry-run preview"), clock, deps.authority.evidenceSchemaHash?.bind(deps.authority)));
    }
    if (envelope.parent === undefined || support.reason !== "no-transaction-node") throw new Error("dry-run preview has no supported preparation boundary");
  }
  const terminal = workflowTerminalResultExecution(descriptor);
  const current = getRun();
  return settleSuccess(current, buildRunResult(
    descriptor,
    current,
    [...dependencyEvidenceFor(terminal.dependsOn, "terminal"), ...[...childResultEvidence.values()].filter(entry => !terminal.dependsOn.includes(entry.nodeId))],
    clock,
    deps.authority.evidenceSchemaHash?.bind(deps.authority),
  ));
}
