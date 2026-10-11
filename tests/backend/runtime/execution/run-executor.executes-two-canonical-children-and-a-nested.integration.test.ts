import { resolveOperationSource } from "../../../../src/backend/runs/queries/operation-source.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { canonicalJsonStringify,JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { Plan1CanonicalInput,Plan1Input,Plan1Output,plan1Parent,plan1Stores,plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testRunLifecycle,testRunService,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
const PLAN1_CONFIG_ID = "00000000-0000-4000-8000-000000000c01";

import assert from "node:assert/strict";
import { afterEach,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema } from "../../../../src/backend/logs/span-emitter.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../../../src/backend/runtime/execution/run-executor.js";
import type { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { type RunParent } from "../../../../src/models/run/envelope.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { SearchPersonOrg,SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION,
type WorkflowOperationDisplayDeclaration,
} from "../../../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow,defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../../../support/fixtures/workflow-definition-fixtures.js";
import {
happySessionHarness,
ManualScheduler,
openAuthorityHarness,
recordingEmitter,
recordingLogger,
sessionManagerFor,
type AuthorityHarness,
type SessionFactoryHarness
} from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

function readPersistedNotes(database: AuthorityDatabase) {
  return readTimelineRecords(database.authority.timelineEvents).records.flatMap(record => record.payload.kind === "note" ? [NoteWireSchema.parse(record.payload.note)] : []);
}

const authorityHarnesses = new WeakMap<AuthorityDatabase, AuthorityHarness>();

const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface ExecutorHarness {
  readonly authority: AuthorityHarness;
  readonly sessions: SessionFactoryHarness;
  readonly manager: WorkerSessionManager;
  readonly scheduler: ManualScheduler;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly deps: RunExecutorDependencies;
}

function executorHarness(options: Readonly<{
  sessions?: SessionFactoryHarness;
  autoFireAtOrBelowMs?: number;
  taskDeadlineMs?: number;
  stores?: RunExecutorDependencies["stores"];
  descriptor?: AnyWorkflowDescriptor;
}> = {}): ExecutorHarness {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  authorityHarnesses.set(authority.database, authority);
  const sessions = options.sessions ?? happySessionHarness();
  const manager = sessionManagerFor(sessions, authority.clock);
  const scheduler = new ManualScheduler(authority.clock, options.autoFireAtOrBelowMs ?? 0);
  const emitter = {
    emitter: createTimelineEmitter({ repository: authority.database.authority.timelineEvents, clock: authority.clock }),
    events: () => authority.database.authority.timelineEvents.page({}).flatMap((record) => {
      if (record.payload.kind !== "span" || record.payload.event.t === "run.queued") return [];
      const { pid: _pid, ...event } = record.payload.event;
      return [ExecutorSpanEventSchema.parse(event)];
    }),
  };
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor: options.descriptor ?? personLookupDescriptor,
    stores: options.stores ?? taskStoreRegistry,
    authority: authority.database,
    sessions: manager,
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("b"),
    scheduler,
    taskDeadlineMs: options.taskDeadlineMs ?? 60_000,
    log: recordingLogger().log,
  };
  return { authority, sessions, manager, scheduler, emitter, deps };
}

function enqueueAndClaim(
  database: AuthorityDatabase,
  run: Record<string, unknown>,
  now: string,
  workflow = WORKFLOW_ID,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const harness = authorityHarnesses.get(database);
  if (harness === undefined) throw new Error("executor-authority-harness-missing");
  const descriptor = [personLookupDescriptor, actionBindingCompiled.descriptor, plan1Parent.descriptor, ...plan1Workflows.map(compiled => compiled.descriptor)].find(candidate => candidate.id === workflow);
  if (descriptor === undefined) throw new Error("executor-fixture-descriptor-missing");
  testWorkerPorts(database, harness.clock, { path: harness.path, descriptor, poolIndex: 1 });
  const slot = database.authority.workerSlots.list(workflow).find(slot => slot.poolIndex === 1 && slot.retiredAt === null);
  if (slot === undefined) throw new Error("executor-fixture-worker-missing");
  database.authority.runs.enqueue(run);
  const claimed = database.authority.runs.claimNext({ workflow, workerId: slot.workerId, now });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return {
    run: claimed.run,
    claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration },
  };
}

const SIGNAL = new AbortController().signal;

