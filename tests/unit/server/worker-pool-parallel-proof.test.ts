/**
 * W5 (ref execution-and-sessions §7.1 / §11, D271): the automated two-child
 * PARALLEL proof for the dashboard worker supervisor — §7.1's standing rule
 * says a new surface two callers can reach adds its concurrency row in the
 * commit that lands it, and §11's pool door is that surface.
 *
 * Two lanes, split by what each claim is ABOUT:
 *
 * - Claims about PROCESSES run REAL OS children: `tests/fixtures/worker-stub-cli.ts`
 *   is spawned through the composed control's real process boundary, proves its
 *   own birth by writing the durable worker lease under its own pid into the
 *   same authority database, takes the real per-worker process lock, observes
 *   the durable stop directive, and exits. Real time is used only here, bounded
 *   generously.
 * - Claims about ORDERING and REFUSALS run the deterministic composed harness
 *   (the W3 pattern): real supervisor, real kernel pool door, real authority —
 *   manual clock, manual scheduler, recording fakes at the process edge only.
 *
 * What this file pins, from the W5 brief:
 * 1. TWO children supervised concurrently through the composed kernel door,
 *    with EXACT pool identities (workflow + pool index + workerId derivation)
 *    and no cross-talk;
 * 2. the overlap/teardown soak: overlapping command sequences, every
 *    acknowledgement truthful, per-workflow serialization observable (the W3b
 *    mutex) — SAME-workflow commands serialize, DIFFERENT workflows interleave;
 * 3. locks released after shutdown, close() evidence on the fault sink, no
 *    orphan children (PID liveness);
 * 4. ZERO false success: spawn ENOENT, an undelivered signal, and a durable
 *    stop-channel throw each surface as their typed refusal/fault — never an
 *    applied acknowledgement.
 */
import assert from "node:assert/strict";
import { spawn as spawnChildProcess, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import {
  createCommandKernel,
  type CommandKernel,
  type CommandKernelDependencies,
  type WorkerPoolRuntimeSeam,
} from "../../../src/core/command-kernel.js";
import { poolWorkerId, type WorkerPoolMember } from "../../../src/core/worker-loop.js";
import { manualClock, systemClock, type Clock, type TestClock } from "../../../src/domain/clock.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../../src/domain/ids.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { WorkerProcessLockFileSchema } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { createTimeoutDeadlineScheduler } from "../../../src/server/scheduling/timeout-deadline-scheduler.js";
import {
  composeDashboardRuntime,
  composeWorkerProcessControl,
  type DashboardRuntime,
} from "../../../src/server/dashboard/compose.js";
import type {
  SpawnedWorkerHandle,
  WorkerProcessSpawnRequest,
  WorkerProcessSpawner,
} from "../../../src/server/dashboard/worker-supervisor.js";
import { ManualScheduler } from "../fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  NO_INTAKE_PROJECTIONS,
  UNSTORED_CONFIG_IDENTITY,
  UNWIRED_INTAKE_PARSER,
} from "../../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../fixtures/archive-fixtures.js";

const NOW = "2026-08-26T09:00:00.000Z";
const PL = WorkflowIdSchema.parse("person-lookup");
const SEP = WorkflowIdSchema.parse("separations-identity-check");
const plMember = (index: number): WorkerPoolMember => {
  const poolIndex = PositiveIntSchema.parse(index);
  return { workflowId: PL, poolIndex, workerId: poolWorkerId(PL, poolIndex) };
};
const sepMember = (index: number): WorkerPoolMember => {
  const poolIndex = PositiveIntSchema.parse(index);
  return { workflowId: SEP, poolIndex, workerId: poolWorkerId(SEP, poolIndex) };
};
const PL_1 = plMember(1);
const PL_2 = plMember(2);
const PL_3 = plMember(3);
const SEP_1 = sepMember(1);

