/**
 * W3 (ref execution-and-sessions §11, D271): the dashboard's REAL worker
 * process control, composed exactly as production composes it —
 * `composeWorkerProcessControl` over a real temp-file `AuthorityDatabase`,
 * wrapped by the real pool executor and adopted by the real command kernel's
 * async `executeWorkerPool` door. Only the process edges are fakes (the
 * spawner, the scheduler, the clock), so a pass here pins production wiring:
 *
 * - a spawn acknowledges ONLY after the child's own durable lease proves its
 *   pid (no journal row, no audit, no reply before process evidence);
 * - the graceful-stop channel writes the durable lease directive at EXACTLY
 *   the kernel command's `now` (the W1/W2 requestedAt==command-now pin);
 * - an externally started worker refuses end-to-end: no adoption, no
 *   directive written, no journal row;
 * - dashboard shutdown closes the supervisor after ingress and before the
 *   process lock releases, and still-live children reach the fault path.
 */
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import {
  createCommandKernel,
  type CommandKernel,
  type WorkerPoolRuntimeSeam,
} from "../../../src/core/command-kernel.js";
import { poolWorkerId } from "../../../src/core/worker-loop.js";
import { manualClock, type TestClock } from "../../../src/domain/clock.js";
import {
  SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../../src/domain/config/settings.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../../src/domain/ids.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import {
  composeDashboardRuntime,
  composeWorkerProcessControl,
  type DashboardRuntime,
} from "../../../src/server/dashboard/compose.js";
import type {
  SpawnedWorkerHandle,
  WorkerProcessSpawnRequest,
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
const WORKFLOW = WorkflowIdSchema.parse("person-lookup");
const BROWSER_SYSTEMS = ["crm", "ucpath"] as const;
const POOL_INDEX_1 = PositiveIntSchema.parse(1);
const WORKER_1 = poolWorkerId(WORKFLOW, POOL_INDEX_1);
const MEMBER_1 = { workflowId: WORKFLOW, poolIndex: POOL_INDEX_1, workerId: WORKER_1 } as const;
const POOL_INDEX_2 = PositiveIntSchema.parse(2);
const WORKER_2 = poolWorkerId(WORKFLOW, POOL_INDEX_2);
const MEMBER_2 = { workflowId: WORKFLOW, poolIndex: POOL_INDEX_2, workerId: WORKER_2 } as const;

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/* ── fakes at the process boundary (the W2 pattern) ──────────────────────── */

class FakeWorkerChild implements SpawnedWorkerHandle {
  readonly pid: number | undefined;
  readonly signalsSent: string[] = [];
  #exitListeners: ((code: number | null, signal: string | null) => void)[] = [];

  constructor(pid: number | undefined) {
    this.pid = pid;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.signalsSent.push(signal);
    return true;
  }

  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.#exitListeners.push(listener);
  }

  onError(): void {
    // No fake process errors in this suite.
  }

  emitExit(code: number | null, signal: string | null): void {
    for (const listener of this.#exitListeners) listener(code, signal);
  }
}

interface ControlHarness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly scheduler: ManualScheduler;
  readonly kernel: CommandKernel;
  readonly control: ReturnType<typeof composeWorkerProcessControl>;
  readonly children: FakeWorkerChild[];
  readonly spawnRequests: WorkerProcessSpawnRequest[];
  readonly faults: Error[];
}

interface ControlHarnessOptions {
  /**
   * Wraps the pool seam the kernel adopts — the hook a test uses to run an
   * out-of-band authority write between the kernel's phases, exactly the way
   * another process would land one.
   */
  readonly interceptPool?: (
    pool: WorkerPoolRuntimeSeam,
    edges: Readonly<{ database: AuthorityDatabase; clock: TestClock }>,
  ) => WorkerPoolRuntimeSeam;
}

function openControlHarness(options?: ControlHarnessOptions): ControlHarness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-worker-pool-"));
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
  let nextPid = 6000;
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
      const child = new FakeWorkerChild(nextPid += 1);
      children.push(child);
      return child;
    },
    birth: { pollMs: 250, timeoutMs: 10_000 },
    onFault: (error) => {
      faults.push(error);
    },
  });
  /**
   * The alias-breaker: the manual wall clock ADVANCES before every
   * directive-writing pool effect runs, so a channel (or a phase-C write)
   * that stamps its own clock read instead of the command's own `now`
   * produces a postdated instant the seam's guards must trip on. Without
   * this, every requestedAt==command-now pin holds vacuously, because every
   * clock read in the flow aliases to the same frozen instant.
   */
  const aliasBrokenPool: WorkerPoolRuntimeSeam = {
    ...control.workerRuntime.pool,
    stopPoolWorker: async (context) => {
      clock.advanceWall(7);
      return control.workerRuntime.pool.stopPoolWorker(context);
    },
    pausePoolWorker: async (context) => {
      clock.advanceWall(7);
      return control.workerRuntime.pool.pausePoolWorker(context);
    },
    resumePoolWorker: async (context) => {
      clock.advanceWall(7);
      return control.workerRuntime.pool.resumePoolWorker(context);
    },
  };
  const pool = options?.interceptPool === undefined
    ? aliasBrokenPool
    : options.interceptPool(aliasBrokenPool, { database, clock });
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
    // EXACTLY what src/server/dashboard/compose.ts adopts: the pool executor
    // over the composed supervisor, behind the explicit adoption wrapper —
    // plus the test-only alias-breaking clock advance around the seam.
    workerRuntime: { pool },
    settings: {
      reconcileReplay: () => {
        throw new Error("worker-pool fixture has no persisted settings replay authority");
      },
      apply: (command) => ({
        state: "applied",
        revision: command.target.expectedRevision + 1,
        settingsFingerprint: "a".repeat(64),
        rollback: () => undefined,
        commit: () => undefined,
      }),
    },
  });
  return { database, clock, scheduler, kernel, control, children, spawnRequests, faults };
}

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `dddddddd-${tail}-4000-8000-${tail}00000000`;
}

