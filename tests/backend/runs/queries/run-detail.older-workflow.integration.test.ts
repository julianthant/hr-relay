import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { buildRunDetail, type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { LogIdentityRefusedError } from "../../../../src/backend/runs/commands/refusals.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { dataOriginViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { readRunLogs, projectRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { TimelineAppendSchema, TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";
import { assertRunTimelineCompatible } from "../../../../src/backend/runs/queries/run-timeline-compatibility.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { HASH_B } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { taskEventsOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupModule } from "../../../support/helpers/registered-workflows.js";

const { world, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

async function fixture() {
  const w = await world();
  queuedEventOf(w, { seed: 81, descriptor: personLookupModule.descriptor });
  const run = w.authority.getRun(uuidOf(81));
  assert.ok(run);
  const descriptor = {
    ...personLookupModule.descriptor,
    timeline: personLookupModule.descriptor.timeline.map(category => ({ ...category,
      label: category.key === "searching" ? "Current person search" : `Current ${category.label}`,
      nodes: category.nodes.map(node => ({ ...node, label: `Current ${node.label}` })),
    })),
    dataOrigins: dataOriginViewsOf(personLookupModule),
  };
  const deps: RunDetailQueryDeps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot,
    projection: w.projection, authority: w.authority, descriptors: { resolve: () => descriptor } };
  return { w, run, descriptor, deps };
}

it.each([0, 1])("loads older run detail and Logs with current names after a fingerprint change (version delta %s)", async versionDelta => {
  const { w, run, descriptor, deps } = await fixture();
  descriptor.contractFingerprint = FingerprintSchema.parse(HASH_B);
  descriptor.version += versionDelta;
  descriptor.timeline[0].label = "Current person search";
  descriptor.timeline[0].nodes[0].label = "Current search task";
  taskEventsOf(w, 81, "searching", "done");
  const at = w.clock.now().toISOString();
  w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: run.envelope.workflow,
    runId: run.envelope.runId, attempt: 1, traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/searching#1`,
    nodeId: "searching", taskId: "ucpath/search-person-org", points: [{ direction: "read", field: "results",
      values: [{ key: "results", state: "allowed", classification: "safe-diagnostic", transform: "allow",
        value: [{ name: "Quillan, Petra A.", emplId: "10000001" }] }] }] });
  w.projection.ingestFromTimeline();
  const row = w.projection.buildDashboardDayWire(at.slice(0, 10)).queueSurfaces.find(row => row.runId === run.envelope.runId);
  assert.ok(row);

  const detail = buildRunDetail(deps, run.envelope.runId);
  assert.equal(detail.timeline.steps?.[0].label, "Current person search");
  assert.equal(detail.timeline.steps?.[0].members[0].label, "Current search task");
  const logs = buildRunLogsSection(deps, run.envelope.runId, w.projection.runFold(run.envelope.runId), run);
  const snapshot = await readRunLogs({ runDetail: async () => buildRunDetail(deps, run.envelope.runId), runSection: async () => logs },
    { row, workflowLabel: "Person lookup" }, new AbortController().signal);
  const projected = projectRunLogs(snapshot, { artifactUrl: () => "unused" });
  assert.equal(projected.timeline[0].label, "Current person search");
  assert.equal(projected.steps[0].title, "Current person search");
  assert.match(JSON.stringify(projected.steps[0].entries), /Quillan, Petra A\./u);
});

it.each([false, true])("refuses a recorded task absent from the current timeline (changed fingerprint %s)", async changed => {
  const { w, run, descriptor, deps } = await fixture();
  if (changed) descriptor.contractFingerprint = FingerprintSchema.parse(HASH_B);
  else descriptor.version++;
  taskEventsOf(w, 81, "searching", "done");
  descriptor.timeline[0].nodes = descriptor.timeline[0].nodes.filter(node => node.id !== "searching");
  assert.throws(() => buildRunDetail(deps, run.envelope.runId), LogIdentityRefusedError);
});

it.each([false, true])("still refuses a current timeline category without a key (changed fingerprint %s)", async changed => {
  const { run, deps } = await fixture();
  const missingKey: RunDetailQueryDeps = { ...deps, descriptors: { resolve: () => ({
    version: run.envelope.descriptorVersion, contractFingerprint: changed ? HASH_B : run.envelope.contractFingerprint,
    timeline: [{ label: "Unkeyed search", nodes: [{ id: "searching", label: "Search" }] }],
  }) } };
  assert.throws(() => buildRunDetail(missingKey, run.envelope.runId), LogIdentityRefusedError);
});

