import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { randomUUID } from "node:crypto";

import { createRunQueueProjection } from "../../../../../src/backend/runs/projections/run-queue-projection.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { admitDirectWorker } from "../../../../../src/backend/storage/sqlite/worker-slots.js";

import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";

import assert from "node:assert/strict";
import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import { createDashboardStreamHub,type DashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { applyDashboardDayPatch } from "../../../../../src/dashboard/client/index.js";
import type { DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import type { DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import { NotificationRecordSchema } from "../../../../../src/models/notifications/notifications.js";
import {
claimEventOf,
DAY,
makeWorld,
queuedEventOf,
runRecordOf,
taskEventsOf,
uuidOf,
type DashboardWorld,
} from "../../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];
const workers = new Map<DashboardWorld["database"], Set<string>>();

const VALIDATING_BACKFILL_GAPS = {
  detected: (input: unknown) => Promise.resolve({
    published: false as const,
    gap: BackfillGapObservationSchema.parse(input),
  }),
};

async function harness(nativeWorkers = false): Promise<{ w: DashboardWorld; hub: DashboardStreamHub }> {
  const original = await makeWorld({ profileFixture: profileFixtures.create });
  const projection = nativeWorkers ? createRunQueueProjection({
    timeline: original.timeline, reader: original.runReader, stateRoot: original.stateRoot, clock: original.clock,
    appVersion: "0.1.0", descriptorSetHash: original.projection.descriptorSetHash(),
    ledger: createTransactionHistory(original.database.authority),
    authority: { ...original.authority,
      listWorkerSlots: () => original.database.authority.workerSlots.list(),
      listWorkerRuns: workerId => original.database.authority.runs.listByWorker(workerId),
      workerOwnerAlive: lease => workers.get(original.database)?.has(lease.workerId) === true && lease.processId === process.pid && lease.lifecycle.state !== "stopped",
      workerControls: () => original.database.authority.workerControls.list(),
      workerBrowsers: workerId => original.database.authority.workerControls.browsers(workerId),
      getWorkerLease: workerId => original.database.authority.workerLeases.get(workerId),
      listLiveWorkerLeases: () => original.database.authority.workerLeases.listLive(),
      listWorkerPools: () => original.database.authority.workerPools.list(),
    }, descriptors: { resolve: workflow => workflow === personLookupDescriptor.id ? personLookupDescriptor : undefined },
  }) : original.projection;
  const w: DashboardWorld = nativeWorkers ? { ...original, projection, writer: { emit: event => {
    original.writer.emit(event); projection.ingestFromTimeline();
  } } } : original;
  worlds.push(w);
  const hub = createDashboardStreamHub({
    projection: w.projection,
    maxPending: 4,
    backfillGaps: VALIDATING_BACKFILL_GAPS,
  });
  hubs.push(hub);
  return { w, hub };
}

afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.close();
  workers.clear();
  for (const w of worlds.splice(0)) await w.dispose();
});

function admitOwnedWorker(w: DashboardWorld) {
  const slot = w.database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    commandId: randomUUID(), workflow: personLookupDescriptor.id, poolIndex: 1,
    expectedPoolVersion: repositories.workerPools.get(personLookupDescriptor.id)?.version ?? 0,
    processId: process.pid, now: w.clock.now().toISOString(),
  }, randomUUID()));
  const owned = workers.get(w.database) ?? new Set<string>();
  owned.add(slot.workerId); workers.set(w.database, owned);
  const started = w.database.authority.workerLeases.start({ workerId: slot.workerId, workflow: personLookupDescriptor.id,
    browserSystems: ["crm", "ucpath"], processId: process.pid, requestedBy: "local-operator", now: w.clock.now().toISOString() });
  assert.equal(started.state, "started");
  if (started.state !== "started") throw new Error("worker fixture did not start");
  return started.lease;
}

/** Pull every envelope the hub has queued for this connection, in order. */
async function drain(connection: { readonly pending: number; next(): Promise<DashboardStreamEnvelope | undefined> }): Promise<DashboardStreamEnvelope[]> {
  const out: DashboardStreamEnvelope[] = [];
  while (connection.pending > 0) {
    const envelope = await connection.next();
    if (envelope === undefined) break;
    out.push(envelope);
  }
  return out;
}