function envelope(harness: ControlHarness, commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: harness.clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "worker-browser",
  } as const;
}

function applySettingsRequiringRestart(harness: ControlHarness): void {
  const patch = { browser: { headless: false } } as const;
  harness.kernel.execute({
    commandId: nextCommandId(),
    requestedAt: harness.clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: {
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    },
  });
}

const settleMicrotasks = async (): Promise<void> => {
  // Two macrotask turns: the birth promise's first poll and the scheduler's
  // queueMicrotask auto-fire both run before assertions look at the world.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Fire every due-or-pending scheduler entry once (the birth re-probe tick). */
function fireBirthPoll(harness: ControlHarness): void {
  for (const entry of harness.scheduler.pending()) entry.fire();
}

/**
 * The composed spawn happy path: submit through the kernel's pool door, let
 * the child "boot", prove its birth by writing the SAME durable lease the real
 * worker CLI writes, and tick the poll.
 */
async function spawnPoolWorker(
  harness: ControlHarness,
  member: typeof MEMBER_1 = MEMBER_1,
): Promise<{ commandId: string; result: unknown }> {
  const commandId = nextCommandId();
  const pending = harness.kernel.executeWorkerPool({
    ...envelope(harness, commandId),
    type: "spawn-worker",
    target: { workflowId: member.workflowId, expectedVersion: 0 },
    payload: { workerId: member.workerId },
  });
  await settleMicrotasks();
  const child = harness.children.at(-1);
  if (child?.pid === undefined) throw new Error("the fake spawner produced no child");
  assert.equal(harness.database.authority.workerLeases.start({
    workerId: member.workerId,
    workflow: member.workflowId,
    browserSystems: BROWSER_SYSTEMS,
    processId: child.pid,
    requestedBy: "local-operator",
    now: harness.clock.now().toISOString(),
  }).state, "started");
  fireBirthPoll(harness);
  return { commandId, result: await pending };
}

/* ── the composed seam, end to end ───────────────────────────────────────── */

describe("the composed worker process control through the kernel pool door", () => {
  it("refuses async pool starts after settings make this runtime stale", async () => {
    const harness = openControlHarness();
    applySettingsRequiringRestart(harness);

    await assert.rejects(
      () => harness.kernel.executeWorkerPool({
        ...envelope(harness),
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW, expectedVersion: 0 },
        payload: { desiredWorkers: 1 },
      }),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW), undefined);
    assert.equal(harness.spawnRequests.length, 0);
  });

  it("refuses an async pool start when settings apply during its process effect", async () => {
    let applyDuringEffect = (): void => {
      throw new Error("settings crossing hook was not initialized");
    };
    const harness = openControlHarness({
      interceptPool: (pool) => ({
        ...pool,
        planPoolWorkerCount: async (context) => {
          const acknowledgement = await pool.planPoolWorkerCount(context);
          applyDuringEffect();
          return acknowledgement;
        },
      }),
    });
    applyDuringEffect = () => applySettingsRequiringRestart(harness);
    const commandId = nextCommandId();

    await assert.rejects(
      () => harness.kernel.executeWorkerPool({
        ...envelope(harness, commandId),
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW, expectedVersion: 0 },
        payload: { desiredWorkers: 1 },
      }),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW), undefined);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
  });

  it("spawns the exact worker CLI argv and acknowledges only after the durable lease proves birth", async () => {
    const harness = openControlHarness();
    const commandId = nextCommandId();
    const pending = harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { workerId: WORKER_1 },
    });
    await settleMicrotasks();

    // The process was launched with the exact argv — but with NO birth
    // evidence yet, nothing is journaled and nothing has been acknowledged.
    assert.equal(harness.spawnRequests.length, 1);
    assert.deepEqual([...harness.spawnRequests[0]?.args ?? []], [
      "--import", "tsx", "src/cli.ts",
      "worker", "person-lookup", "--pool-index", "1",
    ]);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);

    // Birth: the child's own durable lease, under the child's real pid.
    const child = harness.children[0];
    if (child?.pid === undefined) throw new Error("the fake spawner produced no child");
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: child.pid, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    fireBirthPoll(harness);

    const result = await pending;
    assert.deepEqual(result, {
      state: "applied",
      commandId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });
    // The settled reply is journaled and audited in the same transaction.
    assert.notEqual(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.result.state, "applied");
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_1)?.state, "running");
  });

  it("rejects a spawn whose child never proves birth: SIGKILL, no journal row, no acknowledgement", async () => {
    const harness = openControlHarness();
    const commandId = nextCommandId();
    const pending = harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { workerId: WORKER_1 },
    });
    await settleMicrotasks();
    harness.clock.advanceMonotonic(10_000);
    fireBirthPoll(harness);

    await assert.rejects(() => pending, /proved no lease birth within 10000ms; the unproved child was killed/);
    assert.deepEqual(harness.children[0]?.signalsSent, ["SIGKILL"]);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("refuses an externally started worker end-to-end: no adoption, no directive, no journal row", async () => {
    const harness = openControlHarness();
    // An operator started this worker by hand: the lease is live under a pid
    // this supervisor never spawned.
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: 999, requestedBy: "local-operator", now: NOW,
    }).state, "started");

    const spawnId = nextCommandId();
    // The kernel's own authority validation refuses BEFORE the supervisor is
    // consulted — a typed rejection, and no process was launched.
    const rejected = await harness.kernel.executeWorkerPool({
      ...envelope(harness, spawnId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { workerId: WORKER_1 },
    });
    assert.equal(rejected.state, "rejected");
    if (rejected.state !== "rejected") throw new Error("unreachable");
    assert.match(rejected.message, /already holds a live lease in state starting/);
    assert.equal(harness.spawnRequests.length, 0);
    assert.equal(harness.database.authority.commands.get(spawnId), undefined);

    const stopId = nextCommandId();
    await assert.rejects(
      () => harness.kernel.executeWorkerPool({
        ...envelope(harness, stopId),
        type: "stop-worker",
        target: { workerId: WORKER_1, expectedVersion: 1 },
      }),
      /never spawned person-lookup-worker-1; an externally started worker is never adopted or controlled/,
    );
    // The refusal wrote NOTHING durable: the external worker keeps running
    // and its lease still carries the run directive.
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.control.directive, "run");
    assert.equal(harness.database.authority.commands.get(stopId), undefined);
  });

  it("writes the durable stop directive at exactly the command's now (the requestedAt==command-now pin)", async () => {
    const harness = openControlHarness();
    await spawnPoolWorker(harness);
    harness.clock.advanceWall(5_000);
    const stopAt = harness.clock.now().toISOString();

    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 1 },
      reason: "shift over",
    });
    assert.deepEqual(result, {
      state: "applied",
      commandId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });

    // The durable directive IS the command: its instant is the command's own
    // `now` (never the channel's clock), its actor and reason the command's.
    assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1)?.control, {
      directive: "stop",
      requestedAt: stopAt,
      requestedBy: "local-operator",
      reason: "shift over",
    });
    // And the supervisor's observed graceful stage carries the SAME instant —
    // the kernel's requireObservedNotAfterNow bound holds by construction.
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_1), {
      state: "stopping",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      observedStop: [{ stage: "graceful-stop-requested", at: stopAt }],
    });
  });

  it("plans only after validation, and writes the desired count from the command — never from the ack path", async () => {
    const harness = openControlHarness();
    // A stale CAS basis refuses BEFORE the supervisor is consulted: no pool
    // row, no journal row, no process effect.
    const staleId = nextCommandId();
    const conflicted = await harness.kernel.executeWorkerPool({
      ...envelope(harness, staleId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 3 },
      payload: { desiredWorkers: 1 },
    });
    assert.equal(conflicted.state, "conflict");
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW), undefined);
    assert.equal(harness.database.authority.commands.get(staleId), undefined);
    assert.equal(harness.spawnRequests.length, 0);

    const planId = nextCommandId();
    const planned = await harness.kernel.executeWorkerPool({
      ...envelope(harness, planId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    });
    assert.deepEqual(planned, {
      state: "applied",
      commandId: planId,
      affectedTargets: [
        { family: "worker-pool", workflowId: WORKFLOW },
        { family: "worker-browser", workerId: WORKER_1 },
      ],
    });
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.version, 1);
  });

  it("serializes concurrent pool plans: the loser refuses before any directive or escalation effect lands", async () => {
    const harness = openControlHarness();
    await spawnPoolWorker(harness, MEMBER_1);
    await spawnPoolWorker(harness, MEMBER_2);

    // Two plans against the SAME basis (pool version 0), in flight together.
    // The first keeps both running workers; the second would stop worker 2 as
    // excess. Without per-workflow serialization across phases A→C, both pass
    // the phase-A CAS, both run process effects, and the loser's durable stop
    // directive plus armed escalation stand against a member the winning plan
    // still desires — while its phase C rolls back without a journal trace.
    const keepBothId = nextCommandId();
    const keepBoth = harness.kernel.executeWorkerPool({
      ...envelope(harness, keepBothId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { desiredWorkers: 2 },
    });
    const shrinkId = nextCommandId();
    const shrink = harness.kernel.executeWorkerPool({
      ...envelope(harness, shrinkId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    });
    const [first, second] = await Promise.allSettled([keepBoth, shrink]);

    assert.equal(first.status, "fulfilled");
    if (first.status !== "fulfilled") throw new Error("unreachable");
    assert.equal(first.value.state, "applied");
    // The loser refuses TYPED, before its effect: never a thrown 500, never a
    // stop directive it initiated and then abandoned.
    assert.equal(second.status, "fulfilled");
    if (second.status !== "fulfilled") throw new Error("unreachable");
    assert.equal(second.value.state, "conflict");
    if (second.value.state !== "conflict") throw new Error("unreachable");
    assert.equal(second.value.currentVersion, 1);
    assert.equal(harness.database.authority.commands.get(shrinkId), undefined);

    // The desired member the loser would have stopped is untouched: run
    // directive intact, supervisor evidence plain running, nothing armed.
    assert.equal(harness.database.authority.workerLeases.get(WORKER_2)?.control.directive, "run");
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_2)?.state, "running");
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 2);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.version, 1);
  });

  it("maps a phase-C pool CAS loss to a typed conflict naming the already-executed effect", async () => {
    const harness = openControlHarness({
      interceptPool: (pool, edges) => ({
        ...pool,
        planPoolWorkerCount: async (context) => {
          // Another PROCESS plans the pool after this command's phase-A CAS
          // passed and before its phase-C write — outside what the in-process
          // serialization can see, so phase C is where it must surface, typed.
          assert.equal(edges.database.authority.workerPools.plan({
            workflow: WORKFLOW,
            expectedVersion: 0,
            desiredWorkers: 1,
            requestedBy: "local-operator",
            now: edges.clock.now().toISOString(),
          }).state, "applied");
          return pool.planPoolWorkerCount(context);
        },
      }),
    });
    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    });
    assert.equal(result.state, "conflict");
    if (result.state !== "conflict") throw new Error("unreachable");
    assert.equal(result.currentVersion, 1);
    // The refusal tells the operator the truth: the process effect ran.
    assert.match(result.message, /ALREADY executed/);
    // A conflict is never journaled or audited.
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("journals a settled-but-unjournaled stop from the lease's own directive evidence on re-delivery", async () => {
    const harness = openControlHarness();
    // The B→C crash window, reproduced at its durable footprint: the crashed
    // delivery's effect stands (the lease carries the command's own stop
    // directive), no journal row was written, and the restarted supervisor
    // never spawned the child.
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: 4242, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    const crashedNow = harness.clock.now().toISOString();
    assert.equal(harness.database.authority.workerLeases.control({
      workerId: WORKER_1,
      expectedVersion: 1,
      control: { directive: "stop", requestedAt: crashedNow, requestedBy: "local-operator", reason: "shift over" },
      now: crashedNow,
    }).state, "applied");

    harness.clock.advanceWall(30_000);
    const commandId = nextCommandId();
    const command = {
      ...envelope(harness, commandId),
      type: "stop-worker" as const,
      target: { workerId: WORKER_1, expectedVersion: 2 },
      reason: "shift over",
    };
    const result = await harness.kernel.executeWorkerPool(command);
    assert.deepEqual(result, {
      state: "applied",
      commandId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });
    // Journaled and audited WITHOUT re-running the process effect; this
    // delivery wrote nothing, so its audit claims no version change.
    assert.notEqual(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.result.state, "applied");
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(commandId)?.versionChanges, []);
    assert.equal(harness.spawnRequests.length, 0);
    assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1)?.control, {
      directive: "stop", requestedAt: crashedNow, requestedBy: "local-operator", reason: "shift over",
    });
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.version, 2);

    // A second delivery of the SAME command replays from the journal.
    const replayed = await harness.kernel.executeWorkerPool(command);
    assert.equal(replayed.state, "already-applied");

    // Evidence matching is EXACT: a stop with a different reason is a new
    // request, not a replay — it refuses TYPED, naming the drifted reason,
    // never by falling through to an unrelated supervisor refusal.
    const driftedId = nextCommandId();
    const drifted = await harness.kernel.executeWorkerPool({
      ...envelope(harness, driftedId),
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 2 },
      reason: "different reason",
    });
    assert.equal(drifted.state, "rejected");
    if (drifted.state !== "rejected") throw new Error("unreachable");
    assert.equal(drifted.code, "invalid-state");
    assert.match(drifted.message, /"different reason"/);
    assert.equal(harness.database.authority.commands.get(driftedId), undefined);
  });

  it("refuses a new same-identity stop against a dead lease's stale directive: invalid-state, never applied", async () => {
    const harness = openControlHarness();
    // A COMPLETED stop, all the way through the worker's own death: the lease
    // carries the stop directive that stopped it and the lifecycle is stopped.
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: 4242, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    const stoppedNow = harness.clock.now().toISOString();
    assert.equal(harness.database.authority.workerLeases.control({
      workerId: WORKER_1,
      expectedVersion: 1,
      control: { directive: "stop", requestedAt: stoppedNow, requestedBy: "local-operator", reason: "shift over" },
      now: stoppedNow,
    }).state, "applied");
    assert.equal(harness.database.authority.workerLeases.reportLifecycle({
      workerId: WORKER_1,
      leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: stoppedNow, reason: "operator" },
      now: stoppedNow,
    }).state, "applied");

    // A NEW stop naming the same actor and reason is NOT a re-delivery of
    // anything: the dead lease's directive is stale evidence, and converging
    // on it would journal "applied" for a command that stopped nothing. The
    // honest answer is the sync path's own typed stopped-worker refusal.
    harness.clock.advanceWall(30_000);
    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 3 },
      reason: "shift over",
    });
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") throw new Error("unreachable");
    assert.equal(result.code, "invalid-state");
    assert.match(result.message, /stopped worker starts a new lease generation/);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("names the drifted evidence field on a near-miss stop instead of falling through unjournaled", async () => {
    const harness = openControlHarness();
    // The crashed delivery's durable footprint again — the lease is LIVE and
    // carries a stop directive — but each incoming stop below drifts from
    // that evidence in exactly one field. Every drift must refuse TYPED,
    // naming the field, never surface as an unrelated supervisor refusal.
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: 4242, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    const crashedNow = harness.clock.now().toISOString();
    assert.equal(harness.database.authority.workerLeases.control({
      workerId: WORKER_1,
      expectedVersion: 1,
      control: { directive: "stop", requestedAt: crashedNow, requestedBy: "local-operator", reason: "shift over" },
      now: crashedNow,
    }).state, "applied");
    harness.clock.advanceWall(30_000);

    // Actor drift: same reason, a different requesting actor.
    const actorDriftId = nextCommandId();
    const actorDrift = await harness.kernel.executeWorkerPool({
      ...envelope(harness, actorDriftId),
      requestedBy: "another-operator",
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 2 },
      reason: "shift over",
    });
    assert.equal(actorDrift.state, "rejected");
    if (actorDrift.state !== "rejected") throw new Error("unreachable");
    assert.equal(actorDrift.code, "invalid-state");
    assert.match(actorDrift.message, /requested by local-operator, not another-operator/);
    assert.equal(harness.database.authority.commands.get(actorDriftId), undefined);

    // Reason drift: same actor, a different (here: absent) reason.
    const reasonDriftId = nextCommandId();
    const reasonDrift = await harness.kernel.executeWorkerPool({
      ...envelope(harness, reasonDriftId),
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 2 },
    });
    assert.equal(reasonDrift.state, "rejected");
    if (reasonDrift.state !== "rejected") throw new Error("unreachable");
    assert.equal(reasonDrift.code, "invalid-state");
    assert.match(reasonDrift.message, /"shift over", not no reason/);
    assert.equal(harness.database.authority.commands.get(reasonDriftId), undefined);

    // requestedAt after this delivery's now: the directive cannot be this
    // command's own crashed effect, and the postdating must be named.
    const future = new Date(Date.parse(harness.clock.now().toISOString()) + 60_000).toISOString();
    assert.equal(harness.database.authority.workerLeases.control({
      workerId: WORKER_1,
      expectedVersion: 2,
      control: { directive: "stop", requestedAt: future, requestedBy: "local-operator", reason: "shift over" },
      now: harness.clock.now().toISOString(),
    }).state, "applied");
    const postdatedId = nextCommandId();
    const postdated = await harness.kernel.executeWorkerPool({
      ...envelope(harness, postdatedId),
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 3 },
      reason: "shift over",
    });
    assert.equal(postdated.state, "rejected");
    if (postdated.state !== "rejected") throw new Error("unreachable");
    assert.equal(postdated.code, "invalid-state");
    assert.match(postdated.message, /requestedAt .* is after this delivery's now/);
    assert.equal(harness.database.authority.commands.get(postdatedId), undefined);

    // None of the refusals disturbed the durable evidence itself.
    assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1)?.control, {
      directive: "stop", requestedAt: future, requestedBy: "local-operator", reason: "shift over",
    });
  });

  it("audits a stop with the directive write's own lease versions, not later unrelated bumps", async () => {
    const harness = openControlHarness({
      interceptPool: (pool, edges) => ({
        ...pool,
        stopPoolWorker: async (context) => {
          const acknowledgement = await pool.stopPoolWorker(context);
          // An unrelated lease bump (the worker's own lifecycle report)
          // lands AFTER the durable directive write and BEFORE phase C. The
          // audit must record the directive write's versions, not absorb
          // this bump into the command's claimed change.
          const bumpNow = edges.clock.now().toISOString();
          assert.equal(edges.database.authority.workerLeases.reportLifecycle({
            workerId: WORKER_1,
            leaseGeneration: 1,
            lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: bumpNow },
            now: bumpNow,
          }).state, "applied");
          return acknowledgement;
        },
      }),
    });
    await spawnPoolWorker(harness, MEMBER_1);
    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 1 },
    });
    assert.equal(result.state, "applied");
    // Lease: v1 at birth, v2 at the directive write, v3 at the unrelated bump.
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.version, 3);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(commandId)?.versionChanges, [
      { target: { family: "worker-browser", workerId: WORKER_1 }, before: 1, after: 2 },
    ]);
  });

  it("drives the composed pause→resume round-trip: durable directives at the command's now, versioned and audited", async () => {
    const harness = openControlHarness();
    await spawnPoolWorker(harness, MEMBER_1);

    const pauseAt = harness.clock.now().toISOString();
    const pauseId = nextCommandId();
    const paused = await harness.kernel.executeWorkerPool({
      ...envelope(harness, pauseId),
      type: "pause-worker",
      target: { workerId: WORKER_1, expectedVersion: 1 },
      reason: "operator break",
    });
    assert.deepEqual(paused, {
      state: "applied",
      commandId: pauseId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });
    const afterPause = harness.database.authority.workerLeases.get(WORKER_1);
    // The durable directive IS the command — its instant the command's own
    // `now` (the alias-breaker advanced the wall clock inside the effect, so
    // a phase-C write stamping a fresh clock read would postdate this).
    assert.deepEqual(afterPause?.control, {
      directive: "pause", requestedAt: pauseAt, requestedBy: "local-operator", reason: "operator break",
    });
    assert.equal(afterPause?.version, 2);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(pauseId)?.versionChanges, [
      { target: { family: "worker-browser", workerId: WORKER_1 }, before: 1, after: 2 },
    ]);

    harness.clock.advanceWall(60_000);
    const resumeAt = harness.clock.now().toISOString();
    const resumeId = nextCommandId();
    const resumed = await harness.kernel.executeWorkerPool({
      ...envelope(harness, resumeId),
      type: "resume-worker",
      target: { workerId: WORKER_1, expectedVersion: 2 },
    });
    assert.deepEqual(resumed, {
      state: "applied",
      commandId: resumeId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });
    const afterResume = harness.database.authority.workerLeases.get(WORKER_1);
    assert.deepEqual(afterResume?.control, {
      directive: "run", requestedAt: resumeAt, requestedBy: "local-operator",
    });
    assert.equal(afterResume?.version, 3);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(resumeId)?.versionChanges, [
      { target: { family: "worker-browser", workerId: WORKER_1 }, before: 2, after: 3 },
    ]);
    // The supervisor still owns the child as plain running throughout.
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_1)?.state, "running");
  });

  it("replays an already-applied spawn without re-running the process effect", async () => {
    const harness = openControlHarness();
    const { commandId } = await spawnPoolWorker(harness);
    assert.equal(harness.children.length, 1);

    const replayed = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { workerId: WORKER_1 },
    });
    assert.equal(replayed.state, "already-applied");
    // Replay is a READ: the supervisor spawned nothing new.
    assert.equal(harness.children.length, 1);
  });

  it("refuses the synchronous execute path for worker-browser, and other families at the pool door", async () => {
    const harness = openControlHarness();
    assert.throws(
      () => harness.kernel.execute({
        ...envelope(harness),
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW, expectedVersion: 0 },
        payload: { desiredWorkers: 1 },
      }),
      /adopted the async worker pool seam; worker-browser commands settle only through executeWorkerPool/,
    );
    await assert.rejects(
      () => harness.kernel.executeWorkerPool({
        commandId: nextCommandId(),
        requestedAt: NOW,
        requestedBy: "local-operator",
        source: "dashboard",
        family: "run",
        type: "cancel",
        target: { runId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1 },
      }),
      /executeWorkerPool settles only worker-browser commands; received run\/cancel/,
    );
  });
});

