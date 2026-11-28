import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildRunDetail, buildRunSection, readRunPanel, type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { LogDisplayRefusedError, LogIdentityRefusedError } from "../../../../src/backend/runs/commands/refusals.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { dataOriginViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { readRunLogs, projectRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { TimelineAppendSchema, TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";
import { assertRunTimelineCompatible } from "../../../../src/backend/runs/queries/run-timeline-compatibility.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";
import { DiagnosticBundleSchema } from "../../../../src/models/trust/diagnostic.js";
import { deriveDiagnosticContentDigest } from "../../../../src/models/trust/diagnostic-capture.js";
import { VerifiedArtifactSourceMissingError } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { openLogDatabases, openTimelineLogReader } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { redactDiagnosticFields } from "../../../../src/rules/redaction/redaction.js";
import { HASH_B } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { failureRecordOf, runEndedEventOf, taskEventsOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupModule } from "../../../support/helpers/registered-workflows.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const { world, queuedEventOf, runRecordOf, cleanup } = createRunQueueProjectionTestWorld(profileFixtures.create);
afterEach(cleanup);

async function fixture(attempt = 1) {
  const w = await world();
  queuedEventOf(w, { seed: 81, attempt, descriptor: personLookupModule.descriptor });
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
  const searchCategory = descriptor.timeline.find(category => category.key === "searching");
  assert.ok(searchCategory);
  return { w, run, descriptor, deps, searchCategory };
}

it.each([0, 1])("loads older run detail and Logs with current names after a fingerprint change (version delta %s)", async versionDelta => {
  const { w, run, descriptor, deps, searchCategory } = await fixture();
  descriptor.contractFingerprint = FingerprintSchema.parse(HASH_B);
  descriptor.version += versionDelta;
  const searchTask = searchCategory.nodes.find(node => node.id === "searching");
  assert.ok(searchTask);
  searchTask.label = "Current search task";
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
  const searchStep = detail.timeline.steps?.find(step => step.key === searchCategory.key);
  assert.equal(searchStep?.label, "Current person search");
  assert.equal(searchStep?.members.find(member => member.nodeId === searchTask.id)?.label, "Current search task");
  const logs = buildRunLogsSection(deps, run.envelope.runId, w.projection.runFold(run.envelope.runId), run);
  const snapshot = await readRunLogs({ runDetail: async () => buildRunDetail(deps, run.envelope.runId), runSection: async () => logs },
    { row, workflowLabel: "Person lookup" }, new AbortController().signal);
  const projected = projectRunLogs(snapshot, { artifactUrl: () => "unused" });
  assert.equal(projected.timeline.find(stage => stage.id === searchCategory.key)?.label, "Current person search");
  assert.equal(projected.steps[0].title, "Current person search");
  assert.match(JSON.stringify(projected.steps[0].entries), /Quillan, Petra A\./u);
});

