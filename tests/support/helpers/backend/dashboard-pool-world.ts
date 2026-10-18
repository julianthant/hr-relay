import { vi } from "vitest";
import type { AuthorityDatabase as PoolAuthorityDatabase } from "../admission-fixture.js";
import { type CommandKernelDependencies } from "../../../../src/backend/runs/commands/command-kernel.js";
import { type Clock } from "../../../../src/rules/time/clock.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { bindWorkerProcessAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { seedSyntheticRuntimeConfig } from "../../fixtures/operator-command-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeWorkerProcessControl } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createCommandKernel, type CommandKernel, type WorkerPoolRuntimeSeam } from "../../../../src/backend/runs/commands/command-kernel.js";
import { type SpawnedWorkerHandle, type WorkerProcessSpawnRequest } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { derivePersistedSettingsFingerprint } from "../../../../src/models/config/settings.js";
import { workerPoolMember, type WorkerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { ManualScheduler } from "../phase1f-executor-harness.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { createDashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import { createRunWorkerCapacity } from "../../../../src/backend/runs/commands/run-worker-capacity.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";

export interface ControlHarness {
  readonly root: string;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly scheduler: ManualScheduler;
  readonly kernel: CommandKernel;
  readonly control: ReturnType<typeof composeWorkerProcessControl>;
  readonly children: FakeWorkerChild[];
  readonly spawnRequests: WorkerProcessSpawnRequest[];
  readonly faults: Error[];
  readonly auditFault: { enabled: boolean };
}

interface ControlHarnessOptions {

  readonly interceptPool?: (
    pool: WorkerPoolRuntimeSeam,
    edges: Readonly<{ database: AuthorityDatabase; clock: TestClock }>,
  ) => WorkerPoolRuntimeSeam;
}

export class FakeWorkerChild implements SpawnedWorkerHandle {
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

export function createDashboardPoolTestWorld() {
  function servedControlBasis(database: AuthorityDatabase, workerId: string) {
    const lease = database.authority.workerLeases.get(workerId);
    assert.ok(lease?.controlRevision, "the fixture must serve a real control basis");
    return { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision };
  }

  const NOW = "2026-08-26T09:00:00.000Z";

  const WORKFLOW = WorkflowIdSchema.parse("person-lookup");

  const BROWSER_SYSTEMS = ["crm", "ucpath"] as const;

  const POOL_INDEX_1 = PositiveIntSchema.parse(1);

  const WORKER_1 = WorkerIdSchema.parse("person-lookup-worker-1");

  const MEMBER_1 = { workflowId: WORKFLOW, poolIndex: POOL_INDEX_1, ordinal: POOL_INDEX_1, membershipRevision: PositiveIntSchema.parse(1), workerId: WORKER_1 } as const;

  const WORKER_2 = WorkerIdSchema.parse("person-lookup-worker-2");

  const roots: string[] = [];

  const openDatabases: AuthorityDatabase[] = [];

  const cleanups: (() => Promise<void> | void)[] = [];

  function openControlHarness(options?: ControlHarnessOptions): ControlHarness {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-worker-pool-"));
    roots.push(root);
    const clock = manualClock(new Date(NOW));
    const database = AuthorityDatabase.open(
      { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
      clock,
    );
    seedSyntheticRuntimeConfig(database);
    openDatabases.push(database);
    const nativeDeath = database.assertRetainedWorkerDeath.bind(database);
    const death = vi.spyOn(database, "assertRetainedWorkerDeath").mockImplementation((member, lifetime, birth) => {
      const lease = database.authority.workerLeases.get(member.workerId);
      if (lease?.birthCommandId !== undefined) return nativeDeath(member, lifetime, birth);
      assert.equal(lease?.lifecycle.state, "stopped");
      assert.equal(lease?.leaseGeneration, lifetime.leaseGeneration);
      assert.equal(lease?.processId, lifetime.processId);
      assert.equal(lease?.lifecycle.startedAt, lifetime.startedAt);
      database.assertWorkerLifecycleRelease(member.workerId);
      assert.ok(database.authority.workerControls.browsers(member.workerId).every(browser => browser.health === "closed"));
    });
    cleanups.push(() => death.mockRestore());
    const scheduler = new ManualScheduler(clock, 0);
    const children: FakeWorkerChild[] = [];
    const spawnRequests: WorkerProcessSpawnRequest[] = [];
    const faults: Error[] = [];
    let nextPid = 6000;
    const control = composeWorkerProcessControl({
      profileRoot: join(root, "browsers"), processLockRoot: join(root, "locks"),
      database,
      clock,
      scheduler,
      launch: {
        environment: {},
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
    // Advance the wall clock inside effects to catch timestamps recomputed after dispatch.
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
    const auditFault = { enabled: false };
    const kernel = createCommandKernel({
      lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
      appVersion: "0.1.0",
      configIdentity: (() => { const active = database.authority.runtimeConfig.get(); assert.ok(active); return {configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId}; })(),
      intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(repositories => work({ ...repositories,
        commandAudits: { ...repositories.commandAudits, insert: input => {
          if (auditFault.enabled) throw new Error("injected-command-audit-failure");
          return repositories.commandAudits.insert(input);
        } },
      })) },
      clock,
      ids: sequentialIdFactory("b"),
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
      settings: {
        validateRequest: () => undefined,
        commitPrivate: () => undefined,
        reconcileReplay: () => {
          throw new Error("worker-pool fixture has no persisted settings replay authority");
        },
        applyOrdinary: (command) => ({
          state: "applied",
          revision: command.target.expectedRevision + 1,
          settingsFingerprint: derivePersistedSettingsFingerprint({}),
          settings: {},
        }),
      },
    });
    return { root, database, clock, scheduler, kernel, control, children, spawnRequests, faults, auditFault };
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

  const settleMicrotasks = async (): Promise<void> => {
    // Two macrotask turns: the birth promise's first poll and the scheduler's
    // queueMicrotask auto-fire both run before assertions look at the world.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  function fireBirthPoll(harness: ControlHarness): void {
    for (const entry of harness.scheduler.pending()) entry.fire();
  }

  async function admitPoolSlot(harness: ControlHarness, poolIndex = 1) {
    const version = harness.database.authority.workerPools.get(WORKFLOW)?.version ?? 0;
    const active = harness.database.authority.workerSlots.list(WORKFLOW).filter(slot => slot.retiredAt === null);
    if (!active.some(slot => slot.poolIndex === poolIndex)) {
      const planned = await harness.kernel.executeWorkerPool({ ...envelope(harness), type: "plan-worker-count",
        target: { workflowId: WORKFLOW, expectedVersion: version },
        payload: { desiredWorkers: Math.max(active.length, poolIndex) } });
      assert.equal(planned.state, "applied");
    }
    const slot = harness.database.authority.workerSlots.list(WORKFLOW).find(slot => slot.poolIndex === poolIndex && slot.retiredAt === null);
    assert.ok(slot);
    return workerPoolMember(slot);
  }

  async function spawnPoolWorker(
    harness: ControlHarness,
    member: WorkerPoolMember = MEMBER_1,
  ): Promise<{ commandId: string; result: unknown }> {
    member = await admitPoolSlot(harness, member.poolIndex);
    const commandId = nextCommandId();
    const pending = harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: member.workflowId, expectedVersion: harness.database.authority.workerPools.get(member.workflowId)?.version },
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

  function admitExternalSlot(harness: ControlHarness, poolIndex = 1) {
    const held = bindWorkerProcessAdmission({ processLockRoot: join(harness.root, "locks"),
      authorityPath: join(harness.root, "state.db"), pid: process.pid, clock: harness.clock,
      open: () => harness.database, close: () => {},
      admit: (database, acquisitionId) => database.withAuthorityTransaction(repositories => admitDirectWorker(repositories,
        { commandId: nextCommandId(), workflow: WORKFLOW, poolIndex,
          expectedPoolVersion: repositories.workerPools.get(WORKFLOW)?.version ?? 0,
          processId: process.pid, processAcquisitionId: acquisitionId, authorityPath: join(harness.root, "state.db"),
          processLockRoot: join(harness.root, "locks"), now: harness.clock.now().toISOString() }, nextCommandId()).workerId),
    });
    cleanups.push(() => held.processLock.release());
    return held.workerId;
  }

  function dashboardLaunch(harness: ControlHarness, eid = "10873698", options: { items?: number } = {}) {
    if (harness.database.authority.runtimeConfig.get() === undefined) seedSyntheticRuntimeConfig(harness.database);
    const active = harness.database.authority.runtimeConfig.get(); assert.ok(active);
    const planner = createStartPlanService({ authority: harness.database, authorityRead: harness.database,
      descriptors: { resolve: workflowId => DESCRIPTORS.find(descriptor => descriptor.id === workflowId) }, clock: harness.clock,
      ids: { uuid: nextCommandId }, planTtlMs: 600_000, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
    const plan = planner.plan({ workflowId: WORKFLOW, submissions: Array.from({ length: options.items ?? 1 }, (_, index) => ({ emplId: String(Number(eid) + index) })), dryRun: false });
    assert.deepEqual(plan.refused, []);
    assert.equal(plan.planned.length, options.items ?? 1);
    const request = { commandId: nextCommandId(), requestedAt: harness.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
      family: "start", type: "start-run", target: { workflowId: WORKFLOW, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
    return { plan, request };
  }

  function launchCommands(harness: ControlHarness) {
    return createDashboardCommandService({ kernel: harness.kernel, projection: { ingestFromTimeline: () => {}, refreshRun: () => {} },
      startWorkerCapacity: createRunWorkerCapacity({ kernel: harness.kernel, authority: harness.database.authority,
        reconcileWorker: workerId => {
          const lease = harness.database.authority.workerLeases.get(workerId);
          return lease !== undefined && lease.lifecycle.state !== "stopped";
        } }) });
  }

  async function proveLaunchBirth(harness: ControlHarness) {
    await settleMicrotasks();
    const child = harness.children.at(-1);
    const member = harness.spawnRequests.at(-1)?.member;
    assert.ok(child?.pid !== undefined && member !== undefined);
    assert.equal(harness.database.authority.workerLeases.start({ workerId: member.workerId, workflow: WORKFLOW,
      browserSystems: BROWSER_SYSTEMS, processId: child.pid, requestedBy: "local-operator", now: harness.clock.now().toISOString() }).state, "started");
    fireBirthPoll(harness);
  }

  function occupyMember(harness: ControlHarness, index: number, directive: "run" | "pause" | "stop") {
    const workerId = admitExternalSlot(harness, index);
    harness.database.authority.workerLeases.start({ workerId, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: process.pid, requestedBy: "local-operator", now: NOW });
    if (directive !== "run") harness.database.authority.workerLeases.control({ workerId, expectedVersion: 1,
      control: { directive, requestedAt: NOW, requestedBy: "local-operator" }, now: NOW });
    return workerId;
  }
  const cleanup = async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const database of openDatabases.splice(0)) database.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  };
  return { servedControlBasis, NOW, WORKFLOW, BROWSER_SYSTEMS, WORKER_1, MEMBER_1, WORKER_2, roots, openDatabases, cleanups, openControlHarness, nextCommandId, envelope, spawnPoolWorker, admitExternalSlot, admitPoolSlot, dashboardLaunch, launchCommands, proveLaunchBirth, occupyMember, settleMicrotasks, fireBirthPoll, cleanup };
}

export interface PoolEffectEvent {
  readonly commandId: string;
  readonly type: string;
  readonly phase: "enter" | "exit";
  readonly seq: number;
  readonly atMonotonicMs: number;
}

export function instrumentPool(
  pool: WorkerPoolRuntimeSeam,
  clock: Clock,
  events: PoolEffectEvent[],
): WorkerPoolRuntimeSeam {
  let seq = 0;
  const record = (commandId: string, type: string, phase: "enter" | "exit"): void => {
    seq += 1;
    events.push({ commandId, type, phase, seq, atMonotonicMs: clock.monotonicMs() });
  };
  const wrap = <Method extends Exclude<keyof WorkerPoolRuntimeSeam, "assertResetOwner" | "assertLifecycleOwner" | "beginLifecycle">>(method: Method): WorkerPoolRuntimeSeam[Method] =>
    async (context: Parameters<WorkerPoolRuntimeSeam[Method]>[0]) => {
      record(context.command.commandId, context.command.type, "enter");
      try {
        return await pool[method](context);
      } finally {
        record(context.command.commandId, context.command.type, "exit");
      }
    };
  return {
    assertResetOwner: pool.assertResetOwner?.bind(pool),
    assertLifecycleOwner: pool.assertLifecycleOwner?.bind(pool),
    beginLifecycle: pool.beginLifecycle?.bind(pool),
    planPoolWorkerCount: wrap("planPoolWorkerCount"),
    spawnPoolWorker: wrap("spawnPoolWorker"),
    stopPoolWorker: wrap("stopPoolWorker"),
    pausePoolWorker: wrap("pausePoolWorker"),
    resumePoolWorker: wrap("resumePoolWorker"),
    refreshPoolBrowser: wrap("refreshPoolBrowser"),
    reopenPoolBrowser: wrap("reopenPoolBrowser"),
  };
}

export function kernelOver(
  database: PoolAuthorityDatabase,
  clock: Clock,
  pool: WorkerPoolRuntimeSeam,
): CommandKernel {
  const dependencies: CommandKernelDependencies = {
    lifecycle: new RunRecordService({ database, clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: (() => { const active = database.authority.runtimeConfig.get(); assert.ok(active); return {configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId}; })(),
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