const STUB_CLI_PATH = join(process.cwd(), "tests", "fixtures", "worker-stub-cli.ts");
const REPO_ROOT = process.cwd();

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the proof expected ${what} to exist`);
  return value;
}

/* ── shared cleanup: kill every child even on failure, then sweep roots ──── */

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const cleanups: (() => Promise<void> | void)[] = [];
const liveRealChildren: ChildProcess[] = [];

afterEach(async () => {
  // Each phase must run even if an earlier one throws (e.g. runtime.stop()
  // rejecting) — otherwise a throwing cleanup phase aborts the SIGKILL loop,
  // the db close, and the root sweep, leaking live stub children on the last
  // test. Collect every phase's errors and rethrow aggregated at the end.
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const child of liveRealChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  for (const database of openDatabases.splice(0)) {
    try {
      database.close();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `afterEach cleanup failed (${String(errors.length)} error(s))`);
  }
}, 30_000);

/* ── shared command plumbing ─────────────────────────────────────────────── */

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `eeeeeeee-${tail}-4000-8000-${tail}00000000`;
}

function envelope(clock: Clock, commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "worker-browser",
  } as const;
}

/** One pool-effect boundary crossing, in door order. */
interface PoolEffectEvent {
  readonly commandId: string;
  readonly type: string;
  readonly phase: "enter" | "exit";
  readonly seq: number;
  readonly atMonotonicMs: number;
}

function eventOf(events: readonly PoolEffectEvent[], commandId: string, phase: "enter" | "exit"): PoolEffectEvent {
  return required(
    events.find((event) => event.commandId === commandId && event.phase === phase),
    `a pool-effect ${phase} event for command ${commandId}`,
  );
}

/**
 * Wraps the composed pool seam so the proof can OBSERVE the door: every pool
 * effect records its enter/exit with a door-wide sequence number. The W3b
 * per-workflow mutex serializes the whole A→C flow, so two same-workflow
 * commands must produce disjoint effect windows in submission order, while
 * different workflows may nest.
 */
function instrumentPool(
  pool: WorkerPoolRuntimeSeam,
  clock: Clock,
  events: PoolEffectEvent[],
): WorkerPoolRuntimeSeam {
  let seq = 0;
  const record = (commandId: string, type: string, phase: "enter" | "exit"): void => {
    seq += 1;
    events.push({ commandId, type, phase, seq, atMonotonicMs: clock.monotonicMs() });
  };
  const wrap = <Method extends keyof WorkerPoolRuntimeSeam>(method: Method): WorkerPoolRuntimeSeam[Method] =>
    async (context: Parameters<WorkerPoolRuntimeSeam[Method]>[0]) => {
      record(context.command.commandId, context.command.type, "enter");
      try {
        return await pool[method](context);
      } finally {
        record(context.command.commandId, context.command.type, "exit");
      }
    };
  return {
    planPoolWorkerCount: wrap("planPoolWorkerCount"),
    spawnPoolWorker: wrap("spawnPoolWorker"),
    stopPoolWorker: wrap("stopPoolWorker"),
    pausePoolWorker: wrap("pausePoolWorker"),
    resumePoolWorker: wrap("resumePoolWorker"),
    refreshPoolBrowser: wrap("refreshPoolBrowser"),
    reopenPoolBrowser: wrap("reopenPoolBrowser"),
  };
}

function kernelOver(
  database: AuthorityDatabase,
  clock: Clock,
  pool: WorkerPoolRuntimeSeam,
): CommandKernel {
  const dependencies: CommandKernelDependencies = {
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("f"),
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
    workerRuntime: { pool },
  };
  return createCommandKernel(dependencies);
}

/** Journal truth: an applied command has its row and its applied audit; a refusal has neither. */
function assertJournaled(database: AuthorityDatabase, commandId: string): void {
  assert.notEqual(database.authority.commands.get(commandId), undefined, `command ${commandId} journal row`);
  assert.equal(
    database.authority.commandAudits.findByCommand(commandId)?.result.state,
    "applied",
    `command ${commandId} audit`,
  );
}
function assertUnjournaled(database: AuthorityDatabase, commandId: string): void {
  assert.equal(database.authority.commands.get(commandId), undefined, `command ${commandId} must not journal`);
  assert.equal(
    database.authority.commandAudits.findByCommand(commandId),
    undefined,
    `command ${commandId} must not audit`,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lane 1 — deterministic composed harness (real supervisor + kernel door,
   recording fakes at the process edge; the W3 pattern, extended for W5)
   ═══════════════════════════════════════════════════════════════════════════ */

class FakeWorkerChild implements SpawnedWorkerHandle {
  readonly pid: number | undefined;
  readonly signalsSent: string[] = [];
  readonly #killResult: boolean;
  #exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
  #errorListeners: ((error: Error) => void)[] = [];

  constructor(pid: number | undefined, killResult = true) {
    this.pid = pid;
    this.#killResult = killResult;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.signalsSent.push(signal);
    return this.#killResult;
  }

  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.#exitListeners.push(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.#errorListeners.push(listener);
  }

  emitExit(code: number | null, signal: string | null): void {
    for (const listener of this.#exitListeners) listener(code, signal);
  }

  emitError(error: Error): void {
    for (const listener of this.#errorListeners) listener(error);
  }
}

interface SoakHarness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly scheduler: ManualScheduler;
  readonly kernel: CommandKernel;
  readonly control: ReturnType<typeof composeWorkerProcessControl>;
  readonly children: FakeWorkerChild[];
  readonly spawnRequests: WorkerProcessSpawnRequest[];
  readonly faults: Error[];
  readonly events: PoolEffectEvent[];
}

interface SoakHarnessOptions {
  /** Per-worker fake-child behavior; default is a healthy signalable child. */
  readonly childFor?: (member: WorkerPoolMember, pid: number) => FakeWorkerChild;
  /** The W3 interception hook: run an out-of-band authority write inside the door. */
  readonly interceptPool?: (
    pool: WorkerPoolRuntimeSeam,
    edges: Readonly<{ database: AuthorityDatabase; clock: TestClock }>,
  ) => WorkerPoolRuntimeSeam;
}

function openSoakHarness(options?: SoakHarnessOptions): SoakHarness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-w5-soak-"));
  roots.push(root);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);
  const scheduler = new ManualScheduler(clock, 0);
  const children: FakeWorkerChild[] = [];
  const spawnRequests: WorkerProcessSpawnRequest[] = [];
  const faults: Error[] = [];
  const events: PoolEffectEvent[] = [];
  let nextPid = 7000;
  const control = composeWorkerProcessControl({
    database,
    clock,
    scheduler,
    launch: {
      command: "/usr/bin/fake-worker-node",
      prefixArgs: Object.freeze(["--import", "tsx", "src/cli.ts"]),
      cwd: root,
    },
    spawn: (request) => {
      spawnRequests.push(request);
      nextPid += 1;
      const child = options?.childFor === undefined
        ? new FakeWorkerChild(nextPid)
        : options.childFor(request.member, nextPid);
      children.push(child);
      return child;
    },
    birth: { pollMs: 250, timeoutMs: 10_000 },
    onFault: (error) => {
      faults.push(error);
    },
  });
  cleanups.push(() => {
    control.supervisor.close();
  });
  const intercepted = options?.interceptPool === undefined
    ? control.workerRuntime.pool
    : options.interceptPool(control.workerRuntime.pool, { database, clock });
  const kernel = kernelOver(database, clock, instrumentPool(intercepted, clock, events));
  return { database, clock, scheduler, kernel, control, children, spawnRequests, faults, events };
}

const settleMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function fireBirthPoll(harness: SoakHarness): void {
  for (const entry of harness.scheduler.pending()) entry.fire();
}

/** Prove the last-spawned fake child's birth the way the real worker CLI does. */
function proveBirth(harness: SoakHarness, member: WorkerPoolMember): void {
  const child = required(harness.children.at(-1), "a spawned fake child");
  const pid = required(child.pid, "the fake child's pid");
  assert.equal(harness.database.authority.workerLeases.start({
    workerId: member.workerId,
    workflow: member.workflowId,
    processId: pid,
    requestedBy: "local-operator",
    now: harness.clock.now().toISOString(),
  }).state, "started");
  fireBirthPoll(harness);
}

describe("W5 soak: overlapping command sequences over the composed pool door (deterministic)", () => {
  it(
    "serializes SAME-workflow commands, interleaves DIFFERENT workflows, and every acknowledgement is truthful",
    async () => {
      const harness = openSoakHarness();

      // ── plan up, both workflows, driven concurrently ────────────────────
      const planPlId = nextCommandId();
      const planSepId = nextCommandId();
      const planPl = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, planPlId),
        type: "plan-worker-count",
        target: { workflowId: PL, expectedVersion: 0 },
        payload: { desiredWorkers: 2 },
      });
      const planSep = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, planSepId),
        type: "plan-worker-count",
        target: { workflowId: SEP, expectedVersion: 0 },
        payload: { desiredWorkers: 1 },
      });
      const [planPlResult, planSepResult] = await Promise.all([planPl, planSep]);
      assert.equal(planPlResult.state, "applied");
      assert.equal(planSepResult.state, "applied");
      assert.equal(harness.database.authority.workerPools.get(PL)?.desiredWorkers, 2);
      assert.equal(harness.database.authority.workerPools.get(SEP)?.desiredWorkers, 1);

      // ── DIFFERENT workflows interleave: SEP-1's whole spawn lands INSIDE
      //    PL-1's still-open birth window ───────────────────────────────────
      const spawnPl1Id = nextCommandId();
      const spawnPl1 = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, spawnPl1Id),
        type: "spawn-worker",
        target: { workflowId: PL, expectedVersion: 1 },
        payload: { workerId: PL_1.workerId },
      });
      await settleMicrotasks();
      const spawnSep1Id = nextCommandId();
      const spawnSep1 = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, spawnSep1Id),
        type: "spawn-worker",
        target: { workflowId: SEP, expectedVersion: 1 },
        payload: { workerId: SEP_1.workerId },
      });
      await settleMicrotasks();
      proveBirth(harness, SEP_1);
      assert.equal((await spawnSep1).state, "applied");
      // PL-1 is STILL awaiting birth while SEP-1 settled end to end.
      const pl1Child = required(harness.children[0], "PL-1's child");
      const pl1Pid = required(pl1Child.pid, "PL-1's pid");
      assert.equal(harness.database.authority.workerLeases.start({
        workerId: PL_1.workerId, workflow: PL, processId: pl1Pid,
        requestedBy: "local-operator", now: harness.clock.now().toISOString(),
      }).state, "started");
      fireBirthPoll(harness);
      assert.equal((await spawnPl1).state, "applied");
      assert.ok(
        eventOf(harness.events, spawnSep1Id, "enter").seq > eventOf(harness.events, spawnPl1Id, "enter").seq
        && eventOf(harness.events, spawnSep1Id, "exit").seq < eventOf(harness.events, spawnPl1Id, "exit").seq,
        `SEP-1's spawn effect must nest inside PL-1's: ${JSON.stringify(harness.events)}`,
      );

      // ── SAME workflow serializes: a pause issued during PL-2's in-flight
      //    spawn must not even ENTER the door until that spawn exits ────────
      harness.clock.advanceWall(1_000);
      const spawnPl2Id = nextCommandId();
      const spawnPl2 = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, spawnPl2Id),
        type: "spawn-worker",
        target: { workflowId: PL, expectedVersion: 1 },
        payload: { workerId: PL_2.workerId },
      });
      await settleMicrotasks();
      const pausePl1Id = nextCommandId();
      const pausePl1 = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, pausePl1Id),
        type: "pause-worker",
        target: { workerId: PL_1.workerId, expectedVersion: 1 },
        reason: "w5 soak pause",
      });
      await settleMicrotasks();
      // Queued behind the same-workflow spawn: no effect entered, no durable
      // directive, no journal row — the acknowledgement has not been minted.
      assert.equal(harness.events.some((event) => event.commandId === pausePl1Id), false);
      assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId)?.control.directive, "run");
      assert.equal(harness.database.authority.commands.get(pausePl1Id), undefined);
      proveBirth(harness, PL_2);
      assert.equal((await spawnPl2).state, "applied");
      assert.equal((await pausePl1).state, "applied");
      assert.ok(
        eventOf(harness.events, pausePl1Id, "enter").seq > eventOf(harness.events, spawnPl2Id, "exit").seq,
        "the pause may enter the door only after the same-workflow spawn exits",
      );
      const pausedAt = harness.clock.now().toISOString();
      assert.deepEqual(harness.database.authority.workerLeases.get(PL_1.workerId)?.control, {
        directive: "pause", requestedAt: pausedAt, requestedBy: "local-operator", reason: "w5 soak pause",
      });
      const resumePl1Id = nextCommandId();
      assert.equal((await harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, resumePl1Id),
        type: "resume-worker",
        target: { workerId: PL_1.workerId, expectedVersion: 2 },
      })).state, "applied");
      assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId)?.control.directive, "run");

      // ── scale PL down to 1 while SEP still works, then stop SEP — driven
      //    concurrently across the two workflows ────────────────────────────
      harness.clock.advanceWall(1_000);
      const scaleDownAt = harness.clock.now().toISOString();
      const shrinkPlId = nextCommandId();
      const stopSepId = nextCommandId();
      const shrinkPl = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, shrinkPlId),
        type: "plan-worker-count",
        target: { workflowId: PL, expectedVersion: 1 },
        payload: { desiredWorkers: 1 },
      });
      const stopSep = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, stopSepId),
        type: "stop-worker",
        target: { workerId: SEP_1.workerId, expectedVersion: 1 },
        reason: "sep teardown",
      });
      const [shrinkResult, stopSepResult] = await Promise.all([shrinkPl, stopSep]);
      assert.equal(shrinkResult.state, "applied");
      assert.equal(stopSepResult.state, "applied");
      // The scale-down's acknowledgement is truthful in authority: the excess
      // member PL-2 carries the durable stop directive at the plan command's
      // own now; the desired member PL-1 is untouched.
      assert.deepEqual(harness.database.authority.workerLeases.get(PL_2.workerId)?.control, {
        directive: "stop", requestedAt: scaleDownAt, requestedBy: "local-operator",
      });
      assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId)?.control.directive, "run");
      assert.equal(harness.database.authority.workerPools.get(PL)?.desiredWorkers, 1);
      assert.equal(harness.database.authority.workerPools.get(PL)?.version, 2);
      assert.equal(harness.control.supervisor.memberEvidence(PL_2)?.state, "stopping");
      assert.deepEqual(harness.database.authority.workerLeases.get(SEP_1.workerId)?.control, {
        directive: "stop", requestedAt: scaleDownAt, requestedBy: "local-operator", reason: "sep teardown",
      });

      // ── stop the last member, then the children die and close() is empty ─
      const stopPl1Id = nextCommandId();
      assert.equal((await harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, stopPl1Id),
        type: "stop-worker",
        target: { workerId: PL_1.workerId, expectedVersion: 3 },
        reason: "pl teardown",
      })).state, "applied");
      required(harness.children[0], "PL-1 child").emitExit(0, null);
      required(harness.children[1], "SEP-1 child").emitExit(0, null);
      required(harness.children[2], "PL-2 child").emitExit(0, null);
      for (const member of [PL_1, PL_2, SEP_1]) {
        const evidence = harness.control.supervisor.memberEvidence(member);
        assert.equal(evidence?.state, "exited", member.workerId);
        if (evidence?.state !== "exited") throw new Error("unreachable");
        assert.equal(evidence.outcome, "stopped", member.workerId);
        assert.equal(evidence.reportedBy, "os", member.workerId);
      }
      assert.deepEqual(harness.control.supervisor.close(), []);
      await assert.rejects(
        () => harness.kernel.executeWorkerPool({
          ...envelope(harness.clock),
          type: "spawn-worker",
          target: { workflowId: PL, expectedVersion: 2 },
          payload: { workerId: PL_3.workerId },
        }),
        /this worker supervisor is closed; a closed supervisor acknowledges nothing/,
      );

      // ── truthfulness sweep: every applied command journaled + audited ────
      for (const commandId of [
        planPlId, planSepId, spawnPl1Id, spawnSep1Id, spawnPl2Id,
        pausePl1Id, resumePl1Id, shrinkPlId, stopSepId, stopPl1Id,
      ]) {
        assertJournaled(harness.database, commandId);
      }
      assert.deepEqual(harness.faults, []);
    },
  );

  it("a spawn ENOENT surfaces typed and unjournaled while the sibling workflow's in-flight spawn still lands", async () => {
    const harness = openSoakHarness();
    const spawnSepId = nextCommandId();
    const spawnSep = harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, spawnSepId),
      type: "spawn-worker",
      target: { workflowId: SEP, expectedVersion: 0 },
      payload: { workerId: SEP_1.workerId },
    });
    await settleMicrotasks();
    const spawnPlId = nextCommandId();
    const spawnPl = harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, spawnPlId),
      type: "spawn-worker",
      target: { workflowId: PL, expectedVersion: 0 },
      payload: { workerId: PL_1.workerId },
    });
    await settleMicrotasks();
    // The OS refuses SEP-1's launch while PL-1's spawn is mid-flight.
    required(harness.children[0], "SEP-1 child").emitError(new Error("spawn ENOENT"));
    await assert.rejects(
      () => spawnSep,
      /process errored before proving its lease birth: spawn ENOENT; the unproved child was killed/,
    );
    proveBirth(harness, PL_1);
    assert.equal((await spawnPl).state, "applied");
    assertUnjournaled(harness.database, spawnSepId);
    assertJournaled(harness.database, spawnPlId);
    assert.equal(harness.database.authority.workerLeases.get(SEP_1.workerId), undefined);
    const sepEvidence = harness.control.supervisor.memberEvidence(SEP_1);
    assert.equal(sepEvidence?.state, "exited");
    if (sepEvidence?.state !== "exited") throw new Error("unreachable");
    assert.equal(sepEvidence.outcome, "crashed");
    assert.equal(sepEvidence.reportedBy, "supervisor");
  });

  it("an undelivered escalation SIGTERM reaches the fault sink and records NO stage that did not happen", async () => {
    const harness = openSoakHarness({
      childFor: (_member, pid) => new FakeWorkerChild(pid, false),
    });
    const spawnId = nextCommandId();
    const spawn = harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, spawnId),
      type: "spawn-worker",
      target: { workflowId: PL, expectedVersion: 0 },
      payload: { workerId: PL_1.workerId },
    });
    await settleMicrotasks();
    proveBirth(harness, PL_1);
    assert.equal((await spawn).state, "applied");
    const stopAt = harness.clock.now().toISOString();
    const stopId = nextCommandId();
    assert.equal((await harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, stopId),
      type: "stop-worker",
      target: { workerId: PL_1.workerId, expectedVersion: 1 },
      reason: "w5 wedge",
    })).state, "applied");

    harness.clock.advanceMonotonic(120_000);
    for (const entry of harness.scheduler.pending()) entry.fire();
    assert.equal(harness.faults.length, 1);
    assert.match(
      required(harness.faults[0], "the wedged-stop fault").message,
      /escalation SIGTERM was not delivered and the child has not reported exit; the stop is wedged/,
    );
    // The evidence records ONLY the stage that actually happened.
    const evidence = harness.control.supervisor.memberEvidence(PL_1);
    assert.equal(evidence?.state, "stopping");
    if (evidence?.state !== "stopping") throw new Error("unreachable");
    assert.deepEqual(evidence.observedStop, [{ stage: "graceful-stop-requested", at: stopAt }]);
    // No SIGKILL follow-up was armed over an undelivered SIGTERM.
    assert.equal(harness.scheduler.pending().length, 0);
    assertJournaled(harness.database, stopId);
  });

  it("a durable stop-channel throw surfaces UNCERTAIN — no applied ack, no journal row, plans refuse the member", async () => {
    const harness = openSoakHarness({
      interceptPool: (pool, edges) => ({
        ...pool,
        stopPoolWorker: async (context) => {
          // The child dies and reports its own stopped lifecycle between the
          // kernel's phase-A validation and the durable directive write —
          // the composed channel then finds a dead lease and throws.
          const lease = required(
            edges.database.authority.workerLeases.get(PL_1.workerId),
            "PL-1's lease",
          );
          const now = edges.clock.now().toISOString();
          assert.equal(edges.database.authority.workerLeases.reportLifecycle({
            workerId: PL_1.workerId,
            leaseGeneration: lease.leaseGeneration,
            lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt, stoppedAt: now, reason: "crashed" },
            now,
          }).state, "applied");
          return pool.stopPoolWorker(context);
        },
      }),
    });
    const spawnId = nextCommandId();
    const spawn = harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, spawnId),
      type: "spawn-worker",
      target: { workflowId: PL, expectedVersion: 0 },
      payload: { workerId: PL_1.workerId },
    });
    await settleMicrotasks();
    proveBirth(harness, PL_1);
    assert.equal((await spawn).state, "applied");

    const stopId = nextCommandId();
    await assert.rejects(
      () => harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, stopId),
        type: "stop-worker",
        target: { workerId: PL_1.workerId, expectedVersion: 1 },
        reason: "w5 uncertain",
      }),
      /is UNCERTAIN: the durable stop channel threw \(graceful stop for person-lookup-worker-1 found the lease stopped/,
    );
    assertUnjournaled(harness.database, stopId);
    const evidence = harness.control.supervisor.memberEvidence(PL_1);
    assert.equal(evidence?.state, "stop-uncertain");
    // A plan can no longer attest the member whose stop may have landed.
    const planId = nextCommandId();
    await assert.rejects(
      () => harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, planId),
        type: "plan-worker-count",
        target: { workflowId: PL, expectedVersion: 0 },
        payload: { desiredWorkers: 1 },
      }),
      /durable stop directive is UNCERTAIN .*a plan cannot attest a member whose stop may have landed/,
    );
    assertUnjournaled(harness.database, planId);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Lane 2 — REAL OS children through the composed door (real time, bounded)
   ═══════════════════════════════════════════════════════════════════════════ */

interface RealChildRecord {
  readonly member: WorkerPoolMember;
  readonly command: string;
  readonly argv: readonly string[];
  readonly pid: number | undefined;
  readonly child: ChildProcess;
  readonly output: string[];
  exited: boolean;
}

/** The production spawn adapter shape, over a REAL child, with observation. */
function realStubSpawner(records: RealChildRecord[]): WorkerProcessSpawner {
  return (request) => {
    const child = spawnChildProcess(request.command, [...request.args], {
      cwd: request.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    liveRealChildren.push(child);
    const output: string[] = [];
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => output.push(chunk));
    child.stderr?.on("data", (chunk: string) => output.push(`STDERR ${chunk}`));
    const record: RealChildRecord = {
      member: request.member,
      command: request.command,
      argv: request.args,
      pid: child.pid,
      child,
      output,
      exited: false,
    };
    records.push(record);
    return Object.freeze({
      pid: child.pid,
      kill: (signal: "SIGTERM" | "SIGKILL"): boolean => child.kill(signal),
      onExit: (listener: (code: number | null, signal: string | null) => void): void => {
        child.on("exit", (code, signal) => {
          record.exited = true;
          listener(code, signal);
        });
      },
      onError: (listener: (error: Error) => void): void => {
        child.on("error", (error) => {
          listener(error);
        });
      },
    });
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitFor(
  predicate: () => boolean,
  what: string,
  diagnostics: () => string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = systemClock.monotonicMs() + timeoutMs;
  while (!predicate()) {
    if (systemClock.monotonicMs() > deadline) {
      throw new Error(`timed out after ${String(timeoutMs)}ms waiting for ${what}\n${diagnostics()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Every worker process-lock record under `<lockRoot>/workers`, by worker id. */
function workerLockRecords(lockRoot: string): Map<string, { releasedAt: string | null }> {
  const directory = join(lockRoot, "workers");
  const records = new Map<string, { releasedAt: string | null }>();
  if (!existsSync(directory)) return records;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".lock.json") || name.startsWith(".")) continue;
    const parsed = WorkerProcessLockFileSchema.parse(
      JSON.parse(readFileSync(join(directory, name), "utf8")),
    );
    records.set(parsed.workerId, { releasedAt: parsed.releasedAt });
  }
  return records;
}