const ACTION_BINDING_WORKFLOW_ID = "fixture-operation-action-binding";
const ActionBindingInput = z.strictObject({ emplId: EidSchema });
const ActionBindingCanonicalInput = defineCanonicalInput(
  ActionBindingInput,
  z.strictObject({ emplId: EidSchema }),
  [{ emplId: "10873698" }],
);
const actionBindingWorkflow = defineWorkflow({
  id: ACTION_BINDING_WORKFLOW_ID,
  version: 1,
  code: "fab",
  label: "Operation action binding fixture",
  icon: "Search",
  category: "operations",
  input: ActionBindingInput,
  canonicalInput: ActionBindingCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `fixture:${input.emplId}` },
  presentation: { title: (input) => `EID ${input.emplId}` },
  scenarios: ["fixture-operation-action-binding/happy"],
  role: defineWorkflowRole({ kind: "standalone" }),
  operationDisplay: {
    capability: "complete",
    version: OPERATION_DISPLAY_FORMAT_VERSION,
    invocations: [{
      id: "search-operation",
      entryId: "search",
      contractRole: "task",
      occurrencePath: ["search"],
      bindings: [
        { slot: "search-kind", value: { kind: "constant", value: "by-eid" } },
        { slot: "empl-id", value: { kind: "run-input", path: "emplId" } },
        { slot: "name", value: { kind: "constant", value: "unused" } },
      ],
    }],
    presentation: [{ id: "search-operation-node", kind: "operation", invocationId: "search-operation" }],
  } satisfies WorkflowOperationDisplayDeclaration,
  steps: ({ task, result }) => {
    const search = task({
      id: "search",
      contract: SearchPersonOrg,
      label: "Search",
      replay: "checkpoint",
    }, [], ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }));
    return {
      steps: [[{ key: "search", label: "Search" }, [search]]],
      result: result(SearchPersonOrgOutputSchema, [search], ({ outputs }) => outputs.search, [{ path: "selection.status", source: { kind: "task-output", entryId: "search", path: "selection.status" } },
        { path: "results", source: { kind: "derived", inputs: [
          { id: "selection", source: { kind: "task-output", entryId: "search", path: "selection.status" } },
          { id: "query", source: { kind: "task-output", entryId: "search", path: "selection.candidateEids" } },
        ] } }]),
    };
  },
});
const actionBindingCompiled = compileWorkflow(actionBindingWorkflow, {
  manifest: fixtureBuildManifest([ACTION_BINDING_WORKFLOW_ID]),
});

