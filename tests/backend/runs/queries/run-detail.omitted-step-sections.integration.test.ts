import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { RunDetailDescriptorView } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { claimEventOf, instantOffsetOf, queuedEventOf, runRecordOf, taskEventsOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const {world, cleanup } = createRunDetailTestWorld();


afterEach(cleanup);

const CATEGORIES: NonNullable<RunDetailDescriptorView["timeline"]> = [
  { key: "extraction", label: "Kuali extraction", nodes: [{ id: "document", label: "Separation Document" }] },
  { key: "kronos-timecard", label: "Kronos timecard", nodes: [{ id: "timecard", label: "Timecard" }, { id: "reconcile", label: "Reconcile" }] },
];

const TERMINAL_DONE = { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 5_000) } as const;
const OMITTED_STEP = "kronos-timecard";
/** What the operator typed for the omitted step. It never crosses this wire. */
const TYPED_FACT = "09/30/2026";


function omittedRun(w: DashboardWorld): void {
  queuedEventOf(w, { seed: 1, lifecycle: TERMINAL_DONE });
  claimEventOf(w, 1);
  const record = runRecordOf({ seed: 1, lifecycle: TERMINAL_DONE });
  w.authority.put(RunRecordSchema.parse({
    ...record,
    envelope: {
      ...record.envelope,
      stepOmissions: [{ step: OMITTED_STEP, facts: { lastDayWorked: TYPED_FACT } }],
    },
  }));
  taskEventsOf(w, 1, "document", "done");
  taskEventsOf(w, 1, "timecard", "skipped", "operator-asserted");
  taskEventsOf(w, 1, "reconcile", "skipped", "step-omitted");
}

function detailOf(w: DashboardWorld) {
  return buildRunDetail(
    { runReader: w.runReader, timeline: w.timeline,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => ({ details: [], version: 1, contractFingerprint: HASH_A, timeline: CATEGORIES }) },
    },
    uuidOf(1),
  );
}

describe("run detail under step omission", () => {
  it("names the omitted step keys and carries none of the typed facts", async () => {
    const w = await world();
    omittedRun(w);

    const detail = detailOf(w);
    assert.deepEqual(detail.omittedSteps, [OMITTED_STEP]);
    assert.equal(JSON.stringify(detail).includes(TYPED_FACT), false);
  });

  it("distinguishes an asserted member from an omitted one inside the same step", async () => {
    const w = await world();
    omittedRun(w);

    const step = detailOf(w).timeline.steps?.find((entry) => entry.label === "Kronos timecard");
    assert.ok(step !== undefined);
    assert.deepEqual(
      step.members.map((member) => [member.label, member.state, member.notRunReason]),
      [["Timecard", "skipped", "operator-asserted"], ["Reconcile", "skipped", "step-omitted"]],
    );
    // The per-event strip carries the same two reasons, from the same spans.
    const events = new Map(detailOf(w).timeline.events.map((event) => [event.label, event.notRun]));
    assert.deepEqual(events.get("timecard"), { state: "present", reason: "operator-asserted" });
    assert.deepEqual(events.get("reconcile"), { state: "present", reason: "step-omitted" });
  });

  it("refuses to call a done run with an omitted step verified-done", async () => {
    const w = await world();
    omittedRun(w);

    const outcome = detailOf(w).outcome;
    assert.equal(outcome.state, "terminal");
    assert.ok(outcome.state === "terminal");
    assert.equal(outcome.result, "partial");

    assert.equal(outcome.rehearsal, undefined);
  });

  it("still calls a settled run with no omission verified-done", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, lifecycle: TERMINAL_DONE });
    claimEventOf(w, 1);
    taskEventsOf(w, 1, "document", "done");

    const detail = detailOf(w);
    assert.equal(detail.omittedSteps, undefined);
    assert.ok(detail.outcome.state === "terminal");
    assert.equal(detail.outcome.result, "verified-done");
  });


  it("refuses a span that recorded a not-run reason beside an outcome that RAN", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, lifecycle: TERMINAL_DONE });
    claimEventOf(w, 1);
    taskEventsOf(w, 1, "timecard", "skipped", "operator-asserted");

    // The emit schema rejects contradictory reasons; retained fold data can still contain them.
    const fold = w.projection.runFold(uuidOf(1));
    const span = fold?.taskSpans.find((entry) => entry.name === "timecard");
    assert.ok(span !== undefined, "the fixture must have folded a timecard span");
    assert.equal(span.notRunReason, "operator-asserted");
    span.outcome = "done";

    assert.throws(
      () => detailOf(w),
      /node "timecard" recorded the not-run reason "operator-asserted" and an outcome this projection folds to "done"/u,
    );
  });

  it("leaves a member whose span recorded no reason without one", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, lifecycle: TERMINAL_DONE });
    claimEventOf(w, 1);
    taskEventsOf(w, 1, "timecard", "skipped");

    const step = detailOf(w).timeline.steps?.find((entry) => entry.label === "Kronos timecard");
    assert.equal(step?.members[0]?.state, "skipped");
    assert.equal(step?.members[0]?.notRunReason, undefined);
  });
});

