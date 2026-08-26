/**
 * The queue's two orderings, pinned as pure functions (R3 findings 1 and 13).
 *
 * Both were WRONG in a way no gate could see. `Attention first` — the default
 * — returned the server's order untouched under a note that promised "what
 * needs you, then what broke, then the rest", so the control's own description
 * was a claim about an order nothing produced. And the member well ranked a
 * CANCELLED member above a clean done and a done-with-warnings below a
 * running one, inverting the demo's table at the two places attention matters
 * most.
 *
 * Every surface here is parsed through `QueueSurfaceWireSchema`, so a fixture
 * cannot drift from a shape the server may serve.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { QueueSurfaceWireSchema } from "../../../src/domain/dashboard/projection.js";
import { sortQueueBand, visibleRunIds } from "../../../src/dashboard/surfaces/queue-model.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-14T17:00:00.000Z";

const runId = (n: number): string => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

function surface(input: Record<string, unknown>) {
  return QueueSurfaceWireSchema.parse({
    itemId: runId(9),
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
    session: { state: "absent", reason: "fixture row predates run sessions (D269)" },
    // Containment tracks the surface kind this fixture is building, because the
    // wire refuses a payload where the two disagree — a member is exactly the
    // row counted in its parent's rollup instead of the day's totals.
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

describe("sortQueueBand — `attention` (R3 finding 1)", () => {
  /**
   * The demo's `SORT_STATUS_RANK`, in the wire's vocabulary:
   * waiting 0 · failed 1 · parked 2 · running 3 · queued 4 · doneWarnings 5 ·
   * verifiedDone 6 · cancelled 7. The input is DELIBERATELY reverse-ranked, so
   * a pass-through implementation returns it unchanged and fails.
   */
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

describe("member ordering (R3 finding 13)", () => {
  /**
   * Read through `visibleRunIds`, which is the traversal the eye follows: an
   * operation, then its members in well order. The demo's
   * `MEMBER_ATTENTION_RANK` puts failed 0 · waiting 1 · doneWarnings/parked 2 ·
   * running 3 · queued 4 · cancelled 5 · verifiedDone 6.
   */
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

  /**
   * The TIEBREAK is the rebuild's, not the demo's: two members of the same
   * status keep the SERVED order. The demo falls back to its fixture id, which
   * is not an order any server produces.
   */
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
