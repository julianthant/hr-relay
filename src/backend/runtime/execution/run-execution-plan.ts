import { AuthenticatedRunContinuation } from "../../storage/sqlite/run-continuation-delegation.js";
import { readRunCheckpoint, originalCheckpoint, RunContinuationRefusedError, readContinuationGate, validateRunContinuation } from "../../storage/sqlite/run-continuation.js";
import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { NodeId } from "../../../rules/identity/ids.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { TerminalDependencyEvidence } from "../../../models/run/result.js";
import { CompareReferenceFields, REFERENCE_CHECK_ID, REFERENCE_LOOKUP_NODE, referenceComparisonForGate } from "../../../models/processing/workbooks/reference-fields.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { auditCheckpointFreshness, CheckpointExpectationSchema, loadCheckpoint, RunCheckpointRecordSchema, type CheckpointPatch, type ReplayedCheckpoint, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { applyCheckpointPatches } from "../checkpoints/checkpoint-patch.js";
import { projectTransactionOutcome, type RuntimeFlowNode, type RuntimeScope } from "../../../models/workflow/graph.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import { orderOnlyOmission } from "../../../models/workflow/step-omission.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { runWorkbookReferenceTypeIds } from "../../../models/dashboard/workbooks.js";
import { delegationEvidenceOutput, resolveDelegationEvidenceOutput } from "../../../models/run/result.js";
import { lifecycleCommandId } from "../../runs/lifecycle/run-record-service.js";
import type { ChildRunRuntimeNode, RunExecutionContext, RunExecutionState, TaskRuntimeNode } from "./run-execution-contract.js";
import { requestedParkedWriteRecheck } from "./run-execution-write.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";

function requireStoredCheckpoint(stored: RunCheckpointRecord | undefined, nodeId: string): RunCheckpointRecord {
  if (stored === undefined) {
    throw new Error(`node "${nodeId}" checkpoint load reported found, but the repository returned no stored row`);
  }
  return stored;
}

type PlanEntry =
  | Readonly<{ mode: "execute" }>
  | Readonly<{ mode: "replay"; record: RunCheckpointRecord; deferred?: true; patches?: readonly CheckpointPatch[] }>
  | Readonly<{ mode: "skipped-condition" }>
  | Readonly<{ mode: "skipped-branch" }>

  | Readonly<{ mode: "asserted"; replay?: RunCheckpointRecord }>

  | Readonly<{ mode: "omitted" }>
  | Readonly<{ mode: "manual" }>
  | Readonly<{ mode: "replay-child"; evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }> }>
  | Readonly<{ mode: "replay-gate"; record: GateResultRecord }>;

export type RunExecutionPlan = ReturnType<typeof prepareRunPlan>;

