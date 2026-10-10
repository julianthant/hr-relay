import { bindWorkerProcessAdmission, readRuntimeProcessLock } from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { admitDirectWorker } from "../../../../../../src/backend/storage/sqlite/worker-slots.js";
import { healthyRuntimePreflightRunners } from "../../../../../support/fixtures/preflight-seams.js";
import { deriveBulkChildCommandId } from "../../../../../../src/rules/commands/command-groups.js";
import { createOperatorCommandIngress } from "../../../../../../src/backend/runs/commands/operator-command-ingress.js";
import { createDashboardCommandService } from "../../../../../../src/backend/runs/commands/command-service.js";
import { createRunWorkerCapacity, runCapacityCommandId } from "../../../../../../src/backend/runs/commands/run-worker-capacity.js";
import { createStartPlanService } from "../../../../../../src/backend/runs/commands/start-plan-service.js";
import { StartPlanWireSchema } from "../../../../../../src/models/dashboard/start-plan.js";
import { seedSyntheticRuntimeConfig } from "../../../../../support/fixtures/operator-command-fixtures.js";
import { WorkerControlRefusal } from "../../../../../../src/models/run/worker-control.js";
import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { DESCRIPTORS } from "../../../../../../src/backend/app/registries/workflow-registry.js";
import {
  createCommandKernel,
  type CommandKernel,
  type WorkerPoolRuntimeSeam,
  type WorkerRuntimeContext,
} from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { workerPoolMember, type WorkerPoolMember } from "../../../../../../src/models/run/worker-slot.js";
import { WorkerIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../../../src/rules/time/clock.js";
import {
  SETTINGS_SCHEMA_HASH,
  derivePersistedSettingsFingerprint,
  deriveSettingsPatchFingerprint,
} from "../../../../../../src/models/config/settings.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase as AdmittedAuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import {
  composeDashboardRuntime,
  composeWorkerProcessControl,
  type DashboardRuntime,
} from "../../../../../../src/backend/app/composition/dashboard/compose.js";
import type {
  SpawnedWorkerHandle,
  WorkerProcessSpawnRequest,
} from "../../../../../../src/backend/runtime/workers/worker-supervisor.js";
import { ManualScheduler } from "../../../../../support/helpers/phase1f-executor-harness.js";
import { QUEUED_RUN, RUN_ID, sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import {
  NO_INTAKE_PROJECTIONS,
  UNWIRED_INTAKE_PARSER,
} from "../../../../../support/fixtures/intake-kernel-seams.js";

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
const POOL_INDEX_2 = PositiveIntSchema.parse(2);
const WORKER_2 = WorkerIdSchema.parse("person-lookup-worker-2");
const MEMBER_2 = { workflowId: WORKFLOW, poolIndex: POOL_INDEX_2, ordinal: POOL_INDEX_2, membershipRevision: PositiveIntSchema.parse(1), workerId: WORKER_2 } as const;

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});



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