it("refuses an unmapped checkpoint-only node when no task span exists", async () => {
  const { w, run, descriptor, deps } = await fixture();
  descriptor.version++;
  const at = w.clock.now().toISOString();
  const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
    nodeId: "removed-node", attempt: 1, claimGeneration: 1, runId: run.envelope.runId,
    output: { schemaHash: HASH_B, value: { name: "Synthetic retained value" } },
    descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
    implFingerprint: HASH_B, provenance: [], writtenAt: at });
  w.authority.putCheckpoint(checkpoint);
  assert.equal(w.database.authority.runCheckpoints.insert(checkpoint).state, "inserted");
  assert.equal(descriptor.contractFingerprint, run.envelope.contractFingerprint);
  assert.throws(() => buildRunDetail(deps, run.envelope.runId), LogIdentityRefusedError);
});

it.each([false, true])("refuses an unmapped action-only node (declared operation %s)", async declared => {
  const { w, run, descriptor, deps } = await fixture();
  descriptor.version++;
  const at = w.clock.now().toISOString();
  w.timeline.append(TimelineAppendSchema.parse({ schemaVersion: 1, eventId: uuidOf(901), workflow: run.envelope.workflow,
    scope: { kind: "run", runId: run.envelope.runId }, occurredAt: at, recordedAt: at, retentionDate: at.slice(0, 10),
    source: { kind: "native" }, payload: { kind: "note", note: { pid: 4242, ts: at, workflow: run.envelope.workflow,
      runId: run.envelope.runId, attempt: 1, traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/removed-node#1`,
      level: "step", message: "Synthetic retained action", action: { kind: "clicked", targetId: "ucpath.search",
        ...(declared ? { operation: { runId: run.envelope.runId, definitionFingerprint: run.envelope.contractFingerprint,
          nodeId: "removed-node", taskId: "ucpath/search-person-org", attempt: 1, claimGeneration: 1, taskAttempt: 1,
          invocationId: "search", occurrencePath: ["search"], logicalActionId: "search", occurrence: 1,
          logicalSessionId: "ucpath" } } : {}) } } } }));
  assert.throws(() => buildRunDetail(deps, run.envelope.runId), LogIdentityRefusedError);
});

it("refuses ambiguous recorded membership while preserving the explicit no-timeline mode", async () => {
  const { w, run, descriptor, deps } = await fixture();
  taskEventsOf(w, 81, "searching", "done");
  descriptor.version++;
  descriptor.timeline.push({ ...descriptor.timeline[0], key: "duplicate" });
  assert.throws(() => buildRunDetail(deps, run.envelope.runId), LogIdentityRefusedError);
  const detail = buildRunDetail({ ...deps, descriptors: { resolve: () => undefined } }, run.envelope.runId);
  assert.equal(detail.timeline.steps, undefined);
  assert.equal(detail.timeline.events[0].native?.nodeId, "searching");
});

it.each(["gate.opened", "gate.resolved", "data.observed", "transaction.fenced", "transaction.previewed"] as const)("validates the node named by native %s evidence", async type => {
  const { w, run, descriptor, deps } = await fixture();
  const at = w.clock.now().toISOString();
  const common = { t: type, pid: 4242, ts: at, workflow: run.envelope.workflow, runId: run.envelope.runId,
    attempt: 1, traceId: run.envelope.traceId, spanPath: run.envelope.traceId };
  const extra = type === "gate.opened" ? { gate: "removed-node" }
    : type === "gate.resolved" ? { gate: "removed-node", resolutionKey: "resolved", resultHash: HASH_B }
      : type === "data.observed" ? { observedAt: at, nodeId: "removed-node", taskId: "ucpath/search-person-org", points: [{ direction: "read", field: "results",
        values: [{ key: "results", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: [] }] }] }
        : type === "transaction.fenced" ? { node: "removed-node", taskId: "ucpath/search-person-org" }
          : { node: "removed-node", subject: "not-observed", externalCommit: "none" };
  const record = TimelineEventRecordSchema.parse({ schemaVersion: 1, eventId: uuidOf(903), cursor: 1,
    workflow: run.envelope.workflow, scope: { kind: "run", runId: run.envelope.runId }, occurredAt: at,
    recordedAt: at, retentionDate: at.slice(0, 10), source: { kind: "native" }, payload: { kind: "span", event: { ...common, ...extra } } });
  assert.throws(() => assertRunTimelineCompatible(run, descriptor.timeline, deps, undefined, [record]), LogIdentityRefusedError);
});

