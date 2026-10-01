import { RunRecordSchema, RunLifecycleSchema } from "../../../src/domain/run/record.js";
import { DatabaseSync } from "node:sqlite";
import { createTimelineRepository } from "../../../src/infra/sqlite/timeline-repository.js";
import { createTimelineEmitter } from "../../../src/infra/events/timeline-emitter.js";
import { IsoInstantSchema } from "../../../src/domain/ids.js";
import { RunSessionRecordSchema } from "../../../src/domain/run/session.js";
/**
 * THE run/queue projection (ref dashboard-surfaces §2.2-2.3, D81 §10.1): the emit → JSONL →
 * fold → DashboardDayWire round-trip over a seeded world with
 * delegated, gated, failed, and terminal rows; count equality by
 * construction; runs_view persistence; apply-failure degradation with the
 * guarded rebuild-from-native-jsonl recovery; and loud refusal while
 * degraded.
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../../src/domain/dashboard/projection.js";
import { buildRunDetail } from "../../../src/server/dashboard/queries/run-detail.js";
import { createRunQueueProjection } from "../../../src/server/dashboard/projectors/run-queue-projection.js";
import { ProjectionDegradedError } from "../../../src/server/failures.js";
import { RunEvidenceReceiptSchema } from "../../../src/domain/trust/evidence.js";
import { HASH_A, HASH_B, UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";
import {
  APP_VERSION,
  atDayOffset,
  claimEventOf,
  DAY,
  dayOffsetOf,
  DESCRIPTOR_SET_HASH,
  failureRecordOf,
  instantOffsetOf,
  makeWorld,
  notificationRecordOf,
  cleanReceiptOf,
  queuedEventOf as queuedEventBase,
  receiptWithOutputOf,
  receiptWithWarningsOf,
  runEndedEventOf,
  runRecordOf as runRecordBase,
  taskEventsOf,
  traceOf,
  uuidOf,
  workerLeaseOf,
  type DashboardWorld,
} from "../../unit/server/helpers/dashboard-harness.js";
import { createTransactionHistory } from "../../../src/infra/sqlite/transaction-history.js";
import { personLookupDescriptor, separationsDescriptor } from "../../helpers/registered-workflows.js";

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

function otherConnection(w: DashboardWorld) {
  const database = new DatabaseSync(join(w.stateRoot, "timeline.sqlite"));
  const repository = createTimelineRepository({ database, read: (read) => read(),
    assertOwner: (record) => {
      if (record.scope.kind === "run" && w.authority.records.has(record.scope.runId)) {
        database.prepare("INSERT OR IGNORE INTO workflow_runs(record_key) VALUES (?)").run(record.scope.runId);
      }
    }, mutate: (work) => {
      if (database.isTransaction) return work().result;
      database.exec("BEGIN IMMEDIATE");
      try { const result = work().result; database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    } });
  return { database, writer: createTimelineEmitter({ repository, clock: w.clock, pid: 777 }) };
}
function appendOther(w: DashboardWorld, event: unknown): void {
  const other = otherConnection(w);
  try { other.writer.emit(event); } finally { other.database.close(); }
}
function corruptLatest(w: DashboardWorld): void {
  using raw = new DatabaseSync(join(w.stateRoot, "timeline.sqlite"));
  raw.exec("DROP TRIGGER timeline_events_never_updated; PRAGMA ignore_check_constraints=ON");
  raw.exec("UPDATE timeline_events SET record_json='{}' WHERE cursor=(SELECT MAX(cursor) FROM timeline_events)");
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

describe("THE run/queue projection (D81)", () => {
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

  it("folds the seeded world into one payload whose three count renderings agree by construction", () => {
    const w = world();
    seedWorld(w);
    const day = w.projection.buildDashboardDayWire(DAY);
    DashboardDayWireSchema.parse(day);

    // D234: EVERY run is rendered — there are runs and archived runs, and no
    // third class. Members 7/8 ride flat for layout but are contained in the
    // operation's rollup, not in any count.
    const runIds: readonly string[] = day.queueSurfaces.map(({ runId }) => runId);
    assert.equal(runIds.includes(uuidOf(5)), true, "run 5 used to be seeded hidden; D234 retired hiding");
    assert.equal(runIds.includes(uuidOf(7)), true);
    assert.equal(day.queueSurfaces.length, 9);

    const topLevel = day.queueSurfaces.filter(({ surfaceKind }) => surfaceKind !== "member");
    const workflowTotal = day.workflowCounts.reduce((sum, { count }) => sum + count, 0);
    const statusTotal = day.statusCounts.reduce((sum, { count }) => sum + count, 0);
    assert.equal(workflowTotal, topLevel.length);
    assert.equal(statusTotal, topLevel.length);
    assert.equal(workflowTotal, 7);
    assert.deepEqual(day.monthCounts, [{ day: DAY, count: 7 }]);

    const statusOf = (seed: number): string | undefined =>
      day.queueSurfaces.find(({ runId }) => runId === uuidOf(seed))?.status;
    assert.equal(statusOf(1), "queued");
    assert.equal(statusOf(2), "running");
    assert.equal(statusOf(3), "done");
    assert.equal(statusOf(4), "failed");
    assert.equal(statusOf(9), "awaiting-approval");

    const operation = day.queueSurfaces.find(({ runId }) => runId === uuidOf(6));
    assert.equal(operation?.surfaceKind, "operation");
    if (operation?.surfaceKind !== "operation") assert.fail("operation surface missing");
    assert.deepEqual([...operation.memberRunIds].sort(), [uuidOf(7), uuidOf(8)].sort());
    assert.deepEqual(operation.memberRollup, { total: 2, terminal: 1, failed: 1 });

    const running = day.queueSurfaces.find(({ runId }) => runId === uuidOf(2));
    assert.deepEqual(running?.pipeline, [{ id: "searching", label: "searching", state: "active" }]);
    assert.equal(running?.rowRevision, 2);

    const failed = day.queueSurfaces.find(({ runId }) => runId === uuidOf(4));
    assert.equal(failed?.availableSections.includes("failure"), true);
    assert.equal(day.descriptorHash, DESCRIPTOR_SET_HASH);
    // D179: the row carries the build the RUN was enqueued under. The harness
    // seeds runs with no stamp (they predate D179 exactly as the two real runs
    // in authority do), so every row reports the absence with its reason
    // rather than borrowing the build serving the page.
    assert.equal(
      day.queueSurfaces.every(({ appVersion }) => appVersion.state === "absent"),
      true,
    );

    /*
     * Ref frontend-backend-integration §8.5 — this world registers NO descriptor (the same reason its
     * pipeline shows only observed nodes), so no row may draw a control: the
     * `WorkflowActionPolicy` is the workflow's own statement of what it offers,
     * and a build that cannot read it must not guess a default set onto a run
     * it cannot describe. The populated case is the next test.
     */
    assert.equal(day.queueSurfaces.every(({ actions }) => actions.length === 0), true);
  });

  /**
   * The row's controls, joined from the run's OWN descriptor (ref frontend-backend-integration §8.5).
   * `queue-row-actions.test.ts` owns the per-status table; what this projection
   * owes is the join — the right policy, the right lifecycle facts, and the
   * row's own revision as every descriptor's CAS target.
   */
  it("serves each row the controls its descriptor enables, bound to that row's revision", () => {
    const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
    seedWorld(w);
    const day = w.projection.buildDashboardDayWire(DAY);

    const actionKeys = (seed: number): string[] =>
      (day.queueSurfaces.find(({ runId }) => runId === uuidOf(seed))?.actions ?? []).map(({ key }) => key);
    assert.deepEqual(actionKeys(1), ["bump", "cancel", "rename"], "the queued row");
    assert.deepEqual(actionKeys(2), ["cancel", "rename"], "the running row");
    // D308's 🗑 is last, so the footer's most destructive control is furthest
    // from the click an operator makes by reflex.
    assert.deepEqual(actionKeys(3), ["rerun", "rename", "delete"], "the done row");
    assert.deepEqual(actionKeys(4), ["rerun", "rename", "delete"], "the failed row");
    assert.deepEqual(actionKeys(9), ["cancel", "rename"], "the awaiting-approval row");
    // A settled delegated member carries no re-run: the kernel refuses generic
    // retry for a child ("child retries route through their delegation edge
    // policy"), so a `↺` there would be a button that always refuses. The check
    // reads AUTHORITY's `envelope.parent`, which is the same fact the kernel
    // decides on — member 8 is the seeded member whose durable record carries it.
    //
    // It carries no RENAME either, and that half is a row-shape decision rather
    // than a kernel one (D233): `displayName` replaces the title on the row it
    // rides, so naming a member would put free text where the group's list
    // prints the person that item is about. This row is the projector's own
    // proof of it — `isMember` is read from the same `operation-member` shape
    // the surface kind comes from.
    // A settled member is the one row this projection serves NO control for at
    // all — and that is the honest answer, not a gap: every verb it could draw
    // is one the kernel or the row shape refuses. D308's `delete` did NOT
    // change that. It is the verb most tempting to put here (the member is
    // terminal, and 🗑 is exactly what D234 took away), but `executeDelete`
    // refuses any run whose `envelope.parent` is set — "delete the group" —
    // because the kernel takes the tree leaves-first from its anchor. Row 6,
    // the operation, is where that door is.
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
    // D248: the lease is the card. The spans supply what the lease cannot —
    // the browser sessions this worker is holding, and the trace id that joins
    // it to a queue row.
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({
      // The dashboard's current person-lookup descriptor declares CRM +
      // UCPath. This launch-time lease deliberately differs so a BFF restart
      // cannot silently rewrite what the already-running worker loaded.
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
    // span counter beside it (R7-4).
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
    // A worker that was ASKED to stop and one whose process died are two
    // different mornings — and neither still holds a browser, whatever the
    // absence of a close event says.
    assert.equal(failed.state, "failed");
    assert.equal(failed.stopReason, "crashed");
    assert.deepEqual(stopped.browsers, []);
    assert.deepEqual(failed.browsers, []);
  });

  it("keeps a re-run node's chip on the CURRENT run attempt when the span path repeats", () => {
    // A node re-run under a LATER run attempt emits the identical
    // `<trace>/<node>#<taskAttempt>` path (the suffix is the task attempt, not
    // the run attempt). Folding on the path alone let attempt 2's start
    // collide with attempt 1's entry, so a terminal run rendered its last step
    // as `active` forever. Observed live on the Phase-1 exit run.
    const w = world();
    queuedEventOf(w, { seed: 1 });
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

    // Both folded spans are real history and both must render. The timeline id
    // seeded on the span path ALONE collapsed them to one uuid, so the strict
    // wire schema refused the whole detail ("timeline note ids must be unique")
    // and the Log Panel could not open. Observed live on the Phase-1 exit run.
    const detail = buildRunDetail({ runReader: w.runReader, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } }, uuidOf(1));
    const crossVerify = detail.timeline.events.filter((event) => event.label === "cross-verify");
    assert.equal(crossVerify.length, 2);
    assert.equal(new Set(detail.timeline.events.map((event) => event.noteId)).size, detail.timeline.events.length);
    assert.deepEqual(crossVerify.map((event) => event.state), ["cancelled", "done"]);
  });

  it("stays live over observed-data and transaction-fence beats and rebuilds identically", () => {
    // The observed-log arm is IGNORED BY NAME, not folded into a span it is
    // not. What must be true either way is that a stream carrying it cannot
    // degrade the projection: a degraded ingest schedules the guarded rebuild,
    // and the rebuild would then refuse the same line by name (D218).
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

  it("degrades on an unfoldable event, schedules the guarded rebuild, and recovers from JSONL", () => {
    const w = world({ collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    // A claim for a run with no run.queued cannot fold; apply must not throw
    // into the emitting path.
    w.projection.apply({
      t: "run.claimed", ts: w.clock.now().toISOString(), workflow: "person-lookup", pid: 4242,
      runId: uuidOf(60), attempt: 1, traceId: traceOf(60), spanPath: traceOf(60),
      workerId: "person-lookup-worker-1",
    } as never);
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /no run\.queued span/);
    assert.throws(() => w.projection.buildDashboardDayWire(DAY), /degraded and refuses to serve counts/);
    // `buildActivityReportWire` shares the same degraded-health guard as
    // `buildDashboardDayWire` and must re-kind to the SAME typed refusal
    // (ProjectionDegradedError, not a plain Error) so /api/v1/reports/activity
    // and .csv answer PROJECTION_DEGRADED/retryable:true instead of a bare 500.
    assert.throws(
      () => w.projection.buildActivityReportWire(DAY, DAY),
      /degraded and refuses to serve activity aggregates/,
    );
    try {
      w.projection.buildActivityReportWire(DAY, DAY);
      assert.fail("expected buildActivityReportWire to throw while degraded");
    } catch (error) {
      assert.ok(error instanceof ProjectionDegradedError, "must throw the typed refusal, not a plain Error");
    }
    assert.equal(w.scheduledRebuilds.length, 1);

    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
    assert.equal(w.changes.some((change) => change.kind === "generation"), true);
  });

  it("stays loudly degraded when a stored timeline row is corrupt", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    corruptLatest(w);
    w.projection.rebuildFromTimeline();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /timeline rebuild failed/);
  });

  /* ── the D218 cross-process SQLite cursor feed ──────────────────────────────────── */

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

  it("folds another SQLite connection's task spans — the run enqueued after boot gets its timeline (D218)", () => {
    // The daily-use defect this pins: the BFF enqueues a run (its own line,
    // folded), the worker — a separate OS process — executes it, and the only
    // place the worker's spans exist is the shared stream file. Before the
    // tail, `row.taskSpans` stayed [] and the run detail served an empty
    // timeline for every run enqueued after the dashboard booted.
    const w = world();
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
    const detail = buildRunDetail({ runReader: w.runReader, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } }, uuidOf(1));
    assert.equal(detail.timeline.events.length > 0, true);
  });

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
      other.database.exec("BEGIN IMMEDIATE");
      other.writer.emit({ workflow: "person-lookup", runId: uuidOf(1), attempt: 1,
        traceId: traceOf(1), spanPath: `${traceOf(1)}/searching#1`, parentSpanPath: traceOf(1),
        t: "span.started", kind: "task", ts: w.clock.now().toISOString(), name: "searching" });
      w.projection.ingestFromTimeline();
      assert.equal(w.projection.health().state, "live");
      assert.equal(w.projection.runFold(uuidOf(1))?.taskSpans.length, 0);
      other.database.exec("COMMIT");
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
    w.authority.put(runRecordOf({ seed: 2, workflow: "zz-flow" }));
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

/**
 * The two presentation defects the Phase-1 live exit run
 * (`4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`) exposed,
 * pinned in the run's exact shape: `searching → cross-verify → active-status`
 * done, then `crm-dates` skipped by its own `when`, and a terminal run whose
 * execution took minutes rather than the hours a live clock kept counting.
 */
describe("lease-only transitions reach the Session Panel without a span (D248 freshness)", () => {
  const workerId = "person-lookup-worker-1";
  const startedAt = instantOffsetOf(0);
  const workerPath = "worker/person-lookup/person-lookup-worker-1";
  function snapshots(w: ReturnType<typeof world>): number {
    return w.changes.filter((change) => change.kind === "snapshot").length;
  }

  it("publishes a snapshot for a lease born before its first span, and an idle tick publishes nothing", () => {
    const w = world();
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 0);
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "starting", startedAt } }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
    const [card] = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.equal(card?.state, "starting");
    assert.deepEqual(card?.browserRequirements, { state: "present", systems: ["crm", "ucpath"] });
    w.projection.reconcileWorkerAuthority();
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
  });

  it("ignores heartbeat-only writes and publishes each phase, directive and settlement move exactly once", () => {
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "starting", startedAt } }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);

    // The maintenance ticker settles `idle`: a lease-only phase move.
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 5_000) }, version: 2,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.state, "idle");

    // A heartbeat bumps the instant and the version and draws nothing.
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 10_000) }, version: 3,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);

    // An operator directive is a lease write with no span of its own.
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 10_000) }, directive: "pause", version: 4,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 3);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.directive, "pause");
  });

  it("publishes a crash or expiry another process settled, keeping the card while its spans are retained", () => {
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId, spanPath: workerPath, name: "person-lookup",
    });
    const before = snapshots(w);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId,
      lifecycle: { state: "stopped", startedAt, stoppedAt: instantOffsetOf(0, 60_000), reason: "lease-expired" },
      directive: "stop",
      version: 5,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), before + 1);
    const [card] = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.equal(card?.state, "failed");
    assert.equal(card?.stopReason, "lease-expired");
    assert.deepEqual(card?.browsers, []);
  });

  it("publishes the disappearance of a settled lease the span stream never named", () => {
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "starting", startedAt } }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 1);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId,
      lifecycle: { state: "stopped", startedAt, stoppedAt: instantOffsetOf(0, 1_000), reason: "crashed" },
      directive: "stop",
      version: 2,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);
    // D248: a settled lease is a card only while the spans still name its worker.
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 0);
  });

  it("publishes a pool declaration the operator planned, which no span carries (D269)", () => {
    const w = world();
    const plannedAt = instantOffsetOf(0, 2_000);
    w.authority.putWorkerPool({
      workflow: "person-lookup", desiredWorkers: 2, plannedBy: "local-operator",
      plannedAt, version: 1, createdAt: plannedAt, updatedAt: plannedAt,
    });
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY).workerPools, [
      { workflowId: "person-lookup", desiredWorkers: 2, version: 1, plannedBy: "local-operator", plannedAt },
    ]);
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
  });

  it("degrades loudly when lease authority cannot be read instead of serving a stale card set", () => {
    const w = world({ collectRebuilds: true });
    w.authority.listLiveWorkerLeases = () => {
      throw new Error("leases table unreadable");
    };
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /worker lease reconcile failed: leases table unreadable/);
    assert.equal(w.scheduledRebuilds.length, 1);
  });
});

