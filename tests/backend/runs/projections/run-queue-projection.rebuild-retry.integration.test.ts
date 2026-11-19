import assert from "node:assert/strict";
import { Hono } from "hono";
import { afterEach, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createRunQueueProjection } from "../../../../src/backend/runs/projections/run-queue-projection.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import { registerQueueRoutes } from "../../../../src/backend/transports/http/routes/queue.js";
import { DashboardStreamHub } from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { ASSISTANT_DEFAULT_EFFORT, ASSISTANT_DEFAULT_MODEL } from "../../../../src/models/dashboard/assistant.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { APP_VERSION, DAY, DESCRIPTOR_SET_HASH, notificationRecordOf, queuedEventOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { runningWorkerView } from "../../../support/helpers/backend/fake-worker-port.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

it("retries a failed rebuild on the next poll and resumes tail ingestion", async () => {
  const w = await world();
  queuedEventOf(w, { seed: 1 });
  let failuresRemaining = 2;
  const projection = createRunQueueProjection({
    timeline: {
      ...w.timeline,
      page(input) {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          throw new Error("simulated transient timeline read failure");
        }
        return w.timeline.page(input);
      },
    },
    reader: w.runReader,
    stateRoot: w.stateRoot,
    clock: w.clock,
    appVersion: APP_VERSION,
    descriptorSetHash: DESCRIPTOR_SET_HASH,
    ledger: createTransactionHistory(w.database.authority),
    authority: w.authority,
    descriptors: { resolve: () => undefined },
  });

  projection.ingestFromTimeline();
  assert.equal(projection.health().state, "degraded");
  assert.match(projection.health().lastError ?? "", /timeline rebuild failed/);
  assert.throws(() => projection.buildDashboardDayWire(DAY), /projection is degraded/);

  projection.ingestFromTimeline();
  assert.equal(projection.health().state, "live");
  assert.ok(projection.runFold(uuidOf(1)));

  queuedEventOf(w, { seed: 2 });
  projection.ingestFromTimeline();
  assert.deepEqual(projection.buildDashboardDayWire(DAY).queueSurfaces.map(row => row.runId), [uuidOf(1), uuidOf(2)]);
});

it("keeps a connected day cursor contiguous across a log-only poll", async () => {
  const w = await world();
  const { workflow, runId, traceId, attempt, ts } = queuedEventOf(w, { seed: 1 });
  const writer = createTimelineEmitter({ repository: w.timeline, clock: w.clock, pid: 4243 });
  const task = { workflow, runId, traceId, attempt, ts, parentSpanPath: traceId, spanPath: `${traceId}/searching#1.1` };
  const hub = new DashboardStreamHub({ projection: w.projection, backfillGaps: { detected: () => assert.fail("unexpected stream backfill") } });
  try {
    const connection = await hub.connect({ day: DAY });
    const baseline = connection.initial.find(event => event.type === "snapshot");
    assert.ok(baseline);

    writer.emit({ ...task, t: "data.observed", observedAt: ts, nodeId: "searching", taskId: "ucpath/search-person-org",
      points: [{ direction: "read", field: "selection", values: [
        { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "resolved" },
      ] }] });
    writer.emit({ ...task, t: "transaction.fenced", spanPath: `${traceId}/searching/commit`, node: "searching", taskId: "ucpath/create-termination" });
    w.projection.ingestFromTimeline();
    const afterLogs = w.projection.cursor();
    assert.deepEqual(w.projection.runLogSnapshot(runId).entries.map(({ event }) => event.t), ["data.observed", "transaction.fenced"]);

    writer.emit({ ...task, t: "span.started", kind: "task", name: "searching" });
    w.projection.ingestFromTimeline();
    const patch = await connection.next();
    assert.equal(patch?.type, "patch");
    assert.equal(patch.cursor, `pc:${Number(baseline.cursor.slice(3)) + 1}`);
    assert.equal(afterLogs, baseline.cursor);
    connection.close();
  } finally {
    hub.close();
  }
});

