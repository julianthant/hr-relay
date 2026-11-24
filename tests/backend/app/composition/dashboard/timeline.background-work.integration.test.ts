import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { admitFixtureSlot } from "../../../../support/fixtures/run-lifecycle-fixtures.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../src/rules/identity/ids.js";
import { NotificationTriggerEventSchema } from "../../../../../src/rules/notifications/notification-triggers.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { composeDashboardTimeline } from "../../../../../src/backend/app/composition/dashboard/timeline.js";
import { startNotificationPolling } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { readNotificationSources } from "../../../../../src/backend/app/composition/dashboard/notification-sources.js";
import { createNotificationObserver } from "../../../../../src/backend/runs/notifications/observation.js";
import type { StartupCleanup } from "../../../../../src/backend/app/composition/dashboard/runtime-contracts.js";
import { createDebugEventWriter } from "../../../../../src/backend/logs/debug-events.js";
import { createOperatorProjection } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { createDashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { declareProjectionWorker, DESCRIPTOR_SET_HASH, runRecordOf, workerMemberOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { AuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { trustWorld } from "../../../../support/helpers/backend/trust-authority-fixture.js";

it("closes the timeline on an operator-sized synthetic store without using its cold read", async () => {
  const f = await trustWorld();
  const { database, world: { clock } } = f;
  const loggingRepository = database.authority.timelineEvents;
  const noteWriter = createNoteTimelineWriter({ repository: loggingRepository, clock });
  const debugEvents = createDebugEventWriter({ repository: loggingRepository, clock, build: "test" });
  const startupCleanups: StartupCleanup[] = [];
  const start = () => {
    const projection = createOperatorProjection({ database, reader: f.service, clock, stateRoot: f.profile.stateRoot,
      appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors: { resolve: () => personLookupDescriptor },
      ledger: createTransactionHistory(database.authority) });
    const poll = projection.pollBackground.bind(projection);
    let readMs: number | undefined;
    vi.spyOn(projection, "pollBackground").mockImplementationOnce((read, now, changed) => poll(async request => {
      const started = performance.now();
      const page = await read(request);
      readMs ??= performance.now() - started;
      return page;
    }, now, changed));
    const runtime = composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents });
    return { runtime, projection, readMs: () => readMs };
  };
  try {
    const runCount = 1600, notesPerRun = 13;
    database.withAuthorityTransaction(repositories => {
      for (let seed = 1; seed <= runCount; seed++) {
        const run = runRecordOf({ seed, enqueuedAt: clock.now().toISOString() });
        repositories.runs.enqueue(run);
        const { workflow, runId, traceId, attempt } = run.envelope;
        for (let note = 0; note < notesPerRun; note++) {
          noteWriter.emitNote({ workflow, address: { runId, traceId, attempt, spanPath: traceId }, level: "step", message: "Fixture note" });
        }
      }
    });
    const first = start();
    await first.runtime.settled();
    expect(first.projection.health().state).toBe("live");
    expect(first.readMs()).toBeDefined();
    await first.runtime.stopTimeline();

    const cold = start(), began = performance.now();
    await cold.runtime.stopTimeline();
    const stopMs = performance.now() - began;
    console.info("Timeline cold-read and stop timings", { runs: runCount, notes: runCount * notesPerRun,
      firstReadMs: first.readMs(), stopMs, stoppedReadMs: cold.readMs() });
    expect(cold.readMs()).toBeUndefined();
  } finally {
    for (const cleanup of startupCleanups.reverse()) await cleanup();
    vi.restoreAllMocks();
    await f.dispose();
  }
});

it("replays a count-neutral background task step across a dashboard reconnect", async () => {
  const f = await trustWorld();
  const { database, world: { clock } } = f;
  const projection = createOperatorProjection({ database, reader: f.service, clock, stateRoot: f.profile.stateRoot,
    appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors: { resolve: () => personLookupDescriptor },
    ledger: createTransactionHistory(database.authority) });
  const loggingRepository = database.authority.timelineEvents;
  const startupCleanups: StartupCleanup[] = [];
  const detected = vi.fn(() => { throw new Error("step-only reconnect created a backfill gap"); });
  const hub = createDashboardStreamHub({ projection, backfillGaps: { detected } });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const run = f.create(823), { runId, traceId, attempt, workflow } = run.envelope;
    const writer = createTimelineEmitter({ repository: loggingRepository, clock });
    writer.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Queued run" }));
    const runtime = composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents: createDebugEventWriter({ repository: loggingRepository, clock, build: "test" }) });
    await runtime.settled();
    projection.refreshRun(runId);
    const day = searchPartitionDay(clock.now());
    const first = await hub.connect({ day });
    const lastEventId = projection.cursor(), lastProjectionGeneration = projection.generation();
    first.close();

    clock.advanceWall(20);
    writer.emit({ t: "span.started", kind: "task", ts: clock.now().toISOString(), workflow, runId, traceId, attempt,
      spanPath: `${traceId}/searching#1`, parentSpanPath: traceId, name: "searching" });
    vi.advanceTimersByTime(250);
    await runtime.settled();
    const resumed = await hub.connect({ day, lastEventId, lastProjectionGeneration });
    expect(resumed.initial.map(event => event.type)).toEqual(["hello", "health", "change", "change"]);
    expect(detected).not.toHaveBeenCalled();
    resumed.close();

    const publications: string[] = [];
    const unsubscribe = projection.onChange(change => publications.push(change.kind));
    f.cancel(run, 825);
    writer.emit({ t: "span.ended", kind: "run", ts: clock.now().toISOString(), workflow, runId, traceId, attempt,
      spanPath: traceId, outcome: "cancelled" });
    vi.advanceTimersByTime(250);
    await runtime.settled();
    expect(publications).toEqual(["snapshot"]);

    const captured = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const poll = projection.pollBackground.bind(projection);
    vi.spyOn(projection, "pollBackground").mockImplementationOnce((read, now) => poll(async request => {
      const page = await read(request);
      captured.resolve();
      await release.promise;
      return page;
    }, now));
    clock.advanceMonotonic(60_000);
    vi.advanceTimersByTime(250);
    await captured.promise;
    let next: ReturnType<typeof f.create>;
    try {
      next = f.create(826);
      writer.emit(runQueuedSpanEvent({ run: next, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Next queued run" }));
      projection.ingestFromTimeline();
      expect(publications).toEqual(["snapshot", "snapshot"]);
      vi.advanceTimersByTime(250);
    } finally { release.resolve(); }
    const commandCursor = projection.cursor();
    await runtime.settled();
    unsubscribe();
    expect(publications).toEqual(["snapshot", "snapshot"]);
    const afterCommand = await hub.connect({ day, lastEventId: commandCursor, lastProjectionGeneration });
    expect(afterCommand.initial.map(event => event.type)).toEqual(["hello", "health", "change"]);
    expect(detected).not.toHaveBeenCalled();

    const now = clock.now().toISOString(), workerId = f.workerId;
    const claim = database.authority.runs.claimNext({ workflow, workerId, now });
    if (claim.state !== "claimed") throw new Error("fixture run was not claimed");
    const claimIdentity = { workerId, claimGeneration: claim.run.claimGeneration };
    const claimTimes = { workerId, claimedAt: now, heartbeatAt: now };
    const validating = database.authority.runs.transition({ runId: next.envelope.runId, expectedVersion: claim.run.version, claim: claimIdentity, now,
      lifecycle: { state: "validating", ...claimTimes } });
    if (validating.state !== "applied") throw new Error("fixture run did not enter validation");
    expect(database.authority.runs.transition({ runId: next.envelope.runId, expectedVersion: validating.run.version, claim: claimIdentity, now,
      lifecycle: { state: "running", currentNodeId: "searching", ...claimTimes } }).state).toBe("applied");
    vi.advanceTimersByTime(250);
    await runtime.settled();
    const running = await afterCommand.next();
    afterCommand.close();
    expect(running).toMatchObject({ type: "snapshot", payload: { queueSurfaces: expect.arrayContaining([
      expect.objectContaining({ runId: next.envelope.runId, status: "running" }),
    ]) } });
    if (running?.type !== "snapshot") throw new Error("worker authority did not publish running status");

    const address = { ts: now, workflow, runId: next.envelope.runId, attempt: next.envelope.attempt, traceId: next.envelope.traceId };
    writer.emit({ ...address, t: "run.claimed", workerId, spanPath: address.traceId });
    writer.emit({ ...address, t: "span.started", kind: "task", spanPath: `${address.traceId}/searching#1`, parentSpanPath: address.traceId, name: "searching" });
    vi.advanceTimersByTime(250);
    await runtime.settled();
    const afterClaim = await hub.connect({ day, lastEventId: running.cursor, lastProjectionGeneration });
    expect(afterClaim.initial.map(event => event.type)).toEqual(["hello", "health", "change", "change"]);
    expect(detected).not.toHaveBeenCalled();
    afterClaim.close();
  } finally {
    hub.close();
    for (const cleanup of startupCleanups.reverse()) await cleanup();
    vi.useRealTimers();
    await f.dispose();
  }
});

it("folds a peer timeline commit on the next tick while the first worker page is pending", async () => {
  const f = await trustWorld();
  const { database, world: { clock } } = f;
  const projection = createOperatorProjection({ database, reader: f.service, clock, stateRoot: f.profile.stateRoot,
    appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors: { resolve: () => personLookupDescriptor },
    ledger: createTransactionHistory(database.authority) });
  const loggingRepository = database.authority.timelineEvents;
  const startupCleanups: StartupCleanup[] = [];
  const release = Promise.withResolvers<void>();
  const poll = projection.pollBackground.bind(projection);
  vi.spyOn(projection, "pollBackground").mockImplementationOnce((read, now, changed) => poll(async request => {
    await release.promise;
    return read(request);
  }, now, changed));
  const peer = new DatabaseSync(f.profile.path);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const run = f.create(824), { workflow, runId, traceId, attempt } = run.envelope;
    createNoteTimelineWriter({ repository: loggingRepository, clock }).emitNote({ workflow,
      address: { runId, traceId, attempt, spanPath: traceId }, level: "step", message: "Initial note" });
    const runtime = composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents: createDebugEventWriter({ repository: loggingRepository, clock, build: "test" }) });
    const touched: string[][] = [];
    const unsubscribe = projection.onChange(change => { if (change.kind === "runs") touched.push([...change.runIds]); });
    const eventId = randomUUID(), started = performance.now();
    expect(peer.prepare(`INSERT INTO timeline_events(id,workflow,run_id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json)
      SELECT ?,workflow,run_id,kind,occurred_at,recorded_at,retention_date,retention_class,
        json_set(payload_json,'$.eventId',?,'$.cursor',(SELECT seq+1 FROM sqlite_sequence WHERE name='timeline_events'))
      FROM timeline_events WHERE run_id=? AND kind='note'`).run(eventId, eventId, runId).changes).toBe(1);
    vi.advanceTimersByTime(250);
    expect(touched).toEqual([[runId]]);
    expect(250 + performance.now() - started).toBeLessThanOrEqual(1000);
    release.resolve();
    await runtime.settled();
    expect(touched).toEqual([[runId]]);
    expect(projection.health().state).toBe("live");
    unsubscribe();
  } finally {
    release.resolve();
    for (const cleanup of startupCleanups.reverse()) await cleanup();
    peer.close();
    vi.useRealTimers();
    await f.dispose();
  }
});