function applyEnvelope(day: DashboardDayWire | undefined, envelope: DashboardStreamEnvelope): DashboardDayWire | undefined {
  if (envelope.type === "snapshot" && envelope.topic === "dashboard-day") return envelope.payload;
  if (envelope.type === "patch" && envelope.topic === "dashboard-day") {
    if (day === undefined) assert.fail("patch arrived before any snapshot");
    return applyDashboardDayPatch(day, envelope.payload);
  }
  return day;
}

describe("dashboard stream hub", () => {
  it("opens with hello -> snapshot -> health and stamps the projection identity", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    const connection = await hub.connect({ day: DAY });
    const [hello, snapshot, health] = connection.initial;
    assert.equal(hello.type, "hello");
    if (hello.type !== "hello") assert.fail("expected hello");
    assert.equal(hello.projectionGeneration, w.projection.generation());
    assert.equal(snapshot.type, "snapshot");
    assert.deepEqual(health, { type: "health", state: "live" });
    connection.close();
  });

  it("EXIT: snapshot + any valid live envelope sequence equals a fresh snapshot", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    const connection = await hub.connect({ day: DAY });
    let local: DashboardDayWire | undefined;
    for (const envelope of connection.initial) local = applyEnvelope(local, envelope);
    // A live consumer drains as it goes; draining only at the end would trip
    // the harness's 4-envelope bound, which is the separate overflow test.
    const take = async (): Promise<void> => {
      for (const envelope of await drain(connection)) local = applyEnvelope(local, envelope);
    };

    // A count-bearing change (new run), a status transition, count-neutral
    // task progress, and a mid-stream member update.
    queuedEventOf(w, { seed: 2 });
    await take();
    claimEventOf(w, 2);
    await take();
    w.authority.put(runRecordOf({
      seed: 2,
      lifecycle: { state: "running", workerId: "person-lookup-worker-1", claimedAt: "2026-08-03T17:00:05.000Z", heartbeatAt: "2026-08-03T17:00:05.000Z" },
      claimGeneration: 1,
      version: 2,
    }));
    taskEventsOf(w, 2, "searching");
    await take();
    taskEventsOf(w, 2, "selecting", "done");
    await take();

    const fresh = w.projection.buildDashboardDayWire(DAY);
    assert.notEqual(local, undefined);
    assert.deepEqual({ ...local, snapshotCursor: "pc:1" }, { ...fresh, snapshotCursor: "pc:1" });
    connection.close();
  });

  it("resnapshots worker cards when a browser session opens", async () => {
    const { w, hub } = await harness(true);
    const lease = admitOwnedWorker(w);
    const connection = await hub.connect({ day: DAY });
    const observed: DashboardStreamEnvelope[] = [];
    const workerPath = "worker/person-lookup/person-lookup-worker-1";

    w.writer.emit({
      t: "span.started",
      kind: "worker",
      ts: w.clock.now().toISOString(),
      workflow: "person-lookup",
      workerId: "person-lookup-worker-1",
      spanPath: workerPath,
      name: "person-lookup",
    });
    const runtime = w.database.authority.runtimeConfig.get(); assert.ok(runtime);
    w.database.authority.workerControls.observe({ workerId: lease.workerId, leaseGeneration: lease.leaseGeneration,
      sessionId: uuidOf(50), system: "ucpath", instance: "prod", configFingerprint: runtime.configFingerprint,
      signInFingerprint: runtime.configFingerprint, browserMode: "headless", acceptDownloads: false, exclusive: false,
      health: "unknown", openedAt: w.clock.now().toISOString(), observedAt: w.clock.now().toISOString(), profileRevision: 1 });
    w.writer.emit({
      t: "span.started",
      kind: "browser",
      ts: w.clock.now().toISOString(),
      workflow: "person-lookup",
      workerId: "person-lookup-worker-1",
      spanPath: `${workerPath}/browser:ucpath#${uuidOf(50)}`,
      parentSpanPath: workerPath,
      name: "browser-session:ucpath",
      system: "ucpath",
    });

    observed.push(...await drain(connection));
    const latest = observed.filter((envelope) => envelope.type === "snapshot").at(-1);
    assert.ok(latest);
    assert.equal(latest.topic, "dashboard-day");
    if (latest.topic !== "dashboard-day") assert.fail("expected a dashboard-day snapshot");
    assert.deepEqual(latest.payload.workerCards[0]?.browsers, [
      { sessionId: uuidOf(50), system: "ucpath", openedAt: w.clock.now().toISOString(), observation: { state: "present", health: "unknown", instance: "prod", observedAt: w.clock.now().toISOString(),
        browserMode: "headless", configFingerprint: runtime.configFingerprint } },
    ]);
    connection.close();
  });

  it("resnapshots worker cards when a lease moves without any span", async () => {
    const { w, hub } = await harness(true);
    const connection = await hub.connect({ day: DAY });
    const observed: DashboardStreamEnvelope[] = [];
    const [initial] = connection.initial.filter((envelope) => envelope.type === "snapshot");
    if (initial?.topic !== "dashboard-day") assert.fail("expected a dashboard-day snapshot");
    assert.deepEqual(initial.payload.workerCards, []);

    // A worker process wrote its lease and has not emitted its first span yet.
    admitOwnedWorker(w);
    w.projection.reconcileWorkerAuthority();

    observed.push(...await drain(connection));
    const latest = observed.filter((envelope) => envelope.type === "snapshot").at(-1);
    assert.ok(latest);
    if (latest.topic !== "dashboard-day") assert.fail("expected a dashboard-day snapshot");
    assert.equal(latest.payload.workerCards.length, 1);
    assert.equal(latest.payload.workerCards[0]?.state, "starting");
    assert.deepEqual(latest.payload.workerCards[0]?.browserRequirements, {
      state: "present",
      systems: ["crm", "ucpath"],
    });
    assert.deepEqual(latest.payload.workerCards[0]?.browsers, []);
    connection.close();
  });

  it("replays retained patches for a resumable cursor and never re-snapshots", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const first = await hub.connect({ day: DAY });
    const cursorAt = w.projection.cursor();
    const generationAt = w.projection.generation();
    first.close();

    taskEventsOf(w, 1, "searching"); // count-neutral -> retained patch
    const resumed = await hub.connect({
      day: DAY,
      lastEventId: cursorAt,
      lastProjectionGeneration: generationAt,
    });
    const types = resumed.initial.map(({ type }) => type);
    assert.deepEqual(types, ["hello", "patch", "health"]);
    resumed.close();
  });

  it("reports the exact historical cursor transition when a retained snapshot forces replacement", async () => {
    const w = await makeWorld({ profileFixture: profileFixtures.create });
    worlds.push(w);
    const observed: unknown[] = [];
    const hub = createDashboardStreamHub({
      projection: w.projection,
      backfillGaps: {
        detected: (input: unknown) => {
          observed.push(input);
          return Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) });
        },
      },
    });
    hubs.push(hub);
    queuedEventOf(w, { seed: 1 });
    const heldCursor = w.projection.cursor();
    const heldGeneration = w.projection.generation();
    queuedEventOf(w, { seed: 2 });

    const replaced = await hub.connect({
      day: DAY,
      lastEventId: heldCursor,
      lastProjectionGeneration: heldGeneration,
    });
    assert.deepEqual(replaced.initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert.deepEqual(observed, [{
      kind: "backfill-gap",
      detector: "server-resume",
      reason: "snapshot-boundary",
      topic: "dashboard-day",
      requestedCursor: heldCursor,
      currentCursor: w.projection.cursor(),
      projectionGeneration: w.projection.generation(),
    }]);
    replaced.close();

    const current = await hub.connect({
      day: DAY,
      lastEventId: w.projection.cursor(),
      lastProjectionGeneration: w.projection.generation(),
    });
    current.close();
    const future = await hub.connect({
      day: DAY,
      lastEventId: "pc:999999",
      lastProjectionGeneration: w.projection.generation(),
    });
    future.close();
    assert.equal(observed.length, 1, "a current or future cursor is not evidence that history was missed");
  });

  it("resnapshots a cursor from an earlier projection generation without reporting missed history", async () => {
    const w = await makeWorld({ profileFixture: profileFixtures.create });
    worlds.push(w);
    const observed: unknown[] = [];
    const hub = createDashboardStreamHub({
      projection: w.projection,
      backfillGaps: {
        detected: (input: unknown) => {
          observed.push(input);
          return Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) });
        },
      },
    });
    hubs.push(hub);
    queuedEventOf(w, { seed: 1 });
    const heldCursor = w.projection.cursor();
    const heldGeneration = w.projection.generation();

    w.projection.rebuildFromTimeline();
    const replacement = await hub.connect({
      day: DAY,
      lastEventId: heldCursor,
      lastProjectionGeneration: heldGeneration,
    });

    assert.deepEqual(replacement.initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert.deepEqual(observed, []);
    replacement.close();
  });

  it("resnapshots a historical cursor without generation evidence without reporting missed history", async () => {
    const w = await makeWorld({ profileFixture: profileFixtures.create });
    worlds.push(w);
    const observed: unknown[] = [];
    const hub = createDashboardStreamHub({
      projection: w.projection,
      backfillGaps: {
        detected: (input: unknown) => {
          observed.push(input);
          return Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) });
        },
      },
    });
    hubs.push(hub);
    queuedEventOf(w, { seed: 1 });
    const heldCursor = w.projection.cursor();
    queuedEventOf(w, { seed: 2 });

    const replacement = await hub.connect({ day: DAY, lastEventId: heldCursor });

    assert.deepEqual(replacement.initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert.deepEqual(observed, []);
    replacement.close();
  });

  it("never pairs a hello from one generation with a snapshot captured after publish rebuilt projection", async () => {
    const w = await makeWorld({ profileFixture: profileFixtures.create });
    worlds.push(w);
    const hub: DashboardStreamHub = createDashboardStreamHub({
      projection: w.projection,
      backfillGaps: {
        detected: (input: unknown) => {
          const gap = BackfillGapObservationSchema.parse(input);
          w.projection.rebuildFromTimeline();
          return Promise.resolve({ published: false as const, gap });
        },
      },
    });
    hubs.push(hub);
    queuedEventOf(w, { seed: 1 });
    const heldCursor = w.projection.cursor();
    const heldGeneration = w.projection.generation();
    queuedEventOf(w, { seed: 2 });

    const replacement = await hub.connect({
      day: DAY,
      lastEventId: heldCursor,
      lastProjectionGeneration: heldGeneration,
    });
    const hello = replacement.initial.find((entry) => entry.type === "hello");
    const snapshot = replacement.initial.find((entry) => entry.type === "snapshot");
    if (hello?.type !== "hello" || snapshot?.type !== "snapshot" || snapshot.topic !== "dashboard-day") {
      assert.fail("expected one replacement handshake");
    }

    assert.equal(snapshot.payload.projectionGeneration, hello.projectionGeneration);
    assert.equal(snapshot.cursor, hello.cursor);
    assert.equal(hello.projectionGeneration, w.projection.generation());
    replacement.close();
  });

  it("captures the complete replacement snapshot after durable gap publication without projection movement", async () => {
    const w = await makeWorld({ profileFixture: profileFixtures.create });
    worlds.push(w);
    const counts = { beforePublication: -1, afterPublication: -1 };
    const hub = createDashboardStreamHub({
      projection: w.projection,
      backfillGaps: {
        detected: (input: unknown) => {
          const gap = BackfillGapObservationSchema.parse(input);
          const cursor = w.projection.cursor();
          const generation = w.projection.generation();
          counts.beforePublication = w.projection.buildDashboardDayWire(DAY).notifications.length;
          const notification = NotificationRecordSchema.parse({
            notificationId: uuidOf(7001),
            actorId: "local-operator",
            dedupeFingerprint: "a".repeat(64),
            trigger: "backfill-gap",
            channel: "ping",
            status: "unread",
            snooze: { state: "not-snoozed" },
            title: "Notification history is incomplete",
            summary: "event-stream history gap",
            links: [],
            count: 1,
            lastSeenAt: w.clock.now().toISOString(),
            version: 1,
            createdAt: w.clock.now().toISOString(),
            updatedAt: w.clock.now().toISOString(),
          });
          w.authority.notifications.push(notification);
          counts.afterPublication = w.projection.buildDashboardDayWire(DAY).notifications.length;
          assert.equal(w.projection.cursor(), cursor);
          assert.equal(w.projection.generation(), generation);
          return Promise.resolve({
            published: true as const,
            gap,
            report: { notification, durable: "created" as const, delivery: { state: "no-channel" as const } },
          });
        },
      },
    });
    hubs.push(hub);
    queuedEventOf(w, { seed: 1 });
    const heldCursor = w.projection.cursor();
    const heldGeneration = w.projection.generation();
    queuedEventOf(w, { seed: 2 });

    const replacement = await hub.connect({
      day: DAY,
      lastEventId: heldCursor,
      lastProjectionGeneration: heldGeneration,
    });
    const snapshot = replacement.initial.find((entry) => entry.type === "snapshot");
    if (snapshot?.type !== "snapshot" || snapshot.topic !== "dashboard-day") {
      assert.fail("expected one replacement dashboard snapshot");
    }
    const fresh = w.projection.buildDashboardDayWire(DAY);

    assert.deepEqual({
      ...counts,
      servedNotifications: snapshot.payload.notifications.length,
      freshNotifications: fresh.notifications.length,
    }, {
      beforePublication: 0,
      afterPublication: 1,
      servedNotifications: 1,
      freshNotifications: 1,
    });
    replacement.close();
  });

  it("refuses to serve a replacement handshake when durable gap publication fails", async () => {
    const w = await makeWorld({ profileFixture: profileFixtures.create });
    worlds.push(w);
    const hub = createDashboardStreamHub({
      projection: w.projection,
      backfillGaps: {
        detected: () => Promise.reject(new Error("notification authority is unavailable")),
      },
    });
    hubs.push(hub);
    queuedEventOf(w, { seed: 1 });
    const heldCursor = w.projection.cursor();
    const heldGeneration = w.projection.generation();
    queuedEventOf(w, { seed: 2 });

    await assert.rejects(
      hub.connect({
        day: DAY,
        lastEventId: heldCursor,
        lastProjectionGeneration: heldGeneration,
      }),
      /notification authority is unavailable/u,
    );
  });

  it("serves a fresh snapshot for an expired or foreign cursor", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    const connection = await hub.connect({
      day: DAY,
      lastEventId: "pc:999999",
      lastProjectionGeneration: w.projection.generation(),
    });
    assert.deepEqual(connection.initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    connection.close();
  });

  it("broadcasts reset-required when the projection generation changes", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    const connection = await hub.connect({ day: DAY });
    w.projection.rebuildFromTimeline();
    const live = await drain(connection);
    assert.deepEqual(live.map(({ type }) => type), ["reset-required"]);
    if (live[0].type !== "reset-required") assert.fail("expected reset-required");
    assert.equal(live[0].reason, "generation-changed");
    connection.close();
  });

  it("replaces an overflowing pending queue with one loud reset-required", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const connection = await hub.connect({ day: DAY });
    // No next() in flight: the pending queue absorbs patches until the bound.
    for (let step = 0; step < 8; step += 1) taskEventsOf(w, 1, `node-${String(step)}`);
    assert.equal(connection.pending, 1, "the overflow collapses to exactly one queued envelope");
    const delivered = await drain(connection);
    assert.deepEqual(delivered.map(({ type }) => type), ["reset-required"]);
    if (delivered[0]?.type !== "reset-required") assert.fail("expected reset-required");
    assert.equal(delivered[0].reason, "cursor-expired");
    assert.equal(delivered[0].cursor, w.projection.cursor(), "the reset names the CURRENT cursor so the client resnapshots from head");
    connection.close();
  });

  it("greets a degraded projection with health degraded instead of a fabricated snapshot", async () => {
    const { w } = await harness();
    w.projection.apply({
      t: "run.claimed", ts: w.clock.now().toISOString(), workflow: "person-lookup", pid: 1,
      runId: uuidOf(60), attempt: 1, traceId: "pl-100000-6060", spanPath: "pl-100000-6060",
      workerId: "person-lookup-worker-1",
    } as never);
    // collectRebuilds is off, so the default schedule ran the rebuild
    // immediately and recovered; force a degraded state via corrupt storage.
    const degradedWorld = await makeWorld({ profileFixture: profileFixtures.create, collectRebuilds: true });
    worlds.push(degradedWorld);
    const degradedHub = createDashboardStreamHub({
      projection: degradedWorld.projection,
      backfillGaps: VALIDATING_BACKFILL_GAPS,
    });
    hubs.push(degradedHub);
    degradedWorld.projection.apply({
      t: "run.claimed", ts: degradedWorld.clock.now().toISOString(), workflow: "person-lookup", pid: 1,
      runId: uuidOf(61), attempt: 1, traceId: "pl-100000-6161", spanPath: "pl-100000-6161",
      workerId: "person-lookup-worker-1",
    } as never);
    assert.equal(degradedWorld.projection.health().state, "degraded");
    const connection = await degradedHub.connect({ day: DAY });
    assert.deepEqual(connection.initial.map(({ type }) => type), ["hello", "health"]);
    const health = connection.initial[1];
    if (health.type !== "health") assert.fail("expected health");
    assert.equal(health.state, "degraded");
    connection.close();
  });
  it("hands a live envelope straight to an outstanding next() and never queues past it", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const connection = await hub.connect({ day: DAY });
    const waiting = connection.next();
    taskEventsOf(w, 1, "searching");
    const envelope = await waiting;
    assert.equal(envelope?.type, "patch");
    assert.equal(connection.pending, 0);
    connection.close();
  });

  it("keeps a consumer that stops asking bounded: N > maxPending publishes leave one reset-required, then nothing", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const connection = await hub.connect({ day: DAY });
    // Take two, then stop asking — exactly what a socket that stopped draining does.
    taskEventsOf(w, 1, "a");
    taskEventsOf(w, 1, "b");
    assert.equal((await connection.next())?.type, "patch");
    assert.equal((await connection.next())?.type, "patch");
    for (let step = 0; step < 50; step += 1) taskEventsOf(w, 1, `node-${String(step)}`);
    assert.equal(connection.pending, 1);
    const reset = await connection.next();
    assert.equal(reset?.type, "reset-required");

    assert.equal(connection.pending, 0);
    const resumed = await hub.connect({ day: DAY });
    assert.deepEqual(resumed.initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    if (resumed.initial[1]?.type !== "snapshot") assert.fail("expected snapshot");
    assert.equal(resumed.initial[1].cursor, w.projection.cursor());
    resumed.close();
    connection.close();
  });

  it("resolves an outstanding next() with undefined when the connection or the hub closes", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    const byConnection = await hub.connect({ day: DAY });
    const byHub = await hub.connect({ day: DAY });
    const first = byConnection.next();
    const second = byHub.next();
    byConnection.close();
    assert.equal(await first, undefined);
    assert.equal(hub.subscriberCount(), 1);
    hub.close();
    assert.equal(await second, undefined);
    assert.equal(hub.subscriberCount(), 0);
    assert.equal(await byHub.next(), undefined, "a closed connection answers undefined forever");
  });

  it("refuses a second concurrent next() instead of racing two consumers over one queue", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    const connection = await hub.connect({ day: DAY });
    const outstanding = connection.next();
    await assert.rejects(connection.next(), /outstanding next\(\)/u);
    connection.close();
    assert.equal(await outstanding, undefined);
  });

  it("builds one snapshot per distinct day for a count-bearing change, however many subscribers share it", async () => {
    const w = await makeWorld({ profileFixture: profileFixtures.create });
    worlds.push(w);
    const builds: string[] = [];
    // A bound Proxy rather than a patched method: the projection keeps private
    // fields, so every call must reach the real instance as its receiver.
    const counting = new Proxy(w.projection, {
      get(target, property, receiver) {
        if (property === "buildDashboardDayWire") {
          return (day: string) => {
            builds.push(day);
            return target.buildDashboardDayWire(day);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const hub = createDashboardStreamHub({ projection: counting, maxPending: 4, backfillGaps: VALIDATING_BACKFILL_GAPS });
    hubs.push(hub);
    queuedEventOf(w, { seed: 1 });
    const sameDayA = await hub.connect({ day: DAY });
    const sameDayB = await hub.connect({ day: DAY });
    builds.length = 0;
    queuedEventOf(w, { seed: 2 }); // count-bearing → snapshot for every subscriber
    assert.deepEqual(builds, [DAY]);
    const [a, b] = await Promise.all([drain(sameDayA), drain(sameDayB)]);
    assert.equal(a[0]?.type, "snapshot");
    assert.equal(a[0], b[0], "the shared day is ONE immutable envelope, not two equal ones");
    sameDayA.close();
    sameDayB.close();
  });
  it("PREMISE: one projection batch stamps its patch and its snapshot with the same cursor, in that order", async () => {

    const { w, hub } = await harness();
    w.writer.emit({
      t: "span.started",
      kind: "worker",
      ts: w.clock.now().toISOString(),
      workflow: "person-lookup",
      workerId: "person-lookup-worker-1",
      spanPath: "worker/person-lookup/person-lookup-worker-1",
      name: "person-lookup",
    });
    queuedEventOf(w, { seed: 1, shape: "operation" });
    queuedEventOf(w, { seed: 2, shape: "operation-member", parentSeed: 1 });
    const connection = await hub.connect({ day: DAY });
    claimEventOf(w, 2);
    const live = await drain(connection);
    assert.deepEqual(live.map(({ type }) => type), ["patch", "snapshot"]);
    const [patch, snapshot] = live;
    if (patch?.type !== "patch" || snapshot?.type !== "snapshot") assert.fail("expected patch then snapshot");
    assert.equal(patch.cursor, snapshot.cursor, "one batch, one cursor");
    connection.close();
  });
});
