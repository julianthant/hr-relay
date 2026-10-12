import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { resolveOperationSource } from "../../../../src/backend/runs/queries/operation-source.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { Plan1CanonicalInput, Plan1Input, Plan1Output, plan1Parent, plan1Stores, plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";

const { disposers, executorHarness, enqueueAndClaim, SIGNAL, readPersistedNotes } = createRunExecutorTestWorld();

const PLAN1_CONFIG_ID = "00000000-0000-4000-8000-000000000c01";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { type RunParent } from "../../../../src/models/run/envelope.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
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