it("executes two canonical children and a nested child, preserving every derived input through real terminal authority and source routes", async () => {
  const harness = executorHarness({ descriptor: plan1Parent.descriptor, stores: plan1Stores });
  const { database, clock, stateRoot: _stateRoot } = harness.authority;
  const config = { ...CONFIG_SNAPSHOT.config, actor: { ...CONFIG_SNAPSHOT.config.actor, label: "Different operator" } };
  const fingerprint = sha256Hex(canonicalJsonStringify(config));
  database.authority.configSnapshots.insert({ ...CONFIG_SNAPSHOT, configSnapshotId: PLAN1_CONFIG_ID, config, fingerprint });
  const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
  const originalTerminalize = harness.deps.lifecycle.terminalize;
  const fixtureLifecycle = { ...harness.deps.lifecycle, terminalize: (...args: Parameters<typeof originalTerminalize>) => originalTerminalize(...args) };
  let number = 0;
  const createRun = (compiled: typeof plan1Parent, value: unknown, parent?: RunParent, itemId?: string) => {
    const sequence = ++number;
    return buildQueuedRun({ descriptor: compiled.descriptor, appVersion: "0.1.0", runId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      itemId: itemId ?? `00000000-0000-4000-8001-${String(sequence).padStart(12, "0")}`, traceId: `fp-170000-${String(sequence).padStart(4, "0")}`,
      rawInput: JsonValueSchema.parse(value), canonicalInput: { protectedBindings: [], schemaHash: deriveSchemaHash(Plan1CanonicalInput, "output"), value: Plan1Input.parse(value) }, ingressSchemaHash: deriveSchemaHash(Plan1Input, "input"),
      configFingerprint: fingerprint, configSnapshotId: PLAN1_CONFIG_ID, resolvedInstance: {}, shape: parent === undefined ? "single" : "operation-member", priority: "bulk", dryRun: false,
      attempt: 1, runNumber: sequence, now: clock.now().toISOString(), ...(parent === undefined ? {} : { parent }) });
  };
  const childExecutor: NonNullable<RunExecutorDependencies["childRuns"]> = { async executeChildRun(context) {
    const node = context.node;
    if (node.cardinality !== "one" || node.await !== "terminal") throw new Error("fixture-child-shape-mismatch");
    const compiled = plan1Workflows.find((compiled) => compiled.descriptor.id === node.target.id);
    if (compiled === undefined) throw new Error("fixture-child-target-unavailable");
    const value = node.bind(context.scope);
    const childInput = createRun(compiled, value, { runId: context.run.envelope.runId, edgeId: node.edgeId, tracePrefix: context.run.envelope.traceId }, node.deriveChildItemId(Plan1Input.parse(value)));
    const protectedBindings = context.run.input.parsed.protectedBindings;
    const child = protectedBindings === undefined ? childInput : { ...childInput, input: { ...childInput.input, parsed: { ...childInput.input.parsed, protectedBindings } } };
    const claimed = enqueueAndClaim(database, child, clock.now().toISOString(), compiled.descriptor.id);
    const outcome = await executeClaimedRun({ ...harness.deps, descriptor: compiled.descriptor, lifecycle: fixtureLifecycle, childRuns: childExecutor, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    if (outcome.state !== "done") throw new Error(`fixture-child-did-not-complete:${JSON.stringify(outcome)}:${JSON.stringify(database.authority.runs.get(child.envelope.runId))}`);
    const result = database.authority.runResults.get(child.envelope.runId);
    assert.ok(result);
    return { state: "done", runId: child.envelope.runId, itemId: child.envelope.itemId, output: result.result.value };
  } };
  const root = createRun(plan1Parent, { emplId: "10800000", text: "same", mode: "ok" });
  const claimed = enqueueAndClaim(database, root, clock.now().toISOString(), plan1Parent.descriptor.id);
  const outcome = await executeClaimedRun({ ...harness.deps, lifecycle: fixtureLifecycle, childRuns: childExecutor, taskNotes: writer }, { ...claimed, signal: SIGNAL });
  assert.equal(outcome.state, "done", JSON.stringify(database.authority.failures.listByRun(root.envelope.runId)));
  const retained = database.authority.runResults.get(root.envelope.runId);
  assert.ok(retained);
  assert.deepEqual(retained.dependencies.map((dependency) => dependency.state), ["child-resolved", "child-resolved", "resolved"]);
  const notes = readPersistedNotes(database).map((note) => NoteWireSchema.parse(note));
  const consumed = notes.find((note) => "runId" in note && note.runId === root.envelope.runId && note.action?.operation?.state === "completed" && note.action.operation.logicalActionId === "consume-text")?.action?.operation;
  assert.ok(consumed?.value?.producer.kind === "transformation");
  assert.deepEqual(consumed.value.producer.inputs?.map((input) => [input.inputId, input.state, input.identities.length]), [["left", "retained", 2], ["right", "retained", 1], ["label", "definition-source", 0]]);
  const identity = consumed.value.producer.inputs?.[0]?.identities[0];
  assert.ok(identity);
  const deps = { timeline: database.authority.timelineEvents, stateRoot: _stateRoot, runReader: testRunService(database, clock), canonical: { database }, descriptors: { resolve: () => undefined }, projection: { runLogSnapshot: () => ({ entries: [] }) } } as unknown as RunDetailQueryDeps;
  const found = resolveOperationSource(deps, root.envelope.runId, { identity });
  assert.equal(found.state, "found");
  assert.throws(() => resolveOperationSource(deps, identity.runId, { identity: (() => { const { value: _value, ...identity } = consumed; return identity; })() }), /child-not-authorized/u);
  assert.throws(() => resolveOperationSource(deps, root.envelope.runId, { identity: { ...identity, childInvocation: { ...identity.childInvocation, edgeId: "foreign-edge" } } }), /child-identity-mismatch/u);
  assert.throws(() => resolveOperationSource(deps, root.envelope.runId, { identity: { ...identity, logicalActionId: "unknown-action" } }), /unknown-frozen-action/u);
  assert.throws(() => resolveOperationSource(deps, root.envelope.runId, { identity: { ...identity, invocationId: "unknown-invocation" } }), /unknown-frozen-invocation/u);
  const protectedParentBase = createRun(plan1Parent, { emplId: "10800000", text: "secret-derived", mode: "ok" });
  const protectedParent = { ...protectedParentBase, input: { ...protectedParentBase.input, parsed: { ...protectedParentBase.input.parsed, protectedBindings: [{ kind: "test-data-local" as const, sourceId: UUID_4, inputPath: "emplId" as const, name: "personLookupCanaryEid" as const }] } } };
  const protectedClaim = enqueueAndClaim(database, protectedParent, clock.now().toISOString(), plan1Parent.descriptor.id);
  assert.equal((await executeClaimedRun({ ...harness.deps, childRuns: childExecutor, taskNotes: writer }, { ...protectedClaim, signal: SIGNAL })).state, "done", database.authority.failures.listByRun(protectedParent.envelope.runId).map((failure) => failure.summary).join(";"));
  const protectedNotes = readPersistedNotes(database).map((note) => NoteWireSchema.parse(note)).filter((note) => "runId" in note && note.runId === protectedParent.envelope.runId);
  const protectedConsumed = protectedNotes.find((note) => note.action?.operation?.logicalActionId === "consume-text" && note.action.operation.state === "completed")?.action;
  assert.equal(protectedConsumed?.operation?.value?.consumed.state, "withheld");
  assert.equal(protectedConsumed?.value, undefined);
  for (const mode of ["fail", "repeat", "ok", "unprotected"] as const) {
    const fresh = createRun(plan1Workflows[0], { emplId: "10800000", text: "same", mode: mode === "unprotected" ? "ok" : mode });
    const local = mode !== "ok" ? fresh : { ...fresh, input: { ...fresh.input, parsed: { ...fresh.input.parsed, protectedBindings: [{ kind: "test-data-local" as const, sourceId: UUID_4, inputPath: "emplId" as const, name: "personLookupCanaryEid" as const }] } } };
    const localClaim = enqueueAndClaim(database, local, clock.now().toISOString(), plan1Workflows[0].descriptor.id);
    const localOutcome = await executeClaimedRun({ ...harness.deps, descriptor: plan1Workflows[0].descriptor, taskNotes: writer }, { ...localClaim, signal: SIGNAL });
    assert.equal(localOutcome.state, mode === "fail" ? "failed" : "done");
    const localNotes = readPersistedNotes(database).map((note) => NoteWireSchema.parse(note)).filter((note) => "runId" in note && note.runId === local.envelope.runId);
    assert.ok(localNotes.some((note) => note.action?.operation?.state === "not-run" && note.action.operation.reason === "condition-false"));
    if (mode === "fail") assert.ok(localNotes.some((note) => note.action?.operation?.state === "failed" && note.action.operation.reason === "callback-failed"));
    if (mode === "repeat") assert.equal(database.authority.runResults.get(local.envelope.runId)?.operationLineage?.[0]?.inputs[0]?.state, "unavailable");
    if (mode === "unprotected") {
      const replay = createRun(plan1Workflows[0], { emplId: "10800000", text: "same", mode: "ok" }, undefined, local.envelope.itemId);
      const replayClaim = enqueueAndClaim(database, { ...replay, envelope: { ...replay.envelope, attempt: 2 } }, clock.now().toISOString(), plan1Workflows[0].descriptor.id);
      assert.equal((await executeClaimedRun({ ...harness.deps, descriptor: plan1Workflows[0].descriptor, taskNotes: writer }, { ...replayClaim, signal: SIGNAL })).state, "done");
      const origin = database.authority.runResults.get(replay.envelope.runId)?.operationSources?.[0]?.identity;
      assert.ok(origin);
      assert.equal(origin.runId, local.envelope.runId);
      assert.equal(resolveOperationSource(deps, replay.envelope.runId, { identity: origin }).state, "found");
      const correctedBase = createRun(plan1Workflows[0], { emplId: "10800000", text: "same", mode: "ok" }, undefined, local.envelope.itemId);
      const corrected = { ...correctedBase, envelope: { ...correctedBase.envelope, attempt: 3, injected: [{ nodeId: "first", fieldPath: "disposition", value: "operator-corrected", correctedAt: clock.now().toISOString(), reason: "Synthetic operator correction" }] } };
      const correctedClaim = enqueueAndClaim(database, corrected, clock.now().toISOString(), plan1Workflows[0].descriptor.id);
      assert.equal((await executeClaimedRun({ ...harness.deps, descriptor: plan1Workflows[0].descriptor, taskNotes: writer }, { ...correctedClaim, signal: SIGNAL })).state, "done");
      const correctedResult = database.authority.runResults.get(corrected.envelope.runId);
      assert.equal(correctedResult?.operationLineage?.[0]?.inputs[0]?.state, "unavailable");
      assert.equal(Plan1Output.parse(correctedResult?.result.value).disposition, "operator-corrected/same");
      assert.ok(!correctedResult?.dependencies.some((dependency) => dependency.state === "resolved" && dependency.nodeId === "first" && dependency.operationSources?.some((source) => source.path === "disposition")));

    }
    if (mode === "ok") {
      const read = localNotes.find((note) => note.action?.operation?.logicalActionId === "read-eid" && note.action.operation.state === "completed");
      assert.equal(read?.action?.operation?.value?.consumed.state, "redacted");
      assert.equal(localNotes.find((note) => note.action?.operation?.logicalActionId === "read-disposition" && note.action.operation.state === "completed")?.action?.operation?.value?.consumed.state, "redacted", "unequal protected-derived output cannot be classified safe by equality");
      assert.equal(read?.action?.value, undefined);
      assert.ok(read?.action?.operation?.value?.consumed !== undefined && !("value" in read.action.operation.value.consumed));

    }
  }

});
