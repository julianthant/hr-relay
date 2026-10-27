import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { claimEventOf, DAY, taskEventsOf, traceOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const {world, queuedEventOf, appendOther, seedExitRunShape, cleanup } = createRunQueueProjectionTestWorld();


afterEach(cleanup);

describe("THE run/queue projection", () => {

  it("keeps a re-run node's chip on the CURRENT run attempt when the span path repeats", async () => {

    const w = await world();
    queuedEventOf(w, { seed: 1, attempt: 2 });
    claimEventOf(w, 1);
    const base = {
      workflow: "person-lookup" as const,
      runId: uuidOf(1),
      traceId: traceOf(1),
      spanPath: `${traceOf(1)}/cross-verify#1`,
      parentSpanPath: traceOf(1),
    };
    const ts = (): string => w.clock.now().toISOString();
    w.writer.emit({ ...base, t: "span.started", kind: "task", attempt: 1, ts: ts(), name: "cross-verify" });
    w.writer.emit({ ...base, t: "span.ended", kind: "task", attempt: 1, ts: ts(), outcome: "cancelled" });
    w.writer.emit({ ...base, t: "span.started", kind: "task", attempt: 2, ts: ts(), name: "cross-verify" });
    w.writer.emit({ ...base, t: "span.ended", kind: "task", attempt: 2, ts: ts(), outcome: "done" });

    const row = w.projection.buildDashboardDayWire(DAY).queueSurfaces
      .find((surface) => surface.runId === uuidOf(1));
    assert.ok(row);
    const step = row.pipeline.find((entry) => entry.id === "cross-verify");
    assert.equal(step?.state, "done");

    const detail = buildRunDetail({ runReader: w.runReader, stateRoot: w.stateRoot, timeline: w.timeline, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } }, uuidOf(1));
    const crossVerify = detail.timeline.events.filter((event) => event.label === "cross-verify");
    assert.equal(crossVerify.length, 2);
    assert.equal(new Set(detail.timeline.events.map((event) => event.noteId)).size, detail.timeline.events.length);
    assert.deepEqual(crossVerify.map((event) => event.state), ["cancelled", "done"]);
  });

  it("folds another SQLite connection's task spans — the run enqueued after boot gets its timeline", async () => {

    const w = await world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const base = {
      workflow: "person-lookup", pid: 777, runId: uuidOf(1), attempt: 1,
      traceId: traceOf(1), spanPath: `${traceOf(1)}/searching#1`, parentSpanPath: traceOf(1),
    };
    appendOther(w, { ...base, t: "span.started", kind: "task", ts: w.clock.now().toISOString(), name: "searching" });
    appendOther(w, { ...base, t: "span.ended", kind: "task", ts: w.clock.now().toISOString(), outcome: "done" });

    w.projection.ingestFromTimeline();

    assert.equal(w.projection.health().state, "live");
    const fold = w.projection.runFold(uuidOf(1));
    assert.equal(fold?.taskSpans.length, 1);
    assert.equal(fold?.taskSpans[0].outcome, "done");
    const detail = buildRunDetail({ runReader: w.runReader, stateRoot: w.stateRoot, timeline: w.timeline, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } }, uuidOf(1));
    assert.equal(detail.timeline.events.length > 0, true);
  });
});

describe("settled run presentation retains skip reasons and measured timing", () => {
  it("renders a conditionally-skipped node as SKIPPED with its closed reason, never as cancelled", async () => {
    const w = await world();
    seedExitRunShape(w);

    const detail = buildRunDetail(
      { runReader: w.runReader, stateRoot: w.stateRoot, timeline: w.timeline, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
      uuidOf(1),
    );
    const crmDates = detail.timeline.events.find((event) => event.label === "crm-dates");
    assert.ok(crmDates, "the skipped node must still appear on the timeline");
    assert.equal(crmDates.state, "skipped");
    assert.deepEqual(crmDates.notRun, { state: "present", reason: "condition-false" });

    // "Cancelled" names an act someone took; nobody acted on this run.
    assert.deepEqual(detail.timeline.events.filter((event) => event.state === "cancelled"), []);
    // Every step that DID run keeps an explicit, reasoned absence.
    for (const event of detail.timeline.events.filter((event) => event.state !== "skipped")) {
      assert.equal(event.notRun.state, "absent");
    }
  });

  it("keeps a skipped span whose reason was never recorded explicitly reasonless", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    // A missing skip reason remains absent; do not infer a familiar reason.
    taskEventsOf(w, 1, "crm-dates", "skipped");

    const detail = buildRunDetail(
      { runReader: w.runReader, stateRoot: w.stateRoot, timeline: w.timeline, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
      uuidOf(1),
    );
    const crmDates = detail.timeline.events.find((event) => event.label === "crm-dates");
    assert.ok(crmDates);
    assert.equal(crmDates.state, "skipped");
    assert.equal(crmDates.notRun.state, "absent");
    assert.match(
      crmDates.notRun.state === "absent" ? crmDates.notRun.reason : "",
      /recorded no reason/,
    );
  });
});