it.each([false, true])("validates folded gate identity without native gate records (resolved %s)", async resolved => {
  const { w, run, descriptor, deps } = await fixture();
  const base = { ts: w.clock.now().toISOString(), workflow: run.envelope.workflow, runId: run.envelope.runId,
    attempt: 1, traceId: run.envelope.traceId, spanPath: run.envelope.traceId, gate: "removed-node" };
  w.writer.emit({ ...base, t: "gate.opened" });
  if (resolved) w.writer.emit({ ...base, t: "gate.resolved", resolutionKey: "resolved", resultHash: HASH_B });
  w.projection.ingestFromTimeline();
  const row = w.projection.runFold(run.envelope.runId);
  assert.ok(row);
  assert.throws(() => assertRunTimelineCompatible(run, descriptor.timeline, deps, row, []), LogIdentityRefusedError);
});

it.each(["same-run", "foreign-run", "nested-child-result"] as const)("checks nested action lineage without importing child workflow nodes (%s)", async source => {
  const { w, run, descriptor, deps } = await fixture();
  const at = w.clock.now().toISOString();
  const identity = { runId: run.envelope.runId, definitionFingerprint: run.envelope.contractFingerprint,
    nodeId: "searching", taskId: "ucpath/search-person-org", attempt: 1, claimGeneration: 1, taskAttempt: 1,
    invocationId: "search", occurrencePath: ["search"], logicalActionId: "search", occurrence: 1, logicalSessionId: "ucpath" };
  const upstream = { ...identity, runId: source === "same-run" ? run.envelope.runId : uuidOf(907), nodeId: "removed-node" };
  const childResults = [{ source: { kind: "child-output", entryId: "removed-node", path: "query" },
    result: { runId: uuidOf(907), definitionFingerprint: HASH_B, resultSchemaHash: HASH_B, resultDigest: HASH_B, dependencyDigest: HASH_B } }];
  const record = TimelineEventRecordSchema.parse({ schemaVersion: 1, eventId: uuidOf(908), cursor: 1,
    workflow: run.envelope.workflow, scope: { kind: "run", runId: run.envelope.runId }, occurredAt: at,
    recordedAt: at, retentionDate: at.slice(0, 10), source: { kind: "native" }, payload: { kind: "note", note: {
      pid: 4242, ts: at, workflow: run.envelope.workflow, runId: run.envelope.runId, attempt: 1,
      traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/searching#1`, level: "step", message: "Synthetic transformed action",
      action: { kind: "typed", targetId: "ucpath.search", operation: { ...identity, value: { slot: "query", fieldPath: "query",
        producer: { kind: "transformation", transformId: "query", path: "query", inputs: [{ inputId: "name", state: "retained",
          source: source === "nested-child-result" ? { kind: "transformation", transformId: "nested", path: "query" }
            : { kind: "task-output", entryId: "searching", path: "results" }, identities: [upstream],
          ...(source === "nested-child-result" ? { childResults } : {}) }] },
        consumed: { state: "observed", value: "Synthetic query" } } } } } } });
  if (source !== "foreign-run") assert.throws(() => assertRunTimelineCompatible(run, descriptor.timeline, deps, undefined, [record]), LogIdentityRefusedError);
  else assert.doesNotThrow(() => assertRunTimelineCompatible(run, descriptor.timeline, deps, undefined, [record]));
});

it.each(["nodeId", "gateId"] as const)("validates gate result %s independently of its other mapped identity", async missing => {
  const { w, run, descriptor, deps } = await fixture();
  w.authority.putGateResult({ runId: run.envelope.runId, nodeId: missing === "nodeId" ? "removed-node" : "searching",
    gateId: missing === "gateId" ? "removed-node" : "searching", commandId: uuidOf(904), expectedVersion: 1,
    resolvedBy: "local-operator", resolvedAt: w.clock.now().toISOString(), checkpointFingerprint: HASH_B,
    result: { schemaHash: HASH_B, value: { decision: "approved" } } });
  assert.throws(() => assertRunTimelineCompatible(run, descriptor.timeline, deps, undefined, []), LogIdentityRefusedError);
});

