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
import { DESCRIPTOR_SET_HASH } from "../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { trustWorld } from "../../../../support/helpers/backend/trust-authority-fixture.js";

it("polls only changed projection inputs, including peer commits, lease expiry and a quiet safety pass", async () => {
  const f = await trustWorld();
  const { database, world: { clock } } = f;
  const projection = createOperatorProjection({ database, reader: f.service, clock, stateRoot: f.profile.stateRoot,
    appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors: { resolve: () => personLookupDescriptor },
    ledger: createTransactionHistory(database.authority) });
  const startupCleanups: StartupCleanup[] = [];
  const loggingRepository = database.authority.timelineEvents;
  const debugEvents = createDebugEventWriter({ repository: loggingRepository, clock, build: "test" });
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
    await runtime.ready;
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
    tick(1000);
    await runtime.settled();
    expect(projection.runFold(run.envelope.runId)).toBeDefined();
    expect(projection.runLogSnapshot(runId).entries.map(entry => entry.line.file.path)).toEqual([`timeline:${eventId}`]);
    expect(projection.health().state).toBe("live");
    expect(poll).toHaveBeenCalledTimes(4);
    expect(synchronousIngest).not.toHaveBeenCalled();
    const nextId = randomUUID();
    createTimelineEmitter({ repository: loggingRepository, clock, uuid: () => nextId }).emit(observation);
    tick(250);
    expect(poll).toHaveBeenCalledTimes(5);
    projection.ingestFromTimeline();
    await runtime.settled();
    expect(projection.runLogSnapshot(runId).entries.map(entry => entry.line.file.path)).toEqual([
      `timeline:${eventId}`, `timeline:${nextId}`,
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
    await runtime.ready;
    const generation = projection.generation();
    peer.exec("CREATE TABLE unexpected_peer_table (id INTEGER)");
    for (let attempt = 0; attempt < 2; attempt++) {
      vi.advanceTimersByTime(250);
      await runtime.settled();
      const health = projection.health();
      expect(health.state).toBe("degraded");
      expect(health.lastError).toContain("run-search-index-rebuild-required");
    }
    peer.exec("DROP TABLE unexpected_peer_table");
    vi.advanceTimersByTime(250);
    await runtime.settled();
    expect(projection.health().state).toBe("live");
    expect(projection.generation()).toBeGreaterThan(generation);
  } finally {
    for (const cleanup of startupCleanups.reverse()) await cleanup();
    peer.exec("DROP TABLE IF EXISTS unexpected_peer_table");
    peer.close();
    vi.useRealTimers();
    await f.dispose();
  }
});
