import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { emptyRunLogsMergeState,mergeRunLogs } from "../../../src/models/dashboard/run-logs-subscription.js";
import { ConfirmedActionEventSchema,confirmedStepOccurrence,type ConfirmedActionEvent } from "../../../src/models/events/confirmed-action.js";

const RUN = "11111111-1111-4111-8111-111111111111";
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

describe("confirmed run log composite stream", () => {

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
});
