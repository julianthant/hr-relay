/**
 * D268 — the queue row and the run-detail panel are the SAME derivation.
 *
 * Ref dashboard-surfaces §2.3 has always said there is one projection. There
 * were two derivations on top of it: the projector's `#status` read the span
 * fold's `ended` and `claimedBy` beside the authority lifecycle, and the
 * run-detail query's private `statusOf` had neither arm and inlined its own
 * copy of the outcome map. One level down, `TASK_OUTCOME_PIPELINE` mapped
 * `cancelled|discarded|superseded` to `blocked` while `TASK_OUTCOME_STEP`
 * mapped them to `cancelled`.
 *
 * Every case below asserts the two surfaces AGAINST EACH OTHER rather than
 * against a literal, because the defect was never "the panel says the wrong
 * word" — it was "the panel says a different word from the row it opened
 * from", which only a comparison can catch. The literal is asserted too, once
 * per case, so a future change that made both wrong in the same way would
 * still fail.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { SpanOutcomeWire } from "../../../src/events/types.js";
import { deriveRunStatus, taskStateOf } from "../../../src/server/dashboard/run-status.js";
import { buildRunDetail } from "../../../src/server/dashboard/queries/run-detail.js";
import type { RunDetailDescriptorView } from "../../../src/server/dashboard/queries/run-detail.js";
import {
  claimEventOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runEndedEventOf,
  runRecordOf,
  taskEventsOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const NODE = "search-person";

/** The ONE declared category, so the timeline serves a member state per node. */
const TIMELINE: NonNullable<RunDetailDescriptorView["timeline"]> = [
  { label: "Lookup", nodes: [{ id: NODE, label: "Search person" }] },
];

function detailOf(w: DashboardWorld, seed: number, timeline?: NonNullable<RunDetailDescriptorView["timeline"]>) {
  return buildRunDetail(
    { runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => ({ details: [], ...(timeline === undefined ? {} : { timeline }) }) },
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

describe("D268 — one run-status derivation", () => {
  it("agrees on `done` when the run's span ended before authority settled", () => {
    // The C1 case, and the ordinary one: the worker emits `span.ended` before
    // its terminal transaction commits. The row read `done` off the fold; the
    // panel, with no `ended` arm, read `queued` off the still-unsettled
    // lifecycle.
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    runEndedEventOf(w, 1, "done");

    const { row, panel } = statusPair(w, 1);
    assert.equal(row, panel);
    assert.equal(panel, "done");
  });

  it("agrees on `cancelled` for a run whose span ended `discarded` before authority settled", () => {
    const w = world();
    queuedEventOf(w, { seed: 2 });
    runEndedEventOf(w, 2, "discarded");

    const { row, panel } = statusPair(w, 2);
    assert.equal(row, panel);
    assert.equal(panel, "cancelled");
  });

  it("agrees on `blocked` for a run whose span ended `interrupted` — no verdict is claimed", () => {
    const w = world();
    queuedEventOf(w, { seed: 3 });
    runEndedEventOf(w, 3, "interrupted");

    const { row, panel } = statusPair(w, 3);
    assert.equal(row, panel);
    assert.equal(panel, "blocked");
  });

  it("agrees on `running` when a claim span folded before the claiming transaction was visible", () => {
    // The second missing arm: authority still reads `queued` because the
    // reader has not seen the claim's CAS, and the fold already names a worker.
    const w = world();
    queuedEventOf(w, { seed: 4 });
    claimEventOf(w, 4);

    const { row, panel } = statusPair(w, 4);
    assert.equal(row, panel);
    assert.equal(panel, "running");
  });

  it("agrees on `awaiting-approval` for an open gate span with a queued lifecycle", () => {
    const w = world();
    queuedEventOf(w, { seed: 5 });
    w.writer.emit({
      t: "gate.opened",
      ts: w.clock.now().toISOString(),
      workflow: "person-lookup",
      runId: uuidOf(5),
      attempt: 1,
      traceId: `pl-100005-${uuidOf(5).slice(0, 4)}`,
      spanPath: `pl-100005-${uuidOf(5).slice(0, 4)}`,
      gate: "identity-approval",
    });

    const { row, panel } = statusPair(w, 5);
    assert.equal(row, panel);
    assert.equal(panel, "awaiting-approval");
  });

  it("lets AUTHORITY outrank the fold when the two disagree", () => {
    // Precedence, asserted where it bites: a terminal lifecycle is written
    // inside the transaction that settles the run, so a stream that says
    // otherwise loses. Both surfaces lose the same way.
    const w = world();
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

  it("is literally the one exported function — no second copy to drift", () => {
    // This pins the OLD divergence, not a structural guarantee: nothing here
    // stops a future edit from re-inlining a second `statusOf`/`taskStateOf`
    // copy that happens to answer the same words on every case above — no
    // architecture guard refuses a second derivation (that is a possible
    // future guard, not one this suite claims). What this case actually
    // checks is behavioral: both surfaces answer through `deriveRunStatus`
    // itself, on the exact inputs (a folded `ended`, a folded `claimedBy`,
    // the unified outcome vocabulary) that the missing arms used to get
    // wrong.
    const w = world();
    queuedEventOf(w, { seed: 7 });
    runEndedEventOf(w, 7, "superseded");
    const fold = w.projection.runFold(uuidOf(7));
    const record = w.authority.getRun(uuidOf(7));
    assert.notEqual(fold, undefined);
    assert.notEqual(record, undefined);
    if (fold === undefined || record === undefined) return;

    const { row, panel } = statusPair(w, 7);
    assert.equal(deriveRunStatus(fold, record), row);
    assert.equal(deriveRunStatus(fold, record), panel);
  });
});

/* ── the task vocabulary ─────────────────────────────────────────────────── */

/**
 * Every word a folded task span can carry, and the ONE state each becomes.
 *
 * The four that used to diverge are the four that matter: `cancelled`,
 * `discarded` and `superseded` read `blocked` on the chip and `cancelled` on
 * the step, and only `interrupted` — the outcome that genuinely names no act —
 * belongs in `blocked`.
 */
const VOCABULARY: readonly (readonly [SpanOutcomeWire, string])[] = [
  ["done", "done"],
  ["failed", "failed"],
  ["skipped", "skipped"],
  ["cancelled", "cancelled"],
  ["discarded", "cancelled"],
  ["superseded", "cancelled"],
  ["interrupted", "blocked"],
];

describe("D268 — one task-outcome vocabulary", () => {
  for (const [outcome, expected] of VOCABULARY) {
    it(`reads a ${outcome} span as ${expected} on the pipeline chip AND the timeline step`, () => {
      const w = world();
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

  it("reads a started-but-unended span as `active` on both, which is a fact and not a default", () => {
    const w = world();
    queuedEventOf(w, { seed: 11 });
    claimEventOf(w, 11);
    taskEventsOf(w, 11, NODE);

    const chip = w.projection.queueSurface(uuidOf(11))?.pipeline.find((step) => step.id === NODE);
    const member = detailOf(w, 11, TIMELINE).timeline.steps?.[0]?.members[0];
    assert.equal(chip?.state, member?.state);
    assert.equal(chip?.state, "active");
    assert.equal(taskStateOf(undefined), "active");
  });

  it("keeps `skipped` its own arm — a branch nobody took is not an act somebody performed (D123)", () => {
    assert.notEqual(taskStateOf("skipped"), taskStateOf("cancelled"));
    assert.equal(taskStateOf("skipped"), "skipped");
  });
});
