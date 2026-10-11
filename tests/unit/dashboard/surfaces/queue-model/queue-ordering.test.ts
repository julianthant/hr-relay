
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";
import {
  attentionRunIds,
  bandOf,
  filterQueueSurfaces,
  groupQueueAttempts,
  sortQueueBand,
  visibleRunIds,
} from "../../../../../src/dashboard/surfaces/queue/queue-model.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-14T17:00:00.000Z";

const runId = (n: number): string => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

function surface(input: Record<string, unknown>) {
  return QueueSurfaceWireSchema.parse({
    itemId: input.itemId ?? input.runId ?? runId(9),
    workflowId: "person-lookup",
    traceId: "pl-120000-1111",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "1.0.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_A,
    configFingerprint: HASH_B,
    resolvedInstances: [],
    dryRun: false,
    priority: "interactive",
    runNumber: { state: "present", value: 1 },
    session: { state: "absent", reason: "This fixture has no run session." },

    containment: input.surfaceKind === "member" ? "member" : "root",
    linkedRuns: [],
    facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: NOW,
    updatedAt: NOW,
    endedAt: { state: "absent", reason: "run has not ended" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title: "A run",
    subtitle: { state: "absent", reason: "no second identifier" },
    liveMessage: { state: "absent", reason: "no message" },
    warnings: { state: "absent", reason: "no warning set has been derived" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    actions: [],
    rowRevision: 1,
    surfaceKind: "single",
    ...input,
  });
}

/** a settled row needs its terminal instant, and the schema enforces that */
function settled(input: Record<string, unknown>) {
  return surface({ endedAt: { state: "present", value: NOW }, ...input });
}

describe("sortQueueBand — `attention`", () => {

  it("ranks by status, in the demo's own order", () => {
    const rows = [
      settled({ runId: runId(1), status: "cancelled" }),
      settled({ runId: runId(2), status: "done" }),
      settled({ runId: runId(3), status: "partial" }),
      surface({ runId: runId(4), status: "queued" }),
      surface({ runId: runId(5), status: "running" }),
      surface({ runId: runId(6), status: "blocked" }),
      settled({ runId: runId(7), status: "failed" }),
      surface({ runId: runId(8), status: "awaiting-approval" }),
    ];
    assert.deepEqual(
      sortQueueBand(rows, "attention", NOW).map((row) => row.status),
      ["awaiting-approval", "failed", "blocked", "running", "queued", "partial", "done", "cancelled"],
    );
  });

  it("breaks a rank tie with the NEWEST first", () => {
    const older = surface({ runId: runId(1), status: "running", startedAt: "2026-08-14T09:00:00.000Z" });
    const newer = surface({ runId: runId(2), status: "running", startedAt: "2026-08-14T16:00:00.000Z" });
    assert.deepEqual(
      sortQueueBand([older, newer], "attention", NOW).map((row) => String(row.runId)),
      [String(newer.runId), String(older.runId)],
    );
  });

  it("leaves the three named orders alone", () => {
    const older = surface({ runId: runId(1), status: "running", startedAt: "2026-08-14T09:00:00.000Z" });
    const newer = surface({ runId: runId(2), status: "awaiting-approval", startedAt: "2026-08-14T16:00:00.000Z" });
    // `oldest` must not be re-ranked by status — the waiting row is newer and
    // still sorts last, which is the whole point of a named order.
    assert.deepEqual(
      sortQueueBand([newer, older], "oldest", NOW).map((row) => String(row.runId)),
      [String(older.runId), String(newer.runId)],
    );
  });
});

describe("member ordering", () => {

  it("ranks doneWarnings with parked, and sinks cancelled below a clean done", () => {
    const members = [
      surface({ runId: runId(1), surfaceKind: "member", status: "done", endedAt: { state: "present", value: NOW }, lineage: { state: "child", parentRunId: runId(9) } }),
      surface({ runId: runId(2), surfaceKind: "member", status: "cancelled", endedAt: { state: "present", value: NOW }, lineage: { state: "child", parentRunId: runId(9) } }),
      surface({ runId: runId(3), surfaceKind: "member", status: "queued", lineage: { state: "child", parentRunId: runId(9) } }),
      surface({ runId: runId(4), surfaceKind: "member", status: "partial", endedAt: { state: "present", value: NOW }, lineage: { state: "child", parentRunId: runId(9) } }),
      surface({ runId: runId(5), surfaceKind: "member", status: "failed", endedAt: { state: "present", value: NOW }, lineage: { state: "child", parentRunId: runId(9) } }),
    ];
    const operation = surface({
      runId: runId(9),
      surfaceKind: "operation",
      status: "running",
      memberRunIds: members.map((member) => String(member.runId)),
      memberRollup: { total: 5, terminal: 4, failed: 1 },
      memberPreview: { state: "absent", reason: "this fixture names no member subjects" },
    });
    assert.deepEqual(
      visibleRunIds([operation, ...members], "attention", NOW),
      [runId(9), runId(5), runId(4), runId(3), runId(2), runId(1)],
    );
  });

  // Equal-status members retain served order; fixture ids are not a real ordering key.
  it("keeps the projection's own order inside one rank", () => {
    const members = [3, 4, 5].map((n) =>
      surface({
        runId: runId(n),
        surfaceKind: "member",
        status: "failed",
        endedAt: { state: "present", value: NOW },
        lineage: { state: "child", parentRunId: runId(9) },
      }),
    );
    const operation = surface({
      runId: runId(9),
      surfaceKind: "operation",
      status: "running",
      memberRunIds: members.map((member) => String(member.runId)),
      memberRollup: { total: 3, terminal: 3, failed: 3 },
      memberPreview: { state: "absent", reason: "this fixture names no member subjects" },
    });
    assert.deepEqual(visibleRunIds([operation, ...members], "attention", NOW), [
      runId(9),
      runId(3),
      runId(4),
      runId(5),
    ]);
  });
});

describe("logical item attempt grouping", () => {
  it("keeps selected-day attempts under one item and scopes identity by workflow", () => {
    const first = settled({ runId: runId(1), itemId: runId(8), attempt: 1, status: "failed" });
    const retry = settled({ runId: runId(2), itemId: runId(8), attempt: 2, status: "done" });
    const otherWorkflow = settled({ runId: runId(3), workflowId: "other-workflow", itemId: runId(8), attempt: 1, status: "done" });

    const groups = groupQueueAttempts([first, otherWorkflow, retry]);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0]?.attempts.map((row) => row.attempt), [1, 2]);
    assert.equal(groups[0]?.representative.runId, retry.runId);
    assert.equal(groups[1]?.representative.workflowId, "other-workflow");
    assert.deepEqual(visibleRunIds([first, retry]), [first.runId, retry.runId]);
  });

  it("refuses two served run identities for the same workflow item attempt", () => {
    const first = settled({ runId: runId(1), itemId: runId(8), attempt: 1, status: "failed" });
    const duplicate = settled({ runId: runId(2), itemId: runId(8), attempt: 1, status: "done" });
    assert.throws(() => groupQueueAttempts([first, duplicate]), /duplicate attempt/u);
  });

  it("keeps every sibling attempt when one attempt matches the status filter", () => {
    const failed = settled({ runId: runId(1), itemId: runId(8), attempt: 1, status: "failed" });
    const retry = settled({ runId: runId(2), itemId: runId(8), attempt: 2, status: "done" });
    const otherItem = settled({ runId: runId(3), itemId: runId(7), status: "done" });
    const otherWorkflow = settled({ runId: runId(4), workflowId: "other-workflow", itemId: runId(8), status: "done" });

    assert.deepEqual(
      filterQueueSurfaces([failed, retry, otherItem, otherWorkflow], "failed").map((row) => row.runId),
      [failed.runId, retry.runId],
    );
  });

  it("does not promote historical attention over the selected item's current attempt", () => {
    const failed = settled({ runId: runId(1), itemId: runId(8), attempt: 1, status: "failed" });
    const retry = settled({ runId: runId(2), itemId: runId(8), attempt: 2, status: "done" });
    assert.deepEqual(attentionRunIds([failed, retry]), []);
  });
});


it("keeps Cancelling in the active band ahead of queued and completed work", () => {
  const cancelling = surface({ runId: runId(1), status: "cancelling" });
  assert.equal(bandOf("cancelling"), "active");
  assert.deepEqual(sortQueueBand([
    settled({ runId: runId(2), status: "done" }),
    surface({ runId: runId(3), status: "queued" }), cancelling,
  ], "attention", NOW).map(({ status }) => status), ["cancelling", "queued", "done"]);
});
