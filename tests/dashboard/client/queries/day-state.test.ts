import { createClientDayFixtures } from "../../../support/helpers/dashboard/client-day-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { applyDashboardDayPatch,type DashboardDayPatch } from "../../../../src/dashboard/client/queries/day-state.js";
import { DashboardDayWireSchema,type DashboardDayWire } from "../../../../src/models/dashboard/projection.js";

const DAY = "2026-08-03";
const HASH_D = "d".repeat(64);
const RUN_IDS = [
  "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b",
  "5d1c2b3a-4e5f-4061-8273-849506172839",
  "7f2e3d4c-5b6a-4798-8071-625344352617",
] as const;

const { surfaceOf: surfaceInput } = createClientDayFixtures(DAY, HASH_D);

function surfaceOf(runId: string, rowRevision: number, title: string): Record<string, unknown> {
  return surfaceInput(runId, rowRevision, title, "queued");
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
    workerCards: [], workerAuthority: { state: "present", members: [] }, workerOperations: [],
    workerPools: [],
    notifications: [],
  });
}


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

describe("applyDashboardDayPatch splices one row", () => {
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

    assert.equal(replayed.value, fresh);
    assert.equal(replayed.value.queueSurfaces[1].rowRevision, 9);
  });
});

it("removes historical attempts only when their selected-day item leaves the queue", () => {
  const day = threeRowDay();
  const row = day.queueSurfaces[0];
  const history = { partitionDay: "2026-07-31", surface: { ...row, runId: "00000000-0000-4000-8000-000000008001", attempt: 1 } };
  const held = DashboardDayWireSchema.parse({ ...day, queueSurfaces: [{ ...row, attempt: 2 }, ...day.queueSurfaces.slice(1).map(surface => ({ ...surface, itemId: surface.runId }))], attemptHistory: [history] });
  const next = applyDashboardDayPatch(held, { operation: "remove-queue-surface", target: { runId: row.runId, rowRevision: row.rowRevision }, reason: "the run left this day" });
  assert.deepEqual(next.attemptHistory, []);
  const other = applyDashboardDayPatch(held, { operation: "remove-queue-surface", target: { runId: day.queueSurfaces[1].runId, rowRevision: day.queueSurfaces[1].rowRevision }, reason: "the run left this day" });
  assert.equal(other.attemptHistory?.[0], held.attemptHistory?.[0]);
});
