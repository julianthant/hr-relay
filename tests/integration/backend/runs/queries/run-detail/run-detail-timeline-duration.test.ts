
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunDetail } from "../../../../../../src/backend/runs/queries/run-detail.js";
import { timelineEventDuration } from "../../../../../../src/models/dashboard/run-detail.js";
import {
  DAY,
  claimEventOf,
  makeWorld,
  queuedEventOf,
  traceOf,
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

/** A run the projection can render, with nothing on its timeline yet. */
function seedRun(w: DashboardWorld, seed = 1): void {
  queuedEventOf(w, { seed });
  claimEventOf(w, seed);
}

function detailOf(w: DashboardWorld, seed = 1) {
  return buildRunDetail(
    { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
    uuidOf(seed),
  );
}

function spanBase(seed: number, node: string) {
  return {
    workflow: "person-lookup" as const,
    runId: uuidOf(seed),
    traceId: traceOf(seed),
    spanPath: `${traceOf(seed)}/${node}#1`,
    parentSpanPath: traceOf(seed),
    attempt: 1,
    kind: "task" as const,
  };
}

describe("a timeline event's own measured duration", () => {
  it("measures the SPAN, not the gap to the next event", () => {
    const w = world();
    seedRun(w);
    const ts = (): string => w.clock.now().toISOString();


    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.started", ts: ts(), name: "ucpath-person" });
    w.clock.advanceWall(2_000);
    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.ended", ts: ts(), outcome: "done" });
    w.clock.advanceWall(300_000);
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.started", ts: ts(), name: "cross-verify" });
    w.clock.advanceWall(3_000);
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.ended", ts: ts(), outcome: "done" });

    const events = detailOf(w).timeline.events;
    const first = events.find((event) => event.label === "ucpath-person");
    const second = events.find((event) => event.label === "cross-verify");
    assert.deepEqual(timelineEventDuration({ durationMs: first?.durationMs }), { state: "present", ms: 2_000 });
    assert.deepEqual(timelineEventDuration({ durationMs: second?.durationMs }), { state: "present", ms: 3_000 });
    // And the gap between the two events — 302s — appears nowhere.
    assert.equal(events.some((event) => event.durationMs?.state === "present" && event.durationMs.ms === 302_000), false);
  });

  it("reports a step still in flight as absent, naming the missing end", () => {
    const w = world();
    seedRun(w);
    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.started", ts: w.clock.now().toISOString(), name: "ucpath-person" });
    w.clock.advanceWall(4_000);

    const event = detailOf(w).timeline.events.find((candidate) => candidate.label === "ucpath-person");
    const measured = timelineEventDuration({ durationMs: event?.durationMs });
    assert.equal(measured.state, "absent");
    // Unfinished steps have no measured duration; their running clock is a separate fact.
    assert.match(measured.state === "absent" ? measured.reason : "", /has not ended/);
  });

  it("reports a span whose START never reached the fold as absent, not as zero", () => {
    const w = world();
    seedRun(w);
    // A projection tail seeded mid-run sees the end and never the start. The
    // run's own queue instant is a plausible substitute and a wrong one.
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.ended", ts: w.clock.now().toISOString(), outcome: "done" });

    const event = detailOf(w).timeline.events.find((candidate) => candidate.label === "cross-verify");
    const measured = timelineEventDuration({ durationMs: event?.durationMs });
    assert.equal(measured.state, "absent");
    assert.match(measured.state === "absent" ? measured.reason : "", /no span\.started was folded/);
  });

  it("gives a zero-length step a real zero, which is not an absence", () => {
    const w = world();
    seedRun(w);
    const ts = w.clock.now().toISOString();
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.started", ts, name: "cross-verify" });
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.ended", ts, outcome: "done" });

    const event = detailOf(w).timeline.events.find((candidate) => candidate.label === "cross-verify");
    // "It took less than a millisecond" and "we could not measure it" must not
    // render as the same thing; the present arm admits zero for that reason.
    assert.deepEqual(timelineEventDuration({ durationMs: event?.durationMs }), { state: "present", ms: 0 });
  });

  it("serves the leaf on EVERY event the live query builds", () => {
    const w = world();
    seedRun(w);
    const ts = (): string => w.clock.now().toISOString();
    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.started", ts: ts(), name: "ucpath-person" });
    w.clock.advanceWall(1_000);
    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.ended", ts: ts(), outcome: "done" });
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.started", ts: ts(), name: "cross-verify" });

    const events = detailOf(w).timeline.events;
    assert.equal(events.length > 0, true);
    // Optional duration fields admit archived bytes; live details must declare measured or unmeasured.
    for (const event of events) {
      assert.notEqual(event.durationMs, undefined, `${event.label} carries no duration leaf`);
    }
  });

  it("refuses to put a gate's WAIT in the step column", () => {
    const w = world();
    seedRun(w);
    w.writer.emit({
      t: "gate.opened",
      ts: w.clock.now().toISOString(),
      workflow: "person-lookup",
      runId: uuidOf(1),
      attempt: 1,
      traceId: traceOf(1),
      spanPath: traceOf(1),
      gate: "identity-approval",
    });
    w.clock.advanceWall(600_000);

    const event = detailOf(w).timeline.events.find((candidate) => candidate.label === "gate:identity-approval");
    const measured = timelineEventDuration({ durationMs: event?.durationMs });
    assert.equal(measured.state, "absent");
    // A park's ten minutes is a real fact about a HUMAN, and putting it under
    // a node's name would report thinking time as execution time.
    assert.match(measured.state === "absent" ? measured.reason : "", /a gate is not a task span/);
  });

  it("reads a FROZEN record with no duration leaf forward, by name", () => {

    const measured = timelineEventDuration({});
    assert.equal(measured.state, "absent");
    assert.match(measured.state === "absent" ? measured.reason : "", /frozen before per-step durations/);
  });
});

describe("the day the timeline is read from", () => {
  it("still renders a full day's wire beside the durations", () => {
    const w = world();
    seedRun(w);
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
  });
});
