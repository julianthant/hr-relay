import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { readRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { dataOriginViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { makeWorld, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, writeFixtureSaveDescriptor, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
const worlds: DashboardWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); cleanup(); });

it.each([false, true])("serves sequencer transaction role spans through run detail and Logs (dryRun=%s)", async dryRun => {
  const h = harness();
  const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun }));
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  if (dryRun) {
    const preview = await h.executeDryRun(contextFor(run, claim, writeFixtureSaveDescriptor, true));
    assert.equal(preview.kind, "transaction-dry-run-preview");
    assert.equal(intentByKey(h.database), undefined);
  } else {
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });
    const result = await h.execute(contextFor(run, claim, writeFixtureSaveDescriptor));
    assert.equal(Reflect.get(result as object, "disposition"), "committed");
  }
  const emitted = h.emitter.events();
  const roles = dryRun ? ["probe", "prepare"] : ["probe", "prepare", "commit", "verify"];
  const starts = emitted.filter(event => event.t === "span.started" && event.kind === "task");
  assert.deepEqual(starts.map(event => event.spanPath), roles.map(role => `${run.envelope.traceId}/submit-write/${role}`));
  const current = h.database.authority.runs.get(run.envelope.runId);
  assert.ok(current);
  const w = makeWorld({ reader: sqliteRunReader(h.database, h.clock) }); worlds.push(w);
  w.authority.put(current);
  w.writer.emit({ t: "run.queued", kind: "run", ts: run.envelope.enqueuedAt,
    workflow: run.envelope.workflow, runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId, actorId: "local-operator", title: "Transaction fixture", itemId: run.envelope.itemId,
    shape: run.envelope.shape, priority: run.envelope.priority, dryRun,
    descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
    resolvedInstance: run.envelope.resolvedInstance, configFingerprint: run.envelope.configFingerprint, configSnapshotId: run.envelope.configSnapshotId });
  for (const event of emitted) w.writer.emit(event);
  const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot,
    projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => ({ version: writeFixtureSaveDescriptor.version,
      contractFingerprint: writeFixtureSaveDescriptor.contractFingerprint, timeline: writeFixtureSaveDescriptor.timeline, dataOrigins: dataOriginViewsOf({ descriptor: writeFixtureSaveDescriptor, stores: [] }) }) } };
  const detail = buildRunDetail(deps, run.envelope.runId);
  const native = readTimelineRecords(w.timeline, 0, run.envelope.runId).records.filter(record => record.payload.kind === "span" && record.payload.event.t === "span.started" && record.payload.event.kind === "task");
  assert.deepEqual(detail.timeline.events.map(event => event.native), native.map(record => ({ eventId: record.eventId, order: record.cursor,
    runId: run.envelope.runId, traceId: run.envelope.traceId, attempt: run.envelope.attempt,
    spanPath: record.payload.kind === "span" ? record.payload.event.spanPath : "", nodeId: "submit-write" })));
  assert.deepEqual(detail.timeline.events.map(event => event.state), roles.map(() => "done"));
  assert.deepEqual(detail.timeline.steps?.flatMap(step => step.members.map(member => ({ nodeId: member.nodeId, state: member.state }))), [{ nodeId: "submit-write", state: "done" }]);
  assert.equal(detail.timeline.steps?.[0].executions, roles.length);
  const logs = buildRunLogsSection(deps, run.envelope.runId, w.projection.runFold(run.envelope.runId), current);
  assert.equal(logs.section, "logs");
  assert.equal(logs.payload.runId, run.envelope.runId);
  const row = w.projection.buildDashboardDayWire(run.envelope.enqueuedAt.slice(0, 10)).queueSurfaces.find(row => row.runId === run.envelope.runId);
  assert.ok(row);
  const snapshot = await readRunLogs({ runDetail: async () => buildRunDetail(deps, run.envelope.runId), runSection: async () => logs }, { row, workflowLabel: "Transaction fixture" }, new AbortController().signal);
  assert.deepEqual(snapshot.detail.timeline.events, detail.timeline.events);
  assert.deepEqual(snapshot.logs, logs.payload);
  w.writer.emit({ ...starts[0], t: "span.started", kind: "task", name: "undeclared role", spanPath: `${run.envelope.traceId}/undeclared/probe` });
  assert.throws(() => buildRunDetail(deps, run.envelope.runId), /timeline node has no unique declared category/);
});