it("recovers after a background worker exits and stops cleanly after the replacement exits", async () => {
  const f = await trustWorld();
  const { database, world: { clock } } = f;
  const projection = createOperatorProjection({ database, reader: f.service, clock, stateRoot: f.profile.stateRoot,
    appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors: { resolve: () => personLookupDescriptor },
    ledger: createTransactionHistory(database.authority) });
  const loggingRepository = database.authority.timelineEvents;
  const startupCleanups: StartupCleanup[] = [];
  const post: unknown = Reflect.get(Worker.prototype, "postMessage");
  if (typeof post !== "function") throw new Error("fixture worker postMessage missing");
  const workers = new Set<Worker>();
  let hold = false;
  const intercept = vi.spyOn(Worker.prototype, "postMessage").mockImplementation(function (this: Worker, ...args) {
    if (args[0] !== null) {
      workers.add(this);
      if (hold) return;
    }
    Reflect.apply(post, this, args);
  });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const runtime = composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents: createDebugEventWriter({ repository: loggingRepository, clock, build: "test" }) });
    await runtime.settled();
    const generation = projection.generation();
    const crash = async () => {
      const worker = [...workers].at(-1);
      expect(worker).toBeDefined();
      if (worker === undefined) throw new Error("expected an active fixture worker");
      hold = true;
      clock.advanceMonotonic(60_000);
      vi.advanceTimersByTime(250);
      await worker.terminate();
      await runtime.settled();
      const health = projection.health();
      expect(health.state).toBe("degraded");
      expect(health.lastError).toContain("dashboard-background-worker-exited");
      hold = false;
    };
    await crash();
    vi.advanceTimersByTime(250);
    await runtime.settled();
    expect(workers.size).toBe(2);
    expect(projection.health().state).toBe("live");
    expect(projection.generation()).toBeGreaterThan(generation);
    await crash();
    await expect(runtime.stopTimeline()).resolves.toBeUndefined();
  } finally {
    for (const cleanup of startupCleanups.reverse()) await cleanup();
    intercept.mockRestore();
    vi.useRealTimers();
    await f.dispose();
  }
});

