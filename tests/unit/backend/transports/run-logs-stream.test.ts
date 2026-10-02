import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ConfirmedActionEventSchema, confirmedStepOccurrence, type ConfirmedActionEvent } from "../../../../src/models/events/confirmed-action.js";
import { CompositeCursorSchema, emptyRunLogsMergeState, mergeRunLogs } from "../../../../src/models/dashboard/run-logs-subscription.js";
import { RunLogsStreamHub } from "../../../../src/backend/transports/http/subscriptions/run-logs-stream.js";
import { compositeEventStreamBody } from "../../../../src/backend/transports/http/subscriptions/sse-response.js";
import type { RunQueueProjection, RunQueueProjectionChange } from "../../../../src/backend/runs/projections/run-queue-projection.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import type { RunLogTail } from "../../../../src/backend/logs/run-log-stream.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GENERATION = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);
const AT = "2026-10-02T12:00:00.000Z";

function event(stream: string, sequence: number, runId = RUN): ConfirmedActionEvent {
  const action = {
    runId, definitionFingerprint: HASH, nodeId: "first", taskId: "ucpath/read-write-fixture",
    attempt: 1, claimGeneration: 1, taskAttempt: 1, invocationId: "first-operation",
    occurrencePath: ["first"], logicalActionId: "read-field", occurrence: sequence,
    logicalSessionId: "local-session", state: "started" as const,
  };
  return ConfirmedActionEventSchema.parse({ version: 1, kind: "trace", state: "started",
    eventId: `${stream}/${String(sequence)}`, workerId: "fixture-worker-1", workerStreamId: stream,
    sequence, traceId: "fpo-120000-0002", stepOccurrence: confirmedStepOccurrence(action),
    action, source: { kind: "headless", system: "service" }, occurredAt: AT, recordedAt: AT });
}

function harness(maxPending = 64) {
  const batches: ConfirmedActionEvent[][] = [];
  let snapshotHook: (() => void) | undefined;
  const listeners: Array<(change: RunQueueProjectionChange) => void> = [];
  const projection = {
    onChange(listener: (change: RunQueueProjectionChange) => void) { listeners.push(listener); return () => {}; },
    cursor: () => "pc:1", generation: () => 1,
    buildDashboardDayWire(day: string) { return { day, descriptorHash: HASH, projectionGeneration: 1,
      snapshotCursor: "pc:1", monthCounts: [], workflowCounts: [], statusCounts: [],
      queueSurfaces: [], workerCards: [], workerPools: [], notifications: [] }; },
  } as unknown as RunQueueProjection;
  const authority = { envelope: { runId: RUN, traceId: "fpo-120000-0002",
    contractFingerprint: HASH, attempt: 1 } } as RunRecord;
  const hub = new RunLogsStreamHub({ projection, maxPending, generation: () => GENERATION,
    readRun: runId => runId === RUN ? { disposition: "live", run: authority } : undefined,
    store: {
      tail(cursors): RunLogTail { return { events: batches.shift() ?? [], cursors,
        pruned: false, parsedLines: 1, bytesRead: 0, hasMore: false }; },
      snapshot: () => { snapshotHook?.(); return { events: [], hasEarlier: false, parsedLines: 2 }; },
    } });
  return { hub, batches, listeners, onSnapshot: (hook?: () => void) => { snapshotHook = hook; } };
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
    h.batches.push([event("stream-a", 1), event("stream-b", 1)]);
    h.hub.poll();
    const reset = await slow.next();
    assert.equal(reset?.source, "control");
    assert.equal(reset?.source === "control" ? reset.reason : undefined, "overflow");
    assert.equal(await slow.next(), undefined);
    assert.equal((await fast.next())?.source, "control");
    const changed = h.hub.connect({ runId: RUN, day: "2026-10-02", lastEventId: oldCursor });
    assert.equal(changed.initial[1]?.source, "control");
    assert.equal(changed.initial[1]?.source === "control" ? changed.initial[1].reason : undefined, "topic-changed");
    changed.close(); fast.close(); h.hub.close();
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

  it("retains the latest persisted members across a lower-sorting restarted worker stream", () => {
    const delivered = Array.from({ length: 200 }, (_, index) => event("stream-z", index + 1));
    delivered.push(event("stream-a", 1), event("stream-a", 2));
    let state = emptyRunLogsMergeState(RUN);
    for (const item of delivered) state = mergeRunLogs(state, { type: "delta", runId: RUN, event: item });
    const snapshot = mergeRunLogs(emptyRunLogsMergeState(RUN), {
      type: "snapshot", runId: RUN, events: delivered.slice(-200), hasEarlier: true,
    });
    assert.equal(state.events.length, 200);
    assert.equal(state.events.some(item => item.eventId === "stream-a/2"), true);
    assert.deepEqual(state.events.map(item => item.eventId), snapshot.events.map(item => item.eventId));
    assert.equal(state.hasEarlier, snapshot.hasEarlier);
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