function applySettingsRequiringRestart(harness: ControlHarness): void {
  const patch = { "browser.headless": { set: false } } as const;
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

/* ── the composed seam, end to end ───────────────────────────────────────── */

describe("the composed worker process control through the kernel pool door", () => {
  it.each(["all-or-none", "best-effort"] as const)("holds %s bulk child identities until an in-flight worker effect is journaled", async (mode) => {
    const harness = openControlHarness();
    const active = harness.database.authority.runtimeConfig.get(); assert.ok(active);
    harness.database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId } });
    await admitPoolSlot(harness);
    const bulkCommandId = nextCommandId();
    const commandId = deriveBulkChildCommandId(bulkCommandId, RUN_ID);
    const ingress = createOperatorCommandIngress({
      clock: harness.clock,
      journal: harness.database.authority.commands,
      protectedCommandAcceptedAt: () => undefined,
      bulkAcceptances: {
        withTransaction: (work) => harness.database.withAuthorityTransaction((repositories) => work({
          get: repositories.commands.getBulk,
          insert: repositories.commands.acceptBulk,
        })),
      },
    });
    const workerPending = ingress.submit({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: harness.database.authority.workerPools.get(WORKFLOW)?.version },
      payload: { workerId: WORKER_1 },
    }, (request) => harness.kernel.executeWorkerPool(request));
    await settleMicrotasks();
    assert.equal(harness.spawnRequests.length, 1);
    assert.notEqual(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);

    let bulkSettled = false;
    let bulkExecutions = 0;
    const bulkPending = ingress.executeBulk({
      commandId: bulkCommandId, bulkCommandId, requestedAt: NOW,
      requestedBy: "local-operator", source: "dashboard", family: "run", type: "cancel", mode,
      targets: [{ runId: RUN_ID, expectedVersion: 1 }],
    }, () => {
      bulkExecutions += 1;
      return { state: "refused", code: "capability-unavailable", message: "execution must not precede identity admission" };
    }).then((result) => { bulkSettled = true; return result; });
    await settleMicrotasks();
    const settledBeforeBirth = bulkSettled;
    const parentBeforeBirth = harness.database.authority.commands.getBulk(bulkCommandId);

    // Complete the real supervisor acknowledgement even on a regression, so
    // the pending command and its fake process cannot outlive the fixture.
    const child = harness.children[0];
    if (child?.pid === undefined) throw new Error("the fake spawner produced no child");
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: child.pid, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    fireBirthPoll(harness);
    const [workerResult, bulkResult] = await Promise.all([workerPending, bulkPending]);
    child.emitExit(0, null);

    assert.equal(settledBeforeBirth, false, "bulk acceptance must await the occupied derived identity");
    assert.equal(parentBeforeBirth, undefined);
    assert.equal(workerResult.state, "applied");
    assert.equal(bulkResult.state, "refused");
    if (bulkResult.state === "refused") assert.equal(bulkResult.code, "command-divergent");
    assert.equal(bulkExecutions, 0);
    assert.equal(harness.database.authority.commands.getBulk(bulkCommandId), undefined);
    assert.equal(harness.database.authority.commands.get(commandId)?.family, "worker-browser");
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.request.family, "worker-browser");
    assert.deepEqual(harness.database.authority.runs.get(RUN_ID)?.lifecycle, { state: "queued" });
  });

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
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.version, 1);
    assert.equal(harness.database.authority.commands.get(commandId)?.type, "plan-worker-count");
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("spawns the exact worker CLI argv and acknowledges only after the durable lease proves birth", async () => {
    const harness = openControlHarness();
    const member = await admitPoolSlot(harness);
    const commandId = nextCommandId();
    const pending = harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: harness.database.authority.workerPools.get(WORKFLOW)?.version },
      payload: { workerId: WORKER_1 },
    });
    await settleMicrotasks();


    assert.equal(harness.spawnRequests.length, 1);
    assert.deepEqual([...harness.spawnRequests[0]?.args ?? []], [
      "--import", "tsx", "src/cli.ts",
      "worker", "person-lookup", "--pool-index", "1",
      "--worker-id", member.workerId, "--ordinal", String(member.ordinal),
      "--membership-revision", String(member.membershipRevision), "--launch-command-id", commandId,
    ]);
    assert.equal(harness.database.authority.commands.get(commandId)?.type, "spawn-worker");
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, "executing");
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);

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

  it("rejects a spawn whose child never proves birth: SIGKILL, retained admission, no acknowledgement", async () => {
    const harness = openControlHarness();
    await admitPoolSlot(harness);
    const commandId = nextCommandId();
    const pending = harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: harness.database.authority.workerPools.get(WORKFLOW)?.version },
      payload: { workerId: WORKER_1 },
    });
    await settleMicrotasks();
    harness.clock.advanceMonotonic(10_000);
    fireBirthPoll(harness);

    await assert.rejects(() => pending, /proved no lease birth within 10000ms; the unproved child was killed/);
    assert.deepEqual(harness.children[0]?.signalsSent, ["SIGKILL"]);
    assert.equal(harness.database.authority.commands.get(commandId)?.type, "spawn-worker");
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, "uncertain");
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("refuses an externally started worker end-to-end with a retained refusal and no directive", async () => {
    const harness = openControlHarness();
    assert.equal(admitExternalSlot(harness), WORKER_1);
    // An operator started this worker by hand: the lease is live under a pid
    // this supervisor never spawned.
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: process.pid, requestedBy: "local-operator", now: NOW,
    }).state, "started");

    const spawnId = nextCommandId();

    const rejected = await harness.kernel.executeWorkerPool({
      ...envelope(harness, spawnId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: harness.database.authority.workerPools.get(WORKFLOW)?.version },
      payload: { workerId: WORKER_1 },
    });
    assert.equal(rejected.state, "rejected");
    if (rejected.state !== "rejected") throw new Error("unreachable");
    assert.match(rejected.message, /already holds a live lease in state starting/);
    assert.equal(harness.spawnRequests.length, 0);
    assert.equal(harness.database.authority.commands.get(spawnId), undefined);

    const stopId = nextCommandId();
    const stopResult = await harness.kernel.executeWorkerPool({ ...envelope(harness, stopId), type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) } });
    assert.equal(stopResult.state, "rejected");
    if (stopResult.state === "rejected") assert.match(stopResult.message, /never spawned person-lookup-worker-1/);
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.control.directive, "run");
    assert.equal(harness.database.authority.commandAudits.findByCommand(stopId)?.result.state, "rejected");

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
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) },
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


    const beforeVersion = harness.database.authority.workerPools.get(WORKFLOW)?.version; assert.ok(beforeVersion);
    const keepBothId = nextCommandId();
    const keepBoth = harness.kernel.executeWorkerPool({
      ...envelope(harness, keepBothId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: beforeVersion },
      payload: { desiredWorkers: 2 },
    });
    const shrinkId = nextCommandId();
    const shrink = harness.kernel.executeWorkerPool({
      ...envelope(harness, shrinkId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: beforeVersion },
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
    assert.equal(second.value.currentVersion, beforeVersion + 1);
    assert.equal(harness.database.authority.commands.get(shrinkId), undefined);

    // The desired member the loser would have stopped is untouched: run
    // directive intact, supervisor evidence plain running, nothing armed.
    assert.equal(harness.database.authority.workerLeases.get(WORKER_2)?.control.directive, "run");
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_2)?.state, "running");
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 2);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.version, beforeVersion + 1);
  });

  it("maps a phase-C pool CAS loss to a typed conflict naming the already-executed effect", async () => {
    let effectCalls = 0;
    const harness = openControlHarness({
      interceptPool: (pool, edges) => ({
        ...pool,
        planPoolWorkerCount: async (context) => {
          effectCalls += 1;
          const acknowledgement = await pool.planPoolWorkerCount(context);

          assert.equal(edges.database.authority.workerPools.plan({
            workflow: WORKFLOW,
            expectedVersion: 1,
            desiredWorkers: 1,
            requestedBy: "local-operator",
            now: edges.clock.now().toISOString(),
          }).state, "applied");
          return acknowledgement;
        },
      }),
    });
    const commandId = nextCommandId();
    const command = {
      ...envelope(harness, commandId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    };
    const result = await harness.kernel.executeWorkerPool(command);
    assert.equal(result.state, "conflict");
    if (result.state !== "conflict") throw new Error("unreachable");
    assert.equal(result.currentVersion, 2);
    // The refusal tells the operator the truth: the process effect ran.
    assert.match(result.message, /ALREADY executed/);
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, "uncertain");
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "rejected");
    assert.equal(effectCalls, 1);
    // Admission remains; no completion is audited.
    assert.equal(harness.database.authority.commands.get(commandId)?.type, "plan-worker-count");
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it.each(["admitted", "executing"] as const)("reconciles an expired %s command without delivering its effect again", async state => {
    const harness = openControlHarness(); await spawnPoolWorker(harness);
    const commandId = nextCommandId(); const request = { ...envelope(harness, commandId), type: "pause-worker" as const,
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) } };
    harness.database.withAuthorityTransaction(r => {
      r.commands.insert(request);
      r.workerLeases.reserveControl(WORKER_1, request.target.controlBasis, commandId, NOW);
      r.workerControls.admit({ commandId, request, scope: "worker-pool:person-lookup", executorId: nextCommandId(), admittedAt: NOW, expiresAt: NOW, basisVersion: 1, phase: { state: "admitted" } });
      if (state === "executing") r.workerControls.transition(commandId, "admitted", { state: "executing", startedAt: NOW });
    });
    harness.control.supervisor.close();
    const result = await harness.kernel.executeWorkerPool(request);
    assert.equal(result.state, "rejected");
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.control.directive, "run");
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, state === "admitted" ? "refused" : "uncertain");
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.result.state, state === "admitted" ? "rejected" : undefined);
    const next = await harness.kernel.executeWorkerPool({ ...envelope(harness), type: "pause-worker",
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) } });
    assert.equal(next.state, "rejected");
    if (next.state === "rejected") assert.match(next.message, state === "executing" ? /unresolved-effect/ : /closed/);
  });

  it("journals the exact retained stop after audit loss without consulting a closed supervisor", async () => {
    const harness = openControlHarness();
    await spawnPoolWorker(harness);
    const commandId = nextCommandId();
    const command = { ...envelope(harness, commandId), type: "stop-worker" as const,
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) }, reason: "shift over" };
    harness.auditFault.enabled = true;
    await assert.rejects(harness.kernel.executeWorkerPool(command), /injected-command-audit-failure/);
    const retained = harness.database.authority.workerControls.get(commandId);
    assert.equal(retained?.phase.state, "succeeded");
    assert.equal(retained?.auditedAt, undefined);
    assert.notEqual(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    const lease = harness.database.authority.workerLeases.get(WORKER_1);
    assert.equal(lease?.control.directive, "stop");
    harness.auditFault.enabled = false;
    const blocked = await harness.kernel.executeWorkerPool({ ...envelope(harness), type: "pause-worker",
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) } });
    assert.equal(blocked.state, "rejected");
    if (blocked.state === "rejected") assert.match(blocked.message, /unresolved-effect/);
    harness.control.supervisor.close();
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "applied");
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "already-applied");
    assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1), lease);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.result.state, "applied");
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(commandId)?.versionChanges,
      [{ target: { family: "worker-browser", workerId: WORKER_1 }, before: 2, after: 3 }]);
  });

  it("does not identify an unjournaled historical stop by matching actor and reason", async () => {
    const harness = openControlHarness();
    assert.equal(admitExternalSlot(harness), WORKER_1);
    harness.database.authority.workerLeases.start({ workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: process.pid, requestedBy: "local-operator", now: NOW });
    harness.database.authority.workerLeases.control({ workerId: WORKER_1, expectedVersion: 1,
      control: { directive: "stop", requestedAt: NOW, requestedBy: "local-operator", reason: "shift over" }, now: NOW });
    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({ ...envelope(harness, commandId), type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 2, controlBasis: servedControlBasis(harness.database, WORKER_1) }, reason: "shift over" });
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.match(result.message, /never spawned/);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.result.state, "rejected");
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.control.requestedAt, NOW);
  });

  it("refuses a new same-identity stop against a dead lease's stale directive: invalid-state, never applied", async () => {
    const harness = openControlHarness();
    assert.equal(admitExternalSlot(harness), WORKER_1);
    // A COMPLETED stop, all the way through the worker's own death: the lease
    // carries the stop directive that stopped it and the lifecycle is stopped.
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: process.pid, requestedBy: "local-operator", now: NOW,
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


    harness.clock.advanceWall(30_000);
    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 3, controlBasis: servedControlBasis(harness.database, WORKER_1) },
      reason: "shift over",
    });
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") throw new Error("unreachable");
    assert.equal(result.code, "invalid-state");
    assert.match(result.message, /stopped worker starts a new lease generation/);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("refuses actor, reason and instant drift under the same retained command identity before effects", async () => {
    const harness = openControlHarness();
    await spawnPoolWorker(harness);
    const commandId = nextCommandId();
    const command = { ...envelope(harness, commandId), type: "pause-worker" as const,
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) }, reason: "shift over" };
    harness.auditFault.enabled = true;
    await assert.rejects(harness.kernel.executeWorkerPool(command), /injected-command-audit-failure/);
    harness.auditFault.enabled = false;
    const lease = harness.database.authority.workerLeases.get(WORKER_1);
    for (const drift of [{ requestedBy: "another-operator" }, { reason: "another reason" }, { requestedAt: "2026-08-26T09:01:00.000Z" }]) {
      const result = await harness.kernel.executeWorkerPool({ ...command, ...drift });
      assert.equal(result.state, "rejected");
      if (result.state === "rejected") assert.equal(result.code, "command-divergent");
      assert.notEqual(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
      assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1), lease);
    }
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "applied");
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "already-applied");
  });

  it("audits a stop with the directive write's own lease versions, not later unrelated bumps", async () => {
    const harness = openControlHarness({
      interceptPool: (pool, edges) => ({
        ...pool,
        stopPoolWorker: async (context) => {
          const acknowledgement = await pool.stopPoolWorker(context);

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
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) },
    });
    assert.equal(result.state, "applied");
    // Lease: v1 at birth, v2 at the directive write, v3 at the unrelated bump.
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.version, 4);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(commandId)?.versionChanges, [
      { target: { family: "worker-browser", workerId: WORKER_1 }, before: 2, after: 3 },
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
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) },
      reason: "operator break",
    });
    assert.deepEqual(paused, {
      state: "applied",
      commandId: pauseId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });
    const afterPause = harness.database.authority.workerLeases.get(WORKER_1);

    assert.deepEqual(afterPause?.control, {
      directive: "pause", requestedAt: pauseAt, requestedBy: "local-operator", reason: "operator break",
    });
    assert.equal(afterPause?.version, 3);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(pauseId)?.versionChanges, [
      { target: { family: "worker-browser", workerId: WORKER_1 }, before: 2, after: 3 },
    ]);

    harness.clock.advanceWall(60_000);
    const resumeAt = harness.clock.now().toISOString();
    const resumeId = nextCommandId();
    const resumed = await harness.kernel.executeWorkerPool({
      ...envelope(harness, resumeId),
      type: "resume-worker",
      target: { workerId: WORKER_1, expectedVersion: 2, controlBasis: servedControlBasis(harness.database, WORKER_1) },
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
    assert.equal(afterResume?.version, 5);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(resumeId)?.versionChanges, [
      { target: { family: "worker-browser", workerId: WORKER_1 }, before: 4, after: 5 },
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
      target: { workflowId: WORKFLOW, expectedVersion: harness.database.authority.workerPools.get(WORKFLOW)?.version },
      payload: { workerId: WORKER_1 },
    });
    assert.equal(replayed.state, "already-applied");
    // Replay is a READ: the supervisor spawned nothing new.
    assert.equal(harness.children.length, 1);
  });

  it("refuses the synchronous execute path for worker-browser, and other families at the pool door", async () => {
    const harness = openControlHarness();
    const result = harness.kernel.execute({
      ...envelope(harness), type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 }, payload: { desiredWorkers: 1 },
    });
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "capability-unavailable");
    assert.equal(harness.children.length, 0);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW), undefined);

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