it("publishes a peer commit on the next tick while an earlier publication is still in flight", async () => {
  const { fixture, seedRun } = createNotificationCompositionTestWorld();
  const f = await fixture();
  const peer = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-peer" }, f.clock);
  const gate = (seed: number) => runRecordOf({ seed, lifecycle: { state: "parked-gate", gateId: "confirm",
    parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } });
  const first = seedRun(f, gate(1));
  const release = Promise.withResolvers<void>();
  const read = vi.fn(() => readNotificationSources(f.db, f.reader));
  const publish = vi.fn(f.inbox.publish.bind(f.inbox)).mockImplementationOnce(async (event, source) => {
    await release.promise;
    return f.inbox.publish(event, source);
  });
  const observer = createNotificationObserver({ inbox: { publish }, read, health: async () => {} });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const timer = startNotificationPolling(f.db, f.clock, { ...observer, healthDueAt: () => Infinity });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
    const second = seedRun({ ...f, db: peer }, gate(2));
    await vi.advanceTimersByTimeAsync(1000);
    const links = () => f.inbox.list("local-operator").flatMap(row => row.links);
    expect(links()).toContainEqual({ kind: "run", runId: second.envelope.runId });
    expect(links()).not.toContainEqual({ kind: "run", runId: first.envelope.runId });
    expect(publish).toHaveBeenCalledTimes(2);
    release.resolve();
    await observer.stop();
    expect(links()).toContainEqual({ kind: "run", runId: first.envelope.runId });
    expect(observer.status()).toEqual({ state: "stopped", pending: 0 });
  } finally {
    clearInterval(timer);
    release.resolve();
    await observer.stop();
    vi.useRealTimers();
    peer.close();
    await f.close();
  }
});

