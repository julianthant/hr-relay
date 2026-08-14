/**
 * THE run/queue projection (doc 03 §2.2-2.3, D81 §10.1): the emit → JSONL →
 * fold → DashboardDayWire round-trip over a seeded world with hidden,
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
import { personLookupDescriptor } from "../../../src/workflows/person-lookup/descriptor.js";
import { RunEvidenceReceiptSchema } from "../../../src/domain/trust/evidence.js";
import { HASH_A, HASH_B, UUID_4 } from "../fixtures/phase1c-contract-fixtures.js";
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
  queuedEventOf,
  receiptWithWarningsOf,
  runEndedEventOf,
  runRecordOf,
  taskEventsOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

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

/** Seeds: queued(1), running(2), done(3), failed(4), hidden(5), operation(6)+members(7,8), gated(9). */
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

  queuedEventOf(w, { seed: 5, hidden: true });

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

  queuedEventOf(w, { seed: 9 });
  w.writer.emit({
    t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(9), attempt: 1, traceId: traceOf(9), spanPath: traceOf(9), gate: "approval",
  });
}

describe("THE run/queue projection (D81)", () => {
  it("folds the seeded world into one payload whose three count renderings agree by construction", () => {
    const w = world();
    seedWorld(w);
    const day = w.projection.buildDashboardDayWire(DAY);
    DashboardDayWireSchema.parse(day);

    // Hidden run 5 is nowhere; members 7/8 ride flat for layout but are
    // contained in the operation's rollup, not in any count.
    const runIds: readonly string[] = day.queueSurfaces.map(({ runId }) => runId);
    assert.equal(runIds.includes(uuidOf(5)), false);
    assert.equal(runIds.includes(uuidOf(7)), true);
    assert.equal(day.queueSurfaces.length, 8);

    const topLevel = day.queueSurfaces.filter(({ surfaceKind }) => surfaceKind !== "member");
    const workflowTotal = day.workflowCounts.reduce((sum, { count }) => sum + count, 0);
    const statusTotal = day.statusCounts.reduce((sum, { count }) => sum + count, 0);
    assert.equal(workflowTotal, topLevel.length);
    assert.equal(statusTotal, topLevel.length);
    assert.equal(workflowTotal, 6);
    assert.deepEqual(day.monthCounts, [{ day: DAY, count: 6 }]);

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
     * Doc 13 §8.5 — this world registers NO descriptor (the same reason its
     * pipeline shows only observed nodes), so no row may draw a control: the
     * `WorkflowActionPolicy` is the workflow's own statement of what it offers,
     * and a build that cannot read it must not guess a default set onto a run
     * it cannot describe. The populated case is the next test.
     */
    assert.equal(day.queueSurfaces.every(({ actions }) => actions.length === 0), true);
  });

  /**
   * The row's controls, joined from the run's OWN descriptor (doc 13 §8.5).
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
    assert.deepEqual(actionKeys(1), ["bump", "cancel", "hide"], "the queued row");
    assert.deepEqual(actionKeys(2), ["cancel", "hide"], "the running row");
    assert.deepEqual(actionKeys(3), ["retry", "hide"], "the done row");
    assert.deepEqual(actionKeys(4), ["retry", "hide"], "the failed row");
    assert.deepEqual(actionKeys(9), ["cancel", "hide"], "the awaiting-approval row");
    // A settled delegated member carries no re-run: the kernel refuses generic
    // retry for a child ("child retries route through their delegation edge
    // policy"), so a `↺` there would be a button that always refuses. The check
    // reads AUTHORITY's `envelope.parent`, which is the same fact the kernel
    // decides on — member 8 is the seeded member whose durable record carries it.
    assert.deepEqual(actionKeys(8), ["hide"]);
    // The operation's cancel is the TREE cancel, keyed so the footer titles it
    // with its blast radius.
    assert.equal(actionKeys(6).includes("cancel-tree"), true);

    for (const surface of day.queueSurfaces) {
      assert.ok(surface.actions.length > 0, `row ${surface.runId} was served no control at all`);
      for (const action of surface.actions) {
        assert.equal(action.kind, "command");
        if (action.kind !== "command") continue;
        assert.equal(action.expectedVersion, surface.rowRevision, `${surface.runId}/${action.key}`);
      }
    }
  });

  it("projects worker cards from worker/browser spans and links the in-flight run", () => {
    const w = world();
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
    assert.equal(card.system, "ucpath");
    assert.equal(card.state, "working");
    assert.deepEqual(card.currentRun, { state: "present", runId: uuidOf(1), traceId: traceOf(1) });
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
    const detail = buildRunDetail({ stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } }, uuidOf(1));
    const crossVerify = detail.timeline.events.filter((event) => event.label === "cross-verify");
    assert.equal(crossVerify.length, 2);
    assert.equal(new Set(detail.timeline.events.map((event) => event.noteId)).size, detail.timeline.events.length);
    assert.deepEqual(crossVerify.map((event) => event.state), ["cancelled", "done"]);
  });

  it("persists every folded row to the rebuildable runs_view table", () => {
    const w = world();
    seedWorld(w);
    assert.equal(w.store.rows.size, 9); // all nine runs, hidden included — hiding is presentation
  });

  it("rebuilds the identical day payload from nothing but the span JSONL", () => {
    const w = world();
    seedWorld(w);
    const before = w.projection.buildDashboardDayWire(DAY);

    const fresh = createRunQueueProjection({
      stateRoot: w.stateRoot,
      clock: w.clock,
      appVersion: APP_VERSION,
      descriptorSetHash: DESCRIPTOR_SET_HASH,
      authority: w.authority,
      descriptors: { resolve: () => undefined },
      projectionStore: w.store,
    });
    fresh.rebuildFromJsonl();
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
    assert.equal(w.scheduledRebuilds.length, 1);

    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
    assert.equal(w.changes.some((change) => change.kind === "generation"), true);
  });

  it("stays loudly degraded when the JSONL itself is corrupt", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    mkdirSync(join(w.stateRoot, "spans"), { recursive: true });
    appendFileSync(join(w.stateRoot, "spans", `person-lookup-${DAY}.jsonl`), "not-json\n");
    w.projection.rebuildFromJsonl();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /corrupt span line .*person-lookup-2026-08-03\.jsonl:2/);
  });

  /* ── the D218 cross-process disk tail ──────────────────────────────────── */

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

  it("folds a WORKER process's task spans from disk — the run enqueued after boot gets its timeline (D218)", () => {
    // The daily-use defect this pins: the BFF enqueues a run (its own line,
    // folded), the worker — a separate OS process — executes it, and the only
    // place the worker's spans exist is the shared stream file. Before the
    // tail, `row.taskSpans` stayed [] and the run detail served an empty
    // timeline for every run enqueued after the dashboard booted.
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const file = join(w.stateRoot, "spans", `person-lookup-${DAY}.jsonl`);
    const base = {
      workflow: "person-lookup", pid: 777, runId: uuidOf(1), attempt: 1,
      traceId: traceOf(1), spanPath: `${traceOf(1)}/searching#1`, parentSpanPath: traceOf(1),
    };
    appendFileSync(file, `${JSON.stringify({ ...base, t: "span.started", kind: "task", ts: w.clock.now().toISOString(), name: "searching" })}\n`);
    appendFileSync(file, `${JSON.stringify({ ...base, t: "span.ended", kind: "task", ts: w.clock.now().toISOString(), outcome: "done" })}\n`);

    w.projection.ingestFromDisk();

    assert.equal(w.projection.health().state, "live");
    const fold = w.projection.runFold(uuidOf(1));
    assert.equal(fold?.taskSpans.length, 1);
    assert.equal(fold?.taskSpans[0].outcome, "done");
    const detail = buildRunDetail({ stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } }, uuidOf(1));
    assert.equal(detail.timeline.events.length > 0, true);
  });

  it("folds each line exactly once — its own emissions included — and an idle tick changes nothing", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 }); // the harness writer already ticked the tail once
    w.projection.ingestFromDisk();
    w.projection.ingestFromDisk();
    assert.equal(w.projection.health().state, "live");
    // A refold would either throw `run.queued replayed` (degrading) or bump
    // the event count; exactly-once means neither happened.
    assert.equal(w.projection.runFold(uuidOf(1))?.eventCount, 1);
  });

  it("leaves a torn trailing line on disk until its newline lands", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    const file = join(w.stateRoot, "spans", `person-lookup-${DAY}.jsonl`);
    const line = JSON.stringify({
      workflow: "person-lookup", pid: 777, runId: uuidOf(1), attempt: 1,
      traceId: traceOf(1), spanPath: `${traceOf(1)}/searching#1`, parentSpanPath: traceOf(1),
      t: "span.started", kind: "task", ts: w.clock.now().toISOString(), name: "searching",
    });
    appendFileSync(file, line.slice(0, 25)); // a worker mid-append
    w.projection.ingestFromDisk();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(1))?.taskSpans.length, 0);

    appendFileSync(file, `${line.slice(25)}\n`);
    w.projection.ingestFromDisk();
    assert.equal(w.projection.runFold(uuidOf(1))?.taskSpans.length, 1);
  });

  it("notices a stream file born after boot — another workflow's process, or a day roll", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 2, workflow: "zz-flow" }));
    mkdirSync(join(w.stateRoot, "spans"), { recursive: true });
    appendFileSync(join(w.stateRoot, "spans", `zz-flow-${DAY}.jsonl`), `${rawQueuedLineOf(w, 2, "zz-flow")}\n`);
    w.projection.ingestFromDisk();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(2))?.queued.workflow, "zz-flow");
  });

  it("degrades on an unparsable tailed line — never a skip — and the guarded rebuild refuses the same line", () => {
    const w = world({ collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    appendFileSync(join(w.stateRoot, "spans", `person-lookup-${DAY}.jsonl`), "not-json\n");
    w.projection.ingestFromDisk();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /span tail ingest failed: corrupt span line .*person-lookup-2026-08-03\.jsonl:2/);
    assert.equal(w.scheduledRebuilds.length, 1);
    // The line is real history on disk, so recovery cannot succeed either —
    // it refuses the same line by name instead of quietly reading past it.
    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /rebuild-from-native-jsonl failed: corrupt span line/);
    assert.throws(() => w.projection.buildDashboardDayWire(DAY), /degraded and refuses to serve counts/);
  });

  it("a rebuild resets the tail cursors, so replayed history is never refolded", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    w.projection.rebuildFromJsonl();
    w.projection.ingestFromDisk();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(1))?.eventCount, 2);
  });

  it("refuses to render a span-known run that authority does not hold", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.records.delete(uuidOf(1));
    assert.throws(() => w.projection.buildDashboardDayWire(DAY), /not in authority/);
  });

  it("emits count-neutral patches and count-bearing snapshots on the right events", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 }); // new run: snapshot
    claimEventOf(w, 1); // queued -> running: snapshot
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
      { stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
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
      { stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
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

  it("falls back to the run span's end instant, and names the absence when neither exists", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    // Authority has not settled yet, so the status comes from the run span —
    // and so must the instant a duration is measured against.
    w.writer.emit({
      t: "span.ended", kind: "run", ts: "2026-08-03T17:20:00.000Z", workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), outcome: "cancelled",
    });
    const surface = w.projection.buildDashboardDayWire(DAY).queueSurfaces
      .find((row) => row.runId === uuidOf(1));
    assert.ok(surface);
    assert.equal(surface.status, "cancelled");
    assert.deepEqual(surface.endedAt, { state: "present", value: "2026-08-03T17:20:00.000Z" });
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
describe("the fold arms a moving run reaches (doc 03 §2.2)", () => {
  /** A worker card exists only once a browser span has named its system. */
  function seedWorkerSpans(w: DashboardWorld, workerId = "person-lookup-worker-1"): void {
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
    claimEventOf(w, 1);
    assert.equal(w.projection.queueSurface(uuidOf(1))?.status, "running");
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0].state, "working");

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

    const card = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(card.state, "idle");
    assert.deepEqual(card.currentRun, { state: "absent", reason: "no claimed run" });
  });

  it("closes an open gate on resolution and records the key and digest that resolved it", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.writer.emit({
      t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), gate: "approval",
    });
    assert.equal(w.projection.queueSurface(uuidOf(1))?.status, "awaiting-approval");

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

    w.writer.emit({
      t: "span.ended", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1",
      outcome: "done",
    });
    const stopped = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(stopped.state, "stopped");
    assert.deepEqual(stopped.currentRun, { state: "absent", reason: "worker stopped" });
  });

  it("orders worker cards by id and shows only the workers that named a system", () => {
    const w = world();
    // Deliberately out of order, and one worker that opened no browser span:
    // a card with no system has nothing to render and is not a card yet.
    seedWorkerSpans(w, "person-lookup-worker-2");
    seedWorkerSpans(w, "person-lookup-worker-1");
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-3", spanPath: "worker/person-lookup/person-lookup-worker-3",
      name: "person-lookup",
    });

    assert.deepEqual(
      w.projection.buildDashboardDayWire(DAY).workerCards.map(({ workerId }) => workerId),
      ["person-lookup-worker-1", "person-lookup-worker-2"],
    );
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

  it("hands the client a fresh snapshot when a hidden or archived row leaves the payload", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    queuedEventOf(w, { seed: 2 });
    taskEventsOf(w, 1, "searching");
    const before = w.changes.length;

    // Hiding and archiving emit NO span, so the refresh trigger re-reads the
    // same authority join every other path uses. Both are count-bearing: the
    // row leaves the payload, and a patch could only describe a row that is no
    // longer there.
    w.authority.put(runRecordOf({ seed: 1, hidden: true, version: 2 }));
    w.projection.refreshRun(uuidOf(1));
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
    queuedEventOf(w, { seed: 2, workflow: "kuali-timekeeper-annotation" });
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
      { workflowId: "kuali-timekeeper-annotation", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
      { workflowId: "person-lookup", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
    ]);
    assert.deepEqual(day.notifications.map(({ title }) => title), ["earlier id", "later id", "oldest"]);
    assert.equal(day.notifications[0].severity, "error");
    assert.equal(day.notifications[0].state, "unread");
  });
});

/**
 * The four row facts that had a consumer and no producer (doc 03 §1.2, §9
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
