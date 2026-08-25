/**
 * The Phase-1f worker composition (`src/server/worker/compose.ts`) and the
 * command kernel's worker-browser arms as the DASHBOARD process composes them.
 *
 * Everything real is real: a temp-file `AuthorityDatabase` under the isolation
 * state root, the registered person-lookup descriptor and task stores, the
 * worker lease protocol, the JSONL span writer, and the whole worker loop.
 * Only the process edges are fakes — the browser session factory, the clock,
 * ids, and the stop signal — so a pass here pins production wiring rather than
 * a parallel reimplementation.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../src/control/workflow-registry.js";
import { createCommandKernel, type CommandKernel } from "../../src/core/command-kernel.js";
import { createPhase1WorkerRuntimeExecutor, phase1WorkerId, poolWorkerId } from "../../src/core/worker-loop.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../src/domain/ids.js";
import type { PositiveInt } from "../../src/domain/ids.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { createDashboardWorkerSupervisor } from "../../src/server/dashboard/compose.js";
import {
  composeWorkerRuntime,
  createTimeoutDeadlineScheduler,
  lineTaskLogger,
  parseWorkerArguments,
} from "../../src/server/worker/compose.js";
import { UUID_7, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "./fixtures/phase1c-contract-fixtures.js";
import {
  EXECUTOR_WORKER_ID,
  happySessionHarness,
  healthyCrmDriver,
  personLookupQueuedRun,
  sessionFactoryHarness,
  type SessionFactoryHarness,
} from "./fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory, ITEM_ID, RUN_ID, WORKFLOW_ID } from "./fixtures/phase1f-run-fixtures.js";
import { fixtureDuoCeremonyGates } from "./fixtures/duo-ceremony-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "./fixtures/archive-fixtures.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const NOW = "2026-08-03T09:00:00.000Z";
const POOL_INDEX_1 = PositiveIntSchema.parse(1);
const POOL_INDEX_2 = PositiveIntSchema.parse(2);

function repoRootWithState(): { repoRoot: string; stateRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-worker-compose-"));
  roots.push(repoRoot);
  const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  return { repoRoot, stateRoot };
}

/** Open the SAME database path the composition will, seed it, and close. */
function seedQueuedRun(stateRoot: string, clock: TestClock, run: Record<string, unknown>): void {
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  try {
    assert.equal(database.authority.runs.enqueue(run).state, "inserted");
  } finally {
    database.close();
  }
}

function reopen(stateRoot: string, clock: TestClock): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);
  return database;
}

function composeInput(options: Readonly<{
  repoRoot: string;
  clock: TestClock;
  sessions: SessionFactoryHarness;
  poolIndex: PositiveInt;
  args?: readonly string[];
  stopSignal?: AbortSignal;
  lines?: string[];
}>) {
  return {
    isolation: rebuildRuntimeIsolation,
    args: options.args ?? [WORKFLOW_ID, "--pool-index", String(options.poolIndex), "--drain"],
    env: {},
    clock: options.clock,
    ids: sequentialIdFactory("c"),
    repoRoot: options.repoRoot,
    processId: 4242,
    sessionFactory: options.sessions.factory,
    duoCeremony: fixtureDuoCeremonyGates(options.clock),
    stopSignal: options.stopSignal ?? new AbortController().signal,
    // Long enough that no scheduled beat fires during a test; the boot beat is
    // synchronous, so the lease/sweep path is still exercised.
    heartbeatIntervalMs: 600_000,
    sweepIntervalMs: 600_000,
    write: (line: string): void => {
      options.lines?.push(line);
    },
  } as const;
}

describe("worker CLI argument parsing", () => {
  it("accepts an explicit positive pool index", () => {
    assert.deepEqual(parseWorkerArguments([WORKFLOW_ID, "--pool-index", "2", "--drain"]), {
      workflowId: WORKFLOW_ID,
      poolIndex: POOL_INDEX_2,
      drain: true,
    });
  });

  it("refuses absent, malformed, zero, and duplicate pool-index flags", () => {
    assert.throws(() => parseWorkerArguments([WORKFLOW_ID]), /requires --pool-index/);
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "many"]),
      /must be a positive integer; received many/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "0"]),
      /must be a positive integer; received 0/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--pool-index", "2"]),
      /duplicate worker flag: --pool-index/,
    );
  });

  it("refuses missing values, duplicate drain flags, and unknown flags by name", () => {
    assert.throws(() => parseWorkerArguments([]), /needs a workflow id/);
    assert.throws(() => parseWorkerArguments(["not-registered"]), /is not registered/);
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "--drain"]),
      /requires a positive integer value/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--drain", "--drain"]),
      /duplicate worker flag: --drain/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--headed"]),
      /unknown worker flag: --headed/,
    );
  });
});

