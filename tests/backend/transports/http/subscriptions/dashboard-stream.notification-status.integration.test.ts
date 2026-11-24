import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createDashboardStreamHub, type DashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import type { NotificationObservationStatus } from "../../../../../src/backend/runs/notifications/observation.js";
import type { DashboardStreamEnvelope, StreamRow } from "../../../../../src/models/dashboard/subscription.js";
import { DAY, makeWorld, type DashboardWorld } from "../../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [], hubs: DashboardStreamHub[] = [];
afterEach(async () => { for (const hub of hubs.splice(0)) hub.close(); for (const world of worlds.splice(0)) await world.dispose(); });

const READY: NotificationObservationStatus = { state: "ready", pending: 0 };
const FAILED: NotificationObservationStatus = { state: "failed", code: "NOTIFICATION_OBSERVATION_FAILED", pending: 1 };

/** An observer whose status the test sets, and whose read the test can make throw. */
async function setup() {
  const world = await makeWorld(); worlds.push(world);
  let status: NotificationObservationStatus = READY, throws = false;
  const listeners = new Set<() => void>();
  const timers: { delayMs: number; task: () => void; cancelled: boolean }[] = [];
  const hub = createDashboardStreamHub({
    projection: world.projection,
    backfillGaps: { detected: () => { throw new Error("no gap is expected"); } },
    notificationStatus: {
      read: () => { if (throws) throw new Error("status read failed"); return status; },
      onChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    schedule: (delayMs, task) => { const timer = { delayMs, task, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
  }); hubs.push(hub);
  return {
    world, hub,
    move: (next: NotificationObservationStatus) => { status = next; for (const listener of [...listeners]) listener(); },
    failReads: (value: boolean) => { throws = value; },
    /** Runs every live timer once and answers how many ran. */
    fire: () => { const due = timers.splice(0).filter(timer => !timer.cancelled); for (const timer of due) timer.task(); return due; },
    listeners,
  };
}

const statusOf = (envelope: DashboardStreamEnvelope | undefined): StreamRow["value"] | undefined => {
  if (envelope?.type !== "snapshot" && envelope?.type !== "change") return undefined;
  return envelope.rows.find(row => row.model === "notification-status")?.value;
};

it("carries the status row in the snapshot and rides a rows-only change when the status moves", async () => {
  const { hub, move } = await setup();
  const connection = await hub.connect({ day: DAY });
  const snapshot = connection.initial.find(envelope => envelope.type === "snapshot");
  assert(snapshot?.type === "snapshot");
  assert.deepEqual(snapshot.rows, [{ model: "notification-status", key: "local-operator", value: { state: "available", value: READY } }]);

  move(FAILED);

  const change = await connection.next();
  assert(change?.type === "change");
  assert.equal(change.day, undefined, "a status change carries no day part");
  assert.equal(change.after, snapshot.cursor);
  assert.deepEqual(statusOf(change), { state: "available", value: FAILED });
  assert.equal(connection.pending, 0);
  connection.close();
});

it("carries the status row in a resumed handoff", async () => {
  const { world, hub } = await setup();
  const first = await hub.connect({ day: DAY });
  const held = world.projection.cursor();
  first.close();
  const resumed = await hub.connect({ day: DAY, lastEventId: held, lastProjectionGeneration: world.projection.generation() });
  const handoff = resumed.initial.at(-1);
  assert(handoff?.type === "change");
  assert.deepEqual(statusOf(handoff), { state: "available", value: READY });
  resumed.close();
});

it("sends a first status that cannot be read as unavailable and the retry's value 5 s later", async () => {
  const { hub, failReads, fire } = await setup();
  failReads(true);
  const connection = await hub.connect({ day: DAY });
  const first = statusOf(connection.initial.find(envelope => envelope.type === "snapshot"));
  assert.equal(first?.state, "unavailable");
  failReads(false);

  const due = fire();
  assert.deepEqual(due.map(timer => timer.delayMs), [5_000]);

  const retried = await connection.next();
  assert(retried?.type === "change");
  assert.deepEqual(statusOf(retried), { state: "available", value: READY });
  assert.equal(fire().length, 0, "an available status is not read again");
  connection.close();
});

it("sends an update that cannot be read as unavailable, then the retried value", async () => {
  const { hub, move, failReads, fire } = await setup();
  const connection = await hub.connect({ day: DAY });
  failReads(true);
  move(FAILED);
  const failed = await connection.next();
  assert.equal(statusOf(failed)?.state, "unavailable");
  failReads(false);
  fire();
  const retried = await connection.next();
  assert.deepEqual(statusOf(retried), { state: "available", value: FAILED });
  connection.close();
});

it("stops retrying once no connection is owed the status and drops its listener on close", async () => {
  const { hub, failReads, fire, listeners } = await setup();
  failReads(true);
  const connection = await hub.connect({ day: DAY });
  connection.close();
  fire();
  assert.equal(fire().length, 0);
  hub.close();
  assert.equal(listeners.size, 0);
});
