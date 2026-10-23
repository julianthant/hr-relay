import type { RunResultRecord } from "../../../../src/models/run/result.js";
import { createTaskProvenanceCollector } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { readDelegationEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { randomUUID } from "node:crypto";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { resolveOperationSource } from "../../../../src/backend/runs/queries/operation-source.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { Plan1CanonicalInput, Plan1Input, Plan1Output, plan1Contract, plan1Parent, plan1Stores, plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";

const {executorHarness, enqueueAndClaim, SIGNAL, readPersistedNotes, cleanup } = createRunExecutorTestWorld();

import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { type RunParent } from "../../../../src/models/run/envelope.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
afterEach(cleanup);

it("executes two canonical children and a nested child, preserving every derived input through real terminal authority and source routes", async () => {
  const harness = executorHarness({ descriptor: plan1Parent.descriptor, stores: plan1Stores });
  const { database, clock, stateRoot: _stateRoot } = harness.authority;
  const patch = { "actor.label": { set: "Different operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), clock),
      createCredentialStore({ stateRoot: _stateRoot })) }, { commandId: randomUUID(), family: "settings", type: "apply-settings",
    source: "settings-surface", requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
  const active = database.authority.runtimeConfig.get();
  assert.ok(active);
  const fingerprint = active.configFingerprint, configSnapshotId = active.configSnapshotId;
  const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
  const canonical = canonicalChildExecution({ ...harness.deps, taskNotes: writer }, database, harness.authority.path,
    id => plan1Workflows.find(workflow => workflow.descriptor.id === id)?.descriptor);
  let number = 0;
  const createRun = (compiled: typeof plan1Parent, value: unknown, parent?: RunParent, itemId?: string) => {
    const sequence = ++number;
    return buildQueuedRun({ descriptor: compiled.descriptor, appVersion: "0.1.0", runId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      itemId: itemId ?? `00000000-0000-4000-8001-${String(sequence).padStart(12, "0")}`, traceId: `fp-170000-${String(sequence).padStart(4, "0")}`,
      rawInput: JsonValueSchema.parse(value), canonicalInput: { protectedBindings: [], schemaHash: deriveSchemaHash(Plan1CanonicalInput, "output"), value: Plan1Input.parse(value) }, ingressSchemaHash: deriveSchemaHash(Plan1Input, "input"),
      configFingerprint: fingerprint, configSnapshotId, resolvedInstance: {}, shape: parent === undefined ? "single" : "operation-member", priority: "bulk", dryRun: false,
      attempt: 1, runNumber: sequence, now: clock.now().toISOString(), ...(parent === undefined ? {} : { parent }) });
  };
  const root = canonical.start(plan1Parent.descriptor, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
  const outcome = await canonical.execute(root, SIGNAL);
  assert.equal(outcome.run?.lifecycle.state, "terminal");
  assert.ok(outcome.outcomes.every(value => value.state === "done" || value.state === "yielded-delegation"));
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
  const left = readDelegationEvidence(database.authority, root.envelope.runId, "left");
  const right = readDelegationEvidence(database.authority, root.envelope.runId, "right");
  assert.ok(left.children[0] && right.children[0]);
  const nested = readDelegationEvidence(database.authority, left.children[0].run.envelope.runId, "nested");
  assert.ok(nested.children[0]);
  const checkpointRows = (result: RunResultRecord) => result.dependencies.flatMap(dependency => {
    if (dependency.state !== "resolved") return [];
    const producer = database.authority.runs.get(dependency.checkpoint.runId);
    assert.ok(producer);
    const rows = database.authority.runCheckpoints.listByAttempt(result.workflowId,
      producer.envelope.itemId, dependency.nodeId, dependency.checkpoint.attempt);
    const matches = rows.filter(row => row.runId === dependency.checkpoint.runId && row.claimGeneration === dependency.checkpoint.claimGeneration);
    assert.equal(matches.length, 1);
    return matches;
  });
  let emitted = 0;
  assert.ok(outcome.run);
  const collector = createTaskProvenanceCollector({ descriptor: plan1Parent.descriptor,
    execution: { runId: root.envelope.runId, traceId: root.envelope.traceId, attempt: root.envelope.attempt,
      workflowId: root.envelope.workflow, nodeId: "observe", taskId: plan1Contract.id }, clock,
    canonicalInput: Plan1Input.parse(root.input.parsed.value),
    observationSpanPath: taskSpanPath(root.envelope.traceId, "observe", 1, outcome.run.claimGeneration),
    upstreamEvidence: { checkpoints: [], children: [
      { evidence: left, results: [left.children[0].result, nested.children[0].result], checkpoints: checkpointRows(nested.children[0].result) },
      { evidence: right, results: [right.children[0].result], checkpoints: checkpointRows(right.children[0].result) },
    ] }, onRecord: () => { emitted++; } });
  const beforeAlias = database.getMeta().authorityGeneration;
  assert.throws(() => collector.recordData({ direction: "read", field: "disposition",
    value: Plan1Output.parse(left.children[0].result.result.value).disposition,
    aliases: [{ path: [], source: { kind: "dependency", nodeId: "left", path: ["output", "disposition"] } }] }),
  /observation alias source is not an admitted dependency/u);
  assert.equal(emitted, 0);
  assert.equal(database.getMeta().authorityGeneration, beforeAlias);
  const protectedParent = canonical.start(plan1Parent.descriptor, { emplId: "10800000", text: "secret-derived", mode: "ok" },
    { dryRun: false, protectedSubmissionBindings: [{ kind: "test-data-local", sourceId: UUID_4, inputPath: "emplId", name: "personLookupCanaryEid" }] });
  const protectedOutcome = await canonical.execute(protectedParent, SIGNAL);
  assert.equal(protectedOutcome.run?.lifecycle.state, "terminal");
  assert.ok(protectedOutcome.outcomes.every(value => value.state === "done" || value.state === "yielded-delegation"));
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
