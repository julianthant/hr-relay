import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RunLifecycleSchema,RunRecordSchema } from "../../../../src/models/run/record.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import {
claimEventOf,
cleanReceiptOf,
DAY,
instantOffsetOf,
makeWorld,
queuedEventOf as queuedEventBase,
receiptWithOutputOf,
runEndedEventOf,
runRecordOf as runRecordBase,
taskEventsOf,
traceOf,
uuidOf,
type DashboardWorld
} from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

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

function otherConnection(w: DashboardWorld, pid = 777) {
  const database = AuthorityDatabase.open({ path: join(w.stateRoot, "authority.db"),
    busyTimeoutMs: 500, migrationOwner: "projection-peer-fixture" }, w.clock);
  return { database, writer: createTimelineEmitter({ repository: database.authority.timelineEvents, clock: w.clock, pid }) };
}
function appendOther(w: DashboardWorld, event: unknown, pid = 777): void {
  const other = otherConnection(w, pid);
  try { other.writer.emit(event); } finally { other.database.close(); }
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});


describe("the queue row's ordinal, class, links and outcome", () => {
  const ORDINAL_CLAIM = {
    workerId: "person-lookup-worker-1",
    claimedAt: "2026-08-03T17:00:05.000Z",
    heartbeatAt: "2026-08-03T17:00:05.000Z",
  } as const;

  function terminalDone(w: DashboardWorld, seed: number, over: Record<string, unknown> = {}): void {
    queuedEventOf(w, { seed, ...over });
    claimEventOf(w, seed);
    runEndedEventOf(w, seed, "done");
    w.authority.put(runRecordOf({
      seed,
      ...over,
      lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 60_000) },
      claimGeneration: 1,
      version: 3,
    }));
  }

  it("serves the durable ordinal and names the absence of an unstamped one", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, runNumber: 12 });
    queuedEventOf(w, { seed: 2 });
    const rows = w.projection.buildDashboardDayWire(DAY).queueSurfaces;
    assert.deepEqual(rows[0].runNumber, { state: "present", value: 12 });
    // The read-forward arm: a run enqueued before schema v15 carries none, and
    // the projection never computes one from the row's position in this array.
    assert.deepEqual(rows[1].runNumber, {
      state: "absent",
      reason: "workflow ordinal was not recorded at enqueue",
    });
  });
  it("serves the worker POOL block from authority — one entry per planned workflow, absent means version 0", () => {
    const w = world();
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY).workerPools, []);
    w.authority.putWorkerPool({
      workflow: "person-lookup", desiredWorkers: 2, plannedBy: "local-operator",
      plannedAt: instantOffsetOf(0), version: 3, createdAt: instantOffsetOf(0), updatedAt: instantOffsetOf(0),
    });
    w.authority.putWorkerPool({
      workflow: "separations", desiredWorkers: 1, plannedBy: "local-operator",
      plannedAt: instantOffsetOf(0), version: 1, createdAt: instantOffsetOf(0), updatedAt: instantOffsetOf(0),
    });
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual(day.workerPools, [
      { workflowId: "person-lookup", desiredWorkers: 2, version: 3, plannedBy: "local-operator", plannedAt: instantOffsetOf(0) },
      { workflowId: "separations", desiredWorkers: 1, version: 1, plannedBy: "local-operator", plannedAt: instantOffsetOf(0) },
    ]);
    // The pool version is the CAS basis — never a worker card's lease version
    // or revision, which this day does not even have.
    assert.equal(day.workerCards.length, 0);
  });

  it("reads priority from the envelope, which is what a bump rewrites", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, priority: "bulk" });
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces[0].priority, "bulk");

    w.authority.put(runRecordOf({ seed: 1, priority: "interactive", version: 2 }));
    w.projection.refreshRun(uuidOf(1));
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces[0].priority, "interactive");
  });

  it("classifies containment from shape and lineage, and chips only the linked children", () => {

    const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
    queuedEventOf(w, { seed: 1, shape: "operation" });
    queuedEventOf(w, { seed: 2, shape: "operation-member", parentSeed: 1, title: "Ada Lovelace" });
    queuedEventOf(w, { seed: 3, shape: "operation-member", parentSeed: 1, title: "Grace Hopper" });
    // A `single` child of the same parent is DELEGATED, not fanned out: it keeps
    // its own row in its own panel, so the parent chips it instead of counting it.
    queuedEventOf(w, { seed: 4, shape: "single", parentSeed: 1, title: "Oath Upload" });

    const rows = w.projection.buildDashboardDayWire(DAY).queueSurfaces;
    const byRun = new Map(rows.map((row) => [String(row.runId), row]));
    const group = byRun.get(uuidOf(1));
    const member = byRun.get(uuidOf(2));
    const linked = byRun.get(uuidOf(4));
    assert.ok(group !== undefined && member !== undefined && linked !== undefined);
    assert.equal(group.containment, "root");
    assert.equal(member.containment, "member");
    assert.equal(linked.containment, "linked");

    // The two partitions are disjoint: the linked child is chipped and NOT
    // counted, the members are counted and NOT chipped.
    assert.ok(group.surfaceKind === "operation");
    assert.deepEqual(group.memberRunIds, [uuidOf(2), uuidOf(3)]);
    assert.equal(group.memberRollup.total, 2);
    assert.deepEqual(group.linkedRuns, [{
      runId: uuidOf(4),
      workflowId: "person-lookup",
      label: personLookupDescriptor.label,
      panelKind: "run",
      status: "queued",
    }]);
    // A childless row's empty list is a real answer, exactly as `actions` is.
    assert.deepEqual(linked.linkedRuns, []);
    // A build that cannot resolve the descriptor labels the chip with what the
    // run IS, never with a guessed pretty name.
    const unregistered = world();
    queuedEventOf(unregistered, { seed: 1, shape: "operation" });
    queuedEventOf(unregistered, { seed: 4, shape: "single", parentSeed: 1 });
    const bare = unregistered.projection.queueSurface(uuidOf(1));
    assert.equal(bare?.linkedRuns[0]?.label, "person-lookup");
    // And the group names its members rather than only counting them.
    assert.deepEqual(group.memberPreview, { state: "present", value: "Ada Lovelace, Grace Hopper" });
  });

  it("names the absence of a member preview a group cannot compose", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, shape: "operation" });
    const group = w.projection.buildDashboardDayWire(DAY).queueSurfaces[0];
    assert.ok(group.surfaceKind === "operation");
    assert.deepEqual(group.memberPreview, {
      state: "absent",
      reason: "this group has fanned out to no members yet",
    });
  });

  it("chips the receipt's own printable outputs, and keeps four absences apart", () => {
    const w = world();
    // 1 — in flight: no terminal result exists to have facts about.
    queuedEventOf(w, { seed: 1 });

    terminalDone(w, 2);
    // 3 — a derived receipt that recorded no output at all.
    terminalDone(w, 3);
    w.authority.receipts.set(uuidOf(3), cleanReceiptOf({ seed: 3 }));
    // 4 — every output leaf redacted or structured: nothing the queue may print.
    terminalDone(w, 4);
    w.authority.receipts.set(uuidOf(4), receiptWithOutputOf({
      seed: 4,
      outputs: [
        { field: "ssn", value: "xxx-xx-1234", redact: "drop" },
        { field: "grid", value: { rows: 3 } },
      ],
    }));
    // 5 — the ordinary settled run: allowed primitives become chips.
    terminalDone(w, 5);
    w.authority.receipts.set(uuidOf(5), receiptWithOutputOf({
      seed: 5,
      outputs: [
        { field: "displayedName", value: "Ada Lovelace" },
        { field: "hdh", value: true },
        { field: "records", value: 6 },
        { field: "ssn", value: "xxx-xx-1234", redact: "drop" },
      ],
    }));

    const byRun = new Map(w.projection.buildDashboardDayWire(DAY).queueSurfaces.map((row) => [String(row.runId), row.facts]));
    assert.deepEqual(byRun.get(uuidOf(1)), {
      state: "absent",
      reason: "run is queued and has not produced a terminal result",
    });
    assert.deepEqual(byRun.get(uuidOf(2)), {
      state: "absent",
      reason: "no evidence receipt has been derived for this run, so its outputs are unknown",
    });
    assert.deepEqual(byRun.get(uuidOf(3)), {
      state: "absent",
      reason: "this run's evidence receipt records no output fact",
    });
    assert.deepEqual(byRun.get(uuidOf(4)), {
      state: "present",
      value: [{ label: "grid", value: '{"rows":3}' }],
    });
    assert.deepEqual(byRun.get(uuidOf(5)), {
      state: "present",
      value: [
        { label: "displayedName", value: "Ada Lovelace" },
        { label: "hdh", value: "true" },
        { label: "records", value: "6" },
      ],
    });
  });

  it("sums a step's duration over every execution and leaves an unmeasured step undated", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "running", ...ORDINAL_CLAIM }, claimGeneration: 1, version: 2 }));
    claimEventOf(w, 1);
    const base = {
      workflow: "person-lookup",
      runId: uuidOf(1),
      traceId: traceOf(1),
      attempt: 1,
    } as const;

    const first = `${traceOf(1)}/searching#1`;
    const second = `${traceOf(1)}/searching#2`;
    w.writer.emit({ ...base, spanPath: first, t: "span.started", kind: "task", ts: instantOffsetOf(0, 1_000), parentSpanPath: traceOf(1), name: "searching" });
    w.writer.emit({ ...base, spanPath: first, t: "span.ended", kind: "task", ts: instantOffsetOf(0, 5_000), outcome: "done" });
    w.writer.emit({ ...base, spanPath: second, t: "span.started", kind: "task", ts: instantOffsetOf(0, 9_000), parentSpanPath: traceOf(1), name: "searching" });
    w.writer.emit({ ...base, spanPath: second, t: "span.ended", kind: "task", ts: instantOffsetOf(0, 12_000), outcome: "done" });
    // An OPEN span measures nothing — and an unmeasured step carries no
    // duration rather than a zero, which would read as "instant".
    taskEventsOf(w, 1, "cross-verify");

    const pipeline = w.projection.buildDashboardDayWire(DAY).queueSurfaces[0].pipeline;
    const searching = pipeline.find((step) => step.id === "searching");
    const crossVerify = pipeline.find((step) => step.id === "cross-verify");
    assert.ok(searching !== undefined && crossVerify !== undefined);
    assert.equal(searching.durationSec, 7);
    assert.equal(searching.executions, 2);
    assert.equal(crossVerify.durationSec, undefined);
    assert.equal(crossVerify.executions, undefined);

    assert.deepEqual(pipeline.map((step) => step.id).sort(), ["cross-verify", "searching"]);
  });


  it("binds a close to the LAST OPEN entry at its identity — two executions at one span path stay two facts", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "running", ...ORDINAL_CLAIM }, claimGeneration: 1, version: 2 }));
    claimEventOf(w, 1);
    const base = {
      workflow: "person-lookup", pid: 778, runId: uuidOf(1), attempt: 1,
      traceId: traceOf(1), spanPath: `${traceOf(1)}/searching#1.1`, parentSpanPath: traceOf(1),
    };
    const line = (event: Record<string, unknown>, pid = 778): void => {
      appendOther(w, event, pid);
    };
    line({ ...base, t: "span.started", kind: "task", ts: instantOffsetOf(0, 1_000), name: "searching" });
    line({ ...base, t: "span.ended", kind: "task", ts: instantOffsetOf(0, 5_000), outcome: "done" });
    line({ ...base, t: "span.started", kind: "task", ts: instantOffsetOf(0, 9_000), name: "searching" }, 779);
    line({ ...base, t: "span.ended", kind: "task", ts: instantOffsetOf(0, 12_000), outcome: "done" }, 779);

    w.projection.ingestFromTimeline();

    const fold = w.projection.runFold(uuidOf(1));
    assert.equal(fold?.taskSpans.length, 2);
    assert.deepEqual(fold?.taskSpans.map((span) => [span.startedAt, span.endedAt]), [
      [instantOffsetOf(0, 1_000), instantOffsetOf(0, 5_000)],
      [instantOffsetOf(0, 9_000), instantOffsetOf(0, 12_000)],
    ]);
    const searching = w.projection.buildDashboardDayWire(DAY).queueSurfaces[0].pipeline
      .find((step) => step.id === "searching");
    // 4 s + 3 s — the two executions, never the 11 s between the first start
    // and the second end.
    assert.equal(searching?.durationSec, 7);
    assert.equal(searching?.executions, 2);
  });
});