describe("composed worker runtime", () => {
  it("builds the whole dependency graph and drains a queued run to done", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const lines: string[] = [];

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, lines, poolIndex: POOL_INDEX_1,
    }));

    assert.equal(report.workflowId, WORKFLOW_ID);
    assert.equal(report.workerId, phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID)));
    assert.equal(report.stopped, "idle");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    // The terminal result authority is the composition's, not a fixture's.
    assert.ok(database.authority.runResults.get(RUN_ID));

    // The durable lease: started by this process, settled honestly at exit.
    const lease = database.authority.workerLeases.get(report.workerId);
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
    assert.equal(lease.processId, 4242);
    assert.equal(lease.workflow, WORKFLOW_ID);

    // The span emitter is the real JSONL writer under the isolation state root.
    const spanDirectory = join(stateRoot, "spans");
    assert.ok(existsSync(spanDirectory));
    assert.ok(readdirSync(spanDirectory).some((file) => file.startsWith(`${WORKFLOW_ID}-`)));

    // One browser session per system, closed exactly once at worker stop.
    assert.equal(sessions.opens("ucpath"), 1);
    assert.deepEqual(sessions.closeReasons(), ["worker-stop", "worker-stop"]);
  });

  it("composes distinct stable identities for members of one workflow pool", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));

    const first = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    const second = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_2,
    }));

    const expected = [
      poolWorkerId(WorkflowIdSchema.parse(WORKFLOW_ID), POOL_INDEX_1),
      poolWorkerId(WorkflowIdSchema.parse(WORKFLOW_ID), POOL_INDEX_2),
    ];
    const database = reopen(stateRoot, clock);
    assert.deepEqual({
      reports: [first.workerId, second.workerId],
      authorityLeases: expected.map((workerId) => database.authority.workerLeases.get(workerId)?.workerId),
    }, {
      reports: expected,
      authorityLeases: expected,
    });
  });

  it("refuses a second process answering to the same worker id", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = poolWorkerId(WorkflowIdSchema.parse(WORKFLOW_ID), POOL_INDEX_1);
    const database = reopen(stateRoot, clock);
    assert.equal(database.authority.workerLeases.start({
      workerId,
      workflow: WORKFLOW_ID,
      processId: 999,
      requestedBy: "local-operator",
      now: NOW,
    }).state, "started");

    await assert.rejects(
      composeWorkerRuntime(composeInput({
        repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
      })),
      /a second process may not answer to the same worker id/,
    );
  });

  it("reclaims a lease whose process died without settling, instead of bricking the workflow", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    const seed = reopen(stateRoot, clock);
    // A worker that was SIGKILLed leaves a live `idle` lease behind whose
    // heartbeat then ages out. Only a RUNNING worker sweeps, so without a
    // reclaim-before-acquire pass no worker could ever start again.
    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, processId: 999, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    }).state, "applied");
    clock.advanceWall(120_000);
    clock.advanceMonotonic(120_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === 4242);
    assert.ok(lines.some((line) => line.includes("stale worker lease reclaimed before start")));
  });

  /**
   * D200. A worker whose loop throws settles its LEASE (`crashed`) on the way
   * out and leaves its claimed run row exactly where it was. The next process
   * therefore wins the lease and then finds `claimNext` refusing —
   * `worker … already holds active run …` — because the row it left behind is
   * still owned by this worker id. The maintenance boot sweep cannot help: the
   * row's heartbeat is seconds old, far inside the 60s staleness gate. Before
   * this, the only ways out were starting a DIFFERENT workflow's worker or
   * cancelling the run.
   */
  it("sweeps its own orphaned claim at startup and then claims it, same workflow", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    const crashed = reopen(stateRoot, clock);
    const claimed = crashed.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.equal(claimed.state, "claimed", "the crashed process must actually own the row");
    // The clock barely moves: the heartbeat this row carries is FRESH, which is
    // precisely why the staleness-gated boot sweep skips it.
    clock.advanceWall(2_000);
    clock.advanceMonotonic(2_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.ok(
      lines.some((line) => line.includes("orphaned claim released before the first poll")),
      "the startup self-sweep did not report releasing the row",
    );
    const run = crashed.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    assert.equal(run.envelope.attempt, 2, "a swept claim takes a fresh attempt");
  });

  /**
   * D200 reuses the D118 sweeper rather than forking it, so the startup pass
   * inherits the gate: a run whose logical item holds an unfinished
   * `attempting` write intent PARKS and is never requeued. A startup path that
   * reimplemented "release my own rows" would have handed a possibly-landed
   * real HR write straight back to the executor.
   */
  it("parks — never requeues — its own orphaned claim that holds an attempting write intent", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    const crashed = reopen(stateRoot, clock);
    const claimed = crashed.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.ok(claimed.state === "claimed");
    const validating = crashed.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.run.version,
      claim: { workerId, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    });
    assert.ok(validating.state === "applied");
    const running = crashed.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: validating.run.version,
      claim: { workerId, claimGeneration: 1 },
      lifecycle: { state: "running", workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "searching" },
      now: NOW,
    });
    assert.ok(running.state === "applied");
    crashed.authority.writeIntents.fenceAttempt({
      intent: { ...WRITE_INTENT_ATTEMPTING, workflowId: WORKFLOW_ID, itemId: ITEM_ID },
      attempt: WRITE_ATTEMPT,
    });
    clock.advanceWall(2_000);
    clock.advanceMonotonic(2_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    // Nothing was claimable, so the drain reports idle with no outcomes at all.
    assert.deepEqual(report.outcomes, []);
    assert.equal(report.stopped, "idle");
    assert.ok(
      lines.some((line) => line.includes("orphaned claim routed to ref write-safety recovery")),
      "the startup self-sweep did not report the recovery routing",
    );
    const run = crashed.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "parked-write");
    assert.equal(run.lifecycle.writeIntentId, WRITE_INTENT_ATTEMPTING.writeIntentId);
    assert.equal(run.envelope.attempt, 1, "a parked write must never take a new attempt");
  });

  it("stops gracefully mid-run: the run is abandoned, never terminalized over a lost claim", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    let started: (() => void) | undefined;
    const driverStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          started?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const stop = new AbortController();

    const running = composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, stopSignal: stop.signal, poolIndex: POOL_INDEX_1,
    }));
    await driverStarted;
    stop.abort(new Error("operator pressed Ctrl-C"));
    const report = await running;

    assert.equal(report.stopped, "stop-signal");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["abandoned"]);
    // The interrupted lease was poison-closed, and the worker-stop sweep found
    // nothing left to close — an uncertain lease is never silently reused.
    assert.deepEqual(sessions.closeReasons(), ["poisoned"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state !== "terminal");
    const lease = database.authority.workerLeases.get(phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID)));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
  });

  it("fails loud when worker-stop cannot prove closure, and records the lease as crashed", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const unprovable: SessionFactoryHarness = {
      ...sessions,
      factory: {
        open: async (input) => {
          const resource = await sessions.factory.open(input);
          return {
            ...resource,
            // A hung/unprovable teardown: the factory contract says an
            // unproven close THROWS, and the manager's poison rule keeps the
            // resource registered rather than believing cleanup succeeded.
            close: () => Promise.reject(new Error(
              `${resource.system} context did not close within its bounded deadline`,
            )),
          };
        },
      },
    };

    await assert.rejects(
      composeWorkerRuntime(composeInput({
        repoRoot, clock, sessions: unprovable, poolIndex: POOL_INDEX_1,
      })),
      (error: unknown) => error instanceof AggregateError
        && error.errors.some((failure: unknown) => failure instanceof Error
          && /did not close within its bounded deadline/.test(failure.message)),
    );

    const database = reopen(stateRoot, clock);
    const lease = database.authority.workerLeases.get(phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID)));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    // An unprovable teardown is a crash, never a clean shutdown.
    assert.equal(lease.lifecycle.reason, "crashed");
  });

  it("starts a NEW lease generation over a settled one and drains normally", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    const seed = reopen(stateRoot, clock);
    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, processId: 7, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "operator" },
      now: NOW,
    }).state, "applied");

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === 4242);
  });
});

