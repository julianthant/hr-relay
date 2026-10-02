/**
 * D4 — the SSE day patch is a SPLICE, not a whole-day re-parse.
 *
 * Track D row D4 (ref frontend-backend-integration §7.4; audit finding P1). A
 * single-row patch used to run `DashboardDayWireSchema.parse` over the entire
 * day — 1,240 rows re-validated to change one — and, because zod's `parse`
 * returns a fresh object graph, it also handed every UNTOUCHED row a new
 * reference, so no `memo` downstream could ever hold. Both halves are pinned
 * here: zero whole-day parses per patch, and reference equality for everything
 * the patch did not name.
 *
 * The safety argument the removal rests on, stated as tests rather than as a
 * comment: the patch itself is still strictly parsed (its replacement row goes
 * through `QueueSurfaceWireSchema`, and the schema's own refinement pins the
 * replacement's identity and revision to the target's), the held day was parsed
 * whole when the snapshot arrived, and `DashboardDayWireSchema`'s only
 * cross-row invariant over `queueSurfaces` is `runId` uniqueness — which a
 * replace-in-place under the SAME id and a removal both preserve by
 * construction. Anything that does not fit fails loud into the resnapshot path.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { applyDashboardDayPatch, type DashboardDayPatch } from "../../../../src/dashboard/client/day-state.js";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../src/domain/dashboard/projection.js";

const DAY = "2026-08-03";
const HASH_D = "d".repeat(64);
const RUN_IDS = [
  "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b",
  "5d1c2b3a-4e5f-4061-8273-849506172839",
  "7f2e3d4c-5b6a-4798-8071-625344352617",
] as const;

function surfaceOf(runId: string, rowRevision: number, title: string): Record<string, unknown> {
  return {
    surfaceKind: "single",
    runId,
    itemId: "9c8b7a6d-5e4f-43a2-9b8c-7d6e5f4a3b2c",
    workflowId: "person-lookup",
    traceId: "pl-104233-3b8f",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "0.1.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_D,
    configFingerprint: HASH_D,
    resolvedInstances: [{ system: "ucpath", instance: "prod" }],
    dryRun: false,
    priority: "interactive",
    runNumber: { state: "present", value: 1 },
    session: { state: "absent", reason: "fixture row predates run sessions (D269)" },
    containment: "root",
    linkedRuns: [],
    facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: "2026-08-03T17:00:00.000Z",
    updatedAt: "2026-08-03T17:00:00.000Z",
    endedAt: { state: "absent", reason: "run is running" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title,
    subtitle: { state: "absent", reason: "none planned" },
    status: "queued",
    liveMessage: { state: "absent", reason: "no producer authors a live progress sentence on this wire" },
    warnings: { state: "absent", reason: "this run has produced no terminal result" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    actions: [],
    rowRevision,
  };
}

function threeRowDay(): DashboardDayWire {
  const surfaces = RUN_IDS.map((runId, index) => surfaceOf(runId, 1, `EID 1087369${String(index)}`));
  return DashboardDayWireSchema.parse({
    day: DAY,
    descriptorHash: HASH_D,
    projectionGeneration: 7,
    snapshotCursor: "pc:1",
    monthCounts: [{ day: DAY, count: surfaces.length }],
    workflowCounts: [
      { workflowId: "person-lookup", count: surfaces.length, statusCounts: [{ status: "queued", count: surfaces.length }] },
    ],
    statusCounts: [{ status: "queued", count: surfaces.length }],
    queueSurfaces: surfaces,
    workerCards: [],
    workerPools: [],
    notifications: [],
  });
}

/**
 * Counts `DashboardDayWireSchema.parse` calls while `work` runs.
 *
 * Same shape as the §7.4 harness's spy, and for the same reason: the finding is
 * a COUNT, so a spy that could silently observe nothing would be a check that
 * cannot fail. Every caller below proves the window is live with a known parse
 * before believing a zero — see `assertSpyObserves`.
 */
function countDayWireParses<Result>(work: () => Result): { readonly value: Result; readonly parses: number } {
  const schema = DashboardDayWireSchema as unknown as { parse: (input: unknown) => unknown };
  const original = schema.parse.bind(DashboardDayWireSchema);
  const ownDescriptor = Object.getOwnPropertyDescriptor(schema, "parse");
  let parses = 0;
  Object.defineProperty(schema, "parse", {
    configurable: true,
    enumerable: ownDescriptor?.enumerable ?? false,
    writable: true,
    value: (input: unknown): unknown => {
      parses += 1;
      return original(input);
    },
  });
  try {
    return { value: work(), parses };
  } finally {
    if (ownDescriptor === undefined) delete (schema as Partial<typeof schema>).parse;
    else Object.defineProperty(schema, "parse", ownDescriptor);
  }
}

/** The spy's own negative control: it must see a parse it knows happened. */
function assertSpyObserves(day: DashboardDayWire): void {
  const probe = countDayWireParses(() => DashboardDayWireSchema.parse(day));
  assert.equal(probe.parses, 1, "the day-wire parse spy is not installed; a zero below would prove nothing");
}