it.each(["delayed", "retried"])("folds the fourth occurrence after a %s third occurrence in the same inbox row", async mode => {
  const { fixture, seedRun } = createNotificationCompositionTestWorld();
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const occurrence = (count: number) => {
    const { runId, workflow } = seedRun(f, runRecordOf({ seed: count })).envelope;
    return {
      event: NotificationTriggerEventSchema.parse({ kind: "repeating-failure", runId, workflowId: workflow, failureId: randomUUID(),
        failureFingerprint: "a".repeat(64), occurrences: count, threshold: 3 }),
      source: { identity: String(count).repeat(64), occurredAt: f.clock.now().toISOString() },
    };
  };
  const observations = [occurrence(3)];
  const publish = vi.fn(f.inbox.publish.bind(f.inbox)).mockImplementationOnce(async (event, source) => {
    started.resolve();
    await release.promise;
    if (mode === "retried") throw new Error("synthetic publication failure");
    return f.inbox.publish(event, source);
  });
  const observer = createNotificationObserver({ read: () => ({ observations, diagnostics: [] }), inbox: { publish }, health: async () => {} });
  const published: number[] = [];
  f.inbox.onPublication(({ event }) => { if (event.kind === "repeating-failure") published.push(event.occurrences); });
  try {
    const first = observer.observeSources();
    await started.promise;
    observations.push(occurrence(4));
    const next = observer.observeSources();
    release.resolve();
    await Promise.all([first, next]);
    if (mode === "retried") {
      expect(published).toEqual([]);
      expect(observer.status()).toEqual({ state: "failed", code: "NOTIFICATION_OBSERVATION_FAILED", pending: 2 });
      observations.length = 0;
      await observer.observeSources(() => false);
    }
    expect(published).toEqual([3, 4]);
    const rows = f.inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    expect(rows.map(row => row.count)).toEqual([2]);
    expect(rows[0].summary).toContain("occurred 4 times");
  } finally {
    release.resolve();
    await observer.stop();
    await f.close();
  }
});

