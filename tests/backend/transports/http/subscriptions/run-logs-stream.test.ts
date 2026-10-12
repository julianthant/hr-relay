import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { RunLogTail } from "../../../../../src/backend/logs/run-log-stream.js";
import type { RunQueueProjection,RunQueueProjectionChange } from "../../../../../src/backend/runs/projections/run-queue-projection.js";
import type { TimelineCursor } from "../../../../../src/backend/storage/events/timeline-reader.js";
import { RunLogsStreamHub } from "../../../../../src/backend/transports/http/subscriptions/run-logs-stream.js";
import { compositeEventStreamBody } from "../../../../../src/backend/transports/http/subscriptions/sse-response.js";
import { CompositeCursorSchema,emptyRunLogsMergeState,mergeRunLogs } from "../../../../../src/models/dashboard/run-logs-subscription.js";
import { ConfirmedActionEventSchema,confirmedStepOccurrence,type ConfirmedActionEvent } from "../../../../../src/models/events/confirmed-action.js";
import type { RunRecord } from "../../../../../src/models/run/record.js";
import { PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GENERATION = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);
const AT = "2026-10-02T12:00:00.000Z";

function event(stream: string, sequence: number, runId = RUN, attempt = 1): ConfirmedActionEvent {
  const action = {
    runId, definitionFingerprint: HASH, nodeId: "first", taskId: "ucpath/read-write-fixture",
    attempt, claimGeneration: 1, taskAttempt: 1, invocationId: "first-operation",
    occurrencePath: ["first"], logicalActionId: "read-field", occurrence: sequence,
    logicalSessionId: "local-session", state: "started" as const,
  };
  return ConfirmedActionEventSchema.parse({ version: 1, kind: "trace", state: "started",
    eventId: `${stream}/${String(sequence)}`, workerId: "fixture-worker-1", workerStreamId: stream,
    sequence, traceId: "fpo-120000-0002", stepOccurrence: confirmedStepOccurrence(action),
    action, source: { kind: "headless", system: "service" }, occurredAt: AT, recordedAt: AT });
}

function tailResult(events: readonly ConfirmedActionEvent[] = [], hasMore = false): RunLogTail {
  return { events, cursors: new Map(), pruned: false, parsedLines: events.length, bytesRead: 0, hasMore };
}

function harness(maxPending = 64, retention = 512) {
  const batches: ConfirmedActionEvent[][] = [];
  const tailResponses: Array<RunLogTail | Error> = [];
  let snapshotHook: (() => void) | undefined;
  const listeners: Array<(change: RunQueueProjectionChange) => void> = [];
  const projection = {
    onChange(listener: (change: RunQueueProjectionChange) => void) { listeners.push(listener); return () => {}; },
    cursor: () => "pc:1", generation: () => 1,
    buildDashboardDayWire(day: string) { return { day, descriptorHash: HASH, projectionGeneration: 1,
      snapshotCursor: "pc:1", monthCounts: [], workflowCounts: [], statusCounts: [],
      queueSurfaces: [], workerCards: [], workerPools: [], notifications: [] }; },
  } as unknown as RunQueueProjection;
  let authority = { envelope: { runId: RUN, traceId: "fpo-120000-0002",
    contractFingerprint: HASH, attempt: 1 } } as RunRecord;
  const otherAuthority = { envelope: { runId: OTHER, traceId: "fpo-120000-0002",
    contractFingerprint: HASH, attempt: 1 } } as RunRecord;
  let runReader = (runId: string) => runId === RUN ? { disposition: "live" as const, run: authority }
    : runId === OTHER ? { disposition: "live" as const, run: otherAuthority } : undefined;
  let tailCalls = 0;
  const hub = new RunLogsStreamHub({ projection, maxPending, retention, generation: () => GENERATION,
    readRun: runId => runReader(runId),
    store: {
      tail(cursors): RunLogTail {
        tailCalls += 1;
        const response = tailResponses.shift();
        if (response instanceof Error) throw response;
        return response ?? { events: batches.shift() ?? [], cursors,
          pruned: false, parsedLines: 1, bytesRead: 0, hasMore: false };
      },
      snapshot: () => { snapshotHook?.(); return { events: [], hasEarlier: false, parsedLines: 2 }; },
    } });
  return { hub, batches, tailResponses, listeners, tailCalls: () => tailCalls,
    onSnapshot: (hook?: () => void) => { snapshotHook = hook; },
    setAttempt: (attempt: number) => { authority = { ...authority, envelope: { ...authority.envelope,
      attempt: PositiveIntSchema.parse(attempt) } }; },
    setRunReader: (reader: typeof runReader) => { runReader = reader; } };
}

