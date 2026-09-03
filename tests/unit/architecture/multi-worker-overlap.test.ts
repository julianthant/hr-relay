/**
 * D182 — ref execution-and-sessions §7.1 rows C1–C4: the OVERLAP half of the 2j concurrency matrix.
 *
 * Everything else in this tree exercises concurrency one caller at a time: a
 * second `claimNext` issued by the test, a sweep run between two statements, a
 * heartbeat fired by hand. That proves the STORE refuses an illegal pair. It
 * does not prove the loop — the thing that actually runs in production — never
 * asks for one, because a single-worker fixture can satisfy `(runId, worker)`
 * uniqueness by never having a second worker.
 *
 * So these arms run REAL `runWorkerLoop` instances, more than one at a time,
 * against ONE shared `AuthorityDatabase`, and sample the durable claim set at
 * every span event and every driver call. Two facts have to hold at once and
 * they pull in opposite directions: no worker may ever hold two active rows
 * (ref execution-and-sessions §0.3), and the workers must genuinely overlap (ref execution-and-sessions §7's
 * "parallelism silently serializes" risk) — a matrix that only proved the first
 * would be satisfied by a runtime that ran everything on one worker.
 *
 * `composeWorkerRuntime` cannot be used here: it derives its id from
 * `phase1WorkerId(workflowId)`, so two composed workers on one workflow collide
 * on the authority worker LEASE by design. N-worker overlap is `runWorkerLoop`
 * called N times with distinct `workerId`s over one database — which is exactly
 * the shape ref execution-and-sessions §2 says a future phase spawns.
 */
import { fixtureDuoCeremonyGates } from "../fixtures/duo-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { runWorkerLoop, type WorkerLoopDependencies } from "../../../src/core/worker-loop.js";
import type { ExecutorSpanEvent, SpanEmitter } from "../../../src/core/span-emitter.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../src/domain/ids.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import type { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { taskStoreRegistry } from "../../../src/stores/index.js";
import { sequentialIdFactory, WORKFLOW_ID } from "../fixtures/phase1f-run-fixtures.js";
import {
  happySessionHarness,
  healthyCrmDriver,
  healthyUcpathDriver,
  ManualScheduler,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingLogger,
  sessionFactoryHarness,
  type AuthorityHarness,
  type SessionFactoryHarness,
} from "../fixtures/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

const ACTIVE_STATES = new Set(["claimed", "validating", "running"]);
const HEARTBEAT_INTERVAL_MS = 500;
const CLAIM_STALE_AFTER_MS = 60_000;

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function sharedAuthority(): AuthorityHarness {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  return authority;
}

/** A queued person-lookup row with its own run/item/trace identity. */
function queuedRun(index: number): Record<string, unknown> {
  const tail = String(index).padStart(4, "0");
  const run = personLookupQueuedRun({
    runId: `0000000${index % 10}-${tail}-4000-8000-${tail}${"0".repeat(8)}`,
    itemId: `1111111${index % 10}-${tail}-4000-8000-${tail}${"0".repeat(8)}`,
  });
  const envelope = run["envelope"];
  assert.ok(envelope !== null && typeof envelope === "object");
  return {
    ...run,
    envelope: { ...envelope, traceId: `pl-170000-${index.toString(16).padStart(4, "0")}` },
  };
}

function runIdOf(record: RunRecord): string {
  return record.envelope.runId;
}

/**
 * The durable claim set, grouped by owner. This reads AUTHORITY — not an
 * in-memory counter a loop could keep consistent while the database disagreed.
 */
function activeClaimsByWorker(database: AuthorityDatabase): ReadonlyMap<string, readonly string[]> {
  const held = new Map<string, string[]>();
  for (const record of database.authority.runs.listByWorkflow(WORKFLOW_ID)) {
    if (!ACTIVE_STATES.has(record.lifecycle.state)) continue;
    const owner = "workerId" in record.lifecycle ? record.lifecycle.workerId : undefined;
    assert.ok(owner !== undefined, `${runIdOf(record)} is ${record.lifecycle.state} with no owner`);
    held.set(owner, [...(held.get(owner) ?? []), runIdOf(record)]);
  }
  return held;
}

interface OverlapObserver {
  readonly sample: () => void;
  readonly maxWorkersHoldingWork: () => number;
  readonly samples: () => number;
}

/**
 * Samples the durable claim set and fails LOUD, at the sampling instant, the
 * moment any worker owns two rows — never by inspecting a report afterwards,
 * because a double claim that was released before the run ended would be
 * invisible to a post-hoc read.
 */