it("polls only changed projection inputs, including peer commits, lease expiry and a quiet safety pass", async () => {
  const f = await trustWorld();
  const { database, world: { clock } } = f;
  declareProjectionWorker(f.world.authority, f.workerId, 1);
  const member = workerMemberOf(f.world.authority, { workerId: f.workerId });
  const projection = createOperatorProjection({ database, reader: f.service, clock, workerMembers: () => [member], stateRoot: f.profile.stateRoot,
    appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors: { resolve: () => personLookupDescriptor },
    ledger: createTransactionHistory(database.authority) });
  const startupCleanups: StartupCleanup[] = [];
  const loggingRepository = database.authority.timelineEvents;
  const debugEvents = createDebugEventWriter({ repository: loggingRepository, clock, build: "test" });
  const pollBackground = projection.pollBackground.bind(projection);
  const poll = vi.spyOn(projection, "pollBackground");
  const synchronousIngest = vi.spyOn(projection, "ingestFromTimeline");
  let revisionReads = 0;
  const track = database.trackAuthorityTables.bind(database);
  vi.spyOn(database, "trackAuthorityTables").mockImplementation((tables, mode) => {
    const revision = track(tables, mode);
    return () => { revisionReads += 1; return revision(); };
  });
  const lease = database.authority.duoCeremonyLeases.acquire({ credentialKey: "a".repeat(64), workerId: f.workerId,
    system: "crm", now: clock.now().toISOString(), ttlMs: 3000 });
  expect(lease.state).toBe("acquired");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const tick = (ms: number) => {
    clock.advanceWall(ms);
    clock.advanceMonotonic(ms);
    vi.advanceTimersByTime(ms);
  };
  try {
    const debug = () => debugEvents.emit({ category: "boot", phase: "settled", correlationId: randomUUID(), area: "timeline", reason: "fixture" });
    debug();
    const runtime = composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents });
    const startupCursor = projection.cursor();
    await runtime.settled();
    expect(projection.cursor()).toBe(startupCursor);
    poll.mockClear();
    revisionReads = 0;
    tick(500);
    debug();
    tick(250);
    expect(poll).not.toHaveBeenCalled();
    expect(revisionReads).toBe(0);

    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      const copy = db.prepare("INSERT INTO debug_events(id,workflow,run_id,worker_id,occurred_at,recorded_at,retention_date,pinned,payload_json) SELECT 'peer-'||id,workflow,run_id,worker_id,occurred_at,recorded_at,retention_date,pinned,payload_json FROM debug_events ORDER BY cursor DESC LIMIT 1").run();
      db.prepare("DELETE FROM debug_events WHERE id LIKE 'peer-%'").run();
      db.close();
      if (copy.changes !== 1) throw new Error("expected one committed peer debug row");
    `, f.profile.path]);
    tick(250);
    expect(poll).not.toHaveBeenCalled();
    expect(revisionReads).toBe(0);

    runtime.noteWriter.emitNote({ workflow: "person-lookup", address: { workerId: f.workerId, spanPath: f.workerId }, level: "step", message: "fixture" });
    const first = loggingRepository.page({ after: loggingRepository.highWaterMark() - 1 })[0];
    expect(first?.payload.kind).toBe("note");
    tick(250);
    expect(poll).toHaveBeenCalledTimes(1);
    await runtime.settled();

    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      const { changes } = db.prepare("DELETE FROM timeline_events WHERE id=?").run(process.argv[2]);
      db.close();
      if (changes !== 1) throw new Error("expected one committed timeline deletion");
    `, f.profile.path, first?.eventId ?? ""]);
    tick(250);
    expect(poll).toHaveBeenCalledTimes(2);
    await runtime.settled();

    const previousCursor = projection.cursor();
    const run = f.create(820);
    tick(500);
    expect(poll).toHaveBeenCalledTimes(3);
    await runtime.settled();
    expect(projection.cursor()).not.toBe(previousCursor);
    createTimelineEmitter({ repository: loggingRepository, clock }).emit(runQueuedSpanEvent({
      run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Queued run" }));
    const { runId, workflow, traceId, attempt } = run.envelope, ts = clock.now().toISOString();
    const eventId = randomUUID();
    const observation = {
      t: "data.observed", ts, observedAt: ts, runId, workflow, traceId, attempt,
      spanPath: `${traceId}/searching#1.1`, nodeId: "searching", taskId: "ucpath/search-person-org",
      points: [{ direction: "read", field: "selection", values: [
        { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "resolved" },
      ] }],
    };
    createTimelineEmitter({ repository: loggingRepository, clock, uuid: () => eventId }).emit(observation);
    expect(projection.runFold(run.envelope.runId)).toBeUndefined();
    const secondPage = Promise.withResolvers<void>(), finishPage = Promise.withResolvers<void>();
    poll.mockImplementationOnce((read, now) => pollBackground(async request => {
      if (request.through !== undefined) {
        secondPage.resolve();
        await finishPage.promise;
      }
      return read({ ...request, limit: 1 });
    }, now));
    tick(750);
    await secondPage.promise;
    try {
      expect(projection.runFold(runId)).toBeDefined();
    } finally { finishPage.resolve(); }
    await runtime.settled();
    expect(projection.runFold(run.envelope.runId)).toBeDefined();
    expect(projection.runLogSnapshot(runId).entries.map(entry => entry.line.file.path)).toEqual([`timeline:${eventId}`]);
    expect(projection.health().state).toBe("live");
    expect(poll).toHaveBeenCalledTimes(4);
    expect(synchronousIngest).not.toHaveBeenCalled();
    const leaseChanges: string[] = [];
    const unsubscribe = projection.onChange(change => leaseChanges.push(change.kind));
    const beforeExpiry = database.changeKey();
    tick(250);
    await runtime.settled();
    unsubscribe();
    expect(database.changeKey()).toEqual(beforeExpiry);
    expect(leaseChanges).toEqual(["snapshot"]);
    expect(poll).toHaveBeenCalledTimes(5);

    const touched: string[][] = [];
    const off = projection.onChange(change => { if (change.kind === "runs") touched.push([...change.runIds]); });
    runtime.noteWriter.emitNote({ workflow, address: { runId, attempt, traceId, spanPath: traceId }, level: "step", message: "fixture" });
    tick(250);
    await runtime.settled();
    off();
    expect(touched).toEqual([[runId]]);
    expect(poll).toHaveBeenCalledTimes(6);

    const captured = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    poll.mockImplementationOnce((read, now) => pollBackground(async request => {
      const page = await read(request);
      captured.resolve();
      await release.promise;
      return page;
    }, now));
    tick(60_000);
    await captured.promise;
    const peerId = randomUUID();
    const beforePeer = performance.now();
    try {
      execFileSync(process.execPath, ["--input-type=module", "-e", `
        import { DatabaseSync } from "node:sqlite";
        const db = new DatabaseSync(process.argv[1]);
        const { changes } = db.prepare(\`
          INSERT INTO timeline_events(id,workflow,run_id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json)
          SELECT ?,workflow,run_id,kind,occurred_at,recorded_at,retention_date,retention_class,
            json_set(payload_json,'$.eventId',?,'$.cursor',(SELECT seq+1 FROM sqlite_sequence WHERE name='timeline_events'))
          FROM timeline_events WHERE id=?
        \`).run(process.argv[2], process.argv[2], process.argv[3]);
        db.close();
        if (changes !== 1) throw new Error("expected one peer observation");
      `, f.profile.path, peerId, eventId]);
      tick(250);
    } finally { release.resolve(); }
    await runtime.settled();
    expect(projection.runLogSnapshot(runId).entries.at(-1)?.line.file.path).toBe(`timeline:${peerId}`);
    expect(250 + performance.now() - beforePeer).toBeLessThanOrEqual(1000);

    const nextId = randomUUID();
    createTimelineEmitter({ repository: loggingRepository, clock, uuid: () => nextId }).emit(observation);
    tick(250);
    expect(poll).toHaveBeenCalledTimes(9);
    projection.ingestFromTimeline();
    await runtime.settled();
    expect(projection.runLogSnapshot(runId).entries.map(entry => entry.line.file.path)).toEqual([
      `timeline:${eventId}`, `timeline:${peerId}`, `timeline:${nextId}`,
    ]);
    poll.mockClear();
    tick(60_000);
    expect(poll).toHaveBeenCalledTimes(1);
    await runtime.settled();
    const second = database.withAuthorityTransaction(repositories =>
      admitFixtureSlot(repositories, "onboarding", 1, clock.now().toISOString()));
    const generation = projection.generation(), beforeRace = projection.cursor();
    const beforeLogs = projection.runLogSnapshot(runId);
    let stale = false;
    poll.mockImplementationOnce((read, now) => pollBackground(async request => {
      if (request.workerCursor !== undefined) {
        database.authority.workerSlots.setPaused({ workerId: second.workerId, paused: true, now: clock.now().toISOString() });
        try { return await read({ ...request, limit: 1 }); }
        catch (error) {
          expect(error).toMatchObject({ message: "dashboard-background-worker-cursor-stale" });
          stale = true;
          throw error;
        }
      }
      return read({ ...request, limit: 1 });
    }, now));
    tick(250);
    await runtime.settled();
    expect(stale).toBe(true);
    expect(projection.health().state).toBe("live");
    expect(projection.buildDashboardDayWire(beforeLogs.entries[0].line.file.date).queueSurfaces.map(row => row.runId)).toContain(runId);
    expect(projection.runLogSnapshot(runId)).toEqual(beforeLogs);
    tick(250);
    await runtime.settled();
    expect(poll).toHaveBeenCalledTimes(3);
    expect(projection.generation()).toBe(generation);
    expect(projection.cursor()).not.toBe(beforeRace);
    await runtime.stopTimeline();
    expect(synchronousIngest).toHaveBeenCalledTimes(1);
  } finally {
    for (const cleanup of startupCleanups.reverse()) await cleanup();
    vi.useRealTimers(); vi.restoreAllMocks();
    await f.dispose();
  }
});

