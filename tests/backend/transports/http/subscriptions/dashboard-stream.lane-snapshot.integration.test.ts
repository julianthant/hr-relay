import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { failureStatus } from "../../../../../src/backend/transports/http/routes/failure-status.js";
import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import { createNotificationInbox } from "../../../../../src/backend/runs/notifications/inbox.js";
import type { NotificationObservationStatus } from "../../../../../src/backend/runs/notifications/observation.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { queryAssistantUsage } from "../../../../../src/backend/assistant/usage-counts.js";
import { applyDashboardDayPatch } from "../../../../../src/dashboard/client/index.js";
import { notificationSourceEventOf, notificationWireOf, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { DashboardStreamEnvelopeSchema, NotificationPublicationWireSchema, type DashboardStreamEnvelope, type StreamRow } from "../../../../../src/models/dashboard/subscription.js";
import { createComposedDashboardReadHost } from "../../../../../src/backend/app/composition/dashboard/runtime-resources.js";
import { composeSettings } from "../../../../../src/backend/app/composition/dashboard/settings.js";
import { activeSettingsRuntimeIdentity } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/protected-settings.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { seedInitialSettingsRuntimeConfig } from "../../../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { openBoundDatabaseFixture } from "../../../../support/helpers/admission-fixture.js";
import { createCredentialStore } from "../../../../support/helpers/synthetic-storage-admission.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import {
  APP_VERSION,
  claimEventOf,
  DAY,
  DESCRIPTOR_SET_HASH,
  makeWorld,
  queuedEventOf,
  runRecordOf,
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
  readonly signal: AbortSignal | undefined;
  readonly initialSnapshot: boolean;
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
async function laneHarness(options: Readonly<{ maxPending?: number; status?: true }> = {}) {
  const statusReads: PromiseWithResolvers<NotificationObservationStatus>[] = [];
  const statusListeners = new Set<() => void>();
  const timers: { task: () => void; cancelled: boolean }[] = [];
  const w = await makeWorld();
  worlds.push(w);
  const replica = createRunQueueProjection({ ...projectionDeps(w), replica: true });
  const reads: LaneRead[] = [];
  const state = { revision: 1 };
  const lane: DashboardDayLane = {
    processRevision: () => state.revision,
    read(day, request) {
      const reply = Promise.withResolvers<Readonly<{ body: string; processRevision: number }>>();
      reads.push({ day, signal: request.signal, initialSnapshot: request.initialSnapshot === true,
        capture: () => {
          replica.ingestFromTimeline();
          const built = replica.buildLaneDay(day);
          return { body: JSON.stringify(built), processRevision: state.revision };
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
    notificationList: { read: () => w.database.authority.notifications.listByActor("local-operator").map(record => notificationWireOf(record, w.clock.nowMs())),
      onChange: () => () => undefined },
    // With `status`, the observer status answers later: each read waits until the test settles it.
    ...options.status === undefined ? {} : {
      notificationStatus: {
        read: () => { const read = Promise.withResolvers<NotificationObservationStatus>(); statusReads.push(read); return read.promise; },
        onChange: (listener: () => void) => { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; },
      },
      schedule: (_delayMs: number, task: () => void) => { const timer = { task, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    },
  });
  hubs.push(hub);
  /** Folds new timeline records into main, as its ingest loop would. */
  const fold = () => main.ingestFromTimeline();
  /** One distinct publication from its own source. */
  const publish = (identity: string) => inbox.publish(STORAGE_EVENT, { identity: identity.repeat(64), occurredAt: w.clock.now().toISOString() });
  const status = {
    reads: statusReads,
    /** The observer reports a move: the hub reads the row again for every connection. */
    move: () => { for (const listener of [...statusListeners]) listener(); },
    settle: async (read: PromiseWithResolvers<NotificationObservationStatus> | undefined, value: NotificationObservationStatus | "unavailable") => {
      assert.ok(read !== undefined, "the hub asked for the status row");
      if (value === "unavailable") read.reject(new Error("status read failed")); else read.resolve(value);
      await new Promise(resolve => setImmediate(resolve));
    },
    /** The re-reads still armed: a settled read's deadline is cancelled, so these are retries. */
    armed: () => timers.filter(timer => !timer.cancelled),
  };
  return { w, main, hub, reads, state, changes, fold, publish, status };
}

const READY_STATUS: NotificationObservationStatus = { state: "ready", pending: 0 };
const sourcesOf = (envelopes: readonly DashboardStreamEnvelope[]): string[] =>
  envelopes.flatMap(envelope => envelope.type === "notification-publication" ? [envelope.publication.sourceId] : []);
const statusStateOf = (envelope: DashboardStreamEnvelope): string | undefined =>
  envelope.type === "snapshot" || envelope.type === "change" ? envelope.rows.find(row => row.model === "notification-status")?.value.state : undefined;

function lastRead(reads: readonly LaneRead[]): LaneRead {
  const read = reads.at(-1);
  if (read === undefined) assert.fail("the hub asked the lane for no day");
  return read;
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** Answers each read the hub has asked from `from` on, and each it asks in answer, with the replica's day at that moment. */
async function answerAll(reads: readonly LaneRead[], from = 0): Promise<void> {
  for (let index = from; index < reads.length; index++) {
    const read = reads[index];
    if (read === undefined) continue;
    read.answer(read.capture());
    await tick();
  }
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
  it("sends a status patch from the lane's proved day and snapshots a superseding change", async () => {
    const { w, main, hub, reads, fold } = await laneHarness();
    const first = queuedEventOf(w, { seed: 1 });
    const second = queuedEventOf(w, { seed: 2 });
    const third = queuedEventOf(w, { seed: 3 });
    fold();
    const opening = hub.connect({ day: DAY });
    assert.equal(lastRead(reads).initialSnapshot, true);
    await answerAll(reads);
    const connection = await opening;
    const terminalize = (seed: number, runId: string) => {
      w.authority.put(runRecordOf({ seed, version: 2,
        lifecycle: { state: "terminal", outcome: "done", endedAt: w.clock.now().toISOString() } }));
      main.refreshRun(runId);
    };

    terminalize(1, first.runId);
    assert.equal(lastRead(reads).initialSnapshot, false);
    await answerAll(reads, 1);
    const updates = await drain(connection);
    const patch = updates[0];
    assert.ok(patch?.type === "change" && patch.day?.operation === "replace-queue-surface");
    assert.deepEqual(patch.day.counts?.statusCounts, [{ status: "done", count: 1 }, { status: "queued", count: 2 }]);
    assertConverges(main, [...connection.initial, ...updates]);

    terminalize(2, second.runId);
    const held = lastRead(reads);
    const overtaken = held.capture();
    terminalize(3, third.runId);
    held.answer(overtaken);
    await tick();
    await answerAll(reads, 3);
    const superseding = await drain(connection);
    assert.deepEqual(superseding.map(envelope => envelope.type), ["snapshot"]);
    assertConverges(main, superseding);
    connection.close();
  });

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
    read.answer(reply);
    await tick();
    await answerAll(reads, 1);
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    const snapshot = assertConverges(main, envelopes);
    assert.ok(cursorOf(snapshot.cursor) >= dispatched);
  });

  it("asks again when a publication is made while the read is pending, and hands it out in the snapshot alone", async () => {
    const { main, hub, reads, publish } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    const position = main.position();
    await publish("a");
    assert.equal(main.position(), position, "the publication is at the same timeline position");
    await answerAll(reads);
    assert.equal(reads.length, 2, "a day read under the publication may or may not hold it, so it is asked again");
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    assertConverges(main, envelopes);
    assert.deepEqual(sourcesOf(envelopes), [], "the snapshot holds the arrival; it is not handed out live as well");
  });

  it("holds a publication in the snapshot when a later fold moved the baseline past it, live and on a resume from that snapshot", async () => {
    const { w, main, hub, reads, fold, publish } = await laneHarness();
    queuedEventOf(w, { seed: 1 }); fold();
    const connecting = hub.connect({ day: DAY });
    await publish("a");
    const published = cursorOf(main.cursor());
    claimEventOf(w, 1);
    const read = lastRead(reads);
    const reply = read.capture();
    // Main folds the peer write after the publication, so the snapshot is framed above the publication's cursor.
    fold();
    read.answer(reply);
    await tick();
    await answerAll(reads, 1);
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    const snapshot = assertConverges(main, envelopes);
    assert.ok(cursorOf(snapshot.cursor) > published, "the baseline passed the publication");
    assert.deepEqual(sourcesOf(envelopes), [], "the arrival is in the snapshot, never below it on the wire");

    connection.close();
    const resumed = await hub.connect({ day: DAY, lastEventId: snapshot.cursor, lastProjectionGeneration: main.generation() });
    assert.deepEqual(sourcesOf([...resumed.initial, ...await drain(resumed)]), [], "a resume from the snapshot replays nothing the snapshot holds");
  });

  it("hands each publication out once, in publish order, when a fold passes one while the read is pending", async () => {
    const { w, main, hub, reads, fold, publish } = await laneHarness();
    queuedEventOf(w, { seed: 1 }); fold();
    const earlyConnecting = hub.connect({ day: DAY });
    lastRead(reads).answer(lastRead(reads).capture());
    const early = await earlyConnecting;
    const earlySnapshot = [...early.initial, ...await drain(early)].find(envelope => envelope.type === "snapshot");
    assert.ok(earlySnapshot?.type === "snapshot");

    const connecting = hub.connect({ day: DAY });
    const read = lastRead(reads);
    await publish("a");
    claimEventOf(w, 1);
    const reply = read.capture();
    // Main folds the peer write after A, so the baseline passes A; B is published above that baseline before the read answers.
    fold();
    await publish("b");
    read.answer(reply);
    await tick();
    await answerAll(reads, 2);
    const connection = await connecting;
    const order = sourcesOf(await drain(early));
    assert.equal(order.length, 2, "a connection already streaming gets each publication once");
    assert.equal(new Set(order).size, 2);
    const live = [...connection.initial, ...await drain(connection)];
    const snapshot = assertConverges(main, live);
    assert.deepEqual(sourcesOf(live), [], "the snapshot's connection gets both in its snapshot, and neither live");

    early.close();
    connection.close();
    const fromSnapshot = await hub.connect({ day: DAY, lastEventId: snapshot.cursor, lastProjectionGeneration: main.generation() });
    assert.deepEqual(sourcesOf([...fromSnapshot.initial, ...await drain(fromSnapshot)]), [], "a resume from that snapshot replays neither");
    fromSnapshot.close();
    const resumed = await hub.connect({ day: DAY, lastEventId: earlySnapshot.cursor, lastProjectionGeneration: main.generation() });
    assert.deepEqual(sourcesOf([...resumed.initial, ...await drain(resumed)]), order, "a resume from before them replays each once, in order");
  });

  it("holds a publication made under a handoff's read in its snapshot when a projection snapshot change arrives meanwhile", async () => {
    const { w, main, hub, reads, changes, fold, publish } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    await publish("a");
    queuedEventOf(w, { seed: 1 }); queuedEventOf(w, { seed: 2 }); claimEventOf(w, 1); claimEventOf(w, 2); fold();
    assert.ok(changes.some(change => change.kind === "snapshot"), "the fold asks for a new snapshot");
    assert.equal(reads.length, 1, "the handoff keeps its place and its read");
    await answerAll(reads);
    const connection = await connecting;
    const live = [...connection.initial, ...await drain(connection)];
    const snapshot = assertConverges(main, live);
    assert.equal(live.filter(envelope => envelope.type === "snapshot").length, 1);
    assert.deepEqual(sourcesOf(live), [], "the arrival is in the snapshot");

    connection.close();
    const resumed = await hub.connect({ day: DAY, lastEventId: snapshot.cursor, lastProjectionGeneration: main.generation() });
    assert.deepEqual(sourcesOf([...resumed.initial, ...await drain(resumed)]), [], "a resume from the snapshot replays nothing it holds");
  });

  it("re-reads a row whose last handed value was unavailable when that change read was dispatched before the snapshot's", async () => {
    const { hub, reads, status } = await laneHarness({ status: true });
    const connecting = hub.connect({ day: DAY });
    // The status moves while the snapshot is pending: that change's read is dispatched first and queues behind the snapshot's place.
    status.move();
    assert.equal(status.reads.length, 1);
    lastRead(reads).answer(lastRead(reads).capture());
    const connection = await connecting;
    assert.equal(status.reads.length, 2, "the snapshot reads the row again for its own envelope");
    await status.settle(status.reads[1], READY_STATUS);
    await status.settle(status.reads[0], "unavailable");
    const handed = (await drain(connection)).flatMap(envelope => statusStateOf(envelope) ?? []);
    assert.deepEqual(handed, ["available", "unavailable"], "the snapshot's row is handed before the change queued behind it");
    assert.equal(status.armed().length, 1, "the connection last received the row as unavailable, so a re-read is armed");
    connection.close();
  });

  it("serves a retained notification in its independent handoff row without asking the day lane to prove it", async () => {
    const { hub, reads, publish, main } = await laneHarness();
    await publish("b");
    const connecting = hub.connect({ day: DAY });
    const read = lastRead(reads);
    read.answer(read.capture());
    const connection = await connecting;
    assert.equal(reads.length, 1, "the day lane reads only the day");
    const snapshot = assertConverges(main, [...connection.initial, ...await drain(connection)]);
    assert.equal("notifications" in snapshot.payload, false);
    const inbox = snapshot.rows.find(row => row.model === "notification-list");
    assert.ok(inbox?.value.state === "available");
    assert.equal(inbox.value.value.length, 1);
    assert.equal(connection.initial.some(envelope => envelope.type === "notification-publication"), false, "a fresh handoff plays no retained arrival");
    connection.close();
  });

  it("asks again when the process facts moved while the read was pending", async () => {
    const { main, hub, reads, state } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    const first = lastRead(reads);
    const stale = first.capture();
    state.revision += 1;
    first.answer(stale);
    await tick();
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
    const { hub, reads, status } = await laneHarness({ maxPending: 4, status: true });
    const connecting = hub.connect({ day: DAY });
    const read = lastRead(reads);
    // The place and health are two; each status move queues one row change behind them.
    for (let move = 0; move < 3; move++) status.move();
    assert.equal(read.signal?.aborted, true, "the overflowed connection gives up its place");
    read.answer(read.capture());
    const connection = await connecting;
    assert.deepEqual(connection.initial.map(envelope => envelope.type), ["hello"]);
    const reset = await connection.next();
    assert.ok(reset?.type === "reset-required" && reset.reason === "cursor-expired");
  });

  it("keeps a pending handoff read for a projection snapshot change, and answers the place once", async () => {
    const { w, main, hub, reads, changes, fold } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    queuedEventOf(w, { seed: 1 }); queuedEventOf(w, { seed: 2 }); claimEventOf(w, 1); claimEventOf(w, 2); fold();
    assert.ok(changes.some(change => change.kind === "snapshot"), "the fold asks for a new snapshot");
    assert.equal(reads.length, 1, "no second read is asked for a connection already holding a place");
    assert.equal(reads[0]?.signal?.aborted, false, "the pending read is not abandoned");
    await answerAll(reads);
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    assert.equal(envelopes.filter(envelope => envelope.type === "snapshot").length, 1);
    assertConverges(main, envelopes);
  });

  it("refuses a fresh handoff by name when a publication overtakes each of its reads, twice in a row, and frames the day once publications pause", async () => {
    const { main, hub, reads, publish } = await laneHarness();
    const identities = ["1", "2", "3", "4", "5", "6"];
    for (const round of [1, 2]) {
      const refused = assert.rejects(hub.connect({ day: DAY }), (error: unknown) => {
        const { status, body } = failureStatus(error);
        return status === 503 && body.retryable && body.code === "DASHBOARD_SNAPSHOT_OVERTAKEN";
      }, "an exhausted handoff is a retryable 503, which the client answers on its delayed reconnect");
      for (let attempt = 0; attempt < 3; attempt++) {
        await publish(identities.shift() ?? "");
        const read = lastRead(reads);
        read.answer(read.capture());
        await tick();
      }
      await refused;
      assert.equal(reads.length, round * 3, "the handoff asks three times and no more");
      assert.equal(hub.subscriberCount(), 0, "the refused handoff leaves no connection");
    }
    const connecting = hub.connect({ day: DAY });
    await answerAll(reads, 6);
    const envelopes = await connecting.then(async connection => [...connection.initial, ...await drain(connection)]);
    assertConverges(main, envelopes);
    assert.deepEqual(sourcesOf(envelopes), [], "the day holds all six arrivals");
  });

  it("asks again in the same place when a snapshot-only fold overtakes the day the lane read, and hands out only the newer day", async () => {
    const { w, main, hub, reads, changes, fold } = await laneHarness();
    const connecting = hub.connect({ day: DAY });
    const read = lastRead(reads);
    // The lane read its day before the fold: no publication is made and the process facts do not move.
    const stale = read.capture();
    queuedEventOf(w, { seed: 1 }); queuedEventOf(w, { seed: 2 }); claimEventOf(w, 1); claimEventOf(w, 2); fold();
    assert.ok(changes.some(change => change.kind === "snapshot"), "the fold asks for a new snapshot");
    assert.equal(changes.some(change => change.kind === "patch"), false, "and makes no patch that could correct an older day");
    assert.equal(reads.length, 1, "the handoff keeps its place and its read");
    read.answer(stale);
    await tick();
    assert.equal(reads.length, 2, "a day older than the snapshot change is not framed; the same place asks again");
    await answerAll(reads, 1);
    const connection = await connecting;
    const envelopes = [...connection.initial, ...await drain(connection)];
    assert.equal(envelopes.filter(envelope => envelope.type === "snapshot").length, 1, "only the newer day is handed out");
    assertConverges(main, envelopes);
  });

  it("hands a publication to a streaming connection while overlapping handoff reads are still pending", async () => {
    const { main, hub, reads, publish } = await laneHarness();
    const earlyConnecting = hub.connect({ day: DAY });
    await answerAll(reads);
    const early = await earlyConnecting;
    await drain(early);
    const answered = reads.length;

    const first = hub.connect({ day: DAY });
    await publish("a");
    const second = hub.connect({ day: DAY });
    assert.equal(sourcesOf(await drain(early)).length, 1, "the arrival waits for neither pending read");
    await publish("b");
    assert.equal(sourcesOf(await drain(early)).length, 1, "nor does the next one, published under both");

    await answerAll(reads, answered);
    for (const connection of [await first, await second]) {
      const envelopes = [...connection.initial, ...await drain(connection)];
      assert.equal(envelopes.filter(envelope => envelope.type === "snapshot").length, 1, "each overlapping read is answered");
      assertConverges(main, envelopes);
    }
  });

  it("keeps one pending count: a publication made under a connection's place waits nowhere outside it", async () => {
    const { hub, reads, publish, status } = await laneHarness({ maxPending: 4, status: true });
    const connecting = hub.connect({ day: DAY });
    await publish("a");
    status.move();
    status.move();
    assert.equal(lastRead(reads).signal?.aborted, false, "the place, health and two row changes are four");
    await answerAll(reads);
    const connection = await connecting;
    for (const read of [...status.reads]) await status.settle(read, READY_STATUS);
    const envelopes = [...connection.initial, ...await drain(connection)];
    assert.equal(envelopes.some(envelope => envelope.type === "reset-required"), false, "nothing uncounted arrives later to overflow the bound");
    assert.equal(envelopes.filter(envelope => envelope.type === "snapshot").length, 1);
    connection.close();
  });

  it("hands no live copy of a publication to a connection whose snapshot holds it, and replays none to a resume from that snapshot", async () => {
    const { main, hub, reads, publish } = await laneHarness();
    const first = hub.connect({ day: DAY });
    await publish("a");
    // The second connection starts after the publication: its snapshot is read wholly above it.
    const second = hub.connect({ day: DAY });
    await answerAll(reads);
    for (const connection of [await first, await second]) {
      const envelopes = [...connection.initial, ...await drain(connection)];
      const snapshot = assertConverges(main, envelopes);
      assert.deepEqual(sourcesOf(envelopes), [], "the snapshot holds the arrival, so it is not handed out live");
      connection.close();
      const resumed = await hub.connect({ day: DAY, lastEventId: snapshot.cursor, lastProjectionGeneration: main.generation() });
      assert.deepEqual(sourcesOf([...resumed.initial, ...await drain(resumed)]), [], "a resume from that snapshot replays nothing it holds");
      resumed.close();
    }
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

/** The settings row composed as the runtime composes it: the store part read on a real navigation lane, the protected facts on main. */
async function settingsLaneHarness() {
  const world = await makeWorld(); worlds.push(world);
  const clock = manualClock(new Date(NOW));
  const fixture = await openBoundDatabaseFixture("settings-stream-lane", clock);
  seedInitialSettingsRuntimeConfig(fixture.database, clock);
  const lanes = createComposedDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock });
  settingsCleanups.push(async () => { await lanes.close(); await fixture.close(); });
  const faults = { lane: false, protected: false };
  const store = createCredentialStore({ stateRoot: fixture.stateRoot });
  const ticks = new Set<() => void>();
  const { editable, onChange, executor } = composeSettings({ database: fixture.database, clock, environment: {}, hostFacts: { primaryDisplay: null },
    active: activeSettingsRuntimeIdentity, every: (_ms, task) => { ticks.add(task); return () => { ticks.delete(task); }; },
    credentials: { ...store, read: () => { if (faults.protected) throw new Error("protected store unreadable"); return store.read(); } },
    readLanes: { read: (definition, args, options) => faults.lane ? Promise.reject(new Error("lane read failed")) : lanes.read(definition, args, options) } });
  const listeners = new Set<() => void>();
  const timers: { task: () => void; cancelled: boolean }[] = [];
  // The row-read deadline runs only on `fire`; a cold lane's start on a slow runner is not a late read.
  const hub = createDashboardStreamHub({ projection: world.projection, clock: { monotonicMs: () => 0 },
    backfillGaps: { detected: () => { throw new Error("no gap is expected"); } },
    // As the dashboard wires it: ordinary commits through the kernel's source, protected commits and the rollover through Settings'.
    settings: { read: editable, onChange: listener => {
      listeners.add(listener);
      const stop = onChange(listener);
      return () => { listeners.delete(listener); stop(); };
    } },
    schedule: (_delayMs, task) => { const timer = { task, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; } });
  hubs.push(hub);
  return { hub, clock, faults, store, executor, tick: () => { for (const task of [...ticks]) task(); },
    changed: () => { for (const listener of [...listeners]) listener(); },
    fire: () => { for (const timer of timers.splice(0).filter(timer => !timer.cancelled)) timer.task(); } };
}

const settingsCleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of settingsCleanups.splice(0)) await close(); });

type SettingsRowValue = Extract<StreamRow, { model: "settings" }>["value"];
const settingsRowOf = (envelope: DashboardStreamEnvelope | undefined): SettingsRowValue | undefined =>
  envelope?.type === "snapshot" || envelope?.type === "change"
    ? envelope.rows.find((row): row is Extract<StreamRow, { model: "settings" }> => row.model === "settings")?.value : undefined;

/** The next settings row the connection is handed: from what it was already given, else from what it is handed next. */
async function nextSettingsRow(connection: DashboardStreamConnection, given: readonly DashboardStreamEnvelope[] = []): Promise<SettingsRowValue> {
  for (const envelope of given) { const row = settingsRowOf(envelope); if (row !== undefined) return row; }
  for (;;) {
    const envelope = await connection.next();
    assert.ok(envelope !== undefined, "the connection ended before a settings row");
    const row = settingsRowOf(envelope);
    if (row !== undefined) return row;
  }
}

describe("the settings row read on the navigation lane", () => {
  it("hands a cold subscriber the lane-built row, recovers a failed refresh, and rebuilds on a protected-facts change and the fiscal-year rollover", async () => {
    const { hub, clock, faults, store, executor, tick, changed, fire } = await settingsLaneHarness();
    const connection = await hub.connect({ day: DAY });
    const first = await nextSettingsRow(connection, connection.initial);
    assert.ok(first.state === "available", "the first subscriber's handoff waits for the lane's read");
    assert.equal(first.value.protectedSettings.state, "available");
    assert.equal(first.value.currentFiscalYear, 2027);

    faults.lane = true;
    changed();
    assert.equal((await nextSettingsRow(connection)).state, "unavailable", "a failed refresh is sent unavailable");
    faults.lane = false;
    fire();
    const recovered = await nextSettingsRow(connection);
    assert.ok(recovered.state === "available", "the retry recovers the row");

    const rosterUrl = "https://sharepoint.example.test/sites/hr/roster.xlsx";
    assert.equal(executor.commitPrivate(ProtectedSettingsCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: NOW,
      requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-protected-settings",
      target: { expectedRevision: store.read().revision },
      payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { sharepointOnboardingRosterUrl: { set: rosterUrl } } } })), undefined);
    const committed = await nextSettingsRow(connection);
    assert.ok(committed.state === "available" && committed.value.protectedSettings.state === "available");
    assert.equal(committed.value.protectedSettings.entries.sharepointOnboardingRosterUrl?.value, rosterUrl, "a protected commit rebuilds the connected row");

    faults.protected = true;
    changed();
    const unknown = await nextSettingsRow(connection);
    assert.ok(unknown.state === "available");
    assert.equal(unknown.value.protectedSettings.state, "unknown", "a protected-facts change rebuilds the document");
    faults.protected = false;

    tick();
    clock.setWall(new Date("2027-07-01T17:00:00.000Z"));
    tick();
    const rolled = await nextSettingsRow(connection);
    assert.ok(rolled.state === "available");
    assert.equal(rolled.value.currentFiscalYear, 2028, "the fiscal-year rollover rebuilds the document");
    assert.equal(rolled.value.protectedSettings.state, "available");
    connection.close();
  });
});