describe("worker composition helpers", () => {
  it("schedules real monotonic deadlines and cancels them", async () => {
    const clock = manualClock(new Date(NOW));
    const scheduler = createTimeoutDeadlineScheduler(clock);
    const fired: string[] = [];
    const handle = scheduler.schedule(clock.monotonicMs() + 5_000, () => fired.push("late"));
    scheduler.schedule(clock.monotonicMs(), () => fired.push("now"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    handle.cancel();
    assert.deepEqual(fired, ["now"]);
  });

  it("logs structured lines rather than console output", () => {
    const clock = manualClock(new Date(NOW));
    const lines: string[] = [];
    lineTaskLogger((line) => lines.push(line), clock).warn("something", { runId: RUN_ID });
    assert.deepEqual(JSON.parse(lines[0] ?? ""), {
      ts: NOW,
      level: "warn",
      message: "something",
      runId: RUN_ID,
    });
  });
});

/* ── the kernel's worker-browser arms, as the dashboard composes them ────── */

function kernelHarness(): { database: AuthorityDatabase; kernel: CommandKernel; clock: TestClock } {
  const root = mkdtempSync(join(tmpdir(), "hrauto-worker-arms-"));
  roots.push(root);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);
  const kernel = createCommandKernel({
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("d"),
    descriptors: {
      resolve: (workflowId) => DESCRIPTORS.find((descriptor) => String(descriptor.id) === workflowId),
    },
    writeResolution: {
      resolvePresent: () => {
        throw new Error("unused in this suite");
      },
      resolveAbsent: () => {
        throw new Error("unused in this suite");
      },
    },
    // EXACTLY what src/server/dashboard/compose.ts composes.
    workerRuntime: createPhase1WorkerRuntimeExecutor(createDashboardWorkerSupervisor()),
  });
  return { database, kernel, clock };
}

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `cccccccc-${tail}-4000-8000-${tail}00000000`;
}