describe("the live exit-run presentation shapes (D123/D124)", () => {
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

  it("renders a conditionally-skipped node as SKIPPED with its closed reason, never as cancelled", () => {
    const w = world();
    seedExitRunShape(w);

    const detail = buildRunDetail(
      { runReader: w.runReader, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
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

  it("keeps a skipped span whose reason was never recorded explicitly reasonless", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    // A pre-D123 span, or any emitter that recorded no reason: absence must
    // stay absence rather than borrowing the only reason we happen to know.
    taskEventsOf(w, 1, "crm-dates", "skipped");

    const detail = buildRunDetail(
      { runReader: w.runReader, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
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

/**
 * The fold arms a run only reaches when something actually MOVES — a recovery
 * requeue, an operator resolving a gate, a restart closing a span it never
 * opened, a worker shutting down, a hide that emits no span at all — plus the
 * two identity refusals that keep the fold from folding two histories into one
 * row. Every one of these is a real transition the kernel already performs;
 * none of them had a projection arm pinned before D190.
 */
describe("the fold arms a moving run reaches (ref dashboard-surfaces §2.2)", () => {
  /**
   * A worker card is its LEASE (D248); the spans are what it is holding. Both
   * are seeded here so these arms exercise the join rather than one half.
   */
  function seedWorkerSpans(w: DashboardWorld, workerId = "person-lookup-worker-1"): void {
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId, spanPath: `worker/person-lookup/${workerId}`, name: "person-lookup",
    });
    w.writer.emit({
      t: "span.started", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId,
      spanPath: `worker/person-lookup/${workerId}/browser:ucpath#${uuidOf(50)}`,
      parentSpanPath: `worker/person-lookup/${workerId}`,
      name: "browser-session:ucpath", system: "ucpath",
    });
  }

  it("returns a requeued run to the queue, advances its attempt, and frees the worker holding it", () => {
    const w = world();
    seedWorkerSpans(w);
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1 }));
    claimEventOf(w, 1);
    assert.equal(w.projection.queueSurface(uuidOf(1))?.status, "running");
    assert.deepEqual(
      w.projection.buildDashboardDayWire(DAY).workerCards[0].currentRun,
      { state: "present", runId: uuidOf(1), traceId: traceOf(1) },
    );

    w.authority.put(runRecordOf({ seed: 1, attempt: 2, lifecycle: { state: "queued" } }));
    w.writer.emit({
      t: "run.requeued", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1),
      cause: "recovery", nextAttempt: 2,
    });

    // The row is queued again — not "running with nobody running it" — and it
    // carries the attempt the NEXT claim will run under.
    const surface = w.projection.queueSurface(uuidOf(1));
    assert.equal(surface?.status, "queued");
    assert.equal(surface?.attempt, 2);
    const fold = w.projection.runFold(uuidOf(1));
    assert.equal(fold?.requeues, 1);
    assert.equal(fold?.claimedBy, undefined);

    // The run leaves this worker's hands. The PHASE beside it is the lease's
    // and does not move here — the worker reports that itself, on its own
    // heartbeat (D248).
    const card = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(card.state, "idle");
    assert.deepEqual(card.currentRun, { state: "absent", reason: "no claimed run" });
  });

  it("closes an open gate on resolution and records the key and digest that resolved it", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: instantOffsetOf(0), resumeAt: "approval" } });
    w.writer.emit({
      t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), gate: "approval",
    });
    assert.equal(w.projection.queueSurface(uuidOf(1))?.status, "awaiting-approval");

    w.authority.put(runRecordOf({ seed: 1 }));
    const resolvedAt = w.clock.now().toISOString();
    w.writer.emit({
      t: "gate.resolved", ts: resolvedAt, workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1),
      gate: "approval", resolutionKey: "approved", resultHash: HASH_A,
    });

    // The gate leaves the OPEN list rather than being marked resolved in place:
    // a run still holding an open gate reads as awaiting-approval forever.
    assert.equal(w.projection.queueSurface(uuidOf(1))?.status, "queued");
    const fold = w.projection.runFold(uuidOf(1));
    assert.deepEqual(fold?.openGates, []);
    assert.deepEqual(fold?.resolvedGates, [
      { gate: "approval", resolutionKey: "approved", resultHash: HASH_A, resolvedAt },
    ]);
  });

  it("closes a task span an earlier process opened without inventing when it started", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    // A restart: the end arrives for a span whose start belonged to a process
    // that is gone. The chip must still render its real outcome.
    w.writer.emit({
      t: "span.ended", kind: "task", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1),
      spanPath: `${traceOf(1)}/cross-verify#1`, outcome: "done",
    });

    assert.deepEqual(w.projection.queueSurface(uuidOf(1))?.pipeline, [
      { id: "cross-verify", label: "cross-verify", state: "done" },
    ]);
    const span = w.projection.runFold(uuidOf(1))?.taskSpans[0];
    assert.equal(span?.outcome, "done");
    // The open time is genuinely unknown; a guessed one would print a duration.
    assert.equal(span?.startedAt, undefined);
  });

  it("frees the worker when the run it held ends, then marks the card stopped when the worker does", () => {
    const w = world();
    seedWorkerSpans(w);
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    runEndedEventOf(w, 1, "done");
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 5_000) },
      version: 3,
    }));

    const idle = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(idle.state, "idle");
    assert.deepEqual(idle.currentRun, { state: "absent", reason: "no claimed run" });

    // The worker's own span ending does NOT settle the card: a span is an
    // observation and the lease is the record. The card turns `stopped` when
    // authority says the lease did (D248) — which is also what carries the
    // reason and the instant.
    w.writer.emit({
      t: "span.ended", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1",
      outcome: "done",
    });
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0].state, "idle");

    w.authority.putWorkerLease(workerLeaseOf({
      lifecycle: {
        state: "stopped",
        startedAt: instantOffsetOf(0),
        stoppedAt: instantOffsetOf(0, 9_000),
        reason: "shutdown",
      },
      directive: "stop",
      version: 3,
    }));
    const stopped = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.stopReason, "shutdown");
    assert.deepEqual(stopped.currentRun, { state: "absent", reason: "worker stopped" });
  });

  it("orders worker cards by id and draws only the workers AUTHORITY names", () => {
    const w = world();
    // Deliberately out of order. Worker 3 holds a live lease and has opened no
    // browser at all — a real card, with an empty tile grid. Worker 4 is the
    // other direction: spans in the stream, no lease in authority, so it is
    // NOT a card, because authority is what says a worker exists (D248).
    seedWorkerSpans(w, "person-lookup-worker-2");
    seedWorkerSpans(w, "person-lookup-worker-1");
    w.authority.putWorkerLease(workerLeaseOf({ workerId: "person-lookup-worker-3" }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-4", spanPath: "worker/person-lookup/person-lookup-worker-4",
      name: "person-lookup",
    });

    const cards = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.deepEqual(
      cards.map(({ workerId }) => workerId),
      ["person-lookup-worker-1", "person-lookup-worker-2", "person-lookup-worker-3"],
    );
    assert.deepEqual(cards[2].browsers, []);
  });

  it("refuses a replayed run.queued rather than folding a second identity over the first", () => {
    const w = world({ collectRebuilds: true });
    const queued = queuedEventOf(w, { seed: 1 });
    // Identity attributes are write-once. A second `run.queued` for the same
    // run would silently reset the attempt, the members and the details.
    w.projection.apply(queued);
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /identity attributes are write-once/);

    // The JSONL still holds exactly one line, so the guarded rebuild restores
    // the one true row rather than the duplicate that degraded it.
    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
  });

  it("refuses a RUN span that ended as skipped — skipped is a task-span outcome", () => {
    const w = world({ collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    // The wire union permits the shape (one outcome enum serves both span
    // kinds); the fold is what knows a run cannot be conditionally skipped.
    w.writer.emit({
      t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), outcome: "skipped",
    });
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /skipped is a task-span outcome/);
  });

  it("hands the client a fresh snapshot when an archived row leaves the payload", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    queuedEventOf(w, { seed: 2 });
    taskEventsOf(w, 1, "searching");
    const before = w.changes.length;

    // Archiving emits NO span, so the refresh trigger re-reads the same
    // authority join every other path uses. It is count-bearing: the row leaves
    // the payload, and a patch could only describe a row that is no longer
    // there. Since D234 it is the ONLY way a run leaves the payload — the
    // hidden-run arm this case used to walk beside it is retired.
    w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0) } }));
    w.authority.archived.add(uuidOf(1));
    w.projection.refreshRun(uuidOf(1));
    w.authority.put(runRecordOf({ seed: 2, lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0) } }));
    w.authority.archived.add(uuidOf(2));
    w.projection.refreshRun(uuidOf(2));
    // A run the fold never saw is not a projection event at all.
    w.projection.refreshRun(uuidOf(99));

    assert.deepEqual(w.changes.slice(before).map(({ kind }) => kind), ["snapshot", "snapshot"]);
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual(day.queueSurfaces, []);
    assert.deepEqual(day.statusCounts, []);
    assert.deepEqual(day.workflowCounts, []);
  });

  it("orders the month calendar, the workflow badges and the inbox deterministically", () => {
    const w = world();
    atDayOffset(w, 0);
    queuedEventOf(w, { seed: 1 });
    queuedEventOf(w, { seed: 2, workflow: "separations-kuali-finalization" });
    atDayOffset(w, 1);
    queuedEventOf(w, { seed: 3 });
    atDayOffset(w, 0);

    // Two notifications share an instant on purpose: newest first, and a tie
    // broken by id rather than by whatever order authority happened to return.
    w.authority.notifications.push(
      notificationRecordOf({ seed: 31, title: "later id", lastSeenAt: instantOffsetOf(0, 2_000) }),
      notificationRecordOf({ seed: 32, title: "oldest", lastSeenAt: instantOffsetOf(0, 1_000) }),
      notificationRecordOf({ seed: 30, title: "earlier id", lastSeenAt: instantOffsetOf(0, 2_000) }),
    );

    const day = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual(day.monthCounts, [
      { day: dayOffsetOf(0), count: 2 },
      { day: dayOffsetOf(1), count: 1 },
    ]);
    // Each workflow carries its OWN status dimension, off the same fold
    // (R2 D5-D12): the Workflow Panel's `active | all` column and the
    // workflow-scoped Status Bar both read these entries.
    assert.deepEqual(day.workflowCounts, [
      { workflowId: "person-lookup", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
      { workflowId: "separations-kuali-finalization", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
    ]);
    assert.deepEqual(day.notifications.map(({ notificationId }) => notificationId), [uuidOf(7030), uuidOf(7031), uuidOf(7032)]);
    assert.deepEqual(day.notifications.map(({ title }) => title), ["Run failed", "Run failed", "Run failed"]);
    assert.equal(day.notifications[0].severity, "error");
    assert.equal(day.notifications[0].state, "unread");
  });
});