describe("confirmed run log composite stream", () => {
  it("assigns unique global cursors to interleaved worker events and resumes the exact selection", async () => {
    const h = harness();
    const first = h.hub.connect({ runId: RUN });
    h.batches.push([event("stream-a", 1), event("stream-b", 1), event("stream-a", 2)]);
    h.hub.poll();
    const deltas = await Promise.all([first.next(), first.next(), first.next()]);
    assert.deepEqual(deltas.map(item => item?.source === "run-logs" ? item.event?.eventId : undefined),
      ["stream-a/1", "stream-b/1", "stream-a/2"]);
    const ids = deltas.map(item => item?.transportCursor);
    assert.equal(new Set(ids).size, 3);
    const replay = h.hub.connect({ runId: RUN, lastEventId: ids[0] });
    assert.deepEqual(replay.initial.filter(item => item.source === "run-logs" && item.type === "delta")
      .map(item => item.source === "run-logs" ? item.event?.eventId : undefined), ["stream-b/1", "stream-a/2"]);
    first.close(); replay.close(); h.hub.close();
  });

  it("binds the topic set in the cursor and isolates overflow to one subscriber", async () => {
    const h = harness(1);
    const slow = h.hub.connect({ runId: RUN });
    const fast = h.hub.connect({ runId: RUN });
    const oldCursor = slow.initial[0].transportCursor;
    const firstDemand = fast.next();
    h.batches.push([event("stream-a", 1)]);
    h.hub.poll();
    const first = await firstDemand;
    assert.ok(first?.source === "run-logs" && first.type === "delta");
    assert.ok(first.event);
    assert.equal(first.event.eventId, "stream-a/1");
    const secondDemand = fast.next();
    h.batches.push([event("stream-b", 1)]);
    h.hub.poll();
    const second = await secondDemand;
    assert.ok(second?.source === "run-logs" && second.type === "delta");
    assert.ok(second.event);
    assert.equal(second.event.eventId, "stream-b/1");
    const reset = await slow.next();
    assert.equal(reset?.source, "control");
    assert.equal(reset?.source === "control" ? reset.reason : undefined, "overflow");
    assert.equal(await slow.next(), undefined);
    const changed = h.hub.connect({ runId: RUN, day: "2026-10-02", lastEventId: oldCursor });
    assert.equal(changed.initial[1]?.source, "control");
    assert.equal(changed.initial[1]?.source === "control" ? changed.initial[1].reason : undefined, "topic-changed");
    changed.close(); fast.close(); h.hub.close();
  });

  it("resets an expired cursor in the same generation and topic with a fresh snapshot", () => {
    const h = harness(64, 1);
    const original = h.hub.connect({ runId: RUN });
    const cursor = original.initial[0].transportCursor;
    h.batches.push([event("stream-a", 1), event("stream-a", 2)]);
    h.hub.poll();
    const resumed = h.hub.connect({ runId: RUN, lastEventId: cursor });
    const reset = resumed.initial.find(item => item.source === "control" && item.type === "reset-required");
    assert.ok(reset?.source === "control" && reset.type === "reset-required");
    assert.equal(reset.reason, "cursor-expired");
    const snapshot = resumed.initial.find(item => item.source === "run-logs" && item.type === "snapshot");
    assert.ok(snapshot?.source === "run-logs" && snapshot.type === "snapshot");
    assert.equal(snapshot.runId, RUN);
    resumed.close(); original.close(); h.hub.close();
  });

  it("does not advance initial health past a delta queued during snapshot capture", () => {
    const h = harness();
    h.onSnapshot(() => { h.batches.push([event("stream-a", 1)]); h.hub.poll(); });
    const first = h.hub.connect({ runId: RUN });
    const handed = first.initial.at(-1)?.transportCursor;
    assert.equal(handed?.endsWith(":0"), true);
    first.close();
    h.onSnapshot();
    const resumed = h.hub.connect({ runId: RUN, lastEventId: handed });
    assert.deepEqual(resumed.initial.filter(item => item.source === "run-logs" && item.type === "delta")
      .map(item => item.source === "run-logs" ? item.event?.eventId : undefined), ["stream-a/1"]);
    resumed.close(); h.hub.close();
  });

  it("uses initial health for catch-up state and keeps its cursor before queued deltas", async () => {
    const h = harness();
    h.tailResponses.push(tailResult(), tailResult([event("stream-a", 1)], true));
    const connection = h.hub.connect({ runId: RUN });
    const health = connection.initial.find(item => item.source === "control" && item.type === "health");
    assert.ok(health?.source === "control" && health.type === "health");
    assert.equal(health.state, "recovering");
    assert.equal(health.transportCursor.endsWith(":0"), true);
    assert.equal(connection.pending, 1);

    const delta = await connection.next();
    assert.ok(delta?.source === "run-logs" && delta.type === "delta");
    assert.ok(delta.event);
    assert.equal(delta.event.eventId, "stream-a/1");
    assert.equal(delta.transportCursor.endsWith(":1"), true);
    assert.equal(connection.pending, 0);
    connection.close(); h.hub.close();
  });

  it("withholds an SSE resume id until every initial topic baseline is handed out", async () => {
    const h = harness();
    const connection = h.hub.connect({ day: "2026-10-02", runId: RUN });
    const reader = compositeEventStreamBody(connection).getReader();
    const decoder = new TextDecoder();
    const hello = decoder.decode((await reader.read()).value);
    const day = decoder.decode((await reader.read()).value);
    assert.equal(hello.startsWith("id: "), false);
    assert.equal(day.startsWith("id: "), false);
    await reader.cancel();
    const fresh = h.hub.connect({ day: "2026-10-02", runId: RUN });
    assert.equal(fresh.initial.some(item => item.source === "run-logs" && item.type === "snapshot"), true);
    fresh.close(); h.hub.close();
  });

  it("does not turn a generation reset into a resumable SSE checkpoint", async () => {
    const h = harness();
    const connection = h.hub.connect({ runId: RUN });
    const reader = compositeEventStreamBody(connection).getReader();
    const decoder = new TextDecoder();
    await reader.read();
    await reader.read();
    const health = decoder.decode((await reader.read()).value);
    const oldId = health.match(/^id: ([^\n]+)/u)?.[1];
    assert.ok(oldId);
    const resetRead = reader.read();
    for (const listener of h.listeners) listener({ kind: "generation", cursor: "pc:2" });
    const reset = decoder.decode((await resetRead).value);
    assert.equal(reset.startsWith("id: "), false);
    assert.equal(reset.includes('"type":"reset-required"'), true);
    await reader.cancel();
    const fresh = h.hub.connect({ runId: RUN, lastEventId: oldId });
    assert.equal(fresh.initial.some(item => item.source === "run-logs" && item.type === "snapshot"), true);
    fresh.close(); h.hub.close();
  });

  it("refuses foreign ownership, resolves shutdown demand and bounds merge history", async () => {
    const h = harness();
    const subscriber = h.hub.connect({ runId: RUN });
    h.batches.push([event("stream-a", 1, OTHER)]);
    h.hub.poll();
    assert.equal(h.hub.stats().degraded, false);
    const pending = subscriber.next();
    h.hub.close();
    assert.equal(await pending, undefined);
    let state = emptyRunLogsMergeState(RUN);
    for (let sequence = 1; sequence <= 205; sequence++) {
      state = mergeRunLogs(state, { type: "delta", runId: RUN, event: event("stream-a", sequence) });
    }
    assert.equal(state.events.length, 200);
    assert.equal(state.hasEarlier, true);
    assert.equal(mergeRunLogs(state, { type: "delta", runId: RUN, event: event("stream-a", 205) }).events.length, 200);
    assert.throws(() => mergeRunLogs(state, { type: "delta", runId: OTHER, event: event("stream-a", 1, OTHER) }), /selection-mismatch/u);
    assert.equal(CompositeCursorSchema.safeParse(`mc:${GENERATION}:${HASH}:9007199254740992`).success, false);
  });

  it("admits a new attempt of the same run and keeps one subscriber failure from hiding peer delivery", async () => {
    const h = harness();
    const earlier = h.hub.connect({ runId: RUN });
    h.setAttempt(2);
    const later = h.hub.connect({ runId: RUN });
    h.batches.push([event("stream-requeue", 1, RUN, 2)]);
    h.hub.poll();
    assert.equal((await earlier.next())?.source, "run-logs");
    assert.equal((await later.next())?.source, "run-logs");
    assert.equal(h.hub.stats().degraded, false);
    earlier.close(); later.close(); h.hub.close();

    const isolated = harness();
    const stale = isolated.hub.connect({ runId: RUN });
    const fresh = isolated.hub.connect({ runId: RUN });
    let reads = 0;
    isolated.setRunReader(runId => runId === RUN ? { disposition: "live", run: {
      envelope: { runId: RUN, traceId: "fpo-120000-0002", contractFingerprint: HASH,
        attempt: ++reads === 1 ? 1 : 2 } } as RunRecord } : undefined);
    isolated.batches.push([event("stream-requeue", 1, RUN, 2)]);
    isolated.hub.poll();
    assert.equal(isolated.hub.stats().lastError, undefined);
    assert.deepEqual(isolated.hub.stats().subscriberError,
      { runId: RUN, error: "run-log-live-owner-mismatch" });
    assert.equal((await stale.next())?.source, "control");
    assert.equal((await fresh.next())?.source, "run-logs");
    isolated.hub.poll();
    assert.equal(isolated.hub.stats().ordinal, 1);
    stale.close(); fresh.close(); isolated.hub.close();
  });

  it("isolates authority read failures from healthy peers and later connections", async () => {
    const h = harness();
    const stalled = h.hub.connect({ runId: RUN });
    const peer = h.hub.connect({ runId: OTHER });
    const otherAuthority = { envelope: { runId: OTHER, traceId: "fpo-120000-0002",
      contractFingerprint: HASH, attempt: 1 } } as RunRecord;
    h.setRunReader(runId => {
      if (runId === RUN) throw new Error("run-a-authority-read-failed");
      return runId === OTHER ? { disposition: "live", run: otherAuthority } : undefined;
    });
    h.tailResponses.push(tailResult([event("stream-b", 1, OTHER)]));
    const peerDemand = peer.next();
    h.hub.poll();

    const delivered = await peerDemand;
    assert.ok(delivered?.source === "run-logs" && delivered.type === "delta");
    assert.ok(delivered.event);
    assert.equal(delivered.event.eventId, "stream-b/1");
    assert.equal(h.hub.stats().degraded, false);
    assert.equal(h.hub.stats().lastError, undefined);
    assert.deepEqual(h.hub.stats().subscriberError,
      { runId: RUN, error: "run-a-authority-read-failed" });
    assert.equal(stalled.pending, 1);

    const newPeer = h.hub.connect({ runId: OTHER });
    assert.equal(newPeer.initial.some(item => item.source === "run-logs" && item.type === "snapshot"), true);
    const reset = await stalled.next();
    assert.ok(reset?.source === "control" && reset.type === "reset-required");
    assert.equal(reset.reason, "generation-changed");
    assert.equal(await stalled.next(), undefined);
    assert.equal(h.hub.stats().subscriberError, undefined);
    newPeer.close(); peer.close(); h.hub.close();
  });

  it("publishes degraded-to-live health changes without flooding unchanged state", async () => {
    const h = harness();
    const connection = h.hub.connect({ runId: RUN });
    const initialHealth = connection.initial.find(item => item.source === "control" && item.type === "health");
    assert.ok(initialHealth?.source === "control" && initialHealth.type === "health");

    h.tailResponses.push(new Error("tail-read-failed"));
    h.hub.poll();
    const degraded = await connection.next();
    assert.ok(degraded?.source === "control" && degraded.type === "health");
    assert.equal(degraded.state, "degraded");
    assert.equal(degraded.transportCursor, initialHealth.transportCursor);

    h.tailResponses.push(tailResult());
    h.hub.poll();
    const live = await connection.next();
    assert.ok(live?.source === "control" && live.type === "health");
    assert.equal(live.state, "live");
    assert.equal(live.transportCursor, degraded.transportCursor);
    assert.equal(h.hub.stats().degraded, false);

    for (let index = 0; index < 3; index++) {
      h.tailResponses.push(tailResult());
      h.hub.poll();
      assert.equal(connection.pending, 0);
    }
    connection.close(); h.hub.close();
  });

  it("publishes recovering-to-live after queued deltas at a monotonic health watermark", async () => {
    const h = harness();
    const connection = h.hub.connect({ runId: RUN });
    const initialHealth = connection.initial.find(item => item.source === "control" && item.type === "health");
    assert.ok(initialHealth?.source === "control" && initialHealth.type === "health");
    assert.equal(initialHealth.transportCursor.endsWith(":0"), true);
    h.tailResponses.push(tailResult([event("stream-a", 1)], true));
    h.hub.poll();
    assert.equal(h.hub.stats().recovering, true);
    assert.equal(connection.pending, 2);

    const delta = await connection.next();
    assert.ok(delta?.source === "run-logs" && delta.type === "delta");
    assert.ok(delta.event);
    assert.equal(delta.event.eventId, "stream-a/1");
    assert.equal(delta.transportCursor.endsWith(":1"), true);
    const recovering = await connection.next();
    assert.ok(recovering?.source === "control" && recovering.type === "health");
    assert.equal(recovering.state, "recovering");
    assert.equal(recovering.transportCursor, delta.transportCursor);

    h.tailResponses.push(tailResult());
    h.hub.poll();
    const live = await connection.next();
    assert.ok(live?.source === "control" && live.type === "health");
    assert.equal(live.state, "live");
    assert.equal(live.transportCursor, recovering.transportCursor);
    assert.equal(h.hub.stats().recovering, false);
    connection.close(); h.hub.close();
  });

  it("uses one authority-scoped snapshot, bounded tail batches and no idle parse or dispatch", async () => {
    const listeners: Array<(change: RunQueueProjectionChange) => void> = [];
    const projection = {
      onChange(listener: (change: RunQueueProjectionChange) => void) { listeners.push(listener); return () => {}; },
      cursor: () => "pc:1", generation: () => 1,
      buildDashboardDayWire: () => { throw new Error("unexpected-dashboard-day-snapshot"); },
    } as unknown as RunQueueProjection;
    const authority = { envelope: { runId: RUN, traceId: "fpo-120000-0002",
      contractFingerprint: HASH, attempt: 1 } } as RunRecord;
    const firstCursor = new Map<string, TimelineCursor>([
      ["timeline", { bytesConsumed: 64, linesConsumed: 2 }],
    ]);
    const secondCursor = new Map<string, TimelineCursor>([
      ["timeline", { bytesConsumed: 96, linesConsumed: 3 }],
    ]);
    const emptyCursor = new Map<string, TimelineCursor>();
    const tails: RunLogTail[] = [
      { events: [], cursors: emptyCursor, pruned: false, parsedLines: 0, bytesRead: 0, hasMore: false },
      { events: [], cursors: emptyCursor, pruned: false, parsedLines: 0, bytesRead: 0, hasMore: false },
      { events: [event("stream-a", 1), event("stream-b", 1)], cursors: firstCursor,
        pruned: false, parsedLines: 2, bytesRead: 64, hasMore: true },
      { events: [event("stream-a", 2)], cursors: secondCursor,
        pruned: false, parsedLines: 1, bytesRead: 32, hasMore: false },
      { events: [], cursors: secondCursor, pruned: false, parsedLines: 0, bytesRead: 0, hasMore: false },
    ];
    const tailInputs: ReadonlyMap<string, TimelineCursor>[] = [];
    const snapshots: RunRecord[] = [];
    let tailCalls = 0;
    let authorityReads = 0;
    let dispatched = 0;
    const hub = new RunLogsStreamHub({ projection, generation: () => GENERATION,
      readRun: runId => {
        authorityReads += 1;
        return runId === RUN ? { disposition: "live", run: authority } : undefined;
      },
      store: {
        tail(cursors) {
          tailInputs.push(cursors);
          const batch = tails[tailCalls];
          if (batch === undefined) throw new Error("unexpected-run-log-tail-call");
          tailCalls += 1;
          return batch;
        },
        snapshot(run) {
          snapshots.push(run);
          return { events: [], hasEarlier: false, parsedLines: 5 };
        },
      } });

    const connection = hub.connect({ runId: RUN });
    assert.equal(connection.initial.filter(item => item.source === "run-logs" && item.type === "snapshot").length, 1);
    assert.deepEqual(snapshots, [authority]);
    assert.equal(tailCalls, 2);
    assert.equal(authorityReads, 2);
    assert.deepEqual([hub.stats().parsedLines, hub.stats().bytesRead, hub.stats().ordinal], [5, 0, 0]);

    hub.poll();
    assert.deepEqual([tailCalls, authorityReads], [3, 3]);
    assert.equal(tailInputs[2]?.size, 0);
    assert.equal(hub.stats().recovering, true);
    const firstBatch = await Promise.all([connection.next(), connection.next()]);
    assert.deepEqual(firstBatch.map(item => item !== undefined && item.source === "run-logs" && item.type === "delta"
      && item.event !== undefined
      ? item.event.eventId : undefined),
      ["stream-a/1", "stream-b/1"]);
    dispatched += firstBatch.filter(item => item !== undefined && item.source === "run-logs" && item.type === "delta").length;
    assert.deepEqual([hub.stats().parsedLines, hub.stats().bytesRead, hub.stats().ordinal], [7, 64, 2]);
    const recovering = await connection.next();
    assert.ok(recovering?.source === "control" && recovering.type === "health");
    assert.equal(recovering.state, "recovering");

    hub.poll();
    assert.deepEqual([tailCalls, authorityReads], [4, 4]);
    assert.equal(tailInputs[3], firstCursor);
    assert.equal(hub.stats().recovering, false);
    const secondBatch = await connection.next();
    assert.ok(secondBatch !== undefined && secondBatch.source === "run-logs" && secondBatch.type === "delta");
    assert.ok(secondBatch.event);
    assert.equal(secondBatch.event.eventId, "stream-a/2");
    dispatched += 1;
    const live = await connection.next();
    assert.ok(live?.source === "control" && live.type === "health");
    assert.equal(live.state, "live");
    assert.deepEqual([hub.stats().parsedLines, hub.stats().bytesRead, hub.stats().ordinal], [8, 96, 3]);

    hub.poll();
    assert.deepEqual([tailCalls, authorityReads], [5, 5]);
    assert.equal(tailInputs[4], secondCursor);
    assert.deepEqual([hub.stats().parsedLines, hub.stats().bytesRead, hub.stats().ordinal], [8, 96, 3]);
    assert.deepEqual([snapshots.length, dispatched], [1, 3]);
    assert.ok(tails.every(batch => batch.events.length <= 2 && batch.parsedLines <= 2
      && batch.bytesRead <= 256 * 1024));
    connection.close();
    hub.close();
  });

  it("refuses a sequence gap and conflicting replay while preserving a distinct restart stream", () => {
    const h = harness();
    h.batches.push([event("stream-a", 1), event("stream-b", 1)]);
    h.hub.poll();
    assert.equal(h.hub.stats().degraded, false);
    h.batches.push([event("stream-a", 3)]);
    h.hub.poll();
    assert.equal(h.hub.stats().lastError, "run-log-worker-sequence-gap");
    h.hub.close();
    const second = harness();
    second.batches.push([event("stream-a", 1)]);
    second.hub.poll();
    second.batches.push([ConfirmedActionEventSchema.parse({ ...event("stream-a", 1),
      occurredAt: "2026-10-02T12:01:00.000Z" })]);
    second.hub.poll();
    assert.equal(second.hub.stats().lastError, "run-log-event-id-conflict");
    second.hub.close();
  });
});