function overlapObserver(database: AuthorityDatabase): OverlapObserver {
  let maximum = 0;
  let samples = 0;
  return {
    sample: (): void => {
      samples += 1;
      const held = activeClaimsByWorker(database);
      for (const [worker, runs] of held) {
        assert.equal(
          runs.length,
          1,
          `worker ${worker} held ${String(runs.length)} active runs at once: ${runs.join(", ")}`,
        );
      }
      maximum = Math.max(maximum, held.size);
    },
    maxWorkersHoldingWork: () => maximum,
    samples: () => samples,
  };
}

interface LoopHarness {
  readonly deps: WorkerLoopDependencies;
  readonly sessions: SessionFactoryHarness;
  readonly events: () => readonly ExecutorSpanEvent[];
  readonly scheduler: ManualScheduler;
  readonly stop: AbortController;
}

/**
 * One worker's whole dependency set over the SHARED authority handle. Each
 * worker gets its own session factory (ref execution-and-sessions §6.1 — one worker never shares a
 * page) and its own id prefix, so a collision in checkpoints or spans would be
 * a real defect rather than a fixture artifact.
 */
function workerHarness(
  authority: AuthorityHarness,
  workerSuffix: string,
  idPrefix: string,
  options: Readonly<{
    observer?: OverlapObserver;
    sessions?: SessionFactoryHarness;
    exitWhenIdle?: boolean;
  }> = {},
): LoopHarness {
  const sessions = options.sessions ?? happySessionHarness();
  const scheduler = new ManualScheduler(authority.clock, 0);
  const stop = new AbortController();
  const events: ExecutorSpanEvent[] = [];
  const emitter: SpanEmitter = {
    emit: (event): void => {
      events.push(event);
      options.observer?.sample();
    },
  };
  return {
    sessions,
    scheduler,
    stop,
    events: () => Object.freeze([...events]),
    deps: {
      workflowId: WorkflowIdSchema.parse(WORKFLOW_ID),
      workerId: WorkerIdSchema.parse(`person-lookup-worker-${workerSuffix}`),
      descriptor: personLookupDescriptor,
      stores: taskStoreRegistry,
      authority: authority.database,
      sessionFactory: sessions.factory,
      emitter,
      clock: authority.clock,
      ids: sequentialIdFactory(idPrefix),
      scheduler,
      taskDeadlineMs: 60_000,
      sessionAcquireMs: 20_000,
      duoCeremony: fixtureDuoCeremonyGates(authority.clock),
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      idleRepollMs: 1_000,
      log: recordingLogger().log,
      stopSignal: stop.signal,
      exitWhenIdle: options.exitWhenIdle ?? true,
    },
  };
}

/** A ucpath driver that reports every call and can hold the run open. */
function gatedUcpathSessions(hooks: Readonly<{
  onCall?: () => void;
  gate?: Promise<void>;
  started?: () => void;
}>): SessionFactoryHarness {
  return sessionFactoryHarness({
    ucpath: () => {
      const driver = healthyUcpathDriver();
      return {
        ...driver,
        searchPersonOrg: async (...args: Parameters<typeof driver.searchPersonOrg>) => {
          hooks.onCall?.();
          hooks.started?.();
          if (hooks.gate !== undefined) await hooks.gate;
          return driver.searchPersonOrg(...args);
        },
      };
    },
    crm: () => healthyCrmDriver(),
  });
}