function dashboardLaunch(harness: ControlHarness, eid = "10873698") {
  if (harness.database.authority.runtimeConfig.get() === undefined) seedSyntheticRuntimeConfig(harness.database);
  const active = harness.database.authority.runtimeConfig.get(); assert.ok(active);
  const planner = createStartPlanService({ authority: harness.database, authorityRead: harness.database,
    descriptors: { resolve: workflowId => DESCRIPTORS.find(descriptor => descriptor.id === workflowId) }, clock: harness.clock,
    ids: { uuid: nextCommandId }, planTtlMs: 600_000, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
  const plan = planner.plan({ workflowId: WORKFLOW, submissions: [{ emplId: eid }], dryRun: false });
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.planned.length, 1);
  const request = { commandId: nextCommandId(), requestedAt: harness.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
    family: "start", type: "start-run", target: { workflowId: WORKFLOW, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
  return { plan, request };
}

function launchCommands(harness: ControlHarness) {
  return createDashboardCommandService({ kernel: harness.kernel, projection: { ingestFromTimeline: () => {}, refreshRun: () => {} },
    startWorkerCapacity: createRunWorkerCapacity({ kernel: harness.kernel, authority: harness.database.authority }) });
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

describe("dashboard launch creates bounded worker capacity", () => {
  it("declares one cold worker, waits for birth, and replays without recreating a later crash", async () => {
    const h = openControlHarness(); const commands = launchCommands(h); const { request } = dashboardLaunch(h);
    assert.equal(h.children.length, 0);
    const pending = commands.submit(request);
    await proveLaunchBirth(h);
    assert.equal((await pending).state, "applied");
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(h.database.authority.workerControls.list().length, 2);
    const retained = JSON.stringify(h.database.authority.workerControls.list());
    h.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1, leaseGeneration: 1,
      lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: h.clock.now().toISOString() }, now: h.clock.now().toISOString() });
    h.children[0]?.emitExit(1, null);
    h.clock.advanceWall(1000);
    h.database.authority.workerLeases.sweepExpired({ now: h.clock.now().toISOString(), staleBefore: h.clock.now().toISOString() });
    assert.equal(h.database.authority.workerLeases.get(WORKER_1)?.lifecycle.state, "stopped");
    assert.equal((await launchCommands(h).submit(request)).state, "already-applied");
    assert.equal(h.children.length, 1);
    assert.equal(JSON.stringify(h.database.authority.workerControls.list()), retained);
    const replacement = commands.submit(dashboardLaunch(h, "10002296").request);
    await proveLaunchBirth(h);
    assert.equal((await replacement).state, "applied");
    assert.equal(h.children.length, 2);
    assert.equal(h.database.authority.workerLeases.get(WORKER_1)?.leaseGeneration, 2);
  });

  it("serializes concurrent launches so two queued runs share one cold worker", async () => {
    const h = openControlHarness(); const commands = launchCommands(h);
    const first = dashboardLaunch(h).request; const second = dashboardLaunch(h, "10002296").request;
    const pending = Promise.all([commands.submit(first), commands.submit(second)]);
    await proveLaunchBirth(h);
    assert.deepEqual((await pending).map(result => result.state), ["applied", "applied"]);
    assert.equal(h.children.length, 1); assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW).length, 2);
  });

  it.each(["starting", "idle", "busy"] as const)("reuses an external %s run-directed worker without adoption or scaling", async state => {
    const h = openControlHarness(); occupyMember(h, 1, "run"); const { request } = dashboardLaunch(h);
    if (state !== "starting") h.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1, leaseGeneration: 1,
      lifecycle: { state, startedAt: NOW, heartbeatAt: NOW, ...(state === "busy" ? { runId: RUN_ID } : {}) }, now: NOW });
    const poolBefore = h.database.authority.workerPools.get(WORKFLOW);
    const before = h.database.authority.workerLeases.get(WORKER_1);
    assert.equal((await launchCommands(h).submit(request)).state, "applied");
    assert.deepEqual(h.database.authority.workerLeases.get(WORKER_1), before);
    assert.deepEqual(h.database.authority.workerPools.get(WORKFLOW), poolBefore); assert.equal(h.children.length, 0);
  });

  it.each(["pause", "stop"] as const)("keeps a larger declaration and starts only a missing slot beside a %s-directed member", async directive => {
    const h = openControlHarness(); const { request } = dashboardLaunch(h);
    await admitPoolSlot(h, 3);
    occupyMember(h, 1, directive); const before = h.database.authority.workerLeases.get(WORKER_1);
    const pending = launchCommands(h).submit(request); await proveLaunchBirth(h); await pending;
    assert.equal(h.spawnRequests[0]?.member.workerId, WORKER_2);
    assert.equal(h.children.length, 1); assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.version, 1);
    assert.deepEqual(h.database.authority.workerLeases.get(WORKER_1), before);
  });

  it.each(["declared", "undeclared"] as const)("plans needed capacity around an owned %s paused member without resuming it", async declaration => {
    const h = openControlHarness(); const { request } = dashboardLaunch(h);
    await spawnPoolWorker(h);
    if (declaration === "declared") h.database.authority.workerPools.plan({ workflow: WORKFLOW, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW });
    h.database.authority.workerLeases.control({ workerId: WORKER_1, expectedVersion: 1, control: { directive: "pause", requestedAt: NOW, requestedBy: "local-operator" }, now: NOW });
    const before = h.database.authority.workerLeases.get(WORKER_1);
    const pending = launchCommands(h).submit(request); await proveLaunchBirth(h); await pending;
    assert.equal(h.spawnRequests[1]?.member.workerId, WORKER_2); assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 2);
    assert.deepEqual(h.database.authority.workerLeases.get(WORKER_1), before);
  });

  it.each(["stop-directed", "stopping"] as const)("refuses automatic growth before Plan effects around an owned %s member", async phase => {
    let planCalls = 0;
    const h = openControlHarness({ interceptPool: pool => ({ ...pool,
      planPoolWorkerCount: async context => { planCalls++; return pool.planPoolWorkerCount(context); },
    }) });
    const { request } = dashboardLaunch(h);
    await spawnPoolWorker(h);
    h.database.authority.workerPools.plan({ workflow: WORKFLOW, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW });
    const directive = phase === "stop-directed" ? "stop" : "pause";
    h.database.authority.workerLeases.control({ workerId: WORKER_1, expectedVersion: 1,
      control: { directive, requestedAt: NOW, requestedBy: "local-operator" }, now: NOW });
    if (phase === "stopping") h.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1, leaseGeneration: 1,
      lifecycle: { state: "stopping", startedAt: NOW, heartbeatAt: NOW }, now: NOW });
    planCalls = 0;
    const before = { lease: h.database.authority.workerLeases.get(WORKER_1), pool: h.database.authority.workerPools.get(WORKFLOW),
      controls: h.database.authority.workerControls.list(), children: h.children.length };
    await assert.rejects(launchCommands(h).submit(request), /Runs queued .*worker startup unavailable: the admitted roster contains a pending stop/);
    assert.equal(planCalls, 0);
    assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW).length, 1);
    assert.deepEqual({ lease: h.database.authority.workerLeases.get(WORKER_1), pool: h.database.authority.workerPools.get(WORKFLOW),
      controls: h.database.authority.workerControls.list(), children: h.children.length }, before);
  });

  it("reports queued capacity unavailable at cap without resuming paused or stopping members", async () => {
    const h = openControlHarness(); const { request } = dashboardLaunch(h);
    await admitPoolSlot(h, 3);
    for (let index = 1; index <= 3; index++) occupyMember(h, index, index === 2 ? "stop" : "pause");
    const before = JSON.stringify(h.database.authority.workerLeases.listLive());
    await assert.rejects(launchCommands(h).submit(request), /Runs queued .*worker startup unavailable: all three/);
    assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW).length, 1); assert.equal(h.children.length, 0);
    assert.equal(JSON.stringify(h.database.authority.workerLeases.listLive()), before);
  });

  it("does not create capacity for a refused start or an applied zero-run plan", async () => {
    const h = openControlHarness(); const commands = launchCommands(h); const { request } = dashboardLaunch(h);
    const bad = { ...request, payload: { ...request.payload, inputFingerprint: "f".repeat(64) } };
    assert.equal((await commands.submit(bad)).state, "rejected");
    const plan = h.database.authority.startPlans.get(request.target.startPlanId); assert.ok(plan);
    const { derivePlannedInputFingerprint } = await import("../../../../../../src/models/run/start-plan.js");
    const empty = { ...plan, startPlanId: nextCommandId(), planned: [], refused: [{ entry: 1, rawInput: { eid: "10873698" }, code: "input-invalid", message: "Refused input" }],
      inputFingerprint: derivePlannedInputFingerprint([], plan.ingressSchemaHash, plan.canonicalInputSchemaHash) };
    h.database.authority.startPlans.create(empty);
    assert.equal((await commands.submit({ ...request, commandId: nextCommandId(), target: { ...request.target, startPlanId: empty.startPlanId },
      payload: { ...request.payload, inputFingerprint: empty.inputFingerprint } })).state, "applied");
    assert.equal(h.database.authority.workerControls.list().length, 0); assert.equal(h.children.length, 0);
  });

  it.each(["refused", "uncertain"] as const)("retains a %s spawn and never repeats it on exact replay", async outcome => {
    let calls = 0;
    const h = openControlHarness({ interceptPool: pool => ({ ...pool, spawnPoolWorker: async () => {
      calls++;
      if (outcome === "refused") throw new WorkerControlRefusal("injected-spawn-refusal");
      throw new Error("injected-spawn-uncertainty");
    } }) });
    const commands = launchCommands(h); const { request } = dashboardLaunch(h);
    await assert.rejects(commands.submit(request), /Runs queued .*worker startup .*spawn/);
    assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW).length, 1);
    const id = runCapacityCommandId(request.commandId, "spawn-worker", 1);
    assert.equal(h.database.authority.workerControls.get(id)?.phase.state, outcome);
    await assert.rejects(commands.submit(request), /Runs queued .*worker startup .*spawn/);
    assert.equal(calls, 1);
  });

  it("reports replay without startup admission as unknown when no usable worker remains", async () => {
    const h = openControlHarness(); const { request } = dashboardLaunch(h);
    assert.equal(h.kernel.execute(request).state, "applied");
    await assert.rejects(launchCommands(h).submit(request), /Runs queued .*worker startup status unknown/);
    assert.equal(h.children.length, 0); assert.equal(h.database.authority.workerControls.list().length, 0);
  });

  it("recovers the selected member from a settled Plan when Spawn was never admitted", async () => {
    const h = openControlHarness(); const { request } = dashboardLaunch(h);
    await spawnPoolWorker(h);
    h.database.authority.workerPools.plan({ workflow: WORKFLOW, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW });
    h.database.authority.workerLeases.control({ workerId: WORKER_1, expectedVersion: 1,
      control: { directive: "pause", requestedAt: NOW, requestedBy: "local-operator" }, now: NOW });
    assert.equal(h.kernel.execute(request).state, "applied");
    const plan = { ...envelope(h, runCapacityCommandId(request.commandId, "plan-worker-count", 2)), type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 1 }, payload: { desiredWorkers: 2 } };
    assert.equal((await h.kernel.executeWorkerPool(plan)).state, "applied");
    const replay = launchCommands(h).submit(request);
    await proveLaunchBirth(h);
    assert.equal((await replay).state, "already-applied");
    assert.equal(h.spawnRequests[1]?.member.workerId, WORKER_2);
    assert.deepEqual(h.database.authority.workerControls.get(plan.commandId)?.request, plan);
  });

  it("does not execute a retained admitted Spawn after a dashboard restart", async () => {
    const h = openControlHarness(); const { request } = dashboardLaunch(h);
    assert.equal(h.kernel.execute(request).state, "applied");
    h.database.authority.workerPools.plan({ workflow: WORKFLOW, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW });
    const child = { ...envelope(h, runCapacityCommandId(request.commandId, "spawn-worker", 1)), type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 1 }, payload: { workerId: WORKER_1 } };
    h.database.authority.commands.insert(child);
    h.database.authority.workerSlots.allocate({ workflow: WORKFLOW, poolIndex: 1, commandId: child.commandId, now: NOW });
    h.database.authority.workerControls.admit({ commandId: child.commandId, request: child, scope: `worker-pool:${WORKFLOW}`,
      executorId: nextCommandId(), admittedAt: NOW, expiresAt: "2026-08-26T09:03:00.000Z", basisVersion: 1, phase: { state: "admitted" } });
    await assert.rejects(launchCommands(h).submit(request), /Runs queued .*worker-control-admitted/);
    assert.equal(h.children.length, 0);
    assert.equal(h.database.authority.workerControls.get(child.commandId)?.phase.state, "admitted");
  });
});

