
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { RunDetailWireSchema } from "../../../../../../src/models/dashboard/run-detail.js";
import { buildRunDetail } from "../../../../../../src/backend/runs/queries/run-detail.js";
import type { RunDetailDescriptorView } from "../../../../../../src/backend/runs/queries/run-detail.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import {
  claimEventOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  taskEventsOf,
  uuidOf,
  type DashboardWorld,
} from "../../../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const CATEGORIES: NonNullable<RunDetailDescriptorView["timeline"]> = [
  { label: "Kuali extraction", nodes: [{ id: "document", label: "Separation Document" }] },
  { label: "Kronos timecard", nodes: [{ id: "timecard", label: "Timecard" }, { id: "reconcile", label: "Reconcile" }] },
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
      descriptors: { resolve: () => ({ details: [], timeline: CATEGORIES }) },
    },
    uuidOf(1),
  );
}

describe("run detail under step omission", () => {
  it("names the omitted step keys and carries none of the typed facts", () => {
    const w = world();
    omittedRun(w);

    const detail = detailOf(w);
    assert.deepEqual(detail.omittedSteps, [OMITTED_STEP]);
    assert.equal(JSON.stringify(detail).includes(TYPED_FACT), false);
  });

  it("distinguishes an asserted member from an omitted one inside the same step", () => {
    const w = world();
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

  it("refuses to call a done run with an omitted step verified-done", () => {
    const w = world();
    omittedRun(w);

    const outcome = detailOf(w).outcome;
    assert.equal(outcome.state, "terminal");
    assert.ok(outcome.state === "terminal");
    assert.equal(outcome.result, "partial");

    assert.equal(outcome.rehearsal, undefined);
  });

  it("still calls a settled run with no omission verified-done", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, lifecycle: TERMINAL_DONE });
    claimEventOf(w, 1);
    taskEventsOf(w, 1, "document", "done");

    const detail = detailOf(w);
    assert.equal(detail.omittedSteps, undefined);
    assert.ok(detail.outcome.state === "terminal");
    assert.equal(detail.outcome.result, "verified-done");
  });


  it("refuses a span that recorded a not-run reason beside an outcome that RAN", () => {
    const w = world();
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

  it("leaves a member whose span recorded no reason without one", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, lifecycle: TERMINAL_DONE });
    claimEventOf(w, 1);
    taskEventsOf(w, 1, "timecard", "skipped");

    const step = detailOf(w).timeline.steps?.find((entry) => entry.label === "Kronos timecard");
    assert.equal(step?.members[0]?.state, "skipped");
    assert.equal(step?.members[0]?.notRunReason, undefined);
  });
});

/* ── the wire's own refusals ─────────────────────────────────────────────── */

const BASE_DETAIL = {
  runId: uuidOf(1),
  rowRevision: 1,
  panelKind: "run",
  header: {
    runId: uuidOf(1),
    traceId: "pl-000619-4ebf",
    workflowId: "person-lookup",
    actorId: "local-operator",
    title: "EID 10873698",
    status: "done",
    attempt: 1,
  },
  timeline: { events: [] },
  gate: { state: "absent", reason: "this run has no gate" },
  outcome: { state: "terminal", result: "verified-done", completedAt: instantOffsetOf(0, 5_000) },
  context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
  availableSections: ["logs"],
} as const;

describe("run detail wire refusals under step omission", () => {
  it("refuses verified-done beside an omitted step", () => {
    assert.throws(
      () => RunDetailWireSchema.parse({ ...BASE_DETAIL, omittedSteps: [OMITTED_STEP] }),
      /a run with an omitted step cannot be verified-done/u,
    );
  });

  it("accepts an omitted step beside a partial outcome", () => {
    const parsed = RunDetailWireSchema.parse({
      ...BASE_DETAIL,
      outcome: { ...BASE_DETAIL.outcome, result: "partial" },
      omittedSteps: [OMITTED_STEP],
    });
    assert.deepEqual(parsed.omittedSteps, [OMITTED_STEP]);
  });

  it("refuses a not-run reason on a member that ran", () => {
    assert.throws(
      () => RunDetailWireSchema.parse({
        ...BASE_DETAIL,
        timeline: {
          events: [],
          steps: [{
            label: "Kronos timecard",
            state: "done",
            members: [{ label: "Timecard", state: "done", notRunReason: "operator-asserted" }],
          }],
        },
      }),
      /a done member cannot carry a not-run reason/u,
    );
  });
});

