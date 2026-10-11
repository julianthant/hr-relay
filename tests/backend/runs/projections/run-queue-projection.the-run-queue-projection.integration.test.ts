import { DatabaseSync } from "node:sqlite";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RunLifecycleSchema,RunRecordSchema } from "../../../../src/models/run/record.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

import assert from "node:assert/strict";
import { appendFileSync,mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { createRunQueueProjection } from "../../../../src/backend/runs/projections/run-queue-projection.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { HASH_A,HASH_B,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
APP_VERSION,
claimEventOf,
DAY,
DESCRIPTOR_SET_HASH,
instantOffsetOf,
makeWorld,
queuedEventOf as queuedEventBase,
runRecordOf as runRecordBase,
taskEventsOf,
traceOf,
uuidOf,
workerLeaseOf,
type DashboardWorld
} from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor,separationsDescriptor } from "../../../support/helpers/registered-workflows.js";

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
function corruptLatest(w: DashboardWorld): void {
  using raw = new DatabaseSync(join(w.stateRoot, "authority.db"));
  const sql = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='timeline_events_immutable'").get()?.sql;
  assert.equal(typeof sql, "string");
  if (typeof sql !== "string") throw new Error("missing timeline immutable guard");
  raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON");
  try { assert.equal(raw.prepare("UPDATE timeline_events SET payload_json='{}' WHERE cursor=(SELECT MAX(cursor) FROM timeline_events)").run().changes, 1); }
  finally { raw.exec(sql); }
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

describe("THE run/queue projection", () => {
  it("shows the six declared Separations steps in the queue pipeline", () => {
    const w = world({ descriptors: { resolve: () => separationsDescriptor } });
    queuedEventOf(w, { seed: 1, workflow: "separations", lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1, version: 2 });

    const pipeline = w.projection.queueSurface(uuidOf(1))?.pipeline;
    assert.deepEqual(pipeline?.map(({ id, label }) => ({ id, label })), [
      { id: "kuali-extraction", label: "Kuali extraction" },
      { id: "identity-check", label: "Identity check" },
      { id: "job-summary", label: "Job summary" },
      { id: "kronos-timecard", label: "Kronos timecard" },
      { id: "ucpath-transaction", label: "UCPath transaction" },
      { id: "kuali-finalization", label: "Kuali finalization" },
    ]);
    assert.deepEqual(pipeline?.map(({ state }) => state), Array(6).fill("pending"));

    const base = { workflow: "separations", runId: uuidOf(1), attempt: 1, traceId: traceOf(1) } as const;
    const first = `${traceOf(1)}/resolve-action#1`;
    w.writer.emit({ ...base, t: "span.started", kind: "task", spanPath: first, parentSpanPath: traceOf(1), name: "resolve-action", ts: instantOffsetOf(0, 1_000) });
    w.writer.emit({ ...base, t: "span.ended", kind: "task", spanPath: first, outcome: "done", ts: instantOffsetOf(0, 1_600) });
    const second = `${traceOf(1)}/document#1`;
    w.writer.emit({ ...base, t: "span.started", kind: "task", spanPath: second, parentSpanPath: traceOf(1), name: "document", ts: instantOffsetOf(0, 2_000) });
    assert.deepEqual(w.projection.queueSurface(uuidOf(1))?.pipeline.map(({ state }) => state),
      ["active", "pending", "pending", "pending", "pending", "pending"]);

    w.writer.emit({ ...base, t: "gate.opened", spanPath: traceOf(1), gate: "identity-approval", ts: instantOffsetOf(0, 3_000) });
    assert.deepEqual(w.projection.queueSurface(uuidOf(1))?.pipeline.map(({ state }) => state),
      ["active", "blocked", "pending", "pending", "pending", "pending"]);

    w.writer.emit({ ...base, t: "span.ended", kind: "task", spanPath: second, outcome: "done", ts: instantOffsetOf(0, 3_600) });
    assert.equal(w.projection.queueSurface(uuidOf(1))?.pipeline[0]?.durationSec, 2,
      "category time rounds the combined 2.2 seconds, not each node separately");
  });


  it("serves each row the controls its descriptor enables, bound to that row's revision", () => {
    const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
    seedWorld(w);
    const day = w.projection.buildDashboardDayWire(DAY);

    const actionKeys = (seed: number): string[] =>
      (day.queueSurfaces.find(({ runId }) => runId === uuidOf(seed))?.actions ?? []).map(({ key }) => key);
    assert.deepEqual(actionKeys(1), ["bump", "cancel", "rename"], "the queued row");
    assert.deepEqual(actionKeys(2), ["cancel", "rename"], "the running row");

    assert.deepEqual(actionKeys(3), ["rerun", "rename", "delete"], "the done row");
    assert.deepEqual(actionKeys(4), ["rerun", "rename", "delete"], "the failed row");
    assert.deepEqual(actionKeys(9), ["cancel", "rename"], "the awaiting-approval row");

    assert.deepEqual(actionKeys(8), []);
    // The operation's cancel is the TREE cancel, keyed so the footer titles it
    // with its blast radius.
    assert.equal(actionKeys(6).includes("cancel-tree"), true);

    for (const surface of day.queueSurfaces) {
      if (surface.runId === uuidOf(8)) continue; // the settled member, above
      assert.ok(surface.actions.length > 0, `row ${surface.runId} was served no control at all`);
      for (const action of surface.actions) {
        if (action.kind === "navigation") {
          assert.equal(action.key, "rerun");
          if (action.navigate.kind !== "rerun") {
            assert.fail(`${surface.runId}/${action.key} was not a rerun navigation`);
          }
          assert.equal(action.navigate.expectedVersion, surface.rowRevision, `${surface.runId}/${action.key}`);
          continue;
        }
        assert.equal(action.kind, "command");
        assert.equal(action.expectedVersion, surface.rowRevision, `${surface.runId}/${action.key}`);
      }
    }
  });

  it("projects a worker card from its authority lease, with the sessions its spans hold open", () => {

    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({
      // Keep launch-time lease requirements different from the current registry to detect accidental rewriting.
      browserSystems: ["kuali"],
      lifecycle: {
        state: "busy",
        startedAt: instantOffsetOf(0),
        heartbeatAt: instantOffsetOf(0, 2_000),
        runId: uuidOf(1),
      },
      version: 7,
    }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", name: "person-lookup",
    });
    w.writer.emit({
      t: "span.started", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1",
      spanPath: `worker/person-lookup/person-lookup-worker-1/browser:ucpath#${uuidOf(50)}`,
      parentSpanPath: "worker/person-lookup/person-lookup-worker-1",
      name: "browser-session:ucpath", system: "ucpath",
    });
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerCards.length, 1);
    const card = day.workerCards[0];
    assert.equal(card.workflowId, "person-lookup");
    assert.equal(card.state, "working");
    assert.equal(card.directive, "run");
    assert.equal(card.startedAt, instantOffsetOf(0));
    assert.equal(card.endedAt, undefined);
    // The CAS basis a `stop-worker` cites is the lease's version, never the
    // span counter beside it.
    assert.equal(card.leaseVersion, 7);
    assert.notEqual(Number(card.leaseVersion), Number(card.revision));
    assert.deepEqual(card.browsers, [
      { sessionId: uuidOf(50), system: "ucpath", openedAt: instantOffsetOf(0), observation: { state: "unavailable", reason: "No current owner observation." } },
    ]);
    assert.deepEqual(card.browserRequirements, { state: "present", systems: ["kuali"] });
    assert.deepEqual(card.currentRun, { state: "present", runId: uuidOf(1), traceId: traceOf(1) });
  });

  it("closes a browser tile when its session closes, and keeps a dead worker holding nothing", () => {
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf());
    const spanPath = `worker/person-lookup/person-lookup-worker-1/browser:ucpath#${uuidOf(50)}`;
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", name: "person-lookup",
    });
    w.writer.emit({
      t: "span.started", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath, parentSpanPath: "worker/person-lookup/person-lookup-worker-1",
      name: "browser-session:ucpath", system: "ucpath",
    });
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0].browsers.length, 1);

    // A POISON close still closes: the session ended badly rather than still
    // being there to act on.
    w.writer.emit({
      t: "span.ended", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath, parentSpanPath: "worker/person-lookup/person-lookup-worker-1",
      outcome: "failed", errorSummary: "browser session closed as poisoned",
    });
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY).workerCards[0].browsers, []);
  });

  it("splits a settled lease by its recorded reason and serves the terminal facts", () => {
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({
      workerId: "person-lookup-worker-1",
      lifecycle: {
        state: "stopped",
        startedAt: instantOffsetOf(0),
        stoppedAt: instantOffsetOf(0, 60_000),
        reason: "operator",
      },
      directive: "stop",
      version: 4,
    }));
    w.authority.putWorkerLease(workerLeaseOf({
      workerId: "person-lookup-worker-2",
      lifecycle: {
        state: "stopped",
        startedAt: instantOffsetOf(0),
        stoppedAt: instantOffsetOf(0, 30_000),
        reason: "crashed",
      },
      directive: "stop",
      version: 9,
    }));
    for (const workerId of ["person-lookup-worker-1", "person-lookup-worker-2"]) {
      w.writer.emit({
        t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
        workerId, spanPath: `worker/person-lookup/${workerId}`, name: "person-lookup",
      });
      w.writer.emit({
        t: "span.started", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
        workerId, spanPath: `worker/person-lookup/${workerId}/browser:ucpath#${uuidOf(51)}`,
        parentSpanPath: `worker/person-lookup/${workerId}`, name: "browser-session:ucpath", system: "ucpath",
      });
    }

    const [stopped, failed] = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.stopReason, "operator");
    assert.equal(stopped.endedAt, instantOffsetOf(0, 60_000));

    assert.equal(failed.state, "failed");
    assert.equal(failed.stopReason, "crashed");
    assert.deepEqual(stopped.browsers, []);
    assert.deepEqual(failed.browsers, []);
  });

  it("stays live over observed-data and transaction-fence beats and rebuilds identically", () => {

    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const base = {
      workflow: "person-lookup" as const,
      runId: uuidOf(1),
      traceId: traceOf(1),
      spanPath: `${traceOf(1)}/searching#1.1`,
      parentSpanPath: traceOf(1),
      attempt: 1,
    };
    const ts = (): string => w.clock.now().toISOString();
    w.writer.emit({ ...base, t: "span.started", kind: "task", ts: ts(), name: "searching" });
    w.writer.emit({
      ...base, t: "data.observed", ts: ts(), observedAt: ts(),
      nodeId: "searching", taskId: "ucpath/search-person-org",
      points: [{
        direction: "read",
        field: "selection",
        values: [
          { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "resolved" },
          { key: "selection.selected.emplId", state: "transformed", classification: "direct-identifier", transform: "last4", value: "6712" },
        ],
      }],
    });
    w.writer.emit({
      ...base,
      t: "transaction.fenced",
      ts: ts(),
      spanPath: `${traceOf(1)}/searching/commit`,
      node: "searching",
      taskId: "ucpath/create-termination",
    });
    w.writer.emit({ ...base, t: "span.ended", kind: "task", ts: ts(), outcome: "done" });
    assert.equal(w.projection.health().state, "live");

    const before = w.projection.buildDashboardDayWire(DAY);
    const fresh = createRunQueueProjection({
      timeline: w.timeline,
      reader: w.runReader,
      stateRoot: w.stateRoot,
      clock: w.clock,
      appVersion: APP_VERSION,
      descriptorSetHash: DESCRIPTOR_SET_HASH,
      ledger: createTransactionHistory(w.database.authority),
      authority: w.authority,
      descriptors: { resolve: () => undefined },
    });
    fresh.rebuildFromTimeline();
    assert.equal(fresh.health().state, "live");
    assert.deepEqual(
      { ...fresh.buildDashboardDayWire(DAY), projectionGeneration: 0, snapshotCursor: "pc:1" },
      { ...before, projectionGeneration: 0, snapshotCursor: "pc:1" },
    );
  });

  it("rebuilds optional evidence in memory without changing canonical runs", () => {
    const w = world();
    seedWorld(w);
    const before = w.runReader.list({ disposition: "live", limit: 1000 });
    w.projection.rebuildFromTimeline();
    assert.deepEqual(w.runReader.list({ disposition: "live", limit: 1000 }), before);
    assert.equal(w.projection.runFold(uuidOf(9))?.queued.runId, uuidOf(9));
  });

  it("rebuilds the identical day payload from nothing but the span JSONL", () => {
    const w = world();
    seedWorld(w);
    const before = w.projection.buildDashboardDayWire(DAY);

    const fresh = createRunQueueProjection({
      timeline: w.timeline,
      reader: w.runReader,
      stateRoot: w.stateRoot,
      clock: w.clock,
      appVersion: APP_VERSION,
      descriptorSetHash: DESCRIPTOR_SET_HASH,
      ledger: createTransactionHistory(w.database.authority),
      authority: w.authority,
      descriptors: { resolve: () => undefined },
    });
    fresh.rebuildFromTimeline();
    assert.equal(fresh.health().state, "live");
    const after = fresh.buildDashboardDayWire(DAY);
    assert.deepEqual(
      { ...after, projectionGeneration: 0, snapshotCursor: "pc:1" },
      { ...before, projectionGeneration: 0, snapshotCursor: "pc:1" },
    );
  });

  it("stays loudly degraded when a stored timeline row is corrupt", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    corruptLatest(w);
    w.projection.rebuildFromTimeline();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /timeline rebuild failed/);
  });



  /** A raw stream line as ANOTHER process would append it — no writer, no apply. */
  function rawQueuedLineOf(w: DashboardWorld, seed: number, workflow: string): string {
    return JSON.stringify({
      t: "run.queued", kind: "run", pid: 777,
      ts: w.clock.now().toISOString(),
      workflow,
      runId: uuidOf(seed), attempt: 1,
      traceId: traceOf(seed), spanPath: traceOf(seed),
      itemId: uuidOf(seed + 5000),
      shape: "single", priority: "interactive", dryRun: false,
      actorId: "local-operator",
      title: `raw #${String(seed)}`,
      descriptorVersion: 1,
      contractFingerprint: HASH_A,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: HASH_B,
      configSnapshotId: UUID_4,
    });
  }

  it("folds each line exactly once — its own emissions included — and an idle tick changes nothing", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 }); // the harness writer already ticked the tail once
    w.projection.ingestFromTimeline();
    w.projection.ingestFromTimeline();
    assert.equal(w.projection.health().state, "live");
    // A refold would either throw `run.queued replayed` (degrading) or bump
    // the event count; exactly-once means neither happened.
    assert.equal(w.projection.runFold(uuidOf(1))?.eventCount, 1);
  });

  it("does not observe another connection's uncommitted event, then sees it once after commit", () => {
    const w = world(); queuedEventOf(w, { seed: 1 });
    const other = otherConnection(w);
    try {
      other.database.withAuthorityTransaction(() => {
      other.writer.emit({ workflow: "person-lookup", runId: uuidOf(1), attempt: 1,
        traceId: traceOf(1), spanPath: `${traceOf(1)}/searching#1`, parentSpanPath: traceOf(1),
        t: "span.started", kind: "task", ts: w.clock.now().toISOString(), name: "searching" });
      w.projection.ingestFromTimeline();
      assert.equal(w.projection.health().state, "live");
      assert.equal(w.projection.runFold(uuidOf(1))?.taskSpans.length, 0);
      });
      w.projection.ingestFromTimeline(); w.projection.ingestFromTimeline();
      assert.equal(w.projection.runFold(uuidOf(1))?.taskSpans.length, 1);
    } finally { other.database.close(); }
  });

  it("ignores changed, corrupt and torn retired span files after SQLite history is available", () => {
    const w = world(); queuedEventOf(w, { seed: 1 });
    const before = w.projection.buildDashboardDayWire(DAY);
    mkdirSync(join(w.stateRoot, "spans"));
    appendFileSync(join(w.stateRoot, "spans", `person-lookup-${DAY}.jsonl`), "not-json\n{torn");
    w.projection.ingestFromTimeline();
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY), before);
    w.projection.rebuildFromTimeline();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(1))?.eventCount, 1);
  });

  it("notices a workflow whose first SQLite event arrives after boot", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    const nativeOwner = runRecordOf({ seed: 2, workflow: "zz-flow" });
    w.authority.put(nativeOwner);
    w.database.authority.runs.enqueue(nativeOwner);
    appendOther(w, JSON.parse(rawQueuedLineOf(w, 2, "zz-flow")));
    w.projection.ingestFromTimeline();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(2))?.queued.workflow, "zz-flow");
  });

  it("degrades on a corrupt newly ingested record and the guarded rebuild refuses it", () => {
    const w = world({ collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    appendOther(w, { t: "span.started", kind: "worker", workflow: "person-lookup", workerId: "other-worker",
      spanPath: "worker/other-worker", ts: w.clock.now().toISOString(), name: "Worker" });
    corruptLatest(w);
    w.projection.ingestFromTimeline();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /timeline ingest failed/);
    assert.equal(w.scheduledRebuilds.length, 1);
    // The line is real history on disk, so recovery cannot succeed either —
    // it refuses the same line by name instead of quietly reading past it.
    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /timeline rebuild failed/);
    assert.throws(() => w.projection.buildDashboardDayWire(DAY), /degraded and refuses to serve counts/);
  });

  it("a rebuild resets the tail cursors, so replayed history is never refolded", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    w.projection.rebuildFromTimeline();
    w.projection.ingestFromTimeline();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(1))?.eventCount, 2);
  });

  it("refuses to render a span-known run that authority does not hold", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.records.delete(uuidOf(1));
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY).queueSurfaces, []);
    assert.equal(w.projection.queueSurface(uuidOf(1)), undefined);
  });

  it("emits count-neutral patches and count-bearing snapshots on the right events", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 }); // new run: snapshot
    w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1 }));
    claimEventOf(w, 1); // canonical queued -> running: snapshot
    taskEventsOf(w, 1, "searching"); // still running: patch
    const kinds = w.changes.map(({ kind }) => kind);
    assert.deepEqual(kinds, ["snapshot", "snapshot", "patch"]);
    const patch = w.changes[2];
    if (patch.kind !== "patch") assert.fail("expected a patch change");
    assert.equal(patch.day, DAY);
    assert.equal(patch.patch.operation, "replace-queue-surface");
  });
});