function envelope(commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "worker-browser",
  } as const;
}

describe("dashboard-composed worker-browser command arms", () => {
  it("applies the wired arms: a one-worker plan and durable lease directives", () => {
    const harness = kernelHarness();
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));

    // D269: the pool version is the CAS basis — 0 for a workflow nobody has
    // planned; the applied plan creates the row at version 1.
    const planned = harness.kernel.execute({
      ...envelope(),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    });
    assert.equal(planned.state, "applied");
    assert.deepEqual(planned.affectedTargets, [
      { family: "worker-pool", workflowId: WORKFLOW_ID },
      { family: "worker-browser", workerId },
    ]);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW_ID)?.version, 1);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW_ID)?.desiredWorkers, 1);

    assert.equal(harness.database.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, processId: 11, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    const paused = harness.kernel.execute({
      ...envelope(),
      type: "pause-worker",
      target: { workerId, expectedVersion: 1 },
    });
    assert.equal(paused.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "pause");

    const stopped = harness.kernel.execute({
      ...envelope(),
      type: "stop-worker",
      target: { workerId, expectedVersion: 2 },
    });
    assert.equal(stopped.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "stop");
  });

  it("refuses a plan for more than one worker, unwinding the whole command", () => {
    const harness = kernelHarness();
    const commandId = nextCommandId();
    assert.throws(
      () => harness.kernel.execute({
        ...envelope(commandId),
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 0 },
        payload: { desiredWorkers: 3 },
      }),
      /exactly one worker per workflow/,
    );
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    // D269: the runtime's refusal unwinds the pool write with the command —
    // no declaration of 3 workers survives a count the runtime refused.
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW_ID), undefined);
  });

  it("keeps spawn-worker unavailable in the dashboard process and names the CLI path", () => {
    const harness = kernelHarness();
    const commandId = nextCommandId();
    assert.throws(
      () => harness.kernel.execute({
        ...envelope(commandId),
        type: "spawn-worker",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 0 },
        payload: { workerId: EXECUTOR_WORKER_ID },
      }),
      /does not launch browser workers .*cli worker person-lookup/s,
    );
    // A thrown supervisor error unwinds the command: no journal row, no lease.
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.workerLeases.get(EXECUTOR_WORKER_ID), undefined);
  });

  it("keeps refresh/reopen browser unavailable rather than acknowledging a non-effect", () => {
    const harness = kernelHarness();
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    assert.equal(harness.database.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, processId: 12, requestedBy: "local-operator", now: NOW,
    }).state, "started");

    for (const type of ["refresh-browser", "reopen-browser"] as const) {
      const commandId = nextCommandId();
      assert.throws(
        () => harness.kernel.execute({
          ...envelope(commandId),
          type,
          target: { workerId, browserSessionId: UUID_7, expectedVersion: 1 },
        }),
        /requires the 1g browser supervisor/,
      );
      assert.equal(harness.database.authority.commands.get(commandId), undefined);
    }
  });
});