export function prepareRunPlan(
  context: RunExecutionContext,
  state: RunExecutionState,
  problems: string[],
) {
  const { deps, initial, claim, descriptor, clock, envelope, runId, nodes, omissionPlan, instant, getRun, boundInputIdentity, labelOf } = context;
  const { accounting, canonicalInput, outputs, checkpointRecords, scopeFor } = state;
  const injectedByNode = new Map<string, CheckpointPatch[]>();
  for (const patch of envelope.injected ?? []) {
    const existing = injectedByNode.get(String(patch.nodeId));
    if (existing === undefined) injectedByNode.set(String(patch.nodeId), [patch]);
    else existing.push(patch);
  }
  const patchedInserts: RunCheckpointRecord[] = [];
  const plan = new Map<string, PlanEntry>();
  const replayedForFreshness: ReplayedCheckpoint[] = [];

  const continuationSources = validateRunContinuation(deps.authority.authority, envelope);
  const continuationAuthority = envelope.continuation === undefined ? undefined
    : deps.authority.withAuthorityTransaction?.(repositories => AuthenticatedRunContinuation.authenticate(repositories, envelope));
  if (envelope.continuation !== undefined && continuationAuthority === undefined) throw new RunContinuationRefusedError("run-continuation-authority-unavailable");
  const memberRetry = continuationAuthority === undefined ? undefined : deps.lifecycle.delegationRetryExecution({ runId, claim });
  const boundAt = (consumer: RunCheckpointRecord) => (source: RunRecord, dependency: NodeId) => originalCheckpoint(deps.authority.authority, source, String(dependency), consumer.claimGeneration);
  // `pick` names the one row the consumer was bound from; nothing is searched by time or taken as latest.
  // `conditions` is false where the record already holds every dependency's value, so none was skipped by its `when`.
  const sourceScopeFor = (sourceRunId: string, dependsOn: readonly NodeId[], pick: (source: RunRecord, dependency: NodeId) => RunCheckpointRecord | undefined, conditions = true, reader?: NodeId): RuntimeScope => {
    const source = sourceRunId === runId ? getRun() : continuationSources.find(row => row.envelope.runId === sourceRunId);
    if (source === undefined) throw new RunContinuationRefusedError("run-continuation-input-source-unavailable");
    const values: Record<string, JsonValue> = {};
    const asserted: string[] = [];
    for (const dependency of dependsOn) {
      const dependencyNode = nodes.find(node => node.id === dependency);
      if (conditions && (dependencyNode?.kind === "task" || dependencyNode?.kind === "gate" && dependencyNode.resolvedBy === "operator") && dependencyNode.when !== undefined
        && !evaluateNodeCondition(dependencyNode.when, sourceScopeFor(sourceRunId, dependencyNode.dependsOn, pick))) continue;
      const checkpoint = pick(source, dependency);
      const gate = readContinuationGate(deps.authority.authority, source.envelope, String(dependency));
      if (checkpoint !== undefined) {
        if (checkpoint.assertion !== undefined) asserted.push(String(dependency));
        values[String(dependency)] = dependencyNode?.kind === "transaction"
          ? JsonValueSchema.parse(projectTransactionOutcome(dependencyNode.commit.uses, checkpoint.output.value, "Continuation source scope", { checkpoint, schemaReader: deps.authority.evidenceSchemaHash?.bind(deps.authority) })) : checkpoint.output.value;
      }
      else if (gate !== undefined) values[String(dependency)] = gate.result.value;
      // A step done by hand left no checkpoint; a reader that only waits on it binds nothing from it.
      else if (reader !== undefined && orderOnlyOmission(descriptor.stepOmissions, source.envelope.stepOmissions, String(reader), String(dependency))) continue;
      else {
        if (dependencyNode?.kind === "child-run") {
          const child = deps.authority.withAuthorityTransaction?.(repositories => AuthenticatedRunContinuation.authenticate(repositories, source.envelope)
            .dependency(String(dependency), String(dependencyNode.edgeId), true));
          if (child !== undefined) { values[String(dependency)] = JsonValueSchema.parse(delegationEvidenceOutput(child, dependencyNode.target.result, deps.authority.evidenceSchemaHash?.bind(deps.authority))); continue; }
        }
        throw new RunContinuationRefusedError("run-continuation-input-context-unavailable");
      }
    }
    return { input: source.input.parsed.value, outputs: values, references: runWorkbookReferenceTypeIds(source.input.workbookReferences),
      ...(asserted.length === 0 ? {} : { asserted }),
      protectedInputBindings: retainedRunProtectedBindings(source) };
  };
  // Mirrors sourceScopeFor's walk: a child reached directly or through a conditional dependency is authenticated only there.
  const reachesChild = (dependsOn: readonly NodeId[]): boolean => dependsOn.some(id => {
    const dependency = nodes.find(candidate => candidate.id === id);
    return dependency?.kind === "child-run" || (dependency?.kind === "task" || dependency?.kind === "gate" && dependency.resolvedBy === "operator")
      && dependency.when !== undefined && reachesChild(dependency.dependsOn);
  });
  const startAt = envelope.startAt;
  let startIndex: number | undefined;
  if (startAt !== undefined) {
    const found = nodes.findIndex((node) => String(node.id) === String(startAt));
    if (found < 0) {
      problems.push(`start node "${startAt}" does not exist in ${descriptor.id} v${String(descriptor.version)}`);
    } else {
      startIndex = found;
    }
  }

  const startNode = startIndex === undefined ? undefined : nodes[startIndex];
  const startsAtPayPath = startNode?.kind === "transaction" && startNode.commit.uses.id === "ucpath/submit-paypath-work-study";
  // A Saved recheck needs the original fenced target. Fresh reads could bind it to another position.
  const payPathRecheckInputs = !startsAtPayPath ? undefined : deps.authority.withAuthorityTransaction?.(repositories => {
    const request = requestedParkedWriteRecheck(repositories, initial, startNode);
    if (request?.command.type !== "recheck-write") return undefined;
    const { intent } = request;
    const ancestors = new Set(nodes.slice(0, startIndex).filter(node => node.kind === "task").map(node => node.id));
    const checkpoints = new Map<string, RunCheckpointRecord>();
    const fencedAt = Date.parse(intent.fencedAt);
    // Native replay records retain the source checkpoint, even when it belongs to another run.
    for (let after = 0; ;) {
      const page = repositories.timelineEvents.page({ runId, after, limit: 1000 });
      for (const { eventId, source, payload, occurredAt } of page) {
        if (source.kind !== "native") continue;
        if (payload.kind === "write-parked" && payload.writeIntentId === intent.writeIntentId && payload.generation === intent.generation) return checkpoints;
        if (payload.kind !== "checkpoint-recorded" && payload.kind !== "checkpoint-replayed") continue;
        const reference = payload.checkpoint;
        if (payload.runId !== runId || payload.workflow !== descriptor.id || payload.attempt !== envelope.attempt
          || payload.claimGeneration >= claim.claimGeneration || Date.parse(occurredAt) > fencedAt
          || Date.parse(reference.writtenAt) > fencedAt || !ancestors.has(reference.nodeId)) continue;
        if (payload.kind === "checkpoint-replayed" && eventId !== lifecycleCommandId("timeline-checkpoint-replayed", {
          runId, nodeId: reference.nodeId, claimGeneration: payload.claimGeneration,
        })) throw new RunContinuationRefusedError("paypath-recheck-replay-identity-mismatch");
        const record = repositories.runCheckpoints.get(descriptor.id, envelope.itemId, reference.nodeId, reference.attempt, reference.claimGeneration);
        if (record === undefined || canonicalJsonStringify(timelineCheckpointReference(record)) !== canonicalJsonStringify(reference)) {
          throw new RunContinuationRefusedError("paypath-recheck-checkpoint-unavailable");
        }
        checkpoints.set(reference.nodeId, record);
      }
      const last = page.at(-1);
      if (last === undefined || page.length < 1000) return checkpoints;
      after = last.cursor;
    }
  });
  const previousNode = startIndex === undefined ? undefined : nodes[startIndex - 1];
  const resolvedResumeGate = envelope.continuation === undefined
    ? (startNode?.kind === "gate" ? readContinuationGate(deps.authority.authority, envelope, String(startNode.id)) : undefined)
      ?? (previousNode?.kind === "gate" ? readContinuationGate(deps.authority.authority, envelope, String(previousNode.id)) : undefined)
    : undefined;
  const ownGateResume = resolvedResumeGate?.runId === runId;
  const reviewComparison = ownGateResume && resolvedResumeGate !== undefined ? referenceComparisonForGate(resolvedResumeGate.nodeId) : undefined;
  // A review after filing resumes from checkpoints bound to the claim that observed the difference.
  const postWriteReview = reviewComparison !== undefined && !envelope.dryRun
    && nodes.slice(0, startIndex).some(node => node.kind === "transaction")
    ? originalCheckpoint(deps.authority.authority, initial, reviewComparison, Number(claim.claimGeneration) - 1) : undefined;
  const reviewCheckpoint = (node: RuntimeFlowNode) => postWriteReview === undefined ? undefined
    : originalCheckpoint(deps.authority.authority, initial, node.id, postWriteReview.claimGeneration);
  const reviewSkippedBranches = new Set<string>();
  const completedOwnDelegation = (node: ChildRunRuntimeNode) => {
    const evidence = deps.authority.withAuthorityTransaction?.(repositories =>
      AuthenticatedRunContinuation.authenticate(repositories, envelope).dependency(String(node.id), String(node.edgeId)));
    if (evidence === undefined || evidence.parentRunId !== runId || evidence.nodeId !== node.id || evidence.edgeId !== node.edgeId
      || node.await !== "terminal" || evidence.manifest.cardinality !== node.cardinality || evidence.manifest.join !== node.join
      || canonicalJsonStringify(evidence.manifest.policy) !== canonicalJsonStringify(node.policy)
      || (deps.authority.evidenceSchemaHash?.({ kind: "delegation-input", id: evidence.manifest.manifestId }, evidence.manifest, evidence.manifest.inputSchemaHash, deriveSchemaHash(node.target.input, "input")) ?? evidence.manifest.inputSchemaHash) !== deriveSchemaHash(node.target.input, "input")
      || (deps.authority.evidenceSchemaHash?.({ kind: "delegation-result", id: evidence.manifest.manifestId }, evidence.manifest, evidence.manifest.resultSchemaHash, deriveSchemaHash(node.target.result, "output")) ?? evidence.manifest.resultSchemaHash) !== deriveSchemaHash(node.target.result, "output")
      || evidence.children.some(child => child.run.envelope.workflow !== node.target.id || child.run.envelope.dryRun !== envelope.dryRun)) {
      throw new RunContinuationRefusedError("run-gate-resume-child-authority-unavailable");
    }
    resolveDelegationEvidenceOutput(evidence, node.target.result, deps.authority.evidenceSchemaHash?.bind(deps.authority));
    return evidence;
  };

  const checkpointExpectation = (node: TaskRuntimeNode) => CheckpointExpectationSchema.parse({
    descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
    implFingerprint: taskImplFingerprint(node.uses),
    outputSchemaHash: deriveSchemaHash(node.uses.output, "output"),
  });

  const retainedTransaction = (node: RuntimeFlowNode) => node.kind === "transaction"
    && (payPathRecheckInputs !== undefined && node === startNode
      || postWriteReview !== undefined && nodes.indexOf(node) < (startIndex ?? 0)
      || envelope.continuation?.checkpoints.some(row => row.nodeId === node.id) === true);
  const pendingCommits = nodes.filter(node => node.kind === "transaction" && !retainedTransaction(node)
    && !omissionPlan.omitted.has(String(node.id)) && !omissionPlan.manual.has(String(node.id)) && !omissionPlan.asserted.has(String(node.id))).map(node => node.id);
  // An explicit start node requires every ancestor to resolve without executing it.
  let ancestorRegionOpen = canonicalInput !== undefined;
  const publicationRegion = new Set<string>();
  if (envelope.dryRun) for (const node of nodes) {
    if (node.kind === "task" && node.dryRun === "stop-before-publish" || node.dependsOn.some(id => publicationRegion.has(String(id)))) publicationRegion.add(String(node.id));
  }
  for (const [index, node] of nodes.entries()) {

    if (omissionPlan.manual.has(String(node.id))) {
      plan.set(String(node.id), { mode: "manual" });
      continue;
    }
    if (omissionPlan.omitted.has(String(node.id))) {
      plan.set(String(node.id), { mode: "omitted" });
      continue;
    }
    if (node.kind === "child-run" && node.id === REFERENCE_LOOKUP_NODE && descriptor.workbookCheck?.id === REFERENCE_CHECK_ID
      && !runWorkbookReferenceTypeIds(initial.input.workbookReferences).includes(REFERENCE_CHECK_ID)) {
      plan.set(String(node.id), { mode: "skipped-condition" });
      continue;
    }
    if (omissionPlan.asserted.has(String(node.id))) {
      // A typed value stands for a reading that would have run: a node this input never runs stays skipped.
      if (node.kind === "task" && node.when?.of.from === "input" && !evaluateNodeCondition(node.when, scopeFor(node.dependsOn))) {
        plan.set(String(node.id), { mode: "skipped-condition" });
        continue;
      }
      const own = readRunCheckpoint(deps.authority.authority, envelope, String(node.id), true);
      const ownRecord = own === undefined ? undefined : RunCheckpointRecordSchema.parse(own);
      const replay = ownRecord !== undefined
        && ownRecord.assertion !== undefined
        && ownRecord.runId === runId
        && ownRecord.attempt === envelope.attempt
        ? ownRecord
        : undefined;
      plan.set(String(node.id), replay === undefined ? { mode: "asserted" } : { mode: "asserted", replay });
      // This run's own assertion row is its output; later conditions read it as known.
      if (replay !== undefined) outputs[String(node.id)] = JsonValueSchema.parse(replay.output.value);
      continue;
    }
    // A dry run re-derives a publication boundary and everything behind it; stored state never stands in.
    if (publicationRegion.has(String(node.id))) {
      plan.set(String(node.id), { mode: "execute" });
      continue;
    }
    const retainedAccounting = accounting?.plan.retain.includes(String(node.id)) === true;
    if (accounting?.plan.recompute.includes(String(node.id))) {
      plan.set(String(node.id), { mode: "execute" });
      continue;
    }
    if (retainedAccounting && node.kind === "child-run") {
      plan.set(String(node.id), { mode: "replay-child", evidence: completedOwnDelegation(node) });
      continue;
    }
    const explicit = startIndex !== undefined && envelope.continuation === undefined;
    const inAncestorRegion = retainedAccounting || envelope.continuation !== undefined || (explicit
      ? index < (startIndex ?? 0) || ownGateResume && index === startIndex && node.id === resolvedResumeGate?.nodeId : ancestorRegionOpen);
    if (postWriteReview !== undefined && (reviewSkippedBranches.has(node.id) || node.dependsOn.some(id => reviewSkippedBranches.has(id)))) {
      reviewSkippedBranches.add(node.id);
      plan.set(String(node.id), { mode: "skipped-branch" });
      continue;
    }
    if (!inAncestorRegion) {
      plan.set(String(node.id), { mode: "execute" });
      continue;
    }
    const recheckAncestor = payPathRecheckInputs !== undefined && index < (startIndex ?? 0);
    if (node.kind === "task") {
      if (!recheckAncestor && postWriteReview === undefined && node.replay === "always-rerun" && (envelope.continuation === undefined || retainedAccounting || memberRetry !== undefined)) {
        // NEVER consult loadCheckpoint for an always-rerun node (§5.3).
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      let conditionKnown = true;
      for (const dependency of node.dependsOn) {
        const dependencyEntry = plan.get(String(dependency));
        if (dependencyEntry?.mode === "skipped-condition") continue;
        if (dependencyEntry === undefined || dependencyEntry.mode === "execute"
          || dependencyEntry.mode === "asserted" && dependencyEntry.replay === undefined
          || !Object.hasOwn(outputs, String(dependency))) {
          conditionKnown = false;
        }
      }
      if (node.when !== undefined && (conditionKnown || node.when.of.from !== "node")) {

        const condition = evaluateNodeCondition(node.when, scopeFor(node.dependsOn));
        if (!condition) {
          plan.set(String(node.id), { mode: "skipped-condition" });
          continue;
        }
      }
      const stored = postWriteReview !== undefined ? reviewCheckpoint(node)
        : recheckAncestor ? payPathRecheckInputs.get(node.id)
        : retainedAccounting || node.uses === CompareReferenceFields && envelope.continuation === undefined
        ? deps.authority.authority.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, node.id, envelope.attempt)
          .filter(record => record.runId === runId).at(-1)
        : readRunCheckpoint(deps.authority.authority, envelope, String(node.id), true,
          node.when?.of.from === "reference" ? node.when.of.typeId : undefined);

      if ((envelope.recovery === "restart-from-start" || envelope.sourceBound !== undefined && envelope.continuation === undefined) && stored !== undefined && stored.runId !== runId) {
        if (explicit) {
          problems.push(
            `node "${node.id}" (${labelOf(node)}) cannot be replayed on a restart-from-start attempt; `
            + "a restart owns no explicit start node",
          );
          continue;
        }
        ancestorRegionOpen = false;
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      const load = loadCheckpoint(
        stored,
        checkpointExpectation(node),
        node.uses.output,
      );
      if (retainedAccounting && !load.found) throw new RunContinuationRefusedError("delegation-accounting-upstream-checkpoint-unavailable");
      // `stored` is the repository's strict parse already; a found load has a row.
      const storedRecord = load.found ? requireStoredCheckpoint(stored, String(node.id)) : undefined;
      const storedAssertion = storedRecord?.assertion;
      if (storedAssertion !== undefined) {

        if (explicit) {
          problems.push(
            `node "${node.id}" (${labelOf(node)}) latest checkpoint is an operator assertion for omitted step `
            + `"${storedAssertion.step}", and this run does not omit that step; an assertion never replays as an observation`,
          );
          continue;
        }
        ancestorRegionOpen = false;
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      if (load.found) {
        const record = requireStoredCheckpoint(stored, String(node.id));
        // A stale always-rerun fact is read again, and so is a stale ancestor of a plain Start;
        // only an explicit start node or a continuation refuses a stale checkpoint.
        const implicitAncestor = !explicit && envelope.continuation === undefined && !retainedAccounting;
        // A receipt review must resolve the filed branch before checking freshness for any remaining commits.
        if (!recheckAncestor && postWriteReview === undefined && (node.replay === "always-rerun" || implicitAncestor) && auditCheckpointFreshness({ workflowId: descriptor.id, runId, startAt: startAt ?? node.id, nodes,
          replayed: [{ nodeId: node.id, taskId: node.uses.id, freshness: node.uses.freshness, provenance: record.provenance }],
          scheduled: pendingCommits, now: clock.now(), attempt: envelope.attempt,
          ...(envelope.freshnessOverride === undefined ? {} : { overrides: envelope.freshnessOverride }) }).length > 0) {
          if (node.replay !== "always-rerun") ancestorRegionOpen = false;
          plan.set(String(node.id), { mode: "execute" });
          continue;
        }
        const deferred = node.dependsOn.some(dependency => !Object.hasOwn(outputs, String(dependency))
          && plan.get(String(dependency))?.mode !== "skipped-condition");
        if (!deferred && envelope.continuation !== undefined) {
          const original = node.uses.input.parse(node.bind(sourceScopeFor(record.runId, node.dependsOn, boundAt(record))));
          const continued = node.uses.input.parse(node.bind(scopeFor(node.dependsOn)));
          if (boundInputIdentity(original) !== boundInputIdentity(continued)) {
            problems.push(`Completed node "${node.id}" has incompatible corrected input; continuation refused`);
            continue;
          }
        }
        const nodePatches = injectedByNode.get(String(node.id));
        let effective = record;
        if (nodePatches !== undefined && !deferred) {
          injectedByNode.delete(String(node.id));
          try {
            const patched = applyCheckpointPatches({
              replayed: record,
              patches: nodePatches,
              outputSchema: node.uses.output,
              attempt: envelope.attempt,
              claimGeneration: claim.claimGeneration,
              runId,
              writtenAt: instant(),
            });
            effective = patched.record;
            patchedInserts.push(patched.record);
          } catch (error) {
            problems.push(
              `injected correction for node "${node.id}" was refused: `
              + (error instanceof Error ? error.message : String(error)),
            );
            continue;
          }
        }
        if (deferred && nodePatches !== undefined) injectedByNode.delete(String(node.id));
        plan.set(String(node.id), { mode: "replay", record: effective, ...(deferred ? { deferred: true,
          ...(nodePatches === undefined ? {} : { patches: nodePatches }) } : {}) });
        if (deferred) continue;
        outputs[String(node.id)] = JsonValueSchema.parse(effective.output.value);
        checkpointRecords.set(String(node.id), effective);
        replayedForFreshness.push({
          nodeId: node.id,
          taskId: node.uses.id,
          freshness: node.uses.freshness,
          provenance: effective.provenance,
        });
        continue;
      }
      if (explicit || recheckAncestor || envelope.continuation?.checkpoints.some(row => row.nodeId === node.id)) {
        problems.push(
          `missing context "${node.id}" (${labelOf(node)} → ${node.uses.id}) — ${load.reason}: ${load.detail}; `
          + `replay policy is "checkpoint".`,
        );
        continue;
      }
      ancestorRegionOpen = false;
      plan.set(String(node.id), { mode: "execute" });
      continue;
    }
    if (node.kind === "gate") {
      const comparison = referenceComparisonForGate(node.id);
      const deferredComparison = comparison === undefined ? undefined : plan.get(comparison);
      const conditionApplies = () => {
        const scope = scopeFor(node.dependsOn);
        const evidence = deferredComparison?.mode === "replay" && comparison !== undefined
          ? { ...scope, outputs: { ...scope.outputs, [comparison]: deferredComparison.record.output.value } } : scope;
        return node.resolvedBy === "operator" && node.when !== undefined && evaluateNodeCondition(node.when, evidence);
      };
      if (node.resolvedBy === "operator" && node.when !== undefined
        && node.dependsOn.every(dependency => outputs[String(dependency)] !== undefined
          || plan.get(String(dependency))?.mode === "skipped-condition" || (dependency === comparison && deferredComparison?.mode === "replay"))
        && !conditionApplies()) {
        if (readContinuationGate(deps.authority.authority, envelope, String(node.id)) !== undefined) {
          problems.push(`inapplicable gate "${node.id}" carries a stored operator result; evidence changed`);
          continue;
        }
        plan.set(String(node.id), { mode: "skipped-condition" });
        continue;
      }
      const stored = readContinuationGate(deps.authority.authority, envelope, String(node.id));
      if (stored !== undefined) {
        if ((stored.runId !== runId && !envelope.continuation?.gates.some(row => row.runId === stored.runId && row.nodeId === node.id)) || String(stored.nodeId) !== String(node.id) || (deps.authority.evidenceSchemaHash?.({ kind: "gate-result", id: canonicalJsonStringify([stored.runId, stored.gateId]) }, stored, stored.result.schemaHash, deriveSchemaHash(node.result, "output")) ?? stored.result.schemaHash) !== deriveSchemaHash(node.result, "output")) throw new Error(`gate "${node.id}" stored result binding changed`);
        if (stored.runId !== runId) {
          const source = continuationSources.find(row => row.envelope.runId === stored.runId);
          if (source === undefined || canonicalJsonStringify(source.input.parsed) !== canonicalJsonStringify(initial.input.parsed)) {
            problems.push(`Completed gate "${node.id}" has incompatible corrected input; continuation refused`);
            continue;
          }
        }
        outputs[String(node.id)] = JsonValueSchema.parse(node.result.parse(stored.result.value));
        plan.set(String(node.id), { mode: "replay-gate", record: stored });
        continue;
      }
      if (explicit) {
        problems.push(`gate "${node.id}" has no stored result; a resume past an unresolved gate is impossible`);
        continue;
      }
      ancestorRegionOpen = false;
      plan.set(String(node.id), { mode: "execute" });
      continue;
    }
    if (node.kind === "branch" || node.kind === "parallel") {
      if (postWriteReview !== undefined && node.kind === "branch") {
        if (node.dependsOn.some(id => !Object.hasOwn(outputs, id) && plan.get(id)?.mode !== "skipped-condition")) {
          problems.push(`missing settled context for branch "${node.id}" before the reference review`);
          continue;
        }
        const selected = node.choose(scopeFor(node.dependsOn));
        if (!Object.hasOwn(node.cases, selected)) throw new RunContinuationRefusedError("run-gate-resume-branch-unavailable");
        for (const [key, targets] of Object.entries(node.cases)) {
          if (key !== selected) for (const target of targets) reviewSkippedBranches.add(target);
        }
      }
      // Pure control nodes re-derive deterministically from validated data.
      plan.set(String(node.id), { mode: "execute" });
      continue;
    }
    if (explicit && ownGateResume && node.kind === "child-run" && node.await === "terminal") {
      const evidence = completedOwnDelegation(node);
      if (postWriteReview !== undefined) outputs[String(node.id)] = JsonValueSchema.parse(delegationEvidenceOutput(
        evidence, node.target.result, deps.authority.evidenceSchemaHash?.bind(deps.authority)));
      plan.set(String(node.id), { mode: "replay-child", evidence });
      continue;
    }
    if (node.kind === "transaction" && postWriteReview !== undefined) {
      const checkpoint = reviewCheckpoint(node);
      const loaded = loadCheckpoint(checkpoint, CheckpointExpectationSchema.parse({
        descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
        implFingerprint: taskImplFingerprint(node.commit.uses), outputSchemaHash: deriveSchemaHash(TransactionOutcomeSchema, "output"),
      }), TransactionOutcomeSchema);
      if (!loaded.found) {
        problems.push(`missing settled write "${node.id}" before the reference review: ${loaded.detail}`);
        continue;
      }
      const record = requireStoredCheckpoint(checkpoint, String(node.id));
      outputs[String(node.id)] = JsonValueSchema.parse(projectTransactionOutcome(node.commit.uses, loaded.output, "Reference review resume",
        { checkpoint: record, schemaReader: deps.authority.evidenceSchemaHash?.bind(deps.authority) }));
      checkpointRecords.set(String(node.id), record);
      plan.set(String(node.id), { mode: "replay", record });
      continue;
    }
    if (explicit) {
      problems.push(
        `cannot resume across ${node.kind} node "${node.id}"; its recovery/reuse semantics `
        + "belong to the owning seam and are not a Phase-1 interpreter replay",
      );
      continue;
    }
    ancestorRegionOpen = false;
    plan.set(String(node.id), { mode: "execute" });
  }

  for (const nodeId of injectedByNode.keys()) {
    problems.push(
      `injected correction names node "${nodeId}", which this run does not replay from a checkpoint; `
      + "a fresh read supersedes any correction, so the patch is refused rather than silently ignored",
    );
  }


  if (canonicalInput !== undefined) {
    const scheduled = nodes
      .filter((node) => plan.get(String(node.id))?.mode === "execute" && !retainedTransaction(node))
      .map((node) => node.id);
    const firstNode = nodes[0];
    if (firstNode === undefined) throw new Error(`${descriptor.id} declares no nodes`);
    problems.push(...auditCheckpointFreshness({
      workflowId: descriptor.id,
      runId,
      startAt: startAt ?? scheduled[0] ?? firstNode.id,
      nodes,
      replayed: replayedForFreshness,
      scheduled,
      now: clock.now(),
      attempt: envelope.attempt,
      ...(envelope.freshnessOverride === undefined ? {} : { overrides: envelope.freshnessOverride }),
    }));
  }


  for (const refusal of omissionPlan.refusals) {
    problems.push(`step omission refused [${refusal.code}]: ${refusal.message}`);
  }
  const typedSteps = new Set([...omissionPlan.asserted.values()].map(({ step }) => step));
  for (const step of typedSteps) {
    const produced = [...omissionPlan.asserted].filter(([, assertion]) => assertion.step === step).map(([nodeId]) => nodeId);
    if (produced.every((nodeId) => plan.get(nodeId)?.mode === "skipped-condition")) {
      problems.push(`step "${step}" carries typed values, but this input runs none of the nodes they stand for (${produced.join(", ")})`);
    }
  }
  return {
    plan, patchedInserts, continuationAuthority, memberRetry, boundAt, sourceScopeFor, reachesChild,
    startAt, startIndex, completedOwnDelegation, retainedTransaction,
  };
}