describe("D182 C1 — two live worker loops drain one queue", () => {
  it("executes every run exactly once, one active claim per worker, and genuinely overlaps", async () => {
    const authority = sharedAuthority();
    const observer = overlapObserver(authority.database);
    const enqueued: string[] = [];
    for (let index = 1; index <= 6; index += 1) {
      const record = authority.database.authority.runs.enqueue(queuedRun(index));
      enqueued.push(runIdOf(record.record));
    }

    const first = workerHarness(authority, "1", "a", {
      observer,
      sessions: gatedUcpathSessions({ onCall: observer.sample }),
    });
    const second = workerHarness(authority, "2", "b", {
      observer,
      sessions: gatedUcpathSessions({ onCall: observer.sample }),
    });

    // Both loops are started before either is awaited: `runWorkerLoop` claims
    // its first row synchronously, so this is a real race for the head of one
    // queue, not two drains stitched together.
    const reports = await Promise.all([runWorkerLoop(first.deps), runWorkerLoop(second.deps)]);

    // Every enqueued run was executed, exactly once, across the union.
    const executed = reports.flatMap((report) => report.outcomes.map(({ runId }) => runId));
    assert.equal(new Set(executed).size, executed.length, "a run was executed twice");
    assert.deepEqual([...executed].sort(), [...enqueued].sort());
    for (const report of reports) {
      assert.equal(report.stopped, "idle");
      for (const outcome of report.outcomes) assert.equal(outcome.state, "done");
    }

    // No run was ever claimed by two workers: the `run.claimed` spans are the
    // loop's own account of what it took, and each run appears once.
    const claims = [...first.events(), ...second.events()]
      .filter((event) => event.t === "run.claimed")
      .map((event) => ({ runId: event.runId, workerId: event.workerId }));
    assert.equal(claims.length, enqueued.length);
    assert.equal(new Set(claims.map(({ runId }) => runId)).size, enqueued.length);
    assert.equal(new Set(claims.map(({ workerId }) => workerId)).size, 2, "both workers must have claimed");

    // Ref execution-and-sessions §7 "parallelism silently serializes": at some sampled instant TWO
    // workers owned work at once. A serialized runtime would peak at one.
    assert.ok(observer.samples() > 20, `only ${String(observer.samples())} samples were taken`);
    assert.equal(observer.maxWorkersHoldingWork(), 2);

    // Durable state: nothing left active, every row terminal `done` at exactly
    // one claim generation — a second claim would have advanced it.
    assert.deepEqual([...activeClaimsByWorker(authority.database).keys()], []);
    for (const record of authority.database.authority.runs.listByWorkflow(WORKFLOW_ID)) {
      assert.equal(record.lifecycle.state, "terminal", runIdOf(record));
      assert.ok("outcome" in record.lifecycle && record.lifecycle.outcome === "done", runIdOf(record));
      assert.equal(record.claimGeneration, 1, `${runIdOf(record)} was claimed more than once`);
      assert.equal(record.envelope.attempt, 1, `${runIdOf(record)} was requeued`);
    }
  });
});

describe("D182 C2 — a live loop's row is invisible to every other claimer", () => {
  it("never serves the held row to a sibling worker and refuses a second claim for the holder", async () => {
    const authority = sharedAuthority();
    const { database } = authority;
    database.authority.runs.enqueue(queuedRun(1));
    database.authority.runs.enqueue(queuedRun(2));

    let releaseDriver = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseDriver = resolve;
    });
    let markStarted = (): void => undefined;
    const driverStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const harness = workerHarness(authority, "1", "a", {
      sessions: gatedUcpathSessions({ gate, started: () => markStarted() }),
    });
    const looping = runWorkerLoop(harness.deps);
    await driverStarted;

    const held = activeClaimsByWorker(database);
    const heldRunIds = held.get("person-lookup-worker-1");
    assert.ok(heldRunIds !== undefined && heldRunIds.length === 1);
    const heldRunId = heldRunIds[0];

    // A sibling worker asking for work gets the OTHER row, never this one.
    const sibling = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: "person-lookup-worker-2",
      now: authority.clock.now().toISOString(),
    });
    assert.equal(sibling.state, "claimed");
    assert.ok(sibling.state === "claimed" && runIdOf(sibling.run) !== heldRunId);

    // The holder asking for a second row is a bug in the caller, and the store
    // says so rather than serving two browser-session sets to one owner.
    assert.throws(
      () => database.authority.runs.claimNext({
        workflow: WORKFLOW_ID,
        workerId: "person-lookup-worker-1",
        now: authority.clock.now().toISOString(),
      }),
      new RegExp(`worker person-lookup-worker-1 already holds active run ${heldRunId ?? ""}`),
    );

    releaseDriver();
    const report = await looping;
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
  });
});

