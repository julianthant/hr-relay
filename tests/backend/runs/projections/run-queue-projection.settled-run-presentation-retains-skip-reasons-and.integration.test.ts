import { RunLifecycleSchema,RunRecordSchema } from "../../../../src/models/run/record.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import {
claimEventOf,
DAY,
makeWorld,
queuedEventOf as queuedEventBase,
runRecordOf as runRecordBase,
taskEventsOf,
traceOf,
uuidOf,
type DashboardWorld
} from "../../../support/helpers/backend/dashboard-harness.js";

/** C completion contract: projection fixtures still carry a valid terminal settlement. */
function runRecordOf(input: Parameters<typeof runRecordBase>[0]) {
  const lifecycle = RunLifecycleSchema.parse(input.lifecycle ?? {state:"queued"});
  if (lifecycle.state !== "terminal" || !["done","failed"].includes(lifecycle.outcome)) return runRecordBase(input);
  const base = runRecordBase({...input,lifecycle:{state:"queued"}});
  const version = Math.max(2,base.version), claimGeneration = Math.max(1,base.claimGeneration);
  return RunRecordSchema.parse({...base,lifecycle,version,claimGeneration,updatedAt:lifecycle.endedAt,completion:{
    schemaVersion:1,kind:lifecycle.outcome,expectedVersion:version-1,
    claim:{workerId:"queue-fixture-worker",claimGeneration},authorizedAt:lifecycle.endedAt,
    ...(lifecycle.outcome === "done" ? {resultDigest:"a".repeat(64)} : {failureId:lifecycle.failureId}),
  }});
}
function queuedEventOf(w: DashboardWorld, input: Parameters<typeof runRecordBase>[0]) {
  const event = queuedEventBase(w,{...input,lifecycle:{state:"queued"}});
  if (input.lifecycle !== undefined) w.authority.put(runRecordOf({...input,enqueuedAt:input.enqueuedAt ?? w.clock.now().toISOString()}));
  return event;
}

const worlds: DashboardWorld[] = [];

function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
  const created = makeWorld(...args);
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const CLAIM = {
  workerId: "person-lookup-worker-1",
  claimedAt: "2026-08-03T17:00:05.000Z",
  heartbeatAt: "2026-08-03T17:00:05.000Z",
} as const;

describe("settled run presentation retains skip reasons and measured timing", () => {
  /** Exactly the exit run's node walk, at one run attempt. */
  function seedExitRunShape(w: DashboardWorld): void {
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    taskEventsOf(w, 1, "searching", "done");
    taskEventsOf(w, 1, "cross-verify", "done");
    taskEventsOf(w, 1, "active-status", "done");
    taskEventsOf(w, 1, "crm-dates", "skipped", "condition-false");
    w.writer.emit({
      t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), outcome: "done",
    });
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: { state: "terminal", outcome: "done", endedAt: "2026-08-03T17:14:30.000Z" },
      version: 3,
    }));
  }

  it("serves the terminal instant on a settled row and an explicit absence while in flight", () => {
    const w = world();
    seedExitRunShape(w);
    queuedEventOf(w, { seed: 2 });
    w.authority.put(runRecordOf({
      seed: 2, lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1, version: 2,
    }));
    claimEventOf(w, 2);

    const day = w.projection.buildDashboardDayWire(DAY);
    const done = day.queueSurfaces.find((surface) => surface.runId === uuidOf(1));
    const running = day.queueSurfaces.find((surface) => surface.runId === uuidOf(2));
    assert.ok(done && running);
    assert.deepEqual(done.endedAt, { state: "present", value: "2026-08-03T17:14:30.000Z" });
    assert.equal(running.endedAt.state, "absent");
  });

  it("ignores a stale run end and leaves a nonterminal run undated", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    // The span contradicts canonical queued authority; neither status nor duration may follow it.
    w.writer.emit({
      t: "span.ended", kind: "run", ts: "2026-08-03T17:20:00.000Z", workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), outcome: "cancelled",
    });
    const surface = w.projection.buildDashboardDayWire(DAY).queueSurfaces
      .find((row) => row.runId === uuidOf(1));
    assert.ok(surface);
    assert.equal(surface.status, "queued");
    assert.deepEqual(surface.endedAt, { state: "absent", reason: "run is queued and has not ended" });
  });
});
