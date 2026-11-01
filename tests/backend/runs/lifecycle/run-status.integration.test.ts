import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { deriveRunStatus, taskStateOf } from "../../../../src/backend/runs/lifecycle/run-status.js";
import type { RunDetailDescriptorView } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import type { SpanOutcomeWire } from "../../../../src/models/events/types.js";
import { claimEventOf, instantOffsetOf, queuedEventOf, runEndedEventOf, runRecordOf, taskEventsOf, traceOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const {world, cleanup } = createRunDetailTestWorld(profileFixtures.create);


afterEach(cleanup);

const NODE = "search-person";

/** The ONE declared category, so the timeline serves a member state per node. */
const TIMELINE: NonNullable<RunDetailDescriptorView["timeline"]> = [
  { key: "lookup", label: "Lookup", nodes: [{ id: NODE, label: "Search person" }] },
];

function detailOf(w: DashboardWorld, seed: number, timeline?: NonNullable<RunDetailDescriptorView["timeline"]>) {
  return buildRunDetail(
    { runReader: w.runReader, timeline: w.timeline,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => ({ version: 1, contractFingerprint: HASH_A, details: [], ...(timeline === undefined ? {} : { timeline }) }) },
    },
    uuidOf(seed),
  );
}

/** The two words the pair of surfaces prints for one run, at one instant. */
function statusPair(w: DashboardWorld, seed: number): { row: string; panel: string } {
  const surface = w.projection.queueSurface(uuidOf(seed));
  assert.notEqual(surface, undefined, "the projection must hold the seeded run");
  return { row: surface?.status ?? "<no row>", panel: detailOf(w, seed).header.status };
}

describe("authority-only run status", () => {
  it("run-status-fold-contributes-no-lifecycle-arm", async () => {
    const cases = [
      { state: "claimed" as const, fold: "done" as const, expected: "running" },
      { state: "queued" as const, fold: "claim" as const, expected: "queued" },
      { state: "queued" as const, fold: "gate" as const, expected: "queued" },
      { state: "parked-gate" as const, fold: "none" as const, expected: "awaiting-approval" },
      { state: "claimed" as const, fold: "done" as const, cancelRequested: true as const, expected: "cancelling" },
      { state: "validating" as const, fold: "gate" as const, cancelRequested: true as const, expected: "cancelling" },
      { state: "running" as const, fold: "none" as const, cancelRequested: true as const, expected: "cancelling" },
    ];
    for (const [index, entry] of cases.entries()) {
      const w = await world();
      const seed = index + 1;
      queuedEventOf(w, { seed });
      if (entry.fold === "done") runEndedEventOf(w, seed, "done");
      if (entry.fold === "claim") claimEventOf(w, seed);
      if (entry.fold === "gate") w.writer.emit({
        t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
        runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed),
        spanPath: traceOf(seed), gate: "identity-approval",
      });
      const lifecycle = entry.state === "queued" ? { state: entry.state }
        : entry.state === "parked-gate" ? { state: entry.state, gateId: "identity-approval", parkedAt: instantOffsetOf(0), resumeAt: "search-person" }
        : { state: entry.state, workerId: "worker-a", claimedAt: instantOffsetOf(0), heartbeatAt: instantOffsetOf(0) };
      const record = runRecordOf({ seed, lifecycle, claimGeneration: 1 });
      w.authority.put({ ...record, ...(entry.cancelRequested === true ? { cancelRequested: true } : {}) });
      assert.deepEqual(statusPair(w, seed), { row: entry.expected, panel: entry.expected }, JSON.stringify(entry));
    }
  });

  it("lets AUTHORITY outrank the fold when the two disagree", async () => {

    const w = await world();
    queuedEventOf(w, { seed: 6 });
    runEndedEventOf(w, 6, "done");
    w.authority.put(runRecordOf({
      seed: 6,
      version: 2,
      lifecycle: {
        state: "terminal",
        outcome: "failed",
        endedAt: instantOffsetOf(0, 5_000),
        failureId: uuidOf(9006),
      },
    }));

    const { row, panel } = statusPair(w, 6);
    assert.equal(row, panel);
    assert.equal(panel, "failed");
  });

  it("is literally the one exported function — no second copy to drift", async () => {

    const w = await world();
    queuedEventOf(w, { seed: 7 });
    runEndedEventOf(w, 7, "superseded");
    const fold = w.projection.runFold(uuidOf(7));
    const record = w.authority.getRun(uuidOf(7));
    assert.notEqual(fold, undefined);
    assert.notEqual(record, undefined);
    if (fold === undefined || record === undefined) return;

    const { row, panel } = statusPair(w, 7);
    assert.equal(deriveRunStatus(record), row);
    assert.equal(deriveRunStatus(record), panel);
  });
});

/* ── the task vocabulary ─────────────────────────────────────────────────── */


const VOCABULARY: readonly (readonly [SpanOutcomeWire, string])[] = [
  ["done", "done"],
  ["failed", "failed"],
  ["skipped", "skipped"],
  ["cancelled", "cancelled"],
  ["discarded", "cancelled"],
  ["superseded", "cancelled"],
  ["interrupted", "blocked"],
];

describe("one task-outcome vocabulary", () => {
  for (const [outcome, expected] of VOCABULARY) {
    it(`reads a ${outcome} span as ${expected} on the pipeline chip AND the timeline step`, async () => {
      const w = await world();
      queuedEventOf(w, { seed: 10 });
      claimEventOf(w, 10);
      taskEventsOf(w, 10, NODE, outcome, outcome === "skipped" ? "condition-false" : undefined);

      const chip = w.projection.queueSurface(uuidOf(10))?.pipeline.find((step) => step.id === NODE);
      const detail = detailOf(w, 10, TIMELINE);
      const member = detail.timeline.steps?.[0]?.members[0];
      const event = detail.timeline.events[0];

      assert.equal(chip?.state, member?.state);
      assert.equal(chip?.state, event?.state);
      assert.equal(chip?.state, expected);
    });
  }

  it("reads a started-but-unended span as `active` on both, which is a fact and not a default", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 11 });
    claimEventOf(w, 11);
    taskEventsOf(w, 11, NODE);

    const chip = w.projection.queueSurface(uuidOf(11))?.pipeline.find((step) => step.id === NODE);
    const member = detailOf(w, 11, TIMELINE).timeline.steps?.[0]?.members[0];
    assert.equal(chip?.state, member?.state);
    assert.equal(chip?.state, "active");
    assert.equal(taskStateOf(undefined), "active");
  });

  it("keeps `skipped` its own arm — a branch nobody took is not an act somebody performed", () => {
    assert.notEqual(taskStateOf("skipped"), taskStateOf("cancelled"));
    assert.equal(taskStateOf("skipped"), "skipped");
  });
});