/* ── dashboard shutdown ordering (the composed runtime) ──────────────────── */

describe("dashboard shutdown closes the worker supervisor between ingress and the process lock", () => {
  it("reports still-live children to the fault path before the server lock releases", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-shutdown-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));

    const clock = manualClock(new Date(NOW));
    const scheduler = new ManualScheduler(clock, 0);
    const children: FakeWorkerChild[] = [];
    const faultLines: string[] = [];
    const lockFile = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    const lockRecord = (): { releasedAt: string | null } =>
      JSON.parse(readFileSync(lockFile, "utf8")) as { releasedAt: string | null };
    // ORDER pin, observed AT EMISSION TIME: when the supervisor's shutdown
    // fault line is emitted, the process lock must still be held (close()
    // runs before the release) — an after-the-fact read cannot tell the two
    // orders apart.
    const lockStateAtShutdownFault: (string | null)[] = [];
    // Port 0: the OS assigns an ephemeral port, so this test never contends
    // with a concurrently running rebuild dashboard on the machine-wide
    // isolation port — and never silently passes vacuous because of one.
    const runtime: DashboardRuntime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      frontendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
      workerProcess: {
        scheduler,
        spawn: () => {
          const child = new FakeWorkerChild(7001);
          children.push(child);
          return child;
        },
        birth: { pollMs: 250, timeoutMs: 10_000 },
        faultSink: (line) => {
          faultLines.push(line);
          if (line.includes("dashboard shutdown leaves a worker child")) {
            lockStateAtShutdownFault.push(existsSync(lockFile) ? lockRecord().releasedAt : "lock-file-missing");
          }
        },
      },
    });
    const stops: (() => Promise<void>)[] = [() => runtime.stop()];
    cleanups.push(async () => {
      for (const stop of stops.splice(0)) await stop();
    });

    // Spawn one worker over the REAL ingress (the same route the operator's
    // dashboard uses), prove its birth against the same authority store, and
    // let the command settle.
    const commandId = nextCommandId();
    const origin = `http://127.0.0.1:${String(runtime.port)}`;
    const posted = fetch(`${origin}/api/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        commandId,
        requestedAt: clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "dashboard",
        family: "worker-browser",
        type: "spawn-worker",
        target: { workflowId: WORKFLOW, expectedVersion: 0 },
        payload: { workerId: WORKER_1 },
      }),
    });
    // Wait for the composed supervisor to actually launch the child.
    for (let waited = 0; children.length === 0 && waited < 200; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(children.length, 1);
    const sideDoor = AuthorityDatabase.open(
      { path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 5_000, migrationOwner: "unit-test" },
      clock,
    );
    try {
      assert.equal(sideDoor.authority.workerLeases.start({
        workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
        processId: 7001, requestedBy: "local-operator", now: NOW,
      }).state, "started");
    } finally {
      sideDoor.close();
    }
    for (const entry of scheduler.pending()) entry.fire();
    const response = await posted;
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { state: string }).state, "applied");

    // Shutdown: ingress stops, the supervisor closes, THEN the lock releases.
    assert.equal(existsSync(lockFile), true);
    assert.equal(lockRecord().releasedAt, null);
    for (const stop of stops.splice(0)) await stop();

    // The still-live child reached the structured fault path — one JSON line
    // naming its running state — and was NOT pretended stopped.
    const shutdownLines = faultLines.filter((line) => line.includes("dashboard shutdown leaves a worker child"));
    assert.equal(shutdownLines.length, 1);
    const parsed = JSON.parse(shutdownLines[0] ?? "") as { level: string; source: string; message: string };
    assert.equal(parsed.level, "error");
    assert.equal(parsed.source, "worker-supervisor");
    assert.match(parsed.message, /"state":"running"/);
    assert.match(parsed.message, /"pid":7001/);
    // The ORDER, pinned at emission time: the supervisor's close (which emits
    // the fault line) ran while the process lock was still held. Moving
    // close() after the lock release records a releasedAt instant here.
    assert.deepEqual(lockStateAtShutdownFault, [null]);
    // The process lock under .tracker-rebuild/locks records its release only
    // after the supervisor closed (the closed-supervisor refusal itself is
    // pinned in the W2 suite). The file stays as the durable record; the NEXT
    // acquirer archives it.
    assert.notEqual(lockRecord().releasedAt, null);
  });
});