it.each(["data.observed", "transaction.fenced"] as const)("refreshes a warm notice only when %s belongs to a run whose timeline it reads", async type => {
  const w = await world();
  const descriptor = personLookupDescriptor;
  const retained = { ...descriptor, version: descriptor.version - 1 };
  const relevant = queuedEventOf(w, { seed: 1, descriptor: retained, displayName: "Synthetic older run" });
  const unrelated = queuedEventOf(w, { seed: 2, descriptor });
  const notice = notificationRecordOf({ seed: 1, title: "Run needs attention", lastSeenAt: relevant.ts });
  w.database.authority.notifications.create(notice);

  const unexpected = (): never => { throw new Error("unexpected write or Activity read"); };
  const runReader = new RunRecordService({ database: w.database, clock: w.clock, ids: { uuid: unexpected }, publishQueued: unexpected });
  const summaries = composeQueueSummaries(w.database);
  let queueReads = 0;
  const makeProjection = () => {
    const projection = createOperatorProjection({
      database: w.database, stateRoot: w.stateRoot, clock: w.clock,
      appVersion: APP_VERSION, descriptorSetHash: DESCRIPTOR_SET_HASH,
      reader: {
        read: runId => runReader.read(runId), list: input => runReader.list(input),
        withRunTreeSnapshot: (ids, read) => runReader.withRunTreeSnapshot(ids, read),
        summaries: { ...summaries, activity: unexpected, queue(input) { queueReads += 1; return summaries.queue(input); } },
      },
      ledger: createTransactionHistory(w.database.authority),
      descriptors: { resolve: workflow => workflow === descriptor.id ? descriptor : undefined },
      workerMembers: () => [],
    });
    projection.rebuildFromTimeline();
    assert.equal(projection.health().state, "live");
    return projection;
  };
  const append = ({ workflow, runId, traceId, attempt, ts }: typeof relevant) => {
    const writer = createTimelineEmitter({ repository: w.database.authority.timelineEvents, clock: w.clock, pid: 4243 });
    const base = { t: type, ts, workflow, runId, traceId, attempt, spanPath: `${traceId}/removed-node/commit` };
    writer.emit(type === "transaction.fenced" ? { ...base, node: "removed-node", taskId: "ucpath/search-person-org" }
      : { ...base, observedAt: ts, nodeId: "removed-node", taskId: "ucpath/search-person-org", points: [
        { direction: "read", field: "selection", values: [
          { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "resolved" },
        ] },
      ] });
  };
  const noticeContext = (projection: ReturnType<typeof makeProjection>) => {
    const row = projection.buildDashboardDayWire(DAY).notifications.find(row => row.notificationId === notice.notificationId);
    assert.ok(row?.kind === "notification");
    return row.context;
  };
  const projection = makeProjection();
  const cursor = projection.cursor();
  const visible = { state: "available", workflow: descriptor.label, subject: "Synthetic older run" };
  assert.deepEqual(noticeContext(projection), visible);
  assert.equal(queueReads, 1);

  append(unrelated);
  projection.ingestFromTimeline();
  assert.deepEqual(noticeContext(projection), visible);
  assert.equal(queueReads, 1, "log evidence for another same-day run reuses the warm day");

  const unrelatedRun = w.database.authority.runs.get(unrelated.runId);
  assert.ok(unrelatedRun);
  const notes = createNoteTimelineWriter({ repository: w.database.authority.timelineEvents, clock: w.clock });
  notes.emitRunLog({ workflow: unrelated.workflow, level: "step", message: "Synthetic task note",
    address: { runId: unrelated.runId, traceId: unrelated.traceId, attempt: unrelated.attempt,
      spanPath: `${unrelated.traceId}/searching#1.1` } }, unrelatedRun);
  projection.ingestFromTimeline();
  assert.equal(projection.cursor(), cursor);
  assert.deepEqual(noticeContext(projection), visible);
  assert.equal(queueReads, 1, "a standalone note for an unread timeline reuses the warm day");

  append(relevant);
  projection.ingestFromTimeline();
  assert.equal(projection.cursor(), cursor);
  const hidden = { state: "workflow-only", workflow: descriptor.label };
  assert.deepEqual(noticeContext(makeProjection()), hidden, "fresh reads withhold the incompatible subject");
  assert.deepEqual(noticeContext(projection), hidden, "warm reads also withhold the incompatible subject");
  assert.equal(queueReads, 3);
});

