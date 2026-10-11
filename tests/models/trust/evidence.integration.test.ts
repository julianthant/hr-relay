import { RunLifecycleSchema,RunRecordSchema } from "../../../src/models/run/record.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { RunEvidenceReceiptSchema } from "../../../src/models/trust/evidence.js";
import {
claimEventOf,
DAY,
instantOffsetOf,
makeWorld,
queuedEventOf as queuedEventBase,
receiptWithWarningsOf,
runRecordOf as runRecordBase,
taskEventsOf,
traceOf,
uuidOf,
type DashboardWorld
} from "../../support/helpers/backend/dashboard-harness.js";

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

/** Seeds: queued(1), running(2), done(3), failed(4), queued(5), operation(6)+members(7,8), gated(9). */
function seedWorld(w: DashboardWorld): void {
  queuedEventOf(w, { seed: 1 });

  queuedEventOf(w, { seed: 2 });
  w.authority.put(runRecordOf({ seed: 2, lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1, version: 2 }));
  claimEventOf(w, 2);
  taskEventsOf(w, 2, "searching");

  queuedEventOf(w, { seed: 3 });
  claimEventOf(w, 3);
  taskEventsOf(w, 3, "searching", "done");
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(3), attempt: 1, traceId: traceOf(3), spanPath: traceOf(3), outcome: "done",
  });
  w.authority.put(runRecordOf({
    seed: 3,
    lifecycle: { state: "terminal", outcome: "done", endedAt: "2026-08-03T17:10:00.000Z" },
    version: 3,
  }));

  queuedEventOf(w, { seed: 4 });
  claimEventOf(w, 4);
  taskEventsOf(w, 4, "searching", "failed");
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(4), attempt: 1, traceId: traceOf(4), spanPath: traceOf(4),
    outcome: "failed", failureId: uuidOf(9004),
  });
  w.authority.put(runRecordOf({
    seed: 4,
    lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:12:00.000Z", failureId: uuidOf(9004) },
    version: 3,
  }));

  queuedEventOf(w, { seed: 5 });

  queuedEventOf(w, { seed: 6, shape: "operation", title: "I-9 batch" });
  queuedEventOf(w, { seed: 7, shape: "operation-member", parentSeed: 6 });
  queuedEventOf(w, { seed: 8, shape: "operation-member", parentSeed: 6 });
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(8), attempt: 1, traceId: traceOf(8), spanPath: traceOf(8),
    outcome: "failed", failureId: uuidOf(9008),
  });
  w.authority.put(runRecordOf({
    seed: 8, shape: "operation-member", parentSeed: 6,
    lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:13:00.000Z", failureId: uuidOf(9008) },
    version: 2,
  }));

  queuedEventOf(w, { seed: 9, lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: instantOffsetOf(0), resumeAt: "approval" } });
  w.writer.emit({
    t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(9), attempt: 1, traceId: traceOf(9), spanPath: traceOf(9), gate: "approval",
  });
}


describe("the queue row's served facts", () => {
  /** A terminal-failed run whose failure record authority holds. */
  function _seedFailed(w: DashboardWorld, seed = 4): void {
    queuedEventOf(w, { seed });
    claimEventOf(w, seed);
    taskEventsOf(w, seed, "searching", "failed");
    w.writer.emit({
      t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed),
      outcome: "failed", failureId: uuidOf(seed + 9000),
    });
    w.authority.put(runRecordOf({
      seed,
      lifecycle: {
        state: "terminal", outcome: "failed",
        endedAt: "2026-08-03T17:12:00.000Z", failureId: uuidOf(seed + 9000),
      },
      version: 3,
    }));
  }

  function rowOf(w: DashboardWorld, seed: number) {
    const surface = w.projection.buildDashboardDayWire(DAY).queueSurfaces
      .find((row) => row.runId === uuidOf(seed));
    assert.ok(surface);
    return surface;
  }

  it("three distinct absences, and never a fabricated zero", () => {
    const w = world();
    seedWorld(w);
    // in flight — nothing has settled
    const running = rowOf(w, 2).warnings;
    assert.equal(running.state, "absent");
    assert.match(running.state === "absent" ? running.reason : "", /has not produced a terminal result/);
    // terminal, but no receipt has been derived
    const noReceipt = rowOf(w, 3).warnings;
    assert.equal(noReceipt.state, "absent");
    assert.match(noReceipt.state === "absent" ? noReceipt.reason : "", /no evidence receipt has been derived/);
    // terminal, receipt derived, genuinely no warning
    w.authority.receipts.set(uuidOf(3), RunEvidenceReceiptSchema.parse({
      ...receiptWithWarningsOf({ seed: 3, summaries: ["only warning"] }),
      warnings: [],
      confidence: "verified",
      result: "verified-done",
    }));
    const clean = rowOf(w, 3).warnings;
    assert.equal(clean.state, "absent");
    assert.match(clean.state === "absent" ? clean.reason : "", /records no warning/);
  });
});
