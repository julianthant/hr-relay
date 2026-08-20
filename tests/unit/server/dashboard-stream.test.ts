/**
 * The resumable subscription hub (ref frontend-backend-integration §3.5) and the 1g exit invariant:
 * a snapshot plus ANY valid patch sequence applied by the ONE client
 * function equals a fresh snapshot. Plus cursor resume, expired-cursor
 * fresh-snapshot, generation reset, and the loudly bounded subscriber queue.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { applyDashboardDayPatch } from "../../../src/dashboard/client/index.js";
import type { DashboardDayWire } from "../../../src/domain/dashboard/projection.js";
import type { DashboardStreamEnvelope } from "../../../src/domain/dashboard/subscription.js";
import { createDashboardStreamHub, type DashboardStreamHub } from "../../../src/server/dashboard/subscriptions/dashboard-stream.js";
import {
  claimEventOf,
  DAY,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  taskEventsOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];

function harness(): { w: DashboardWorld; hub: DashboardStreamHub } {
  const w = makeWorld();
  worlds.push(w);
  const hub = createDashboardStreamHub({ projection: w.projection, maxPending: 4 });
  hubs.push(hub);
  return { w, hub };
}

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.close();
  for (const w of worlds.splice(0)) w.dispose();
});

function applyEnvelope(day: DashboardDayWire | undefined, envelope: DashboardStreamEnvelope): DashboardDayWire | undefined {
  if (envelope.type === "snapshot" && envelope.topic === "dashboard-day") return envelope.payload;
  if (envelope.type === "patch" && envelope.topic === "dashboard-day") {
    if (day === undefined) assert.fail("patch arrived before any snapshot");
    return applyDashboardDayPatch(day, envelope.payload);
  }
  return day;
}

describe("dashboard stream hub", () => {
  it("opens with hello -> snapshot -> health and stamps the projection identity", () => {
    const { w, hub } = harness();
    queuedEventOf(w, { seed: 1 });
    const connection = hub.connect({ day: DAY });
    const [hello, snapshot, health] = connection.initial;
    assert.equal(hello.type, "hello");
    if (hello.type !== "hello") assert.fail("expected hello");
    assert.equal(hello.projectionGeneration, w.projection.generation());
    assert.equal(snapshot.type, "snapshot");
    assert.deepEqual(health, { type: "health", state: "live" });
    connection.close();
  });

  it("EXIT: snapshot + any valid live envelope sequence equals a fresh snapshot", () => {
    const { w, hub } = harness();
    queuedEventOf(w, { seed: 1 });
    const connection = hub.connect({ day: DAY });
    let local: DashboardDayWire | undefined;
    for (const envelope of connection.initial) local = applyEnvelope(local, envelope);
    connection.subscribe((envelope) => {
      local = applyEnvelope(local, envelope);
    });

    // A count-bearing change (new run), a status transition, count-neutral
    // task progress, and a mid-stream member update.
    queuedEventOf(w, { seed: 2 });
    claimEventOf(w, 2);
    w.authority.put(runRecordOf({
      seed: 2,
      lifecycle: { state: "running", workerId: "person-lookup-worker-1", claimedAt: "2026-08-03T17:00:05.000Z", heartbeatAt: "2026-08-03T17:00:05.000Z" },
      claimGeneration: 1,
      version: 2,
    }));
    taskEventsOf(w, 2, "searching");
    taskEventsOf(w, 2, "selecting", "done");

    const fresh = w.projection.buildDashboardDayWire(DAY);
    assert.notEqual(local, undefined);
    assert.deepEqual({ ...local, snapshotCursor: "pc:1" }, { ...fresh, snapshotCursor: "pc:1" });
    connection.close();
  });

  it("replays retained patches for a resumable cursor and never re-snapshots", () => {
    const { w, hub } = harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const first = hub.connect({ day: DAY });
    const cursorAt = w.projection.cursor();
    first.close();

    taskEventsOf(w, 1, "searching"); // count-neutral -> retained patch
    const resumed = hub.connect({ day: DAY, lastEventId: cursorAt });
    const types = resumed.initial.map(({ type }) => type);
    assert.deepEqual(types, ["hello", "patch", "health"]);
    resumed.close();
  });

  it("serves a fresh snapshot for an expired or foreign cursor", () => {
    const { w, hub } = harness();
    queuedEventOf(w, { seed: 1 });
    const connection = hub.connect({ day: DAY, lastEventId: "pc:999999" });
    assert.deepEqual(connection.initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    connection.close();
  });

  it("broadcasts reset-required when the projection generation changes", () => {
    const { w, hub } = harness();
    queuedEventOf(w, { seed: 1 });
    const connection = hub.connect({ day: DAY });
    const live: DashboardStreamEnvelope[] = [];
    connection.subscribe((envelope) => live.push(envelope));
    w.projection.rebuildFromJsonl();
    assert.deepEqual(live.map(({ type }) => type), ["reset-required"]);
    if (live[0].type !== "reset-required") assert.fail("expected reset-required");
    assert.equal(live[0].reason, "generation-changed");
    connection.close();
  });

  it("replaces an overflowing pending queue with one loud reset-required", () => {
    const { w, hub } = harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const connection = hub.connect({ day: DAY });
    // No subscribe(): the pending queue absorbs patches until the bound.
    for (let step = 0; step < 8; step += 1) taskEventsOf(w, 1, `node-${String(step)}`);
    const delivered: DashboardStreamEnvelope[] = [];
    connection.subscribe((envelope) => delivered.push(envelope));
    assert.deepEqual(delivered.map(({ type }) => type), ["reset-required"]);
    connection.close();
  });

  it("greets a degraded projection with health degraded instead of a fabricated snapshot", () => {
    const { w } = harness();
    w.projection.apply({
      t: "run.claimed", ts: w.clock.now().toISOString(), workflow: "person-lookup", pid: 1,
      runId: uuidOf(60), attempt: 1, traceId: "pl-100000-6060", spanPath: "pl-100000-6060",
      workerId: "person-lookup-worker-1",
    } as never);
    // collectRebuilds is off, so the default schedule ran the rebuild
    // immediately and recovered; force a degraded state via corrupt storage.
    const degradedWorld = makeWorld({ collectRebuilds: true });
    worlds.push(degradedWorld);
    const degradedHub = createDashboardStreamHub({ projection: degradedWorld.projection });
    hubs.push(degradedHub);
    degradedWorld.projection.apply({
      t: "run.claimed", ts: degradedWorld.clock.now().toISOString(), workflow: "person-lookup", pid: 1,
      runId: uuidOf(61), attempt: 1, traceId: "pl-100000-6161", spanPath: "pl-100000-6161",
      workerId: "person-lookup-worker-1",
    } as never);
    assert.equal(degradedWorld.projection.health().state, "degraded");
    const connection = degradedHub.connect({ day: DAY });
    assert.deepEqual(connection.initial.map(({ type }) => type), ["hello", "health"]);
    const health = connection.initial[1];
    if (health.type !== "health") assert.fail("expected health");
    assert.equal(health.state, "degraded");
    connection.close();
  });
});
