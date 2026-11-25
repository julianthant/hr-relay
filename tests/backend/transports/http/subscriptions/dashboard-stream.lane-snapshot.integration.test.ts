import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import {
  createRunQueueProjection,
  decodeLaneDay,
  type DashboardDayLane,
  type RunQueueProjection,
  type RunQueueProjectionChange,
} from "../../../../../src/backend/runs/projections/run-queue-projection.js";
import { createDashboardStreamHub, type DashboardStreamConnection, type DashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { sseSerialize } from "../../../../../src/backend/transports/http/subscriptions/sse-response.js";
import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import { createNotificationInbox } from "../../../../../src/backend/runs/notifications/inbox.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { queryAssistantUsage } from "../../../../../src/backend/assistant/usage-counts.js";
import { applyDashboardDayPatch } from "../../../../../src/dashboard/client/index.js";
import { notificationSourceEventOf, notificationWireOf, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { DashboardStreamEnvelopeSchema, NotificationPublicationWireSchema, type DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import {
  APP_VERSION,
  claimEventOf,
  DAY,
  DESCRIPTOR_SET_HASH,
  makeWorld,
  queuedEventOf,
  taskEventsOf,
  type DashboardWorld,
} from "../../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.close();
  for (const world of worlds.splice(0)) await world.dispose();
});

const STORAGE_TARGET = { kind: "storage" } as const;
const STORAGE_EVENT = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };

interface LaneRead {
  readonly day: string;
  readonly publications: readonly string[];
  readonly signal: AbortSignal | undefined;
  /** The lane's body as its replica builds the day now, at the current process-facts revision. */
  capture(): Readonly<{ body: string; processRevision: number }>;
  answer(reply: Readonly<{ body: string; processRevision: number }>): void;
}

function projectionDeps(w: DashboardWorld) {
  return {
    assistantUsage: (from: string, to: string, generatedAt: string) => queryAssistantUsage(w.database, { from, to, generatedAt }),
    timeline: w.timeline, reader: w.runReader, stateRoot: w.stateRoot, clock: w.clock, appVersion: APP_VERSION,
    descriptorSetHash: DESCRIPTOR_SET_HASH, ledger: createTransactionHistory(w.database.authority), authority: w.authority,
    descriptors: { resolve: () => undefined },
  };
}

/** Main's projection served by a scripted navigation lane: each read waits until the test answers it with its replica's day. */
async function laneHarness(options: Readonly<{ maxPending?: number }> = {}) {
  const w = await makeWorld();
  worlds.push(w);
  const replica = createRunQueueProjection({ ...projectionDeps(w), replica: true });
  const reads: LaneRead[] = [];
  const state = { revision: 1 };
  const lane: DashboardDayLane = {
    processRevision: () => state.revision,
    read(day, request) {
      const reply = Promise.withResolvers<Readonly<{ body: string; processRevision: number }>>();
      reads.push({ day, publications: request.publications, signal: request.signal,
        capture: () => {
          replica.ingestFromTimeline();
          const built = replica.buildLaneDay(day);
          const held = new Set<string>(w.database.authority.notificationPublications.list().map(record => record.sourceId));
          const missing = request.publications.filter(sourceId => !held.has(sourceId));
          return { body: JSON.stringify({ d: built.d, f: { ...built.f, missingPublications: missing } }), processRevision: state.revision };
        },
        answer: answered => reply.resolve(answered) });
      return reply.promise;
    },
  };
  const main = createRunQueueProjection({ ...projectionDeps(w), dayLane: lane });
  main.ingestFromTimeline();
  const changes: RunQueueProjectionChange[] = [];
  main.onChange(change => changes.push(change));
  const inbox = createNotificationInbox({ authority: w.database, clock: w.clock, ids: sequentialIdFactory("f"), runReader: w.runReader, actorId: "local-operator" });
  const hub = createDashboardStreamHub({ projection: main, maxPending: options.maxPending ?? 64,
    backfillGaps: { detected: input => Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) }) },
    notificationPublications: { subscribe: callback => inbox.onPublication(callback), project: publication => {
      const wire = NotificationPublicationWireSchema.parse({ sourceId: publication.sourceId, actorId: publication.notification.actorId, durable: publication.durable,
        notification: notificationWireOf(publication.notification, w.clock.nowMs(), { state: "not-applicable" }, notificationSourceEventOf(publication.notification,
          { actorId: publication.notification.actorId, notificationId: publication.notification.notificationId, event: publication.event, adopted: false })) });
      return { publication: wire, listed: wire.notification };
    }, target: () => STORAGE_TARGET },
  });
  hubs.push(hub);
  /** Folds new timeline records into main, as its ingest loop would. */
  const fold = () => main.ingestFromTimeline();
  /** One distinct publication from its own source. */
  const publish = (identity: string) => inbox.publish(STORAGE_EVENT, { identity: identity.repeat(64), occurredAt: w.clock.now().toISOString() });
  return { w, main, hub, reads, state, changes, fold, publish };
}