describe("D182 C3 — a claim sweep concurrent with a live heartbeat", () => {
  it("leaves the freshly renewed claim alone and requeues only the genuinely stale one", async () => {
    const authority = sharedAuthority();
    const { database, clock } = authority;
    database.authority.runs.enqueue(queuedRun(1));
    database.authority.runs.enqueue(queuedRun(2));

    let releaseDriver = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseDriver = resolve;
    });
    let markStarted = (): void => undefined;
    const driverStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const harness = workerHarness(authority, "1", "a", {
      sessions: gatedUcpathSessions({ gate, started: () => markStarted() }),
    });
    const looping = runWorkerLoop(harness.deps);
    await driverStarted;

    const liveRunId = activeClaimsByWorker(database).get("person-lookup-worker-1")?.[0];
    assert.ok(liveRunId !== undefined);

    // A second worker takes the sibling row and then dies: it never renews.
    const abandoned = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: "person-lookup-worker-dead",
      now: clock.now().toISOString(),
    });
    assert.equal(abandoned.state, "claimed");
    const staleRunId = abandoned.state === "claimed" ? runIdOf(abandoned.run) : "";

    // Wall time passes past the staleness bound for BOTH rows. The live one is
    // saved by its heartbeat, not by its state — the sweep reads heartbeat_at.
    clock.advanceWall(90_000);
    const heartbeat = harness.scheduler.pending()
      .find((entry) => entry.deadlineMonotonicMs === clock.monotonicMs() + HEARTBEAT_INTERVAL_MS);
    assert.ok(heartbeat, "the live run's heartbeat must be scheduled while it executes");
    heartbeat.fire();

    const now = clock.now().toISOString();
    const swept = database.authority.runs.sweepExpiredClaims({
      workflow: WORKFLOW_ID,
      staleBefore: new Date(clock.nowMs() - CLAIM_STALE_AFTER_MS).toISOString(),
      now,
    });

    // Exactly one row was reachable by the sweep, and it is not the live one.
    assert.equal(swept.length, 1);
    assert.equal(swept[0]?.state, "requeued");
    assert.equal(swept[0] === undefined ? "" : runIdOf(swept[0].run), staleRunId);

    const live = database.authority.runs.get(liveRunId);
    assert.ok(live !== undefined);
    assert.ok(ACTIVE_STATES.has(live.lifecycle.state), `live run became ${live.lifecycle.state}`);
    assert.equal("workerId" in live.lifecycle ? live.lifecycle.workerId : undefined, "person-lookup-worker-1");
    assert.equal(live.claimGeneration, 1);
    assert.equal(live.envelope.attempt, 1);

    const stale = database.authority.runs.get(staleRunId);
    assert.ok(stale !== undefined);
    assert.equal(stale.lifecycle.state, "queued");
    assert.equal("requeuedFrom" in stale.lifecycle ? stale.lifecycle.requeuedFrom : undefined, "recovery");
    assert.equal(stale.envelope.attempt, 2);

    // The requeued row is genuinely re-claimable: the SAME live loop drains it
    // after its own run settles, so a sweep never strands work.
    releaseDriver();
    const report = await looping;
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done", "done"]);
    assert.deepEqual(
      [...report.outcomes].map(({ runId }) => runId).sort(),
      [liveRunId, staleRunId].sort(),
    );
  });
});

describe("D182 C4 — a heartbeat that lost its row never renews it", () => {
  it("reports lost to the live loop after a sweep re-owned the run, and never resurrects the claim", async () => {
    const authority = sharedAuthority();
    const { database, clock } = authority;
    database.authority.runs.enqueue(queuedRun(1));

    let markStarted = (): void => undefined;
    const driverStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    // The driver never returns: the run is held open until its claim is taken.
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          markStarted();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const harness = workerHarness(authority, "1", "a", { sessions });
    const looping = runWorkerLoop(harness.deps);
    await driverStarted;

    const runId = activeClaimsByWorker(database).get("person-lookup-worker-1")?.[0];
    assert.ok(runId !== undefined);
    const generationBefore = database.authority.runs.get(runId)?.claimGeneration;

    // A recovery sweep requeues the row (its heartbeat went stale), and a
    // second worker claims it — the first loop's claim generation is history.
    clock.advanceWall(90_000);
    const swept = database.authority.runs.sweepExpiredClaims({
      workflow: WORKFLOW_ID,
      staleBefore: new Date(clock.nowMs() - CLAIM_STALE_AFTER_MS).toISOString(),
      now: clock.now().toISOString(),
    });
    assert.deepEqual(swept.map(({ state }) => state), ["requeued"]);
    const reclaimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: "person-lookup-worker-2",
      now: clock.now().toISOString(),
    });
    assert.equal(reclaimed.state, "claimed");
    assert.ok(generationBefore !== undefined
      && reclaimed.state === "claimed"
      && reclaimed.run.claimGeneration > generationBefore);

    // The zombie's heartbeat reports `lost` and aborts its own run rather than
    // stamping a heartbeat over the new owner's claim.
    const heartbeat = harness.scheduler.pending()
      .find((entry) => entry.deadlineMonotonicMs === clock.monotonicMs() + HEARTBEAT_INTERVAL_MS);
    assert.ok(heartbeat);
    heartbeat.fire();

    const report = await looping;
    assert.equal(report.outcomes[0]?.state, "abandoned");
    const current = database.authority.runs.get(runId);
    assert.ok(current !== undefined);
    assert.equal("workerId" in current.lifecycle ? current.lifecycle.workerId : undefined, "person-lookup-worker-2");
    assert.equal(current.envelope.attempt, 2);
  });
});