it("opens a historical run's timeline from the log database when an earlier screenshot is unavailable", async () => {
  const { w, run, descriptor, deps } = await fixture(2);
  descriptor.version++;
  const { runId, traceId, workflow, enqueuedAt } = run.envelope;
  const at = w.clock.now().toISOString();
  const notes = createNoteTimelineWriter({ repository: w.timeline, clock: w.clock, pid: 4242 });
  const identity = { workflow, runId, traceId };
  const [bundleId, artifactId, sessionId] = [uuidOf(82), uuidOf(83), uuidOf(84)];
  const firstTask = { ...identity, ts: at, attempt: 1, kind: "task", spanPath: `${traceId}/searching#1` } as const;
  w.writer.emit({ ...firstTask, t: "span.started", parentSpanPath: traceId, name: "searching" });
  const firstAttempt = runRecordOf({ seed: 81, enqueuedAt, descriptor: personLookupModule.descriptor });
  notes.emitRunAction({
    workflow,
    address: { runId, traceId, attempt: 1, spanPath: firstTask.spanPath },
    action: { kind: "screenshot", targetId: "ucpath.task-capture", value: `${bundleId}:${artifactId}`, physicalSessionId: sessionId, at },
  }, firstAttempt);
  w.writer.emit({ ...firstTask, t: "span.ended", outcome: "done" });
  w.writer.emit({ ...identity, t: "run.requeued", ts: at, spanPath: traceId, attempt: 1, nextAttempt: 2, cause: "recovery" });
  taskEventsOf(w, 81, "active-status", "done");
  w.authority.put(runRecordOf({ seed: 81, enqueuedAt, attempt: 2, descriptor: personLookupModule.descriptor,
    lifecycle: { state: "terminal", outcome: "done", endedAt: at } }));
  const content = {
    runId, origin: { kind: "operator-request", requestedBy: "local-operator" },
    configFingerprint: run.envelope.configFingerprint, descriptorFingerprint: run.envelope.contractFingerprint,
    redaction: redactDiagnosticFields(Object.entries({ captureStage: "task-point", nodeId: "searching", runAttempt: 1,
      browserSessionId: sessionId }).map(([key, value]) => ({ key, value, classification: "safe-diagnostic", transform: "allow" }))),
    attachments: [{ kind: "screenshot", artifactId, mediaType: "image/png", byteLength: 1, digest: HASH_B,
      width: 1280, height: 720, sensitivity: "restricted" }],
  };
  const bundle = DiagnosticBundleSchema.parse({ ...content, bundleId, createdAt: at,
    contentDigest: deriveDiagnosticContentDigest({ ...content, capturedAt: at }),
    retention: { kind: "ordinary", purgeAfter: at } });
  const logs = openLogDatabases(join(w.stateRoot, "state.db"), w.stateRoot);
  try { logs.reconcile(); } finally { logs.close(); }
  const { installationId, profileId } = w.database.getMeta();
  assert.ok(installationId && profileId);
  const { page, highWaterMark, withReadSnapshot, close } = openTimelineLogReader(w.stateRoot, { installationId, profileId }, 250);
  const panel = await readRunPanel({ ...deps, timeline: { ...deps.timeline, page, highWaterMark, withReadSnapshot }, captures: {
    authority: { listByRun: () => [bundle], get: () => bundle,
      listAttachments: () => bundle.attachments.map(attachment => ({ bundleId: bundle.bundleId, attachment, createdAt: bundle.createdAt })) },
    artifactReader: { verify: async () => { throw new VerifiedArtifactSourceMissingError(); },
      prepare: async () => assert.fail("availability does not prepare a download") },
  } }, runId, new AbortController().signal).finally(close);
  assert.equal(panel.detail.header.attempt, 2);
  assert.ok(panel.detail.captures?.state === "error");
  assert.equal(panel.detail.captures.code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
  assert.deepEqual(panel.detail.timeline.events.map(event => event.native?.attempt), [1, 2]);
  assert.ok(panel.logs.rows?.some(row => row.kind === "note" && row.native?.attempt === 1 && row.note.screenshot !== undefined));
  const projected = projectRunLogs({ ...panel, unavailableEvidence: [] }, { artifactUrl: () => assert.fail("unavailable screenshot has no URL") });
  const completed = projected.timeline.flatMap(stage => stage.substeps).filter(step => step.state === "completed");
  assert.deepEqual(completed.map(step => step.id), ["searching", "active-status"]);
  assert.ok(projected.steps.some(step => step.entries.some(entry => entry.kind === "note" && entry.message === "Screenshot unavailable.")));
});

it.each(["historical", "current"] as const)("checks unmapped observations when opening failed-run Logs (%s)", async definition => {
  const w = await world();
  const original = personLookupModule.descriptor;
  const at = w.clock.now().toISOString();
  const nodeId = "active-status";
  const taskId = "workflow:person-lookup/read-active-status";
  const failure = FailureRecordSchema.parse({ ...failureRecordOf({ seed: 82, code: "UNEXPECTED_PAGE_STATE" }),
    nodeId, taskId, occurredAt: at });
  queuedEventOf(w, { seed: 82, descriptor: original,
    lifecycle: { state: "terminal", outcome: "failed", failureId: failure.failureId, endedAt: at } });
  w.authority.failures.set(failure.failureId, failure);
  const run = w.authority.getRun(failure.runId);
  assert.ok(run);
  taskEventsOf(w, 82, nodeId);
  const identity = { ts: at, workflow: run.envelope.workflow, runId: run.envelope.runId, attempt: 1,
    traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/${nodeId}#1` };
  w.writer.emit({ ...identity, t: "data.observed", observedAt: at, nodeId, taskId,
    points: [{ direction: "read", field: "status", values: [{ key: "status", state: "allowed",
      classification: "safe-diagnostic", transform: "allow", value: "retired-status" }] }] });
  w.writer.emit({ ...identity, t: "span.ended", kind: "task", outcome: "failed", failureId: failure.failureId });
  runEndedEventOf(w, 82, "failed", { failureId: failure.failureId });
  w.projection.ingestFromTimeline();
  const row = w.projection.buildDashboardDayWire(at.slice(0, 10)).queueSurfaces.find(row => row.runId === run.envelope.runId);
  assert.ok(row);
  const descriptor = { ...original, version: original.version + (definition === "historical" ? 1 : 0),
    dataOrigins: dataOriginViewsOf(personLookupModule).map(origin => origin.taskId !== taskId ? origin : {
      ...origin, operatorFields: [{ label: "Status", kind: "output" as const, fieldPath: "status",
        display: { cases: [{ value: "active", text: "Active" }] } }],
    }) };
  const deps: RunDetailQueryDeps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot,
    projection: w.projection, authority: w.authority, descriptors: { resolve: () => descriptor },
    trust: { getFailure: id => w.authority.getFailure(id), countFailuresByFingerprint: () => 1,
      ensureReceipt: () => { throw new Error("opening Logs must not derive a receipt"); } } };
  const sections: string[] = [];
  const opening = readRunLogs({ runDetail: async id => buildRunDetail(deps, id),
    runSection: async (id, name) => { sections.push(name); return buildRunSection(deps, id, name); } },
    { row, workflowLabel: "Person lookup" }, new AbortController().signal);
  if (definition === "current") {
    await assert.rejects(opening, LogDisplayRefusedError);
    assert.deepEqual(sections, ["logs"]);
    assert.throws(() => buildRunSection(deps, run.envelope.runId, "failure"), LogDisplayRefusedError);
    return;
  }
  const snapshot = await opening;
  const failureSection = snapshot.sections.find(section => section.section === "failure");
  assert.ok(failureSection?.payload.state === "available");
  assert.equal(failureSection.payload.value.failureId, failure.failureId);
  assert.equal(failureSection.payload.value.display?.field, undefined);
  assert.match(JSON.stringify(snapshot.logs), /Unavailable for this historical run/u);
  assert.doesNotMatch(JSON.stringify(snapshot), /retired-status/u);
});

it.each(["version", "fingerprint", "current"] as const)("reads removed task membership only for retained runs (%s)", async drift => {
  const { w, run, descriptor, deps, searchCategory } = await fixture();
  if (drift === "fingerprint") descriptor.contractFingerprint = FingerprintSchema.parse(HASH_B);
  if (drift === "version") descriptor.version++;
  taskEventsOf(w, 81, "searching", "done");
  searchCategory.nodes = searchCategory.nodes.filter(node => node.id !== "searching");
  if (drift === "current") {
    assert.throws(() => buildRunDetail(deps, run.envelope.runId), LogIdentityRefusedError);
    return;
  }
  const detail = buildRunDetail(deps, run.envelope.runId);
  const historical = detail.timeline.steps?.find(step => step.label === "Historical steps");
  assert.ok(historical?.key);
  assert.deepEqual(historical.members.map(({ nodeId, label, state }) => ({ nodeId, label, state })),
    [{ nodeId: "searching", label: "searching", state: "done" }]);
  assert.equal(detail.timeline.events[0]?.categoryKey, historical.key);
  assert.equal(detail.timeline.events[0]?.native?.nodeId, "searching");
});

it.each([false, true])("still refuses a current timeline category without a key (changed fingerprint %s)", async changed => {
  const { run, deps } = await fixture();
  const missingKey: RunDetailQueryDeps = { ...deps, descriptors: { resolve: () => ({
    version: run.envelope.descriptorVersion, contractFingerprint: changed ? HASH_B : run.envelope.contractFingerprint,
    timeline: [{ label: "Unkeyed search", nodes: [{ id: "searching", label: "Search" }] }],
  }) } };
  assert.throws(() => buildRunDetail(missingKey, run.envelope.runId), LogIdentityRefusedError);
});

it("retains the identity of an unmapped checkpoint-only node when no task span exists", async () => {
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
  const detail = buildRunDetail(deps, run.envelope.runId);
  assert.equal(detail.timeline.steps?.find(step => step.label === "Historical steps")?.members[0]?.nodeId, "removed-node");
  assert.deepEqual(detail.timeline.events, []);
});

it.each([false, true])("retains an unmapped action-only node (declared operation %s)", async declared => {
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
  const detail = buildRunDetail(deps, run.envelope.runId);
  assert.equal(detail.timeline.steps?.find(step => step.label === "Historical steps")?.members[0]?.nodeId, "removed-node");
  assert.deepEqual(detail.timeline.events, []);
});

it("refuses ambiguous recorded membership while preserving the explicit no-timeline mode", async () => {
  const { w, run, descriptor, deps, searchCategory } = await fixture();
  taskEventsOf(w, 81, "searching", "done");
  descriptor.version++;
  descriptor.timeline.push({ ...searchCategory, key: "duplicate" });
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
  const readDetail = () => buildRunDetail({ ...deps, descriptors: { resolve: () => current }, timeline: { ...deps.timeline, page(input) {
    timelineReads++;
    return deps.timeline.page(input);
  } } }, run.envelope.runId);
  if (drift === "missing-version" || drift === "missing-fingerprint") assert.throws(readDetail, LogIdentityRefusedError);
  else assert.equal(readDetail().timeline.steps?.find(step => step.label === "Historical steps")?.members[0]?.nodeId, "outside-timeline");
  assert.equal(timelineReads, 1);
});