function lastRead(reads: readonly LaneRead[]): LaneRead {
  const read = reads.at(-1);
  if (read === undefined) assert.fail("the hub asked the lane for no day");
  return read;
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

const cursorOf = (cursor: string): number => Number(cursor.slice("pc:".length));
/** The day without its stamp, as its JSON reads: a key the builder leaves undefined is not on the wire. */
const unstamped = ({ snapshotCursor: _cursor, projectionGeneration: _generation, ...day }: DashboardDayWire): unknown => JSON.parse(JSON.stringify(day));

/**
 * Applies everything after the snapshot to it and checks it reaches main's own day: no change is missing and none is applied
 * twice. Every cursor after the snapshot is above it and strictly increasing.
 */
function assertConverges(main: RunQueueProjection, envelopes: readonly DashboardStreamEnvelope[]): DashboardStreamEnvelope & { type: "snapshot" } {
  const index = envelopes.findIndex(envelope => envelope.type === "snapshot");
  const snapshot = envelopes[index];
  assert.ok(snapshot?.type === "snapshot", "the handoff carries one snapshot");
  let day = snapshot.payload, previous = cursorOf(snapshot.cursor);
  assert.equal(day.snapshotCursor, snapshot.cursor, "the stamp names the envelope's cursor");
  assert.equal(day.projectionGeneration, main.generation());
  for (const envelope of envelopes.slice(index + 1)) {
    if (!("cursor" in envelope) || envelope.type === "reset-required") continue;
    assert.ok(cursorOf(envelope.cursor) > previous, `cursor ${envelope.cursor} is above ${String(previous)}`);
    previous = cursorOf(envelope.cursor);
    if (envelope.type === "change" && envelope.day !== undefined) day = applyDashboardDayPatch(day, envelope.day);
  }
  assert.deepEqual(unstamped(day), unstamped(main.buildDashboardDayWire(DAY)), "the snapshot plus its replay is main's day");
  return snapshot;
}

describe("a stream snapshot read on the navigation lane", () => {
  it("frames a day built after a peer write at main's fold cursor, and drops the write's patch it already holds", async () => {
    const { w, main, hub, reads, fold } = await laneHarness();
    queuedEventOf(w, { seed: 1 }); fold();
    const connecting = hub.connect({ day: DAY });
    const dispatched = cursorOf(main.cursor());
    claimEventOf(w, 1); fold();
    const read = lastRead(reads);
    const reply = read.capture();
    const position = decodeLaneDay(reply.body).facts.position;
    const fold_ = main.foldCursor(position);
    assert.ok(fold_.state === "at" && fold_.cursor > dispatched, "main folded the peer write above the dispatch cursor");
    read.answer(reply);
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    const snapshot = assertConverges(main, envelopes);
    assert.equal(snapshot.cursor, `pc:${String(fold_.cursor)}`);
    assert.equal(snapshot.position, position);
    assert.equal(envelopes.some(envelope => envelope.type === "change" && envelope.day !== undefined), false, "the held patch is not replayed");
    assert.equal(connection.pending, 0);
  });

  it("replays a peer write the lane's day does not hold above the dispatch cursor", async () => {
    const { w, main, hub, reads, fold } = await laneHarness();
    queuedEventOf(w, { seed: 1 }); fold();
    const connecting = hub.connect({ day: DAY });
    const dispatched = cursorOf(main.cursor());
    const read = lastRead(reads);
    const reply = read.capture();
    claimEventOf(w, 1); fold();
    assert.equal(reads.length, 1, "the write is a patch, not a new snapshot");
    read.answer(reply);
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    const snapshot = assertConverges(main, envelopes);
    assert.equal(snapshot.cursor, `pc:${String(dispatched)}`);
    assert.ok(envelopes.some(envelope => envelope.type === "change" && envelope.day !== undefined), "the write arrives as a patch after the snapshot");
  });

  it("names the cursor before main's batch when its fold skipped the lane's position", async () => {
    const { w, main, hub, reads, fold } = await laneHarness();
    queuedEventOf(w, { seed: 1 }); fold();
    const connecting = hub.connect({ day: DAY });
    const dispatched = cursorOf(main.cursor());
    claimEventOf(w, 1);
    const read = lastRead(reads);
    const reply = read.capture();
    const skipped = decodeLaneDay(reply.body).facts.position;
    taskEventsOf(w, 1, "searching");
    // One batch passes the lane's position without stopping at it.
    fold();
    assert.ok(main.position() > skipped);
    assert.deepEqual(main.foldCursor(skipped), { state: "at", cursor: dispatched }, "a skipped position maps to the cursor before the batch that passed it");
    assert.deepEqual(main.foldCursor(main.position()), { state: "at", cursor: cursorOf(main.cursor()) });
    for (const pending of reads) pending.answer(pending === read ? reply : pending.capture());
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    const snapshot = assertConverges(main, envelopes);
    assert.ok(cursorOf(snapshot.cursor) >= dispatched);
  });

  it("delivers a publication admitted while the read was pending once, after the snapshot", async () => {
    const { main, hub, reads, publish } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    const position = main.position();
    await publish("a");
    assert.equal(main.position(), position, "the publication is at the same timeline position");
    const read = lastRead(reads);
    assert.deepEqual(read.publications, [], "nothing was retained at dispatch");
    const reply = read.capture();
    read.answer(reply);
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    assertConverges(main, envelopes);
    const snapshotAt = envelopes.findIndex(envelope => envelope.type === "snapshot");
    const arrivals = envelopes.flatMap((envelope, index) => envelope.type === "notification-publication" ? [index] : []);
    assert.equal(arrivals.length, 1, "exactly one arrival");
    assert.ok((arrivals[0] ?? -1) > snapshotAt, "the arrival follows the snapshot");
  });

  it("asks again when the lane's snapshot lacks a publication main retained at dispatch", async () => {
    const { hub, reads, publish, main } = await laneHarness();
    await publish("b");
    const connecting = hub.connect({ day: DAY });
    const first = lastRead(reads);
    assert.equal(first.publications.length, 1);
    const reply = first.capture();
    const decoded = JSON.parse(reply.body) as { d: unknown; f: { missingPublications: string[] } };
    first.answer({ ...reply, body: JSON.stringify({ d: decoded.d, f: { ...decoded.f, missingPublications: [...first.publications] } }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads.length, 2, "the read is asked again");
    const second = lastRead(reads);
    second.answer(second.capture());
    const connection = await connecting;
    assertConverges(main, [...connection.initial, ...await drain(connection)]);
    assert.equal(connection.initial.some(envelope => envelope.type === "notification-publication"), false, "a fresh snapshot replays no retained arrival");
  });

  it("asks again when the process facts moved while the read was pending", async () => {
    const { main, hub, reads, state } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    const first = lastRead(reads);
    const stale = first.capture();
    state.revision += 1;
    first.answer(stale);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads.length, 2, "a reply from the old revision is discarded and asked again");
    const second = lastRead(reads);
    second.answer(second.capture());
    const connection = await connecting;
    const snapshot = assertConverges(main, [...connection.initial, ...await drain(connection)]);
    assert.equal(snapshot.cursor, main.cursor());
  });

  it("resets the connection, and frames nothing, when the generation changes while the read is pending", async () => {
    const { main, hub, reads } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    const read = lastRead(reads);
    const stale = read.capture();
    main.rebuildFromTimeline();
    assert.equal(read.signal?.aborted, true, "the abandoned read is aborted");
    read.answer(stale);
    const connection = await connecting;
    const types = connection.initial.map(envelope => envelope.type === "reset-required" ? `${envelope.type}:${envelope.reason}` : envelope.type);
    assert.deepEqual(types, ["hello", "reset-required:generation-changed"]);
    assert.equal(connection.pending, 0);
    assert.equal(reads.length, 1);
  });

  it("bounds the outbox while the read is pending and resets a connection that overflows it", async () => {
    const { hub, reads, publish } = await laneHarness({ maxPending: 4 });
    const connecting = hub.connect({ day: DAY });
    const read = lastRead(reads);
    for (const identity of ["c", "d", "e"]) await publish(identity);
    assert.equal(read.signal?.aborted, true, "the overflowed connection gives up its place");
    read.answer(read.capture());
    const connection = await connecting;
    assert.deepEqual(connection.initial.map(envelope => envelope.type), ["hello"]);
    const reset = await connection.next();
    assert.ok(reset?.type === "reset-required" && reset.reason === "cursor-expired");
  });

  it("re-requests the snapshot for a projection change while a handoff read is pending, and answers the place once", async () => {
    const { w, main, hub, reads, changes, fold } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    queuedEventOf(w, { seed: 1 }); queuedEventOf(w, { seed: 2 }); claimEventOf(w, 1); claimEventOf(w, 2); fold();
    if (changes.some(change => change.kind === "snapshot")) {
      assert.equal(reads.length, 2);
      assert.equal(reads[0]?.signal?.aborted, true, "the newer read answers the place");
    }
    for (const read of reads) read.answer(read.capture());
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    assert.equal(envelopes.filter(envelope => envelope.type === "snapshot").length, 1);
    assertConverges(main, envelopes);
  });
});

describe("the day wire main stamps around the lane's body", () => {
  it("serves GET and the SSE snapshot byte for byte as the day built on the request thread", async () => {
    const w = await makeWorld();
    worlds.push(w);
    queuedEventOf(w, { seed: 1 }); claimEventOf(w, 1);
    const hub = createDashboardStreamHub({ projection: w.projection,
      backfillGaps: { detected: input => Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) }) } });
    hubs.push(hub);
    const connection = await hub.connect({ day: DAY });
    const snapshot = connection.initial.find(envelope => envelope.type === "snapshot");
    assert.ok(snapshot?.type === "snapshot");
    const today = JSON.stringify(w.projection.buildDashboardDayWire(DAY));
    const served = await w.projection.servedDashboardDay(DAY);
    assert.equal(served, today, "GET answers today's day wire");
    const event = sseSerialize(snapshot);
    const data = event.slice(event.indexOf("data: ") + "data: ".length, -2);
    assert.equal(event, `id: ${snapshot.cursor}\ndata: ${JSON.stringify(DashboardStreamEnvelopeSchema.parse(JSON.parse(data)))}\n\n`,
      "the framed envelope is the envelope today's serializer writes");
    assert.ok(data.includes(`"payload":${today},"rows":`), "the snapshot carries the GET body as its payload");
    assert.equal(JSON.stringify(snapshot.payload), today);
  });

  it("refuses a lane body whose leading members are not this day, and never re-serializes it", async () => {
    const { main, hub, reads } = await laneHarness();
    const serving = main.servedDashboardDay(DAY);
    const read = lastRead(reads);
    const reply = read.capture();
    read.answer({ ...reply, body: reply.body.replace(`"day":"${DAY}"`, `"day":"2026-08-04"`) });
    await assert.rejects(serving, /queue-day-lane-body-unverified: head/u);

    const connecting = hub.connect({ day: DAY });
    lastRead(reads).answer({ body: "{\"day\":\"not a lane body\"}", processRevision: 1 });
    await assert.rejects(connecting, /queue-day-lane-body-unverified: frame/u);
    assert.equal(hub.subscriberCount(), 0, "a refused handoff leaves no connection");
  });
});
