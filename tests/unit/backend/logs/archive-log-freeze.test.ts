import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { freezeLogs } from "../../../../src/backend/runs/queries/archive-snapshot.js";
import { ConfirmedActionEventSchema, confirmedStepOccurrence } from "../../../../src/models/events/confirmed-action.js";
import { LogPageCursorSchema } from "../../../../src/models/dashboard/run-detail.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";

const RUN = RunIdSchema.parse("11111111-1111-4111-8111-111111111111");
const HASH = "a".repeat(64);
const AT = "2026-10-02T12:00:00.000Z";

function confirmed(sequence: number) {
  const action = { runId: RUN, definitionFingerprint: HASH, nodeId: "first", taskId: "ucpath/read-write-fixture",
    attempt: 1, claimGeneration: 1, taskAttempt: 1, invocationId: "first-operation",
    occurrencePath: ["first"], logicalActionId: "read-field", occurrence: sequence,
    logicalSessionId: "local-session", state: "started" as const };
  return ConfirmedActionEventSchema.parse({ version: 1, kind: "trace", state: "started",
    eventId: `worker-incarnation/${String(sequence)}`, workerId: "fixture-worker-1", workerStreamId: "worker-incarnation",
    sequence, traceId: "fpo-120000-0002", stepOccurrence: confirmedStepOccurrence(action), action,
    source: { kind: "headless", system: "service" }, occurredAt: AT, recordedAt: AT });
}

describe("frozen logs copy served confirmed facts", () => {
  it("retains each paged confirmed event and leaves old sections explicitly absent", () => {
    const first = confirmed(1);
    const second = confirmed(2);
    const readPagedSection: NonNullable<Parameters<typeof freezeLogs>[2]> = (_deps, _runId, _section, cursor) => ({
      section: "logs", payload: { runId: RUN, notes: [], rows: [],
        confirmedActions: cursor === undefined ? [first] : [second],
        nextCursor: cursor === undefined ? { state: "present", value: LogPageCursorSchema.parse(`lc:${HASH}:1`) }
          : { state: "absent", reason: "end-of-page" } },
    });
    const captured = freezeLogs({} as RunDetailQueryDeps, RUN, readPagedSection);
    assert.deepEqual(captured.confirmedActions?.map(event => event.eventId),
      ["worker-incarnation/1", "worker-incarnation/2"]);
    const readOldSection: NonNullable<Parameters<typeof freezeLogs>[2]> = (_deps, _runId, _section) => ({
      section: "logs", payload: { runId: RUN, notes: [], rows: [],
        nextCursor: { state: "absent", reason: "end-of-page" } },
    });
    const old = freezeLogs({} as RunDetailQueryDeps, RUN, readOldSection);
    assert.equal("confirmedActions" in old, false);
  });
});