/* ── dashboard shutdown ordering (the composed runtime) ──────────────────── */

describe("dashboard shutdown drains owned workers between ingress and the process lock", () => {
  it.each(["manual-worker", "dashboard-start"] as const)("%s writes a graceful stop, waits for the owned OS exit, then releases the server lock", async mode => {
    const repoRoot = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "hrauto-shutdown-")));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));

    const clock = manualClock(new Date(NOW));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    mkdirSync(join(repoRoot, rebuildRuntimeIsolation.artifactRoot), { recursive: true, mode: 0o700 });
    const initial = AuthorityDatabase.open({ path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
    initial.close();
    const admission = acquireEntrypointAdmission(repoRoot, "shared");
    cleanups.push(() => admission.release());
    const scheduler = new ManualScheduler(clock, 0);
    const children: FakeWorkerChild[] = [];
    const faultLines: string[] = [];
    const lockRecord = () => {
      const record = readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server");
      assert.ok(record); return record;
    };
    // Port 0 asks the OS for an ephemeral port, isolating this proof from a running dashboard.
    const runtime: DashboardRuntime = await composeDashboardRuntime({ admission, preflightRunnerFactory: healthyRuntimePreflightRunners,
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
        },
      },
    });
    const stops: (() => Promise<void>)[] = [() => runtime.stop()];
    cleanups.push(async () => {
      for (const stop of stops.splice(0)) {
        const stopping = stop();
        for (const child of children) child.emitExit(0, null);
        await stopping;
      }
    });

    const commandId = nextCommandId();
    const origin = `http://127.0.0.1:${String(runtime.port)}`;
    let command: unknown;
    if (mode === "dashboard-start") {
      const proposed = await fetch(`${origin}/api/v1/start-plans`, {
        method: "POST", headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ workflowId: WORKFLOW, submissions: [{ emplId: "10873698" }], dryRun: false }),
      });
      assert.equal(proposed.status, 200);
      const plan = StartPlanWireSchema.parse(await proposed.json());
      assert.deepEqual(plan.refused, []);
      assert.equal(children.length, 0, "preview must not launch workers");
      command = { commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "run-start",
        family: "start", type: "start-run", target: { workflowId: WORKFLOW, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
    } else {
      const planned = await fetch(`${origin}/api/v1/commands`, { method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ commandId: nextCommandId(), requestedAt: clock.now().toISOString(),
          requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type: "plan-worker-count",
          target: { workflowId: WORKFLOW, expectedVersion: 0 }, payload: { desiredWorkers: 1 } }) });
      assert.equal(planned.status, 200);
      assert.equal(((await planned.json()) as { state: string }).state, "applied");
      command = { commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
        family: "worker-browser", type: "spawn-worker", target: { workflowId: WORKFLOW, expectedVersion: 1 }, payload: { workerId: WORKER_1 } };
    }
    const posted = fetch(`${origin}/api/v1/commands`, {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(command),
    });
    // Wait for the composed supervisor to actually launch the child.
    for (let waited = 0; children.length === 0 && waited < 200; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(children.length, 1);
    const sideDoor = AdmittedAuthorityDatabase.open(admission,
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

    if (mode === "dashboard-start") {
      const planned = await fetch(`${origin}/api/v1/commands`, { method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ commandId: nextCommandId(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator",
          source: "dashboard", family: "worker-browser", type: "plan-worker-count",
          target: { workflowId: WORKFLOW, expectedVersion: 1 }, payload: { desiredWorkers: 3 } }) });
      assert.equal(planned.status, 200);
      assert.equal(((await planned.json()) as { state: string }).state, "applied");
      const blocked = AdmittedAuthorityDatabase.open(admission,
        { path: join(stateRoot, "state.db"), busyTimeoutMs: 5_000, migrationOwner: "unit-test" }, clock);
      try {
        assert.equal(blocked.authority.commands.get(commandId)?.source, "dashboard");
        for (let index = 1; index <= 3; index++) {
          const workerId = WorkerIdSchema.parse(`person-lookup-worker-${String(index)}`);
          if (index > 1) blocked.authority.workerLeases.start({ workerId, workflow: WORKFLOW,
            browserSystems: BROWSER_SYSTEMS, processId: 7001 + index, requestedBy: "local-operator", now: NOW });
          const lease = blocked.authority.workerLeases.get(workerId); assert.ok(lease);
          blocked.authority.workerLeases.control({ workerId, expectedVersion: lease.version,
            control: { directive: "pause", requestedAt: NOW, requestedBy: "local-operator" }, now: NOW });
        }
      } finally { blocked.close(); }
      const nextPlanResponse = await fetch(`${origin}/api/v1/start-plans`, { method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ workflowId: WORKFLOW, submissions: [{ emplId: "10002296" }], dryRun: false }) });
      assert.equal(nextPlanResponse.status, 200);
      const nextPlan = StartPlanWireSchema.parse(await nextPlanResponse.json());
      const nextId = nextCommandId();
      const failure = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ commandId: nextId, requestedAt: NOW, requestedBy: "local-operator", source: "run-start", family: "start", type: "start-run",
          target: { workflowId: WORKFLOW, startPlanId: nextPlan.startPlanId, expectedVersion: nextPlan.expectedVersion }, payload: nextPlan.fingerprints }) });
      assert.equal(failure.status, 500);
      assert.match(JSON.stringify(await failure.json()), /Runs queued .*worker startup unavailable: all three/);
      const committed = AdmittedAuthorityDatabase.open(admission,
        { path: join(stateRoot, "state.db"), busyTimeoutMs: 5_000, migrationOwner: "unit-test" }, clock);
      try {
        assert.equal(committed.authority.commandAudits.findByCommand(nextId)?.result.state, "applied");
        assert.equal(committed.authority.runs.listByWorkflow(WORKFLOW).length, 2);
      } finally { committed.close(); }
      assert.equal(children.length, 1);
    }

    // Shutdown: ingress closes and the supervisor durably requests stop. It
    // must remain pending until this owned child reports its real OS exit.
    assert.ok(lockRecord());
    assert.equal(lockRecord().releasedAt, null);
    stops.splice(0);
    const stopping = runtime.stop();
    let stopRequested = false;
    for (let waited = 0; waited < 200 && !stopRequested; waited += 1) {
      const probe = AdmittedAuthorityDatabase.open(admission,
        { path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 5_000, migrationOwner: "unit-test" },
        clock,
      );
      try {
        stopRequested = probe.authority.workerLeases.get(WORKER_1)?.control.directive === "stop";
      } finally {
        probe.close();
      }
      if (!stopRequested) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(stopRequested, true, "shutdown must persist the graceful stop directive");
    assert.equal(lockRecord().releasedAt, null);
    children[0]?.emitExit(0, null);
    await stopping;

    assert.equal(faultLines.some((line) => line.includes("dashboard shutdown leaves a worker child")), false);
    assert.notEqual(lockRecord().releasedAt, null);
  });
});