it.each(["empty", "previous claim"] as const)("refreshes a worker's %s lookup before polling an off-month claim", async previous => {
  const w = await world();
  const older = queuedEventOf(w, { seed: 1, priority: "bulk" });
  const newer = queuedEventOf(w, { seed: 2, enqueuedAt: "2026-07-31T17:00:00.000Z" });
  const slot = w.database.withAuthorityTransaction(({ workerPools, workerSlots }) => {
    const plan = workerPools.plan({ workflow: older.workflow, expectedVersion: 0, desiredWorkers: 1,
      requestedBy: "local-operator", now: older.ts });
    assert.equal(plan.state, "applied");
    return workerSlots.allocate({ workflow: older.workflow, poolIndex: 1, now: older.ts });
  });
  if (previous === "previous claim") {
    const writer = createTimelineEmitter({ repository: w.database.authority.timelineEvents, clock: w.clock });
    writer.emit({ t: "run.claimed", workflow: older.workflow, ts: older.ts, runId: older.runId, traceId: older.traceId,
      attempt: older.attempt, spanPath: older.traceId, workerId: slot.workerId });
  }
  const unexpected = (): never => { throw new Error("unexpected queue publication"); };
  const runReader = new RunRecordService({ database: w.database, clock: w.clock, ids: { uuid: unexpected }, publishQueued: unexpected });
  const worker = runningWorkerView(slot);
  const createProjection = () => {
    const projection = createOperatorProjection({
      database: w.database, reader: {
        read: runId => runReader.read(runId), list: input => runReader.list(input),
        withRunTreeSnapshot: (ids, read) => runReader.withRunTreeSnapshot(ids, read),
        summaries: composeQueueSummaries(w.database),
      },
      stateRoot: w.stateRoot, clock: w.clock, appVersion: APP_VERSION, descriptorSetHash: DESCRIPTOR_SET_HASH,
      ledger: createTransactionHistory(w.database.authority), descriptors: { resolve: () => undefined }, workerMembers: () => [worker],
    });
    projection.rebuildFromTimeline();
    assert.equal(projection.health().state, "live");
    return projection;
  };
  const projection = createProjection();
  const cursor = projection.cursor();
  const before = projection.buildDashboardDayWire(DAY);
  assert.deepEqual(before.workerCards[0]?.lastRun, previous === "empty" ? { state: "unavailable", reason: "no-run-recorded" }
    : { state: "present", runId: older.runId, traceId: older.traceId });
  assert.equal(projection.buildDashboardDayWire(DAY), before);

  const runtime = w.database.authority.runtimeConfig.get();
  assert.ok(runtime);
  const claimed = runReader.claimNext({ commandId: uuidOf(30), workflow: newer.workflow, workerId: slot.workerId,
    runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision,
      settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  assert.ok(claimed.state === "applied");
  assert.equal(claimed.run.envelope.runId, newer.runId);
  assert.equal(projection.cursor(), cursor);
  const expected = { state: "present", runId: newer.runId, traceId: newer.traceId };
  const fresh = createProjection().buildDashboardDayWire(DAY);
  assert.deepEqual(fresh.workerCards[0]?.lastRun, expected);
  const warm = projection.buildDashboardDayWire(DAY);
  assert.deepEqual(warm.workerCards[0]?.lastRun, expected);
  assert.deepEqual(warm.monthCounts, before.monthCounts);
  assert.equal(warm.snapshotCursor, cursor);
});

it("shares an unchanged day across a GET and stream connects and refreshes it when the runs change", async () => {
  const w = await world();
  queuedEventOf(w, { seed: 1 });
  const unrelated = queuedEventOf(w, { seed: 3, enqueuedAt: "2026-07-31T17:00:00.000Z" });
  const summaries = composeQueueSummaries(w.database);
  let queueReads = 0;
  let daySnapshots = 0;
  let runLists = 0;
  const unexpected = (): never => { throw new Error("unexpected write or Activity read"); };
  const runReader = new RunRecordService({ database: w.database, clock: w.clock, ids: { uuid: unexpected }, publishQueued: unexpected });
  const configIdentity = w.database.authority.runtimeConfig.get();
  assert.ok(configIdentity);
  let nextAudit = 100;
  const kernel = createCommandKernel({ authority: w.database, lifecycle: runReader, clock: w.clock,
    ids: { uuid: () => uuidOf(nextAudit++) }, appVersion: APP_VERSION, configIdentity,
    authorityProfileId: w.database.getMeta().profileId, prepareAssistantModelPreference: async () => () => true,
    descriptors: { resolve: () => undefined }, writeResolution: { recheck: unexpected, resolveAbsent: unexpected },
    workerRuntime: { pool: { admit: unexpected, assertMember: unexpected, start: unexpected, ensure: unexpected,
      stop: unexpected, remove: unexpected, direct: unexpected, browser: unexpected, checkParkedWrite: unexpected } },
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
  });
  const projection = createOperatorProjection({
    database: w.database,
    reader: {
      read: runId => runReader.read(runId),
      withRunTreeSnapshot: (ids, read) => runReader.withRunTreeSnapshot(ids, read),
      list(input) {
        runLists += 1;
        return runReader.list(input);
      },
      summaries: { ...summaries, activity: unexpected, withSnapshot(read) {
        daySnapshots += 1;
        return summaries.withSnapshot(read);
      }, queue(input) {
        assert.equal(input.fromDay, DAY);
        assert.equal(input.toDay, DAY);
        queueReads += 1;
        return summaries.queue(input);
      } },
    },
    stateRoot: w.stateRoot,
    clock: w.clock,
    appVersion: APP_VERSION,
    descriptorSetHash: DESCRIPTOR_SET_HASH,
    ledger: createTransactionHistory(w.database.authority),
    descriptors: { resolve: () => undefined },
    workerMembers: () => [],
  });
  projection.rebuildFromTimeline();
  assert.equal(projection.health().state, "live");
  const app: DashboardApp = new Hono();
  registerQueueRoutes(app, { queue: { day: day => projection.buildDashboardDayWire(day) },
    startPlans: { plan: unexpected, previewWarnings: unexpected } });
  const hub = new DashboardStreamHub({ projection, backfillGaps: { detected: unexpected } });
  try {
    const readDay = (ifNoneMatch?: string) => app.request(`/api/v1/dashboard?day=${DAY}`,
      ifNoneMatch === undefined ? {} : { headers: { "If-None-Match": ifNoneMatch } });
    const first = await readDay();
    assert.equal(first.status, 200);
    const tag = first.headers.get("ETag");
    assert.ok(tag, "the first Queue response supplies a validator");
    assert.equal(first.headers.get("Cache-Control"), "private, no-cache");
    const wire: unknown = await first.json();
    assert.equal(queueReads, 1);
    for (let tab = 0; tab < 2; tab += 1) {
      const connection = await hub.connect({ day: DAY });
      const snapshot = connection.initial.find(event => event.type === "snapshot");
      assert.ok(snapshot);
      assert.equal(JSON.stringify(snapshot.payload), JSON.stringify(wire));
      connection.close();
    }
    const listsBeforeDiagnostics = runLists;
    const cursorBeforeDiagnostics = projection.cursor();
    const debug = createDebugEventWriter({ repository: w.timeline, clock: w.clock, build: APP_VERSION });
    assert.equal(debug.emit({ category: "boot", phase: "failed", correlationId: uuidOf(99),
      area: "integration", reason: "unrelated-timeline-write" }).state, "inserted");
    projection.ingestFromTimeline();
    projection.reconcileWorkerAuthority();
    assert.equal(runLists, listsBeforeDiagnostics, "unrelated authority changes skip the canonical run listing");
    assert.equal(projection.cursor(), cursorBeforeDiagnostics);
    const repeated = await readDay();
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), wire);
    assert.equal(repeated.headers.get("ETag"), tag);
    const beforeValidation = daySnapshots;
    const validated = await readDay(`"older", W/${tag}`);
    assert.equal(validated.status, 304);
    assert.equal(validated.headers.get("ETag"), tag);
    assert.equal(validated.headers.get("Cache-Control"), "private, no-cache");
    assert.equal(await validated.text(), "");
    assert.equal(daySnapshots, beforeValidation, "the SQLite source check already owns the snapshot for a cache hit");
    assert.equal(queueReads, 1, "every unchanged request reuses the day build");

    const preferenceId = uuidOf(97);
    const preference = await kernel.executeAssistantModelPreference({
      commandId: preferenceId, requestedAt: w.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
      family: "assistant-model-preference", type: "set-assistant-model-preference",
      target: { profileId: w.database.getMeta().profileId, epoch: 0, expectedRevision: 0 },
      payload: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT },
    });
    assert.equal(preference.state, "applied");
    assert.ok(w.database.authority.commandAudits.findByCommand(preferenceId));
    const afterPreference = await readDay();
    assert.equal(afterPreference.status, 200);
    assert.deepEqual(await afterPreference.json(), wire);
    assert.equal(queueReads, 1, "a journaled assistant preference reuses the unchanged Queue day");

    const rename = (commandId: string, runId: string, displayName: string) => kernel.execute({
      commandId, requestedAt: w.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
      family: "run", type: "rename", target: { runId, expectedVersion: 1 }, payload: { displayName },
    });
    assert.equal(rename(uuidOf(98), unrelated.runId, "Renamed July run").state, "applied");
    assert.equal(projection.cursor(), cursorBeforeDiagnostics);
    const afterUnrelatedRename = await readDay();
    assert.equal(afterUnrelatedRename.status, 200);
    assert.deepEqual(await afterUnrelatedRename.json(), wire);
    assert.equal(queueReads, 1, "renaming an unlinked run outside the month reuses the day build");

    assert.equal(rename(uuidOf(99), uuidOf(1), "Renamed August run").state, "applied");
    const afterSelectedRename = await readDay(tag);
    assert.equal(afterSelectedRename.status, 200);
    assert.notEqual(afterSelectedRename.headers.get("ETag"), tag);
    assert.deepEqual(DashboardDayWireSchema.parse(await afterSelectedRename.json()).queueSurfaces[0]?.displayName,
      { state: "present", value: "Renamed August run" });
    assert.equal(queueReads, 2, "renaming a selected run invalidates its cached day before the next poll");

    queuedEventOf(w, { seed: 2 });
    const updated = await readDay();
    assert.equal(updated.status, 200);
    assert.notDeepEqual(await updated.json(), wire);
    assert.equal(queueReads, 3, "a selected-day insertion invalidates the cached day before the next poll");

    queuedEventOf(w, { seed: 4, enqueuedAt: "2026-08-04T17:00:00.000Z" });
    const afterMonthInsertion = await readDay();
    assert.equal(afterMonthInsertion.status, 200);
    assert.deepEqual(DashboardDayWireSchema.parse(await afterMonthInsertion.json()).monthCounts,
      [{ day: DAY, count: 2 }, { day: "2026-08-04", count: 1 }]);
    assert.equal(queueReads, 3, "new month counts reuse the untouched selected-day summaries");

    w.database.authority.runs.holdAdmission({ commandId: uuidOf(96), runtimeGeneration: configIdentity.generation, reason: "shutdown" });
    assert.equal(w.database.authority.runs.admission().state, "draining");
    assert.equal(projection.cursor(), cursorBeforeDiagnostics);
    assert.equal((await readDay()).status, 200);
    assert.equal(queueReads, 4, "a journaled application admission hold invalidates the day before polling");
  } finally {
    hub.close();
  }
});