describe("D4 — applyDashboardDayPatch splices one row (audit P1)", () => {
  it("replaces the named row with NO whole-day re-parse and leaves every other row reference-equal", () => {
    const day = threeRowDay();
    assertSpyObserves(day);

    const patch = {
      operation: "replace-queue-surface",
      target: { runId: RUN_IDS[1], rowRevision: 4 },
      replacement: surfaceOf(RUN_IDS[1], 4, "EID 10873691"),
    } as unknown as DashboardDayPatch;

    const applied = countDayWireParses(() => applyDashboardDayPatch(day, patch));
    assert.equal(applied.parses, 0, "one single-row patch must not re-validate the whole day");

    const next = applied.value;
    assert.notEqual(next, day, "the fold is immutable: the held day is never mutated in place");
    assert.equal(next.queueSurfaces.length, 3);
    assert.equal(next.queueSurfaces[1].rowRevision, 4, "the target row carries the patch's revision");
    assert.equal(String(next.queueSurfaces[1].runId), RUN_IDS[1]);

    // The whole point of dropping the parse: untouched rows keep their identity,
    // so a `memo`'d row component below can actually skip.
    assert.equal(next.queueSurfaces[0], day.queueSurfaces[0]);
    assert.equal(next.queueSurfaces[2], day.queueSurfaces[2]);
    assert.equal(next.monthCounts, day.monthCounts);
    assert.equal(next.workflowCounts, day.workflowCounts);
    assert.equal(next.statusCounts, day.statusCounts);
    assert.equal(next.workerCards, day.workerCards);
    assert.equal(next.notifications, day.notifications);
    // D81: a patch is count-neutral by protocol — nothing here recomputes one.
    assert.deepEqual(next.statusCounts, day.statusCounts);
  });

  it("removes the named row with NO whole-day re-parse, keeping the survivors reference-equal", () => {
    const day = threeRowDay();
    assertSpyObserves(day);

    const applied = countDayWireParses(() => applyDashboardDayPatch(day, {
      operation: "remove-queue-surface",
      target: { runId: RUN_IDS[1], rowRevision: 2 },
      reason: "the run left this day",
    } as unknown as DashboardDayPatch));
    assert.equal(applied.parses, 0);

    const next = applied.value;
    assert.deepEqual(next.queueSurfaces.map((surface) => String(surface.runId)), [RUN_IDS[0], RUN_IDS[2]]);
    assert.equal(next.queueSurfaces[0], day.queueSurfaces[0]);
    assert.equal(next.queueSurfaces[1], day.queueSurfaces[2]);
  });

  it("refuses a patch naming a run this snapshot does not hold — replace and remove alike", () => {
    const day = threeRowDay();
    const unheld = "0a1b2c3d-4e5f-4061-8273-849506172839";
    for (const patch of [
      {
        operation: "replace-queue-surface",
        target: { runId: unheld, rowRevision: 1 },
        replacement: surfaceOf(unheld, 1, "EID 99999999"),
      },
      { operation: "remove-queue-surface", target: { runId: unheld, rowRevision: 1 }, reason: "gone" },
    ]) {
      assert.throws(
        () => applyDashboardDayPatch(day, patch as unknown as DashboardDayPatch),
        (error: unknown) => error instanceof DashboardClientError && error.kind === "protocol",
        `a patch for unheld run ${unheld} must be a protocol failure the subscription resnapshots on`,
      );
    }
  });

  it("refuses a shape-mismatched patch rather than splicing it, and leaves the held day untouched", () => {
    const day = threeRowDay();
    const before = day.queueSurfaces[1];
    assert.throws(() => applyDashboardDayPatch(day, {
      operation: "replace-queue-surface",
      target: { runId: RUN_IDS[1], rowRevision: 4 },
      // `rowRevision` disagrees with the target — the patch schema's own
      // refinement. With the whole-day parse gone, THIS is the check that
      // stands between a malformed payload and the held snapshot.
      replacement: surfaceOf(RUN_IDS[1], 5, "EID 10873691"),
    } as unknown as DashboardDayPatch));
    assert.throws(() => applyDashboardDayPatch(day, {
      operation: "replace-queue-surface",
      target: { runId: RUN_IDS[1], rowRevision: 4 },
      replacement: { runId: RUN_IDS[1], rowRevision: 4 },
    } as unknown as DashboardDayPatch));
    assert.equal(day.queueSurfaces[1], before);
  });

  it("keeps the FRESHER row when a resume replays a stale revision, and parses nothing", () => {
    const day = threeRowDay();
    const fresh = applyDashboardDayPatch(day, {
      operation: "replace-queue-surface",
      target: { runId: RUN_IDS[1], rowRevision: 9 },
      replacement: surfaceOf(RUN_IDS[1], 9, "EID 10873691"),
    } as unknown as DashboardDayPatch);
    assertSpyObserves(day);

    const replayed = countDayWireParses(() => applyDashboardDayPatch(fresh, {
      operation: "replace-queue-surface",
      target: { runId: RUN_IDS[1], rowRevision: 3 },
      replacement: surfaceOf(RUN_IDS[1], 3, "EID 10873691"),
    } as unknown as DashboardDayPatch));
    assert.equal(replayed.parses, 0);
    // The held day is returned BY REFERENCE: nothing moved, so no consumer of
    // this fold should re-render. Keeping the fresher row is not "keeping a
    // stale row" — the stale thing is the replayed patch, and a Last-Event-ID
    // resume replaying it is a documented, expected state (§3.5).
    assert.equal(replayed.value, fresh);
    assert.equal(replayed.value.queueSurfaces[1].rowRevision, 9);
  });
});
