import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../src/rules/identity/ids.js";
import { composeDashboardTimeline } from "../../../../../src/backend/app/composition/dashboard/timeline.js";
import type { StartupCleanup } from "../../../../../src/backend/app/composition/dashboard/runtime-contracts.js";
import { createDebugEventWriter } from "../../../../../src/backend/logs/debug-events.js";
import { createOperatorProjection } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { declareProjectionWorker, DESCRIPTOR_SET_HASH, workerMemberOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { trustWorld } from "../../../../support/helpers/backend/trust-authority-fixture.js";

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
    const first = debug().record;
    const runtime = composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents });
    const startupCursor = projection.cursor();
    await runtime.settled();
    expect(projection.cursor()).toBe(startupCursor);
    poll.mockClear();
    tick(1000);
    expect(poll).not.toHaveBeenCalled();

    debug();
    tick(250);
    expect(poll).toHaveBeenCalledTimes(1);
    await runtime.settled();

    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      const { changes } = db.prepare("DELETE FROM timeline_events WHERE id=?").run(process.argv[2]);
      db.close();
      if (changes !== 1) throw new Error("expected one committed timeline deletion");
    `, f.profile.path, first.eventId]);
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
    expect(poll).toHaveBeenCalledTimes(8);
    projection.ingestFromTimeline();
    await runtime.settled();
    expect(projection.runLogSnapshot(runId).entries.map(entry => entry.line.file.path)).toEqual([
      `timeline:${eventId}`, `timeline:${peerId}`, `timeline:${nextId}`,
    ]);
    poll.mockClear();
    tick(60_000);
    expect(poll).toHaveBeenCalledTimes(1);
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