describe("W5 real processes: two children supervised concurrently through the composed kernel door", () => {
  interface RealHarness {
    readonly database: AuthorityDatabase;
    readonly kernel: CommandKernel;
    readonly control: ReturnType<typeof composeWorkerProcessControl>;
    readonly records: RealChildRecord[];
    readonly faults: Error[];
    readonly events: PoolEffectEvent[];
    readonly lockRoot: string;
    readonly dbPath: string;
  }

  function openRealHarness(launchCommandOverride?: string): RealHarness {
    const root = mkdtempSync(join(tmpdir(), "hrauto-w5-real-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker-rebuild");
    const dbPath = join(stateRoot, "state.db");
    const lockRoot = join(stateRoot, "locks");
    mkdirSync(stateRoot, { recursive: true });
    const database = AuthorityDatabase.open(
      { path: dbPath, busyTimeoutMs: 5_000, migrationOwner: "unit-test" },
      systemClock,
    );
    openDatabases.push(database);
    const records: RealChildRecord[] = [];
    const faults: Error[] = [];
    const events: PoolEffectEvent[] = [];
    const control = composeWorkerProcessControl({
      database,
      clock: systemClock,
      scheduler: createTimeoutDeadlineScheduler(systemClock),
      launch: {
        command: launchCommandOverride ?? process.execPath,
        prefixArgs: Object.freeze(["--import", "tsx", STUB_CLI_PATH, dbPath, lockRoot]),
        cwd: REPO_ROOT,
      },
      spawn: realStubSpawner(records),
      birth: { pollMs: 50, timeoutMs: 30_000 },
      onFault: (error) => {
        faults.push(error);
      },
    });
    cleanups.push(() => {
      control.supervisor.close();
    });
    const kernel = kernelOver(database, systemClock, instrumentPool(control.workerRuntime.pool, systemClock, events));
    return { database, kernel, control, records, faults, events, lockRoot, dbPath };
  }

  it(
    "spawns worker 1 and worker 2 as real children, proves both births via durable leases, and stops both — exact identities, no cross-talk",
    async () => {
      const harness = openRealHarness();
      const childOutput = (): string => harness.records.map((record) =>
        `${record.member.workerId}: ${record.output.join("")}`).join("\n");

      const planId = nextCommandId();
      assert.equal((await harness.kernel.executeWorkerPool({
        ...envelope(systemClock, planId),
        type: "plan-worker-count",
        target: { workflowId: PL, expectedVersion: 0 },
        payload: { desiredWorkers: 2 },
      })).state, "applied");

      // Both spawns in flight together through the one composed door.
      const spawn1Id = nextCommandId();
      const spawn2Id = nextCommandId();
      const submitAtMs = systemClock.monotonicMs();
      const spawn1 = harness.kernel.executeWorkerPool({
        ...envelope(systemClock, spawn1Id),
        type: "spawn-worker",
        target: { workflowId: PL, expectedVersion: 1 },
        payload: { workerId: PL_1.workerId },
      });
      const spawn2 = harness.kernel.executeWorkerPool({
        ...envelope(systemClock, spawn2Id),
        type: "spawn-worker",
        target: { workflowId: PL, expectedVersion: 1 },
        payload: { workerId: PL_2.workerId },
      });
      const [result1, result2] = await Promise.all([
        spawn1.then((result) => ({ result, ackMs: systemClock.monotonicMs() - submitAtMs })),
        spawn2.then((result) => ({ result, ackMs: systemClock.monotonicMs() - submitAtMs })),
      ]);
      assert.deepEqual(result1.result, {
        state: "applied",
        commandId: spawn1Id,
        affectedTargets: [{ family: "worker-browser", workerId: PL_1.workerId }],
      });
      assert.deepEqual(result2.result, {
        state: "applied",
        commandId: spawn2Id,
        affectedTargets: [{ family: "worker-browser", workerId: PL_2.workerId }],
      });

      // EXACT pool identities: derivation, argv, lease ownership — both ways.
      assert.equal(PL_1.workerId, "person-lookup-worker-1");
      assert.equal(PL_2.workerId, "person-lookup-worker-2");
      assert.equal(harness.records.length, 2);
      const record1 = required(harness.records.find((record) => record.member.workerId === PL_1.workerId), "child 1");
      const record2 = required(harness.records.find((record) => record.member.workerId === PL_2.workerId), "child 2");
      for (const [record, index] of [[record1, 1], [record2, 2]] as const) {
        assert.equal(record.command, process.execPath);
        assert.deepEqual([...record.argv], [
          "--import", "tsx", STUB_CLI_PATH, harness.dbPath, harness.lockRoot,
          "worker", "person-lookup", "--pool-index", String(index),
        ]);
      }
      const pid1 = required(record1.pid, "child 1 pid");
      const pid2 = required(record2.pid, "child 2 pid");
      assert.notEqual(pid1, pid2);
      // No cross-talk: each durable lease is owned by exactly the child that
      // was launched with that member's argv, under the child's REAL OS pid.
      const lease1 = required(harness.database.authority.workerLeases.get(PL_1.workerId), "lease 1");
      const lease2 = required(harness.database.authority.workerLeases.get(PL_2.workerId), "lease 2");
      assert.equal(lease1.workflow, PL);
      assert.equal(lease1.processId, pid1);
      assert.equal(lease2.workflow, PL);
      assert.equal(lease2.processId, pid2);
      // Both children are supervised CONCURRENTLY: alive at the same instant,
      // both owned as running by the one supervisor.
      assert.equal(pidAlive(pid1) && pidAlive(pid2), true, childOutput());
      assert.equal(harness.control.supervisor.memberEvidence(PL_1)?.state, "running");
      assert.equal(harness.control.supervisor.memberEvidence(PL_2)?.state, "running");

      // The W3b mutex under real time: same-workflow spawn effects are
      // disjoint and FIFO; the handoff gap is the serialization overhead.
      const spawn1Exit = eventOf(harness.events, spawn1Id, "exit");
      const spawn2Enter = eventOf(harness.events, spawn2Id, "enter");
      assert.ok(spawn2Enter.seq > spawn1Exit.seq, "spawn 2 must enter the door only after spawn 1 exits");
      const handoffGapMs = spawn2Enter.atMonotonicMs - spawn1Exit.atMonotonicMs;
      const birth1Ms = spawn1Exit.atMonotonicMs - eventOf(harness.events, spawn1Id, "enter").atMonotonicMs;
      const birth2Ms = eventOf(harness.events, spawn2Id, "exit").atMonotonicMs - spawn2Enter.atMonotonicMs;

      // Concurrent stops: both settle applied; the durable directive instant
      // IS the observed graceful stage instant for each member.
      const stop1Id = nextCommandId();
      const stop2Id = nextCommandId();
      const stopSubmitMs = systemClock.monotonicMs();
      const [stop1Result, stop2Result] = await Promise.all([
        harness.kernel.executeWorkerPool({
          ...envelope(systemClock, stop1Id),
          type: "stop-worker",
          target: { workerId: PL_1.workerId, expectedVersion: lease1.version },
          reason: "w5 stop",
        }),
        harness.kernel.executeWorkerPool({
          ...envelope(systemClock, stop2Id),
          type: "stop-worker",
          target: { workerId: PL_2.workerId, expectedVersion: lease2.version },
          reason: "w5 stop",
        }),
      ]);
      const stopsAckMs = systemClock.monotonicMs() - stopSubmitMs;
      assert.equal(stop1Result.state, "applied");
      assert.equal(stop2Result.state, "applied");
      await waitFor(
        () => harness.control.supervisor.memberEvidence(PL_1)?.state === "exited"
          && harness.control.supervisor.memberEvidence(PL_2)?.state === "exited",
        "both real children to observe their durable stop directives and exit",
        childOutput,
      );
      const exitObservedMs = systemClock.monotonicMs() - stopSubmitMs;
      for (const member of [PL_1, PL_2]) {
        const evidence = harness.control.supervisor.memberEvidence(member);
        assert.equal(evidence?.state, "exited");
        if (evidence?.state !== "exited") throw new Error("unreachable");
        assert.equal(evidence.outcome, "stopped");
        assert.equal(evidence.reportedBy, "os");
        assert.equal(evidence.exitCode, 0);
        const graceful = required(evidence.observedStop[0], `${member.workerId} graceful stage`);
        const lease = required(harness.database.authority.workerLeases.get(member.workerId), "stopped lease");
        assert.deepEqual(lease.control, {
          directive: "stop",
          requestedAt: graceful.at,
          requestedBy: "local-operator",
          reason: "w5 stop",
        });
        assert.equal(lease.lifecycle.state, "stopped");
      }
      // The real children released their process locks on the way out, and no
      // process outlives the proof: PID liveness says both are gone.
      await waitFor(() => !pidAlive(pid1) && !pidAlive(pid2), "both child pids to die", childOutput);
      const locks = workerLockRecords(harness.lockRoot);
      assert.notEqual(required(locks.get(PL_1.workerId), "PL-1 worker lock").releasedAt, null);
      assert.notEqual(required(locks.get(PL_2.workerId), "PL-2 worker lock").releasedAt, null);
      assert.deepEqual(harness.control.supervisor.close(), []);
      assert.deepEqual(harness.faults, []);
      for (const commandId of [planId, spawn1Id, spawn2Id, stop1Id, stop2Id]) {
        assertJournaled(harness.database, commandId);
      }

      process.stdout.write(`W5-MEASURED two-child kernel door: ${JSON.stringify({
        spawn1AckMs: Math.round(result1.ackMs),
        spawn2AckMs: Math.round(result2.ackMs),
        birth1EffectMs: Math.round(birth1Ms),
        birth2EffectMs: Math.round(birth2Ms),
        sameWorkflowHandoffGapMs: Math.round(handoffGapMs * 100) / 100,
        concurrentStopsAckMs: Math.round(stopsAckMs),
        stopToObservedExitMs: Math.round(exitObservedMs),
      })}\n`);
    },
    120_000,
  );

  it(
    "a REAL spawn ENOENT rejects typed with no journal row and no fabricated pid",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "hrauto-w5-enoent-"));
      roots.push(root);
      const harness = openRealHarness(join(root, "no-such-node-binary"));
      const spawnId = nextCommandId();
      await assert.rejects(
        () => harness.kernel.executeWorkerPool({
          ...envelope(systemClock, spawnId),
          type: "spawn-worker",
          target: { workflowId: PL, expectedVersion: 0 },
          payload: { workerId: PL_1.workerId },
        }),
        /process errored before proving its lease birth: .*ENOENT.*; the child has no pid to kill/,
      );
      assertUnjournaled(harness.database, spawnId);
      assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId), undefined);
      const evidence = harness.control.supervisor.memberEvidence(PL_1);
      assert.equal(evidence?.state, "exited");
      if (evidence?.state !== "exited") throw new Error("unreachable");
      assert.equal(evidence.outcome, "crashed");
      assert.equal(evidence.reportedBy, "supervisor");
    },
    60_000,
  );
});