it("validates replayed checkpoint references without importing unrelated item attempts", async () => {
  const { w, run, descriptor, deps } = await fixture();
  const at = w.clock.now().toISOString();
  const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
    nodeId: "removed-node", attempt: 1, claimGeneration: 1, runId: uuidOf(905), output: { schemaHash: HASH_B, value: {} },
    descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
    implFingerprint: HASH_B, provenance: [], writtenAt: at });
  w.authority.putCheckpoint(checkpoint);
  assert.doesNotThrow(() => assertRunTimelineCompatible(run, descriptor.timeline, deps, undefined, []));
  const record = TimelineEventRecordSchema.parse({ schemaVersion: 1, eventId: uuidOf(906), cursor: 1,
    workflow: run.envelope.workflow, scope: { kind: "run", runId: run.envelope.runId }, occurredAt: at,
    recordedAt: at, retentionDate: at.slice(0, 10), source: { kind: "native" }, payload: { kind: "checkpoint-replayed",
      runId: run.envelope.runId, workflow: run.envelope.workflow, attempt: 1, claimGeneration: 1,
      checkpoint: { workflowId: checkpoint.workflowId, itemId: checkpoint.itemId, nodeId: checkpoint.nodeId,
        runId: checkpoint.runId, attempt: 1, claimGeneration: 1, outputDigest: HASH_B, writtenAt: at } } });
  assert.throws(() => assertRunTimelineCompatible(run, descriptor.timeline, deps, undefined, [record]), LogIdentityRefusedError);
});

it("loads a current-version run with a recorded checkpoint node outside the live timeline", async () => {
  const { w, run, deps } = await fixture();
  const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
    nodeId: "outside-timeline", attempt: 1, claimGeneration: 1, runId: run.envelope.runId,
    output: { schemaHash: HASH_B, value: {} }, descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint, implFingerprint: HASH_B, provenance: [],
    writtenAt: w.clock.now().toISOString() });
  w.authority.putCheckpoint(checkpoint);
  assert.equal(w.database.authority.runCheckpoints.insert(checkpoint).state, "inserted");
  const detail = buildRunDetail(deps, run.envelope.runId);
  assert.equal(detail.runId, run.envelope.runId);
});

it.each(["version", "fingerprint", "missing-version", "missing-fingerprint"] as const)("checks an older run's empty fold with one timeline read after %s drift", async drift => {
  const { w, run, descriptor, deps } = await fixture();
  if (drift === "version") descriptor.version++;
  else if (drift === "fingerprint") descriptor.contractFingerprint = FingerprintSchema.parse(HASH_B);
  const { version, contractFingerprint, ...presentation } = descriptor;
  const current = drift === "missing-version" ? { ...presentation, contractFingerprint }
    : drift === "missing-fingerprint" ? { ...presentation, version } : descriptor;
  const at = w.clock.now().toISOString();
  w.timeline.append(TimelineAppendSchema.parse({ schemaVersion: 1, eventId: uuidOf(909), workflow: run.envelope.workflow,
    scope: { kind: "run", runId: run.envelope.runId }, occurredAt: at, recordedAt: at, retentionDate: at.slice(0, 10),
    source: { kind: "native" }, payload: { kind: "span", event: { t: "data.observed", pid: 4242, ts: at,
      workflow: run.envelope.workflow, runId: run.envelope.runId, attempt: 1, traceId: run.envelope.traceId,
      spanPath: run.envelope.traceId, observedAt: at, nodeId: "outside-timeline", taskId: "ucpath/search-person-org",
      points: [{ direction: "read", field: "results", values: [{ key: "results", state: "allowed",
        classification: "safe-diagnostic", transform: "allow", value: [] }] }] } } }));
  let timelineReads = 0;
  assert.throws(() => buildRunDetail({ ...deps, descriptors: { resolve: () => current }, timeline: { ...deps.timeline, page(input) {
    timelineReads++;
    return deps.timeline.page(input);
  } } }, run.envelope.runId), LogIdentityRefusedError);
  assert.equal(timelineReads, 1);
});
