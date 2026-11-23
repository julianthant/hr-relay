import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it, vi } from "vitest";
import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import {
  createDashboardStreamHub,
  type DashboardStreamConnection,
  type DashboardStreamHub,
} from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { dashboardEventStreamBody } from "../../../../../src/backend/transports/http/subscriptions/sse-response.js";
import { createDashboardClient, type SubscriptionState } from "../../../../../src/dashboard/client/index.js";
import type { DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import type { DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import {
  claimEventOf,
  DAY,
  makeWorld,
  queuedEventOf,
  taskEventsOf,
  uuidOf,
  type DashboardWorld,
} from "../../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];
const closers: (() => void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const hub of hubs.splice(0)) hub.close();
  for (const w of worlds.splice(0)) await w.dispose();
});

type Gap = ReturnType<typeof BackfillGapObservationSchema.parse>;

async function harness(options: Readonly<{ retention?: number }> = {}): Promise<{ w: DashboardWorld; hub: DashboardStreamHub; gaps: Gap[] }> {
  const w = await makeWorld({ profileFixture: profileFixtures.create });
  worlds.push(w);
  const gaps: Gap[] = [];
  const hub = createDashboardStreamHub({
    projection: w.projection,
    ...(options.retention === undefined ? {} : { retention: options.retention }),
    backfillGaps: {
      detected: (input: unknown) => {
        const gap = BackfillGapObservationSchema.parse(input);
        gaps.push(gap);
        return Promise.resolve({ published: false as const, gap });
      },
    },
  });
  hubs.push(hub);
  return { w, hub, gaps };
}

function cursorNumberOf(cursor: string): number {
  return Number(cursor.slice(3));
}

function cursorOf(envelope: DashboardStreamEnvelope | undefined): string {
  if (envelope === undefined || !("cursor" in envelope)) assert.fail("expected an envelope that names a cursor");
  return envelope.cursor;
}

function changeOf(envelope: DashboardStreamEnvelope | undefined): Extract<DashboardStreamEnvelope, { type: "change" }> {
  if (envelope?.type !== "change") assert.fail(`expected a change, got ${String(envelope?.type)}`);
  return envelope;
}

async function drain(connection: DashboardStreamConnection): Promise<DashboardStreamEnvelope[]> {
  const out: DashboardStreamEnvelope[] = [];
  while (connection.pending > 0) {
    const envelope = await connection.next();
    if (envelope === undefined) break;
    out.push(envelope);
  }
  return out;
}

/** The real client against the real hub: each stream the client opens is one hub connection, served as SSE. */
function openClient(hub: DashboardStreamHub, options: Readonly<{ holdFirstResponse?: Promise<void> }> = {}) {
  const days: DashboardDayWire[] = [];
  const states: SubscriptionState[] = [];
  const requests: { lastEventId: string | undefined; generation: string | undefined }[] = [];
  const connections: DashboardStreamConnection[] = [];
  const client = createDashboardClient({
    baseUrl: "http://fixture.test",
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      const lastEventId = headers.get("last-event-id") ?? undefined;
      const generation = headers.get("dashboard-projection-generation") ?? undefined;
      const first = requests.length === 0;
      requests.push({ lastEventId, generation });
      const connection = await hub.connect({
        day: DAY,
        ...(lastEventId === undefined ? {} : { lastEventId }),
        ...(generation === undefined ? {} : { lastProjectionGeneration: Number(generation) }),
      });
      connections.push(connection);
      init?.signal?.addEventListener("abort", () => connection.close());
      if (first && options.holdFirstResponse !== undefined) await options.holdFirstResponse;
      return new Response(dashboardEventStreamBody(connection), { headers: { "content-type": "text/event-stream" } });
    },
  });
  const subscription = client.subscribeDay({
    day: DAY,
    onDay: (day) => days.push(day),
    onState: (state) => states.push(state),
    reconnectDelayMs: 0,
  });
  closers.push(() => subscription.close());
  return { days, states, requests, connections };
}

function rowOf(day: DashboardDayWire | undefined, seed: number) {
  return day?.queueSurfaces.find((row) => row.runId === uuidOf(seed));
}

