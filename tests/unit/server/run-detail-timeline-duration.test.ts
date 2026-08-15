/**
 * Per-step durations on the run-detail timeline (doc 03 §1.1 span identity;
 * `docs/findings/archive.md` "Per-step durations in the archived timeline").
 *
 * The measurement is the executor's OWN pair of instants for one span —
 * `span.ended` minus `span.started` at the same `(attempt, spanPath)` — and
 * the whole point of these cases is that it is NOT the gap between adjacent
 * timeline events. The two agree only when nothing sits between two steps, so
 * every case here puts something between them.
 *
 * The absence arms carry as much weight as the present one: a step still
 * running, a step whose start never reached the fold, a gate, and two instants
 * that disagree are four different facts, and none of them is zero.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunDetail } from "../../../src/server/dashboard/queries/run-detail.js";
import { timelineEventDuration } from "../../../src/domain/dashboard/run-detail.js";
import {
  DAY,
  claimEventOf,
  makeWorld,
  queuedEventOf,
  traceOf,
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

/** A run the projection can render, with nothing on its timeline yet. */
function seedRun(w: DashboardWorld, seed = 1): void {
  queuedEventOf(w, { seed });
  claimEventOf(w, seed);
}

function detailOf(w: DashboardWorld, seed = 1) {
  return buildRunDetail(
    { stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
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

    // A 2s read, then FIVE MINUTES of the worker doing something else, then a
    // 3s read. Differencing consecutive events would report the first step as
    // 5m 2s — a real number about the wrong thing, and the exact defect this
    // leaf exists to close.
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
    // Never `now − startedAt`: an unfinished step has no duration, and the
    // running clock is a different fact (D124's queue-row lesson, one level in).
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
    // The leaf is optional ONLY so a pre-D133 archived record parses. A LIVE
    // detail that omitted it would make "not measured" indistinguishable from
    // "frozen before the measurement existed".
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
    // The D133 arm: an archived `RunDetailWire` written before the leaf
    // existed. Nothing back-fills it — a duration nobody measured is not zero.
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