/**
 * The four row facts that had a consumer and no producer (ref dashboard-surfaces §1.2, §9
 * D12/D13/D22/D126). Each one is a field the queue component already drew the
 * moment it arrived, so what these arms pin is where the value comes FROM —
 * and, for three of them, which absences the row must state instead of
 * inventing a value.
 */
describe("the queue row's served facts (D12/D13/D22/D126)", () => {
  /** A terminal-failed run whose failure record authority holds. */
  function seedFailed(w: DashboardWorld, seed = 4): void {
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

  it("D13: a failed row carries its terminal failure summary VERBATIM", () => {
    const w = world();
    seedFailed(w);
    const failure = failureRecordOf({ seed: 4, code: "CRM_UNAVAILABLE" });
    w.authority.failures.set(String(failure.failureId), failure);

    assert.deepEqual(rowOf(w, 4).liveMessage, { state: "present", value: failure.summary });
  });

  it("D13: a failure record authority does not hold is NAMED, never replaced by a guess", () => {
    const w = world();
    // The failure id rides the lifecycle; nothing puts the record.
    seedFailed(w);
    const { liveMessage } = rowOf(w, 4);
    assert.equal(liveMessage.state, "absent");
    assert.match(
      liveMessage.state === "absent" ? liveMessage.reason : "",
      new RegExp(`failure ${uuidOf(9004)}, which authority does not hold`),
    );
  });

  it("every non-failed row states WHY it carries no sentence rather than carrying one", () => {
    const w = world();
    seedWorld(w);
    const running = rowOf(w, 2);
    const done = rowOf(w, 3);
    assert.equal(running.liveMessage.state, "absent");
    assert.match(
      running.liveMessage.state === "absent" ? running.liveMessage.reason : "",
      /run is running/,
    );
    assert.equal(done.liveMessage.state, "absent");
    assert.match(
      done.liveMessage.state === "absent" ? done.liveMessage.reason : "",
      /only a failed run carries an error sentence/,
    );
  });

  it("D6: `dryRun` comes off the run envelope and is served on every row", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, dryRun: true });
    queuedEventOf(w, { seed: 2 });
    assert.equal(rowOf(w, 1).dryRun, true);
    assert.equal(rowOf(w, 2).dryRun, false);
  });

  it("D12: only an awaiting row dates its gate, and the instant is the GATE's own", () => {
    const w = world();
    seedWorld(w);
    const record = w.authority.getRun(uuidOf(9));
    assert.ok(record);
    w.authority.put({ ...record, updatedAt: IsoInstantSchema.parse(instantOffsetOf(0, 1000)) });
    const gated = rowOf(w, 9);
    assert.equal(gated.status, "awaiting-approval");
    const openedAt = w.projection.runFold(uuidOf(9))?.openGates.at(-1)?.openedAt;
    assert.deepEqual(gated.gateOpenedAt, { state: "present", value: openedAt });
    // …and it is NOT `updatedAt`, which moves on every patch.
    assert.notEqual(gated.gateOpenedAt.state === "present" ? gated.gateOpenedAt.value : "", gated.updatedAt);
    for (const seed of [1, 2, 3, 4]) {
      assert.equal(rowOf(w, seed).gateOpenedAt.state, "absent");
    }
  });

  it("D12: a parked-gate run whose gate span is missing falls back to authority's park instant", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: {
        state: "parked-gate", gateId: "approval",
        parkedAt: "2026-08-03T17:05:00.000Z", resumeAt: "cross-verify",
      },
      version: 2,
    }));
    assert.deepEqual(rowOf(w, 1).gateOpenedAt, { state: "present", value: "2026-08-03T17:05:00.000Z" });
  });

  it("the wire refuses a gate instant on a row that is not waiting", () => {
    const w = world();
    seedWorld(w);
    const running = rowOf(w, 2);
    assert.equal(QueueSurfaceWireSchema.safeParse({
      ...running,
      gateOpenedAt: { state: "present", value: "2026-08-03T17:05:00.000Z" },
    }).success, false);
  });

  it("D22/D126: the △ chip's count is the receipt's real warning set, titled by the first", () => {
    const w = world();
    seedWorld(w);
    w.authority.receipts.set(uuidOf(3), receiptWithWarningsOf({
      seed: 3,
      summaries: ["CRM dates were replayed past their freshness limit", "the second warning"],
    }));
    assert.deepEqual(rowOf(w, 3).warnings, {
      state: "present",
      count: 2,
      first: "CRM dates were replayed past their freshness limit",
    });
  });

  it("serves pre-composition-3 receipt diagnostics in Queue without mutating authority", () => {
    const w = world();
    seedWorld(w);
    const raw = "ucpath:termination|10812345|2026-08-29";
    const legacy = RunEvidenceReceiptSchema.parse({
      ...receiptWithWarningsOf({ seed: 3, summaries: [raw] }),
      composition: 2,
    });
    w.authority.receipts.set(uuidOf(3), legacy);

    const row = rowOf(w, 3);
    assert.equal(JSON.stringify(row).includes(raw), true);
    assert.equal(row.warnings.state, "present");
    assert.equal(w.authority.receipts.get(uuidOf(3)), legacy);
  });

  it("D22/D126: three distinct absences, and never a fabricated zero", () => {
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

/**
 * The six §1.2/§9 row facts this slice added a PRODUCER for.
 *
 * Every case asserts the absent arm beside the present one, because for five of
 * the six the absence is the state a real day is usually in — and an absence
 * that reads as a zero, an empty band or a plausible number is exactly the
 * substitution this projection must not make.
 */
describe("the queue row's ordinal, class, links and outcome (D230, D7)", () => {
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
      reason: "enqueued before runs carried a workflow ordinal (D230)",
    });
  });

  it("D269: serves the run's session off its own row, and names the absence of one", () => {
    const w = world();
    w.authority.batches.set(uuidOf(70), RunSessionRecordSchema.parse({ sessionId: uuidOf(70), workflow: "person-lookup", origin: { kind: "start-plan", startPlanId: uuidOf(71), actorId: "local-operator" }, startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 }));
    queuedEventOf(w, { seed: 1, sessionId: uuidOf(70) });
    queuedEventOf(w, { seed: 2, sessionId: uuidOf(70) });
    queuedEventOf(w, { seed: 3 });
    const rows = w.projection.buildDashboardDayWire(DAY).queueSurfaces;
    // Membership is the row's own field — two rows naming one session ARE that
    // session's membership, with no stored list consulted.
    assert.deepEqual(rows[0].session, { state: "present", sessionId: uuidOf(70), presentation: { groupInQueue: true, version: 1, startedAt: instantOffsetOf(0) } });
    assert.deepEqual(rows[1].session, { state: "present", sessionId: uuidOf(70), presentation: { groupInQueue: true, version: 1, startedAt: instantOffsetOf(0) } });
    assert.deepEqual(rows[2].session, {
      state: "absent",
      reason: "this run predates D269 session grouping, or retries a run that does",
    });
  });

  it("publishes batch presentation changes without new run spans and ignores an unchanged tick", () => {
    const w = world();
    const batch = RunSessionRecordSchema.parse({ sessionId: uuidOf(70), workflow: "person-lookup", origin: { kind: "start-plan", startPlanId: uuidOf(71), actorId: "local-operator" }, startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 });
    w.authority.batches.set(batch.sessionId, batch);
    queuedEventOf(w, { seed: 1, sessionId: batch.sessionId });
    queuedEventOf(w, { seed: 2, sessionId: batch.sessionId });
    w.projection.reconcileWorkerAuthority();
    const before = w.changes.filter((change) => change.kind === "snapshot").length;
    w.authority.batches.set(batch.sessionId, RunSessionRecordSchema.parse({ ...batch, groupInQueue: false, version: 2 }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.changes.filter((change) => change.kind === "snapshot").length, before + 1);
    for (const row of w.projection.buildDashboardDayWire(DAY).queueSurfaces) {
      assert.equal(row.session.state, "present");
      if (row.session.state === "present") assert.deepEqual(row.session.presentation, { groupInQueue: false, version: 2, startedAt: batch.startedAt });
    }
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.changes.filter((change) => change.kind === "snapshot").length, before + 1);
  });
  it("D269: serves the worker POOL block from authority — one entry per planned workflow, absent means version 0", () => {
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
    // The bump's durable effect is an envelope rewrite with no span of its own,
    // so a row that read the frozen `run.queued` copy would keep saying `bulk`
    // after the claim order had already changed.
    w.authority.put(runRecordOf({ seed: 1, priority: "interactive", version: 2 }));
    w.projection.refreshRun(uuidOf(1));
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces[0].priority, "interactive");
  });

  it("classifies containment from shape and lineage, and chips only the linked children", () => {
    // The registry resolves this workflow, so the chip's label is the
    // descriptor's own — the workflow id is the fallback a build that cannot
    // read the declaration falls back to, and it is asserted below.
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
    // 2 — terminal, no receipt derived. D141 forbids deriving one here.
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
    // Two executions of ONE node — the gate-resume shape D214 named. The chip
    // reports time spent on the step, which is both intervals, not the last.
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
    // Every step this build could observe is measured or explicitly not; a
    // world with no registered descriptor shows exactly the observed nodes, so
    // there is no `pending` step here to check — that arm rides the descriptor
    // branch, which the count/pipeline cases above already walk.
    assert.deepEqual(pipeline.map((step) => step.id).sort(), ["cross-verify", "searching"]);
  });

  /**
   * D255 — the same node executed twice at ONE span path. The executor cannot
   * produce this since D214 (`taskSpanPath` carries the claim generation), and
   * the JSONL writer's own identity guard refuses a re-open in-process, which
   * is why this case is written straight to the stream the way a second OS
   * process would. What it pins is the FOLD's rule, not a producer's: a close
   * binds to a still-OPEN entry, so each execution keeps its own interval. The
   * first-match rule this replaces reported one 11 s span (start of execution
   * one to end of execution two, the idle gap included) and dropped the other.
   */
  it("binds a close to the LAST OPEN entry at its identity — two executions at one span path stay two facts", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "running", ...ORDINAL_CLAIM }, claimGeneration: 1, version: 2 }));
    claimEventOf(w, 1);
    const base = {
      workflow: "person-lookup", pid: 778, runId: uuidOf(1), attempt: 1,
      traceId: traceOf(1), spanPath: `${traceOf(1)}/searching#1.1`, parentSpanPath: traceOf(1),
    };
    const line = (event: Record<string, unknown>): void => {
      appendOther(w, event);
    };
    line({ ...base, t: "span.started", kind: "task", ts: instantOffsetOf(0, 1_000), name: "searching" });
    line({ ...base, t: "span.ended", kind: "task", ts: instantOffsetOf(0, 5_000), outcome: "done" });
    line({ ...base, t: "span.started", kind: "task", ts: instantOffsetOf(0, 9_000), name: "searching" });
    line({ ...base, t: "span.ended", kind: "task", ts: instantOffsetOf(0, 12_000), outcome: "done" });

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