describe("dashboard stream change envelope", () => {
  it("gives every emitted envelope its own cursor and chains each change to the one before it", async () => {
    const { w, hub } = await harness();
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", name: "person-lookup",
    });
    queuedEventOf(w, { seed: 1, shape: "operation" });
    queuedEventOf(w, { seed: 2, shape: "operation-member", parentSeed: 1 });
    const connection = await hub.connect({ day: DAY });
    const snapshot = connection.initial[1];
    if (snapshot?.type !== "snapshot") assert.fail("expected the handoff snapshot");
    assert.equal(snapshot.payload.snapshotCursor, snapshot.cursor);
    assert.equal(snapshot.position, w.projection.position());

    claimEventOf(w, 2); // one projection batch: a row change and a whole-day snapshot
    const live = await drain(connection);
    assert.deepEqual(live.map(({ type }) => type), ["change", "snapshot"]);
    const change = changeOf(live[0]);
    assert.equal(change.after, snapshot.cursor);
    assert.equal(cursorNumberOf(change.cursor), cursorNumberOf(snapshot.cursor) + 1);
    assert.equal(cursorNumberOf(cursorOf(live[1])), cursorNumberOf(change.cursor) + 1);
    assert.equal(change.position, w.projection.position());

    taskEventsOf(w, 2, "searching");
    const [next] = await drain(connection);
    assert.equal(changeOf(next).after, cursorOf(live[1]), "a change follows the snapshot handed before it");
    connection.close();
  });

  it("applies the change after folded activity that moved no row, with no reconnect", async () => {
    const { w, hub } = await harness();
    const queued = queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const client = openClient(hub);
    await vi.waitFor(() => assert.equal(client.days.length, 1));
    const held = client.days[0]?.snapshotCursor;

    // A queued span of a run the store does not hold folds into the projection and serves no row.
    w.projection.apply({ ...queued, runId: uuidOf(99), itemId: uuidOf(5099), traceId: "pl-100000-9999", spanPath: "pl-100000-9999" });
    assert.notEqual(w.projection.runFold(uuidOf(99)), undefined, "the span was folded");
    assert.equal(client.connections[0]?.pending, 0, "the fold emitted no envelope");
    assert.equal(w.projection.health().state, "live");
    taskEventsOf(w, 1, "searching");

    await vi.waitFor(() => assert.equal(client.days.length, 2));
    assert.equal(client.requests.length, 1, "the client kept its one stream");
    assert.equal(w.projection.cursor(), `pc:${String(cursorNumberOf(held ?? "") + 1)}`, "activity that emits no envelope takes no cursor");
    assert.deepEqual(rowOf(client.days[1], 1), JSON.parse(JSON.stringify(rowOf(w.projection.buildDashboardDayWire(DAY), 1))));
  });

  it("resumes at a cursor below another connection's private handoff with an empty replay and no gap notice", async () => {
    const { w, hub, gaps } = await harness();
    queuedEventOf(w, { seed: 1 });
    const first = await hub.connect({ day: DAY });
    const held = cursorOf(first.initial[1]);
    first.close();
    const other = await hub.connect({ day: DAY });
    assert.equal(cursorNumberOf(cursorOf(other.initial[1])), cursorNumberOf(held) + 1, "the other connection's handoff took the next cursor");

    const resumed = await hub.connect({ day: DAY, lastEventId: held, lastProjectionGeneration: w.projection.generation() });
    assert.deepEqual(resumed.initial.map(({ type }) => type), ["hello", "change", "health"]);
    const handoff = changeOf(resumed.initial[1]);
    assert.equal(handoff.day, undefined);
    assert.equal(handoff.after, held);
    assert.equal(cursorNumberOf(handoff.cursor), cursorNumberOf(held) + 2);
    assert.deepEqual(gaps, []);
    other.close();
    resumed.close();
  });

  it("replays a shared change retained above a private handoff cursor", async () => {
    const { w, hub, gaps } = await harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const first = await hub.connect({ day: DAY });
    const held = cursorOf(first.initial[1]);
    first.close();
    taskEventsOf(w, 1, "searching"); // count-neutral: one retained shared change

    const resumed = await hub.connect({ day: DAY, lastEventId: held, lastProjectionGeneration: w.projection.generation() });
    assert.deepEqual(resumed.initial.map(({ type }) => type), ["hello", "change", "change", "health"]);
    const replayed = changeOf(resumed.initial[1]);
    const handoff = changeOf(resumed.initial[2]);
    assert.equal(replayed.day?.target.runId, uuidOf(1));
    assert.equal(replayed.after, held);
    assert.equal(handoff.after, replayed.cursor);
    assert.equal(handoff.day, undefined);
    assert.deepEqual(gaps, []);
    resumed.close();
  });

  it("answers a cursor below the eviction watermark with a snapshot and the cursor-expired gap notice", async () => {
    const { w, hub, gaps } = await harness({ retention: 3 });
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const first = await hub.connect({ day: DAY });
    const held = cursorOf(first.initial[1]);
    first.close();
    for (const node of ["a", "b", "c", "d"]) taskEventsOf(w, 1, node); // four shared changes; the first is evicted
    const generation = w.projection.generation();

    // The cursor of the evicted change is still covered: everything above it is retained.
    const covered = await hub.connect({ day: DAY, lastEventId: `pc:${String(cursorNumberOf(held) + 1)}`, lastProjectionGeneration: generation });
    assert.deepEqual(covered.initial.map(({ type }) => type), ["hello", "change", "change", "change", "change", "health"]);
    assert.deepEqual(gaps, []);
    covered.close();

    const expired = await hub.connect({ day: DAY, lastEventId: held, lastProjectionGeneration: generation });
    assert.deepEqual(expired.initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert.deepEqual(gaps.map(({ reason, requestedCursor }) => ({ reason, requestedCursor })), [{ reason: "cursor-expired", requestedCursor: held }]);
    expired.close();
  });

  it("starts a new eviction watermark with each projection generation", async () => {
    const { w, hub, gaps } = await harness({ retention: 1 });
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    for (const node of ["a", "b"]) taskEventsOf(w, 1, node);
    w.projection.rebuildFromTimeline();
    const first = await hub.connect({ day: DAY });
    const held = cursorOf(first.initial[1]);
    first.close();

    const resumed = await hub.connect({ day: DAY, lastEventId: held, lastProjectionGeneration: w.projection.generation() });
    assert.deepEqual(resumed.initial.map(({ type }) => type), ["hello", "change", "health"]);
    assert.deepEqual(gaps, []);
    resumed.close();
  });

  it("freezes the snapshot's day at its cursor, then applies the changes behind it in order on one connection", async () => {
    const { w, hub } = await harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    let release: () => void = () => undefined;
    const client = openClient(hub, { holdFirstResponse: new Promise<void>((resolve) => { release = resolve; }) });
    await vi.waitFor(() => assert.equal(client.connections.length, 1));
    const before = rowOf(w.projection.buildDashboardDayWire(DAY), 1);

    // While the handoff is undelivered: the run's row is replaced, then the run leaves the day.
    taskEventsOf(w, 1, "searching");
    const replaced = rowOf(w.projection.buildDashboardDayWire(DAY), 1);
    w.authority.records.delete(uuidOf(1));
    w.projection.refreshRun(uuidOf(1));
    release();

    await vi.waitFor(() => assert.equal(client.days.length, 3));
    assert.deepEqual(rowOf(client.days[0], 1), JSON.parse(JSON.stringify(before)), "the snapshot holds the day as it was at its cursor");
    assert.deepEqual(rowOf(client.days[1], 1), JSON.parse(JSON.stringify(replaced)));
    assert.equal(rowOf(client.days[2], 1), undefined);
    assert.equal(client.requests.length, 1, "the client converged on its first connection");
  });

  it("replays what a dropped client missed exactly once and carries on live", async () => {
    const { w, hub, gaps } = await harness();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const client = openClient(hub);
    await vi.waitFor(() => assert.equal(client.days.length, 1));
    const served = (): unknown => JSON.parse(JSON.stringify(rowOf(w.projection.buildDashboardDayWire(DAY), 1)));
    taskEventsOf(w, 1, "a");
    const afterA = served();
    await vi.waitFor(() => assert.equal(client.days.length, 2));

    // The server side goes away; a change is published while nobody is connected.
    client.connections[0]?.close();
    taskEventsOf(w, 1, "b");
    const afterB = served();
    await vi.waitFor(() => assert.equal(client.requests.length, 2));
    await vi.waitFor(() => assert.equal(client.days.length, 3));
    taskEventsOf(w, 1, "c");
    const afterC = served();
    await vi.waitFor(() => assert.equal(client.days.length, 4));

    assert.equal(client.requests[1]?.generation, String(w.projection.generation()));
    assert.equal(cursorNumberOf(client.requests[1]?.lastEventId ?? ""), cursorNumberOf(client.days[0]?.snapshotCursor ?? "") + 1);
    assert.equal(client.requests.length, 2, "one resume, no snapshot reconnect");
    assert.deepEqual(gaps, []);
    assert.notDeepEqual(afterA, afterB);
    assert.notDeepEqual(afterB, afterC);
    assert.deepEqual(client.days.slice(1).map((day) => rowOf(day, 1)), [afterA, afterB, afterC], "each change was applied once, in order");
  });
});