describe("every control retains a crash after effect admission", () => {
  it.each(["plan-worker-count", "spawn-worker", "pause-worker", "resume-worker", "stop-worker", "refresh-browser", "reopen-browser"] as const)("%s never repeats an uncertain effect or accepts a divergent replay", async type => {
    let fault = false; let calls = 0;
    const harness = openControlHarness({ interceptPool: (pool, { database, clock }) => {
      const wrap = (operation: (context: WorkerRuntimeContext) => Promise<unknown>) => async (context: WorkerRuntimeContext) => {
        if (!fault || context.command.type !== type) return operation(context);
        calls += 1;
        if (type === "refresh-browser" || type === "reopen-browser") {
          database.authority.workerControls.transition(context.command.commandId, "admitted", { state: "ready" });
          database.authority.workerControls.transition(context.command.commandId, "ready", { state: "executing", startedAt: clock.now().toISOString() });
        }
        throw new Error("injected-owner-loss-after-admission");
      };
      return { planPoolWorkerCount: wrap(c => pool.planPoolWorkerCount(c)), spawnPoolWorker: wrap(c => pool.spawnPoolWorker(c)),
        pausePoolWorker: wrap(c => pool.pausePoolWorker(c)), resumePoolWorker: wrap(c => pool.resumePoolWorker(c)),
        stopPoolWorker: wrap(c => pool.stopPoolWorker(c)), refreshPoolBrowser: wrap(c => pool.refreshPoolBrowser(c)), reopenPoolBrowser: wrap(c => pool.reopenPoolBrowser(c)) };
    } });
    await spawnPoolWorker(harness);
    harness.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1, leaseGeneration: 1, lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW }, now: NOW });
    const sessionId = nextCommandId();
    harness.database.authority.workerControls.observe({ workerId: WORKER_1, leaseGeneration: 1, sessionId, system: "crm", configFingerprint: "a".repeat(64), browserMode: "headless",
      acceptDownloads: false, exclusive: false, health: "authenticated", observedAt: NOW,
      signInFingerprint: "b".repeat(64), openedAt: NOW, profileRevision: 1 });
    if (type === "spawn-worker") await admitPoolSlot(harness, 2);
    const command = { ...envelope(harness), type, ...(type === "plan-worker-count" || type === "spawn-worker"
      ? { target: { workflowId: WORKFLOW, expectedVersion: harness.database.authority.workerPools.get(WORKFLOW)?.version }, payload: type === "plan-worker-count" ? { desiredWorkers: 2 } : { workerId: WORKER_2 } }
      : { target: { workerId: WORKER_1, expectedVersion: 2, controlBasis: servedControlBasis(harness.database, WORKER_1),
        ...(type === "refresh-browser" || type === "reopen-browser" ? { browserSessionId: sessionId } : {}) } }) };
    fault = true;
    await assert.rejects(harness.kernel.executeWorkerPool(command), /injected-owner-loss/);
    assert.equal(harness.database.authority.workerControls.get(command.commandId)?.phase.state, "uncertain");
    const replay = await harness.kernel.executeWorkerPool(command); assert.equal(replay.state, "rejected");
    if (replay.state === "rejected") assert.match(replay.message, /uncertain/);
    const divergent = await harness.kernel.executeWorkerPool({ ...command, requestedBy: "another-actor" });
    assert.equal(divergent.state, "rejected"); if (divergent.state === "rejected") assert.equal(divergent.code, "command-divergent");
    const next = await harness.kernel.executeWorkerPool({ ...envelope(harness), type: "pause-worker",
      target: { workerId: WORKER_1, expectedVersion: 2, controlBasis: servedControlBasis(harness.database, WORKER_1) } });
    assert.equal(next.state, "rejected"); if (next.state === "rejected") assert.match(next.message, /unresolved-effect/);
    assert.equal(calls, 1);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
  });
});
