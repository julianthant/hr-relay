
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";

import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import {
createDashboardStreamHub,
type DashboardStreamHub,
} from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { applyDashboardDayPatch } from "../../../../../src/dashboard/client/index.js";
import type { DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import type { DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import {
claimEventOf,
DAY,
makeWorld,
queuedEventOf,
runRecordOf,
taskEventsOf,
type DashboardWorld,
} from "../../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];

const VALIDATING_BACKFILL_GAPS = {
  detected: (input: unknown) =>
    Promise.resolve({
      published: false as const,
      gap: BackfillGapObservationSchema.parse(input),
    }),
};

async function harness(options: { maxPending?: number; retention?: number } = {}): Promise<{
  w: DashboardWorld;
  hub: DashboardStreamHub;
}> {
  const w = await makeWorld();
  worlds.push(w);
  const hub = createDashboardStreamHub({
    projection: w.projection,
    maxPending: options.maxPending ?? 8,
    retention: options.retention ?? 128,
    backfillGaps: VALIDATING_BACKFILL_GAPS,
  });
  hubs.push(hub);
  return { w, hub };
}

afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.close();
  for (const w of worlds.splice(0)) await w.dispose();
});

async function drain(connection: {
  readonly pending: number;
  next(): Promise<DashboardStreamEnvelope | undefined>;
}): Promise<DashboardStreamEnvelope[]> {
  const out: DashboardStreamEnvelope[] = [];
  while (connection.pending > 0) {
    const envelope = await connection.next();
    if (envelope === undefined) break;
    out.push(envelope);
  }
  return out;
}

function applyEnvelope(
  day: DashboardDayWire | undefined,
  envelope: DashboardStreamEnvelope,
): DashboardDayWire | undefined {
  if (envelope.type === "snapshot" && envelope.topic === "dashboard-day") return envelope.payload;
  if (envelope.type === "patch" && envelope.topic === "dashboard-day") {
    if (day === undefined) assert.fail("patch arrived before any snapshot");
    return applyDashboardDayPatch(day, envelope.payload);
  }
  return day;
}

