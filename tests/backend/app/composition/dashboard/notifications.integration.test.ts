import { execFileSync } from "node:child_process";
import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { describe, expect, it, vi } from "vitest";
import { createTrustNotifications, startNotificationPolling } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import * as inspection from "../../../../../src/backend/storage/sqlite/authority-inspection-off-thread.js";
import * as sources from "../../../../../src/backend/app/composition/dashboard/notification-sources.js";
import { syntheticStateRoot } from "../../../../support/helpers/synthetic-storage-admission.js";

const { fixture, seedRun } = createNotificationCompositionTestWorld();

describe("canonical notification producers", () => {
  it("publishes gate and write occurrences once across observation restarts", async () => {
    const f = await fixture();
    try {
      seedRun(f, runRecordOf({ seed: 1, lifecycle: { state: "parked-gate", gateId: "confirm", parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      const composition = () => createTrustNotifications({ database: f.db, clock: f.clock, ids: sequentialIdFactory("b"), reader: f.reader });
      await composition().observer.observe();
      const row = f.inbox.list("local-operator")[0]; f.inbox.markRead(row.notificationId, 1);
      await composition().observer.observe(); expect(f.inbox.get(row.notificationId)?.status).toBe("read"); expect(f.inbox.get(row.notificationId)?.count).toBe(1);
    } finally { await f.close(); }
  });
});

it("resumes polling from the persisted storage-health sample when it is nearly due", async () => {
  const f = await fixture();
  const compose = () => createTrustNotifications({ admission: syntheticStateRoot(f.root), database: f.db, clock: f.clock,
    ids: sequentialIdFactory("health"), reader: f.reader, stateRoot: f.root }).observer;
  try {
    const first = compose();
    try { await first.observe(); } finally { await first.stop(); }
    const sampledAt = () => f.db.authority.notificationHealth.get("wal-growth")?.observedAt;
    const original = f.clock.now().toISOString();
    expect(sampledAt()).toBe(original);
    f.clock.advanceWall(59_000);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const resumed = compose();
    const timer = startNotificationPolling(f.db, f.clock, resumed);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(sampledAt()).toBe(original);
      f.clock.advanceWall(1000);
      f.clock.advanceMonotonic(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(sampledAt()).toBe(f.clock.now().toISOString());
    } finally {
      clearInterval(timer);
      await resumed.stop();
      vi.useRealTimers();
    }
  } finally { await f.close(); }
});

it("publishes changed sources within one second while health is in flight and skips idle and unrelated ticks", async () => {
  const f = await fixture();
  const inspected = Promise.withResolvers<void>();
  const health = vi.spyOn(inspection, "inspectAuthorityOffThread").mockImplementation(async () => { await inspected.promise; throw new Error("fixture inspection stopped"); });
  const read = vi.spyOn(sources, "readNotificationSources");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { observer } = createTrustNotifications({ admission: syntheticStateRoot(f.root), database: f.db, clock: f.clock,
    ids: sequentialIdFactory("b"), reader: f.reader, stateRoot: f.root });
  const timer = startNotificationPolling(f.db, f.clock, observer);
  try {
    expect(health).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false,
      occurrence: 0, observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), samples: [] }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(1);

    const run = seedRun(f, runRecordOf({ seed: 8, lifecycle: { state: "parked-gate", gateId: "confirm",
      parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.inbox.list("local-operator").flatMap(row => row.links)).toContainEqual({ kind: "run", runId: run.envelope.runId });
    expect(health).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    const reads = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(reads);

    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      const { changes } = db.prepare("DELETE FROM notifications WHERE id=?").run(process.argv[2]);
      db.close();
      if (changes !== 1) throw new Error("expected one removed notification");
    `, f.path, f.inbox.list("local-operator")[0].notificationId]);
    expect(f.inbox.list("local-operator")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.inbox.list("local-operator").flatMap(row => row.links)).toContainEqual({ kind: "run", runId: run.envelope.runId });
  } finally {
    clearInterval(timer);
    inspected.resolve();
    await observer.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await f.close();
  }
});
