import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, it } from "vitest";
import { executeRecoveryProbe, RecoveryActivityError } from "../../../../src/backend/runtime/writes/recovery-activity.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { recordBrowserAction, withBrowserActionSession } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { RecoveryActivitySchema, recoveryActivitySpanPath } from "../../../../src/models/run/recovery-activity.js";
import { assertNoteWithinRunScope } from "../../../../src/models/run/note-scope.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { WorkflowOperationDisplaySnapshotSchema } from "../../../../src/models/workflow/operation-display-snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { deriveStableUuid } from "../../../../src/rules/identity/identifiers.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { localDatePart } from "../../../../src/rules/time/clock.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createWriteRecoveryTestWorld } from "../../../support/helpers/backend/write-recovery-world.js";
import { ManualScheduler, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { UUID_5, UUID_6, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { buildWriteFixtureRegistry, WriteFixtureProbe, WRITE_FIXTURE_EID, WRITE_FIXTURE_FINGERPRINT,
  WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, unknownProbeVerdict,
  writeFixtureDescriptor, writeFixtureQueuedRun, writeFixtureTransactionNode,
  writeFixtureSessions, writeFixtureSessionManager } from "../../../support/fixtures/write-sequencer-fixtures.js";

const profiles = createProfileFixtureSet();
const world = createWriteRecoveryTestWorld(profiles.create);
afterEach(world.cleanup);
afterAll(() => profiles.close());

function queuedWithSnapshot() {
  const payload = { capability: "complete", declarationVersion: 1, snapshotVersion: 2,
    workflowId: WRITE_FIXTURE_WORKFLOW_ID, definitionFingerprint: WRITE_FIXTURE_FINGERPRINT,
    transforms: [], presentation: [], execution: [], invocations: [{ id: "recovery-probe", entryId: WRITE_FIXTURE_NODE_ID,
      taskId: WriteFixtureProbe.id, contractRole: "probe", occurrencePath: [WRITE_FIXTURE_NODE_ID, "probe"], bindings: [], outcomes: [],
      operation: { version: 1, id: "recovery-probe", system: "ucpath", session: { kind: "browser", id: "ucpath", system: "ucpath" },
        values: [], templates: [], transforms: [], actions: [{ id: "probe-state", kind: "read-field", target: "ucpath.write-fixture.probe-state" }] } }] };
  const snapshot = WorkflowOperationDisplaySnapshotSchema.parse({ ...payload,
    contentDigest: sha256Hex(`hrauto:operation-display-snapshot:v2\0${canonicalJsonStringify(payload)}`) });
  const queued = RunRecordSchema.parse(writeFixtureQueuedRun());
  return RunRecordSchema.parse({ ...queued, envelope: { ...queued.envelope, operationDisplaySnapshot: snapshot } });
}

async function fixture(snapshot = false) {
  const h = await world.harness();
  const held = world.parkedAttemptingWrite(h, undefined, snapshot ? queuedWithSnapshot() : writeFixtureQueuedRun());
  h.clock.advanceWall(3 * 24 * 60 * 60 * 1000);
  const run = h.database.authority.runs.get(held.run.envelope.runId);
  const intent = h.database.authority.writeIntents.get(held.writeIntentId);
  assert.ok(run && intent?.status === "attempting");
  const scheduler = new ManualScheduler(h.clock);
  const events: string[] = [];
  let failCapture = false;
  const sessions: Parameters<typeof executeRecoveryProbe>[0]["sessions"] = {
    bindRunConfigFingerprint: (_fingerprint, _mode, context) => {
      assert.deepEqual(context, { runId: run.envelope.runId, descriptorFingerprint: run.envelope.contractFingerprint });
      events.push("bound");
    },
    releaseRunConfigFingerprint: () => { events.push("released"); },
    closeAll: async () => { events.push("closed"); },
    withDriver: async (_need, _instance, _signal, operation) => withBrowserActionSession(UUID_6, async () => {
      return await operation({ system: "ucpath" }, async () => {
        events.push("captured");
        if (failCapture) throw new TaskError(WriteFixtureProbe.id, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Synthetic required capture failure");
        h.clock.advanceWall(1000);
        recordBrowserAction("screenshot", "ucpath.task-capture", `${UUID_5}:${UUID_7}`);
      });
    }),
  };
  const input: Parameters<typeof executeRecoveryProbe>[0] = { operation: "diagnostic-recovery", repositories: h.database.authority,
    run, intent, descriptor: writeFixtureDescriptor, node: writeFixtureTransactionNode(writeFixtureDescriptor), commitInput: { eid: WRITE_FIXTURE_EID },
    signal: new AbortController().signal, sessions,
    probe: { stores: buildWriteFixtureRegistry(h.world), sessions, clock: h.clock, scheduler, taskDeadlineMs: 1000, log: recordingLogger().log } };
  return { h, input, scheduler, events, failCapture: () => { failCapture = true; } };
}

describe("durable recovery activity authority", () => {
  for (const snapshot of [false, true]) it(`files actions and a required capture on an old run with snapshot=${snapshot}`, async () => {
    const f = await fixture(snapshot);
    const before = canonicalJsonStringify([f.input.run, f.input.intent]);
    const openedAt = f.h.clock.now().toISOString();
    f.h.world.probeResults.push(unknownProbeVerdict(openedAt));
    assert.equal((await executeRecoveryProbe(f.input)).state, "unknown");
    const records = readTimelineRecords(f.h.database.authority.timelineEvents, 0, WRITE_FIXTURE_RUN_ID).records;
    const notes = records.flatMap(record => record.payload.kind === "note" ? [record] : []);
    assert.deepEqual(records.map(record => record.payload.kind), snapshot
      ? ["recovery-activity-started", "note", "note", "note", "recovery-activity-ended"]
      : ["recovery-activity-started", "note", "recovery-activity-ended"]);
    assert.deepEqual(notes.map(record => record.occurredAt), snapshot
      ? [openedAt, openedAt, f.h.clock.now().toISOString()] : [f.h.clock.now().toISOString()]);
    assert.ok(notes.every(record => record.recordedAt === f.h.clock.now().toISOString()));
    if (snapshot) {
      assert.ok(notes.slice(0, 2).every(record => record.payload.kind === "note" && record.payload.note.action?.operation?.runId === WRITE_FIXTURE_RUN_ID));
      assert.ok(notes.slice(0, 2).every(record => record.payload.kind === "note" && record.payload.note.action?.operation?.taskId === WriteFixtureProbe.id));
    } else {
      assert.ok(notes.every(record => record.payload.kind === "note" && record.payload.note.action?.operation === undefined));
    }
    const screenshot = notes.at(-1)?.payload;
    assert.ok(screenshot?.kind === "note" && screenshot.note.action?.value === `${UUID_5}:${UUID_7}`);
    assert.equal(canonicalJsonStringify([f.input.run, f.input.intent]), before);
    assert.equal(f.h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, f.input.run.envelope.itemId, WRITE_FIXTURE_NODE_ID), undefined);
    const start = records[0].payload;
    assert.ok(start.kind === "recovery-activity-started");
    assert.equal(start.writeAttemptId, f.input.intent.currentAttemptId);
    assert.equal(start.generation, f.input.intent.generation);
    const page = buildRunLogsSection({ timeline: f.h.database.authority.timelineEvents,
      projection: { runLogSnapshot: () => ({ entries: [] }) }, descriptors: { resolve: () => undefined },
    } as unknown as RunDetailQueryDeps, WRITE_FIXTURE_RUN_ID, undefined, f.input.run);
    assert.equal(page.section, "logs");
    if (page.section !== "logs") throw new Error("expected recovery logs");
    assert.deepEqual(page.payload.rows?.map(row => row.native?.eventId), notes.map(record => record.eventId));
    assert.deepEqual(page.payload.notes.map(note => note.at), notes.map(record => record.occurredAt));
    assert.ok(page.payload.rows?.every(row => row.native?.nodeId === WRITE_FIXTURE_NODE_ID));
    assert.deepEqual(page.payload.notes.at(-1)?.screenshot, { bundleId: UUID_5, artifactId: UUID_7, sessionId: UUID_6 });
    f.h.database.authority.timelineEvents.pruneBefore("2099-01-01");
    assert.ok(f.h.database.authority.timelineEvents.get(records[0].eventId));
    assert.ok(f.h.database.authority.timelineEvents.get(records.at(-1)!.eventId));
  });

  it("admits only exact open scope and rejects closed, foreign and crash-open ambient notes", async () => {
    const f = await fixture();
    const activity = RecoveryActivitySchema.parse({ activityId: randomUUID(), operation: "diagnostic-recovery",
      runId: f.input.run.envelope.runId, workflow: f.input.run.envelope.workflow, attempt: f.input.run.envelope.attempt,
      traceId: f.input.run.envelope.traceId, nodeId: WRITE_FIXTURE_NODE_ID, writeIntentId: f.input.intent.writeIntentId,
      generation: f.input.intent.generation, writeAttemptId: f.input.intent.currentAttemptId, openedAt: f.h.clock.now().toISOString() });
    const base = { schemaVersion: 1, workflow: activity.workflow, scope: { kind: "run", runId: activity.runId },
      occurredAt: activity.openedAt, recordedAt: activity.openedAt, retentionDate: localDatePart(f.h.clock.now()), source: { kind: "native" } };
    const repository = f.h.database.authority.timelineEvents;
    repository.append({ ...base, eventId: activity.activityId, payload: { kind: "recovery-activity-started", ...activity } });
    const address = { runId: activity.runId, attempt: activity.attempt, traceId: activity.traceId, spanPath: recoveryActivitySpanPath(activity) };
    const note = { ...address, workflow: activity.workflow, at: f.h.clock.now() };
    assertNoteWithinRunScope(f.input.run, note, activity);
    assert.throws(() => assertNoteWithinRunScope(f.input.run, note, { ...activity, runId: RunIdSchema.parse(UUID_6) }), /scope-mismatch/);
    const ordinary = createNoteTimelineWriter({ repository, clock: f.h.clock });
    assert.throws(() => ordinary.emitRunAction({ workflow: activity.workflow, address,
      action: { kind: "opened", targetId: "ucpath.recovery", at: activity.openedAt } }, f.input.run), /outside the run/);
    const scoped = createNoteTimelineWriter({ repository, clock: f.h.clock, recoveryActivity: { activity, assertOpen: () => {} } });
    scoped.emitRunAction({ workflow: activity.workflow, address, action: { kind: "opened", targetId: "ucpath.recovery", at: activity.openedAt } }, f.input.run);
    repository.append({ ...base, eventId: deriveStableUuid("recovery-activity-ended", activity.activityId),
      payload: { kind: "recovery-activity-ended", ...activity, endedAt: activity.openedAt } });
    assert.throws(() => scoped.emitRunAction({ workflow: activity.workflow, address,
      action: { kind: "opened", targetId: "ucpath.recovery", at: activity.openedAt } }, f.input.run), /note-not-open/);
  });

  it("refuses open, append and close failures rather than returning a successful observation", async () => {
    for (const kind of ["recovery-activity-started", "note", "recovery-activity-ended"]) {
      const f = await fixture();
      f.h.world.probeResults.push(unknownProbeVerdict(f.h.clock.now().toISOString()));
      const repository = f.h.database.authority.timelineEvents;
      const wrapped = { ...repository, append: (input: unknown) => {
        if ((input as { payload: { kind: string } }).payload.kind === kind) throw new Error("synthetic-timeline-failure");
        return repository.append(input);
      } };
      await assert.rejects(executeRecoveryProbe({ ...f.input, repositories: { ...f.input.repositories, timelineEvents: wrapped } }), RecoveryActivityError);
      if (kind === "recovery-activity-started") { assert.deepEqual(f.events, []); assert.deepEqual(repository.page({}), []); }
      assert.equal(f.h.database.authority.writeIntents.get(f.input.intent.writeIntentId)?.status, "attempting");
      assert.equal(f.h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, f.input.run.envelope.itemId, WRITE_FIXTURE_NODE_ID), undefined);
    }
  });

  for (const snapshot of [false, true]) for (const abort of ["deadline", "cancel"] as const) it(`keeps ${abort} cleanup open with snapshot=${snapshot}, with no late notes`, async () => {
    const f = await fixture(snapshot);
    let release!: () => void;
    f.h.world.probeWait = new Promise<void>(resolve => { release = resolve; });
    f.h.world.probeResults.push(unknownProbeVerdict(f.h.clock.now().toISOString()));
    const controller = new AbortController();
    let settled = false;
    const operation = executeRecoveryProbe({ ...f.input, signal: controller.signal }).finally(() => { settled = true; });
    const rejection = assert.rejects(operation, abort === "deadline" ? /deadline/ : /synthetic-cancel/);
    while (!f.h.world.events.includes("probe")) await Promise.resolve();
    if (abort === "deadline") { const deadline = f.scheduler.pending()[0]; assert.ok(deadline); deadline.fire(); }
    else controller.abort(new Error("synthetic-cancel"));
    while (f.events.filter(event => event === "closed").length < 2) await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(f.h.database.authority.timelineEvents.page({}).map(record => record.payload.kind), ["recovery-activity-started"]);
    release();
    await rejection;
    assert.deepEqual(f.h.database.authority.timelineEvents.page({}).map(record => record.payload.kind), ["recovery-activity-started", "recovery-activity-ended"]);
    assert.equal(f.h.database.authority.writeIntents.get(f.input.intent.writeIntentId)?.status, "attempting");
  });

  it("rejects callback-tail actions at the task deadline while real session failure cleanup is held", async () => {
    const f = await fixture(true);
    let releaseProbe!: () => void, releaseCleanup!: () => void, captureStarted!: () => void;
    f.h.world.probeWait = new Promise<void>(resolve => { releaseProbe = resolve; });
    const cleanupWait = new Promise<void>(resolve => { releaseCleanup = resolve; });
    const captureWait = new Promise<void>(resolve => { captureStarted = resolve; });
    const harness = writeFixtureSessions(f.h.world);
    const sessions = await writeFixtureSessionManager({ ...harness, factory: { ...harness.factory,
      open: async input => {
        const resource = await harness.factory.open(input);
        return { ...resource, screenshot: async () => {
          captureStarted();
          await cleanupWait;
          assert.ok(resource.screenshot);
          return resource.screenshot();
        } };
      },
    } }, f.input.probe.stores, f.h.clock);
    f.h.world.probeResults.push(unknownProbeVerdict(f.h.clock.now().toISOString()));
    let callback: Promise<unknown> | undefined;
    let settled = false;
    const operation = executeRecoveryProbe({ ...f.input, sessions,
      probe: { ...f.input.probe, retainCallback: settlement => { callback = settlement; } },
    }).finally(() => { settled = true; });
    const rejection = assert.rejects(operation, /deadline/);
    try {
      while (!f.h.world.events.includes("probe")) await Promise.resolve();
      const deadline = f.scheduler.pending()[0]; assert.ok(deadline); deadline.fire();
      await captureWait;
      releaseProbe();
      assert.ok(callback); await callback;
      assert.equal(settled, false);
      assert.deepEqual(f.h.database.authority.timelineEvents.page({}).map(record => record.payload.kind), ["recovery-activity-started"]);
      releaseCleanup();
      await rejection;
      assert.deepEqual(f.h.database.authority.timelineEvents.page({}).map(record => record.payload.kind), ["recovery-activity-started", "recovery-activity-ended"]);
      assert.equal(f.h.database.authority.writeIntents.get(f.input.intent.writeIntentId)?.status, "attempting");
      assert.equal(f.h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, f.input.run.envelope.itemId, WRITE_FIXTURE_NODE_ID), undefined);
    } finally {
      releaseProbe(); releaseCleanup();
      try { await rejection; }
      finally { await sessions.closeAll("worker-stop"); }
    }
  });

  it("refuses a required capture failure and leaves no checkpoint or write settlement", async () => {
    const f = await fixture(); f.failCapture();
    f.h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    await assert.rejects(executeRecoveryProbe(f.input), RecoveryActivityError);
    assert.equal(f.h.database.authority.writeIntents.get(f.input.intent.writeIntentId)?.status, "attempting");
    assert.equal(f.h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, f.input.run.envelope.itemId, WRITE_FIXTURE_NODE_ID), undefined);
    assert.equal(f.h.database.authority.timelineEvents.page({}).at(-1)?.payload.kind, "recovery-activity-ended");
  });
});