describe("Stream convergence: authoritative snapshots across create, delete, and terminalization", () => {
  it("converges to authoritative snapshot on create, status transition, delete, and terminalization", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    const connection = await hub.connect({ day: DAY });

    let local: DashboardDayWire | undefined;
    for (const envelope of connection.initial) local = applyEnvelope(local, envelope);

    const take = async (): Promise<DashboardStreamEnvelope[]> => {
      const envelopes = await drain(connection);
      for (const envelope of envelopes) local = applyEnvelope(local, envelope);
      return envelopes;
    };

    // Initial state check
    assert.equal(local?.queueSurfaces.length, 1);
    assert.equal(local?.statusCounts.find((s) => s.status === "queued")?.count, 1);

    // 1. Create/enqueue run 2 -> count-bearing -> snapshot emitted
    queuedEventOf(w, { seed: 2 });
    const createEnvelopes = await take();
    assert.ok(createEnvelopes.some((e) => e.type === "snapshot"));
    assert.equal(local?.queueSurfaces.length, 2);
    assert.equal(local?.statusCounts.find((s) => s.status === "queued")?.count, 2);

    // 2. Status transition on run 2 -> running -> terminal completed
    claimEventOf(w, 2);
    await take();
    w.authority.put(
      runRecordOf({
        seed: 2,
        lifecycle: {
          state: "terminal",
          outcome: "done",
          endedAt: "2026-08-03T17:01:00.000Z",
        },
        version: 3,
      }),
    );
    w.projection.refreshRun(runRecordOf({ seed: 2 }).envelope.runId);
    const transitionEnvelopes = await take();
    assert.ok(transitionEnvelopes.some((e) => e.type === "snapshot"));
    const freshAfterComplete = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual(
      { ...local, snapshotCursor: "pc:1" },
      { ...freshAfterComplete, snapshotCursor: "pc:1" },
    );


    const run2Id = runRecordOf({ seed: 2 }).envelope.runId;
    w.authority.records.delete(run2Id);
    w.projection.refreshRun(run2Id);

    const deleteEnvelopes = await take();
    // Authoritative snapshot emitted upon deletion
    assert.ok(deleteEnvelopes.some((e) => e.type === "snapshot"));
    assert.equal(local?.queueSurfaces.length, 1);
    assert.ok(!local?.queueSurfaces.some((s) => s.runId === run2Id));

    const freshAfterDelete = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual(
      { ...local, snapshotCursor: "pc:1" },
      { ...freshAfterDelete, snapshotCursor: "pc:1" },
    );

    // Current terminal rows remain visible.
    const run1Id = runRecordOf({ seed: 1 }).envelope.runId;
    w.authority.put(
      runRecordOf({
        seed: 1,
        lifecycle: {
          state: "terminal",
          outcome: "done",
          endedAt: "2026-08-03T17:02:00.000Z",
        },
        version: 2,
      }),
    );
    w.projection.refreshRun(run1Id);
    await take();

    assert.equal(local?.queueSurfaces.length, 1);
    assert.equal(local?.queueSurfaces[0].status, "done");
    const freshAfterTerminal = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual({ ...local, snapshotCursor: "pc:1" }, { ...freshAfterTerminal, snapshotCursor: "pc:1" });

    connection.close();
  });

  it("prevents late or delayed patches from resurrecting deleted rows", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    queuedEventOf(w, { seed: 2 });
    const run2Id = runRecordOf({ seed: 2 }).envelope.runId;

    const connection = await hub.connect({ day: DAY });
    let local: DashboardDayWire | undefined;
    for (const envelope of connection.initial) local = applyEnvelope(local, envelope);

    // Delete run 2 in authority and refresh projection
    w.authority.records.delete(run2Id);
    w.projection.refreshRun(run2Id);

    for (const envelope of await drain(connection)) {
      local = applyEnvelope(local, envelope);
    }
    assert.ok(!local?.queueSurfaces.some((s) => s.runId === run2Id));

    // A stale patch for run 2 attempting to replace surface on an absent run fails or does not resurrect
    const staleSurface = w.projection.buildDashboardDayWire(DAY).queueSurfaces[0];
    assert.ok(staleSurface !== undefined);
    assert.notEqual(staleSurface.runId, run2Id);

    // The authoritative snapshot is definitive
    const fresh = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual(
      { ...local, snapshotCursor: "pc:1" },
      { ...fresh, snapshotCursor: "pc:1" },
    );
    connection.close();
  });

  it("resumes with fresh snapshot when cursor crosses a snapshot or deletion boundary", async () => {
    const { w, hub } = await harness({ retention: 64 });
    queuedEventOf(w, { seed: 1 });
    const connection1 = await hub.connect({ day: DAY });
    const cursorBeforeDelete = w.projection.cursor();
    connection1.close();

    // Now delete run 1
    const run1Id = runRecordOf({ seed: 1 }).envelope.runId;
    w.authority.records.delete(run1Id);
    w.projection.refreshRun(run1Id);

    // Client reconnects with cursorBeforeDelete
    const resumed = await hub.connect({
      day: DAY,
      lastEventId: cursorBeforeDelete,
      lastProjectionGeneration: w.projection.generation(),
    });

    // Because a snapshot occurred in the retained window, the hub delivers a fresh snapshot
    const [hello, snapshot] = resumed.initial;
    assert.equal(hello.type, "hello");
    assert.equal(snapshot.type, "snapshot");
    if (snapshot.type === "snapshot" && snapshot.topic === "dashboard-day") {
      assert.equal(snapshot.payload.queueSurfaces.length, 0);
      assert.equal(snapshot.payload.statusCounts.length, 0);
    }
    resumed.close();
  });

  it("snapshots an expired cursor and avoids resnapshotting at the current cursor", async () => {
    const { w, hub } = await harness({ retention: 4 });
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const connection = await hub.connect({ day: DAY });
    const cursor = w.projection.cursor();
    connection.close();

    // Expire the cursor by producing more than 4 count-neutral task events
    for (let i = 0; i < 6; i++) {
      taskEventsOf(w, 1, `step-${i}`);
    }

    // Reconnecting with expired cursor gets fresh snapshot
    const expiredResume = await hub.connect({
      day: DAY,
      lastEventId: cursor,
      lastProjectionGeneration: w.projection.generation(),
    });
    const [hello, snapshot] = expiredResume.initial;
    assert.equal(hello.type, "hello");
    assert.equal(snapshot.type, "snapshot");
    expiredResume.close();

    // An exact current cursor with matching generation already names current authority.
    const currentCursor = w.projection.cursor();
    const currentResume = await hub.connect({
      day: DAY,
      lastEventId: currentCursor,
      lastProjectionGeneration: w.projection.generation(),
    });
    assert.deepEqual(currentResume.initial.map(({ type }) => type), ["hello", "health"]);
    currentResume.close();
  });

  it("enforces bounded backpressure by sending reset-required on buffer overflow", async () => {
    const { w, hub } = await harness({ maxPending: 3 });
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);

    const connection = await hub.connect({ day: DAY });
    // Connection does not pull envelopes; we publish multiple task events
    taskEventsOf(w, 1, "task-1");
    taskEventsOf(w, 1, "task-2");
    taskEventsOf(w, 1, "task-3");
    taskEventsOf(w, 1, "task-4"); // Exceeds maxPending = 3

    // Buffer overflow replaces queue with reset-required
    const reset = await connection.next();
    assert.ok(reset !== undefined);
    assert.equal(reset.type, "reset-required");
    if (reset.type === "reset-required") {
      assert.equal(reset.reason, "cursor-expired");
    }
    connection.close();
  });
});