it("degrades on a refused peer snapshot and rebuilds after the peer repairs it", async () => {
  const f = await trustWorld();
  const { database, world: { clock } } = f;
  const projection = createOperatorProjection({ database, reader: f.service, clock, stateRoot: f.profile.stateRoot,
    appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors: { resolve: () => personLookupDescriptor },
    ledger: createTransactionHistory(database.authority) });
  const loggingRepository = database.authority.timelineEvents;
  const startupCleanups: StartupCleanup[] = [];
  const peer = new DatabaseSync(f.profile.path);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const runtime = composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents: createDebugEventWriter({ repository: loggingRepository, clock, build: "test" }) });
    const startupCursor = projection.cursor();
    const run = f.create(821);
    await runtime.settled();
    expect(projection.cursor()).not.toBe(startupCursor);
    const generation = projection.generation();
    peer.exec("CREATE TABLE unexpected_peer_table (id INTEGER)");
    const poll = projection.pollBackground.bind(projection);
    const reads = vi.spyOn(projection, "pollBackground");
    for (let attempt = 0; attempt < 2; attempt++) {
      vi.advanceTimersByTime(250);
      await runtime.settled();
      expect(reads).toHaveBeenCalledTimes(attempt + 1);
      const health = projection.health();
      expect(health.state).toBe("degraded");
      expect(health.lastError).toBe("timeline background read failed: authority-native-schema-shape-mismatch");
    }
    peer.exec("DROP TABLE unexpected_peer_table");
    const writer = createTimelineEmitter({ repository: loggingRepository, clock });
    const { runId, workflow, traceId, attempt } = run.envelope;
    clock.advanceWall(1000);
    writer.emit({ t: "run.claimed", ts: clock.now().toISOString(), runId, workflow, traceId, attempt, spanPath: traceId, workerId: f.workerId });
    writer.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Queued run" }));
    reads.mockImplementationOnce((read, now) => poll(request => read({ ...request, limit: 1 }), now));
    vi.advanceTimersByTime(250);
    await runtime.settled();
    expect(projection.health().state).toBe("live");
    expect(projection.generation()).toBeGreaterThan(generation);
    expect(projection.runFold(runId)?.claimedBy).toBe(f.workerId);
  } finally {
    for (const cleanup of startupCleanups.reverse()) await cleanup();
    peer.exec("DROP TABLE IF EXISTS unexpected_peer_table");
    peer.close();
    vi.useRealTimers();
    await f.dispose();
  }
});