describe("W5 real runtime: dashboard shutdown releases the locks, reports close() evidence, and leaves no orphans", () => {
  it(
    "two real children over the real ingress; graceful stop, shutdown with one live child, then PID-proved teardown",
    async () => {
      const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-w5-runtime-"));
      roots.push(repoRoot);
      writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "w5-probe", version: "0.1.0" }));
      const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
      const dbPath = join(stateRoot, "state.db");
      const lockRoot = join(repoRoot, rebuildRuntimeIsolation.processLockRoot);
      const serverLockFile = join(lockRoot, "server.lock.json");
      const records: RealChildRecord[] = [];
      const faultLines: string[] = [];
      const childOutput = (): string => records.map((record) =>
        `${record.member.workerId}: ${record.output.join("")}`).join("\n");

      const runtime: DashboardRuntime = await composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        env: {},
        repoRoot,
        workerProcess: {
          launch: {
            command: process.execPath,
            prefixArgs: Object.freeze(["--import", "tsx", STUB_CLI_PATH, dbPath, lockRoot]),
            cwd: REPO_ROOT,
          },
          spawn: realStubSpawner(records),
          birth: { pollMs: 50, timeoutMs: 30_000 },
          faultSink: (line) => {
            faultLines.push(line);
          },
        },
      });
      const stops: (() => Promise<void>)[] = [() => runtime.stop()];
      cleanups.push(async () => {
        for (const stop of stops.splice(0)) await stop();
      });

      const post = async (body: Record<string, unknown>): Promise<{ status: number; state: string }> => {
        const origin = `http://127.0.0.1:${String(runtime.port)}`;
        const response = await fetch(`${origin}/api/v1/commands`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify(body),
        });
        return { status: response.status, state: ((await response.json()) as { state: string }).state };
      };

      // Two REAL children, two workflows, spawned concurrently over the real
      // ingress; each proves its own birth by writing its durable lease.
      const [spawnPl, spawnSep] = await Promise.all([
        post({
          ...envelope(systemClock),
          type: "spawn-worker",
          target: { workflowId: PL, expectedVersion: 0 },
          payload: { workerId: PL_1.workerId },
        }),
        post({
          ...envelope(systemClock),
          type: "spawn-worker",
          target: { workflowId: SEP, expectedVersion: 0 },
          payload: { workerId: SEP_1.workerId },
        }),
      ]);
      assert.deepEqual([spawnPl, spawnSep], [
        { status: 200, state: "applied" },
        { status: 200, state: "applied" },
      ]);
      const plRecord = required(records.find((record) => record.member.workerId === PL_1.workerId), "PL child");
      const sepRecord = required(records.find((record) => record.member.workerId === SEP_1.workerId), "SEP child");
      const plPid = required(plRecord.pid, "PL pid");
      const sepPid = required(sepRecord.pid, "SEP pid");
      assert.equal(pidAlive(plPid) && pidAlive(sepPid), true, childOutput());

      // Graceful stop of PL-1 through the same ingress: the real child
      // observes the durable directive, releases its lock, and dies.
      const sideDoor = AuthorityDatabase.open(
        { path: dbPath, busyTimeoutMs: 5_000, migrationOwner: "unit-test" },
        systemClock,
      );
      let plLeaseVersion: number;
      try {
        plLeaseVersion = required(sideDoor.authority.workerLeases.get(PL_1.workerId), "PL lease").version;
      } finally {
        sideDoor.close();
      }
      assert.deepEqual(
        await post({
          ...envelope(systemClock),
          type: "stop-worker",
          target: { workerId: PL_1.workerId, expectedVersion: plLeaseVersion },
          reason: "w5 runtime stop",
        }),
        { status: 200, state: "applied" },
      );
      await waitFor(() => !pidAlive(plPid), "the stopped child's pid to die", childOutput);
      assert.notEqual(
        required(workerLockRecords(lockRoot).get(PL_1.workerId), "PL-1 worker lock").releasedAt,
        null,
      );

      // Shutdown while SEP-1 is STILL LIVE: the supervisor's close() evidence
      // reaches the structured sink, the server process lock records its
      // release, and the live child is never pretended stopped.
      assert.equal(
        (JSON.parse(readFileSync(serverLockFile, "utf8")) as { releasedAt: string | null }).releasedAt,
        null,
      );
      for (const stop of stops.splice(0)) await stop();
      assert.notEqual(
        (JSON.parse(readFileSync(serverLockFile, "utf8")) as { releasedAt: string | null }).releasedAt,
        null,
      );
      const shutdownLines = faultLines.filter((line) => line.includes("dashboard shutdown leaves a worker child"));
      assert.equal(shutdownLines.length, 1, faultLines.join("\n"));
      const unexpectedLines = faultLines.filter((line) => !shutdownLines.includes(line));
      assert.deepEqual(unexpectedLines, [], `no OTHER supervisor fault may reach the sink: ${faultLines.join("\n")}`);
      const parsed = JSON.parse(required(shutdownLines[0], "the shutdown fault line")) as {
        level: string; source: string; message: string;
      };
      assert.equal(parsed.level, "error");
      assert.equal(parsed.source, "worker-supervisor");
      assert.match(parsed.message, /"state":"running"/);
      assert.match(parsed.message, new RegExp(`"pid":${String(sepPid)}`));
      assert.equal(pidAlive(sepPid), true, "the supervisor must never kill a live child at close");

      // Reap the survivor and prove NO orphan child outlives the proof.
      sepRecord.child.kill("SIGTERM");
      await waitFor(() => !pidAlive(sepPid), "the reaped child's pid to die", childOutput);
      assert.notEqual(
        required(workerLockRecords(lockRoot).get(SEP_1.workerId), "SEP-1 worker lock").releasedAt,
        null,
      );
      assert.deepEqual(
        records.map((record) => ({ workerId: record.member.workerId, alive: pidAlive(required(record.pid, "pid")) })),
        [
          { workerId: PL_1.workerId, alive: false },
          { workerId: SEP_1.workerId, alive: false },
        ],
      );
    },
    120_000,
  );
});
