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
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
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
  const ingest = vi.spyOn(projection, "ingestFromTimeline");
  const reconcile = vi.spyOn(projection, "reconcileWorkerAuthority");
  // Every revision read opens a read snapshot over the timeline or run sources.
  let revisionReads = 0;
  const track = database.trackAuthorityTables.bind(database);
  vi.spyOn(database, "trackAuthorityTables").mockImplementation(tables => {
    const revision = track(tables);
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
    const notes = createNoteTimelineWriter({ repository: loggingRepository, clock, pid: 1 });
    const note = () => notes.emitNote({ workflow: "person-lookup", address: { workerId: f.workerId, spanPath: f.workerId }, level: "step", message: "fixture" });
    debug();
    composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents });
    ingest.mockClear(); reconcile.mockClear();
    tick(1000);
    expect([ingest.mock.calls.length, reconcile.mock.calls.length]).toEqual([0, 0]);

    revisionReads = 0;
    debug();
    tick(250);
    expect([ingest.mock.calls.length, reconcile.mock.calls.length, revisionReads]).toEqual([0, 0, 0]);

    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      const copy = db.prepare("INSERT INTO debug_events(id,workflow,run_id,worker_id,occurred_at,recorded_at,retention_date,pinned,payload_json) SELECT 'peer-'||id,workflow,run_id,worker_id,occurred_at,recorded_at,retention_date,pinned,payload_json FROM debug_events ORDER BY cursor DESC LIMIT 1").run();
      db.prepare("DELETE FROM debug_events WHERE id LIKE 'peer-%'").run();
      db.close();
      if (copy.changes !== 1) throw new Error("expected one committed peer debug row");
    `, f.profile.path]);
    tick(250);
    expect([ingest.mock.calls.length, reconcile.mock.calls.length, revisionReads]).toEqual([0, 0, 0]);

    note();
    const first = loggingRepository.page({ after: loggingRepository.highWaterMark() - 1 })[0];
    expect(first?.payload.kind).toBe("note");
    tick(250);
    expect([ingest.mock.calls.length, reconcile.mock.calls.length]).toEqual([1, 0]);

    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      const { changes } = db.prepare("DELETE FROM timeline_events WHERE id=?").run(process.argv[2]);
      db.close();
      if (changes !== 1) throw new Error("expected one committed timeline deletion");
    `, f.profile.path, first?.eventId ?? ""]);
    tick(250);
    expect([ingest.mock.calls.length, reconcile.mock.calls.length]).toEqual([2, 0]);

    const run = f.create(820);
    tick(500);
    expect(reconcile).toHaveBeenCalledTimes(1);
    createTimelineEmitter({ repository: loggingRepository, clock }).emit(runQueuedSpanEvent({
      run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Queued run" }));
    expect(projection.runFold(run.envelope.runId)).toBeUndefined();
    tick(1000);
    expect(projection.runFold(run.envelope.runId)).toBeDefined();
    expect(projection.health().state).toBe("live");
    expect(reconcile).toHaveBeenCalledTimes(2);
    ingest.mockClear(); reconcile.mockClear();
    tick(60_000);
    expect([ingest.mock.calls.length, reconcile.mock.calls.length]).toEqual([1, 1]);
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
    composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: f.profile.admission,
      lifecycle: f.service, loggingRepository, debugEvents: createDebugEventWriter({ repository: loggingRepository, clock, build: "test" }) });
    const generation = projection.generation();
    peer.exec("CREATE TABLE unexpected_peer_table (id INTEGER)");
    for (let attempt = 0; attempt < 2; attempt++) {
      vi.advanceTimersByTime(250);
      const health = projection.health();
      expect(health.state).toBe("degraded");
      expect(health.lastError).toContain("run-search-index-rebuild-required");
    }
    peer.exec("DROP TABLE unexpected_peer_table");
    vi.advanceTimersByTime(250);
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
