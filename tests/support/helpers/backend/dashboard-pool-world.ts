import assert from "node:assert/strict";
import { join } from "node:path";
import { createBoundProfileFixture, boundProfileCredentials } from "../admission-fixture.js";
import { composeWorkerPool } from "../../../../src/backend/app/composition/dashboard/compose.js";
import type { WorkerCliLaunchSpec, WorkerProcessSpawner, WorkerSpawnRequest } from "../../../../src/backend/app/composition/dashboard/worker-process.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createCommandKernel, type CommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createDashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import { createRunWorkerCapacity } from "../../../../src/backend/runs/commands/run-worker-capacity.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { reconcileExitedWorker } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import type { WorkerMemberView } from "../../../../src/backend/runtime/workers/worker-pool.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { derivePersistedSettingsFingerprint } from "../../../../src/models/config/settings.js";
import { WorkerPoolMemberSchema, workerPoolMember, type WorkerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { PreflightAdmissionScopeSchema } from "../../../../src/rules/preflight/preflight-admission.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { seedSyntheticRuntimeConfig } from "../../fixtures/operator-command-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { ManualScheduler } from "../phase1f-executor-harness.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { scriptedWorkerSpawner, type ScriptedWorkerBehavior, type ScriptedWorkerChild } from "./fake-worker-port.js";

export interface ControlHarness {
  readonly database: AuthorityDatabase;
  readonly admission: Awaited<ReturnType<typeof createBoundProfileFixture>>["admission"];
  readonly profileRoot: string;
  readonly clock: TestClock;
  readonly scheduler: ManualScheduler;
  readonly kernel: CommandKernel;
  readonly workers: ReturnType<typeof composeWorkerPool>;
  readonly children: ScriptedWorkerChild[];
  readonly spawnRequests: WorkerSpawnRequest[];
  readonly faults: Error[];
  /** Worker startup failures a command reported after its reply. */
  readonly detachedStartupFailures: Error[];
  /** Whether the fixture workflow's startup was pending, at each change the capacity republished. */
  readonly startupPending: boolean[];
  /** With `holdPreflight`, each member start's preflight waits here until released or aborted by the pool's stop. */
  readonly preflight: Readonly<{ entered(): number; release(): void }>;
  readonly settled: string[];
  readonly changes: WorkerMemberView[];
  readonly stateRoot: string;
  readonly lifecycle: RunRecordService;
}

/** The composed pool over scripted children, the real kernel and real exit settlement against real SQLite. */
export function createDashboardPoolTestWorld() {
  const NOW = "2026-08-26T09:00:00.000Z";
  const WORKFLOW = WorkflowIdSchema.parse("person-lookup");
  const WORKER_1 = WorkerIdSchema.parse("person-lookup-worker-1");
  const MEMBER_1: WorkerPoolMember = WorkerPoolMemberSchema.parse({ workflowId: WORKFLOW, poolIndex: 1, ordinal: 1, workerId: WORKER_1 });
  const cleanups: (() => Promise<void> | void)[] = [];

  /** `real` swaps the scripted children for real processes from the given launch and spawner. */
  async function openControlHarness(behavior: Partial<ScriptedWorkerBehavior> = {},
    real?: (lifetime: RuntimeLifetimeLock) => Readonly<{ launch: WorkerCliLaunchSpec; spawn: WorkerProcessSpawner }>,
    options: Readonly<{ holdPreflight?: boolean }> = {}): Promise<ControlHarness> {
    const profile = await createBoundProfileFixture(real === undefined ? {} : { sharedMachine: true }), root = profile.stateRoot;
    const clock = manualClock(new Date(NOW));
    const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(profile.admission));
    cleanups.push(async () => { database.close(); await profile.close(); });
    seedSyntheticRuntimeConfig(database);
    const scheduler = new ManualScheduler(clock, 0);
    const children: ScriptedWorkerChild[] = [], spawnRequests: WorkerSpawnRequest[] = [], faults: Error[] = [], settled: string[] = [];
    const detachedStartupFailures: Error[] = [], startupPending: boolean[] = [];
    const changes: WorkerMemberView[] = [];
    const spawnChild = scriptedWorkerSpawner(children, behavior);
    const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("e"), publishQueued: () => {} });
    const lock = profile.lifetime;
    assert.ok(lock instanceof RuntimeLifetimeLock);
    const realProcess = real?.(lock);
    let preflightsEntered = 0;
    const heldPreflights: (() => void)[] = [];
    const preflight = { entered: () => preflightsEntered, release: () => { for (const release of heldPreflights.splice(0)) release(); } };
    const workerPreflight = options.holdPreflight !== true ? undefined : {
      currentScope: () => { const active = database.authority.runtimeConfig.get(); assert.ok(active);
        return PreflightAdmissionScopeSchema.parse({ configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint,
          descriptorFingerprint: "a".repeat(64), requestedCapabilities: ["executor.run"] }); },
      admission: {
        // Like a real detector, a held check gives up when the pool's stop aborts it.
        prepare: (_scope: unknown, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
          preflightsEntered += 1; heldPreflights.push(resolve);
          signal.addEventListener("abort", () => { reject(signal.reason instanceof Error ? signal.reason : new Error("preflight aborted")); }, { once: true });
        }),
        assertReady: () => undefined,
      },
    };
    const workers = composeWorkerPool({
      admission: profile.admission, sessionGeneration: 1, profileRoot: join(root, "browsers"), database, clock, scheduler,
      ids: sequentialIdFactory("a"),
      launch: realProcess?.launch ?? { environment: {}, command: "/usr/bin/fake-worker-node", prefixArgs: Object.freeze(["--import", "tsx", "src/cli.ts"]), cwd: root },
      spawn: request => { spawnRequests.push(request); return realProcess === undefined ? spawnChild(request) : realProcess.spawn(request); },
      settleExit: member => {
        settled.push(member.workerId);
        reconcileExitedWorker({ machine: profile.machine, admission: profile.admission, database, lifecycle, clock, workerId: member.workerId, lock });
      },
      onChange: view => { changes.push(view); },
      onFault: error => { faults.push(error); },
      ...(workerPreflight === undefined ? {} : { preflight: workerPreflight }),
    });
    cleanups.push(async () => { await workers.pool.stopAll("shutdown"); });
    const kernel = createCommandKernel({
      lifecycle, appVersion: "0.1.0",
      configIdentity: (() => { const active = database.authority.runtimeConfig.get(); assert.ok(active); return { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId }; })(),
      intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: { withAuthorityTransaction: work => database.withAuthorityTransaction(work) },
      clock, ids: sequentialIdFactory("b"),
      descriptors: { resolve: workflowId => DESCRIPTORS.find(descriptor => String(descriptor.id) === workflowId) },
      writeResolution: { recheck: () => { throw new Error("unused in this suite"); }, resolveAbsent: () => { throw new Error("unused in this suite"); } },
      workerRuntime: { pool: workers.seam },
      settings: { validateRequest: () => undefined, commitPrivate: () => undefined,
        reconcileReplay: () => { throw new Error("worker-pool fixture has no persisted settings replay authority"); },
        applyOrdinary: command => ({ state: "applied", revision: command.target.expectedRevision + 1, settingsFingerprint: derivePersistedSettingsFingerprint({}), settings: {} }) },
    });
    return { database, admission: profile.admission, profileRoot: join(root, "browsers"), stateRoot: root, lifecycle, clock, scheduler, kernel, workers, children, spawnRequests, faults, detachedStartupFailures, startupPending, preflight, settled, changes };
  }

  let commandSequence = 0;
  function nextCommandId(): string {
    commandSequence += 1;
    const tail = String(commandSequence).padStart(4, "0");
    return `dddddddd-${tail}-4000-8000-${tail}00000000`;
  }

  function envelope(harness: ControlHarness, commandId = nextCommandId()) {
    return { commandId, requestedAt: harness.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "worker-browser" } as const;
  }

  /** Lets scripted children answer: spawn → ready, stop → exit and the settlement that follows. */
  const settleMicrotasks = async (turns = 4): Promise<void> => {
    for (let turn = 0; turn < turns; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
  };

  function view(harness: ControlHarness, workerId: string = WORKER_1): WorkerMemberView {
    const found = harness.workers.pool.snapshot().find(entry => entry.member.workerId === workerId);
    assert.ok(found, `no pool member ${workerId}`);
    return found;
  }

  function memberTarget(harness: ControlHarness, workerId: string = WORKER_1) {
    const current = view(harness, workerId);
    return { workflowId: WORKFLOW, workerId, lifetimeId: current.lifetimeId, expectedVersion: current.version };
  }

  async function planWorkers(harness: ControlHarness, desiredWorkers: number) {
    const result = await harness.kernel.executeWorkerPool({ ...envelope(harness), type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: harness.database.authority.workerPools.get(WORKFLOW)?.version ?? 0 }, payload: { desiredWorkers } });
    assert.equal(result.state, "applied", JSON.stringify(result));
    return harness.database.authority.workerSlots.active(WORKFLOW).map(workerPoolMember);
  }

  function dashboardLaunch(harness: ControlHarness, eid = "10873698", options: { items?: number } = {}) {
    const active = harness.database.authority.runtimeConfig.get(); assert.ok(active);
    const planner = createStartPlanService({ authority: harness.database, authorityRead: harness.database,
      descriptors: { resolve: workflowId => DESCRIPTORS.find(descriptor => descriptor.id === workflowId) }, clock: harness.clock,
      ids: { uuid: nextCommandId }, planTtlMs: 600_000, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
    const plan = planner.plan({ workflowId: WORKFLOW, submissions: Array.from({ length: options.items ?? 1 }, (_, index) => ({ emplId: String(Number(eid) + index) })), dryRun: false });
    assert.deepEqual(plan.refused, []);
    const request = { commandId: nextCommandId(), requestedAt: harness.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
      family: "start", type: "start-run", target: { workflowId: WORKFLOW, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
    return { plan, request };
  }

  function launchCommands(harness: ControlHarness) {
    const capacity = createRunWorkerCapacity({ kernel: harness.kernel, authority: harness.database.authority, running: harness.workers.running, ensureRunning: harness.workers.ensureRunning,
      own: harness.workers.own, reportDetachedFailure: error => { harness.detachedStartupFailures.push(error); },
      startupPendingChanged: () => { harness.startupPending.push(capacity.startupPending(WORKFLOW)); } });
    const service = createDashboardCommandService({ kernel: harness.kernel, projection: { ingestFromTimeline: () => {}, refreshRun: () => {} }, startWorkerCapacity: capacity });
    return Object.freeze({ ...service, startupPending: capacity.startupPending });
  }

  const cleanup = async () => {
    const failures: unknown[] = [];
    for (const step of cleanups.splice(0).reverse()) { try { await step(); } catch (error) { failures.push(error); } }
    if (failures.length > 0) throw new AggregateError(failures, "pool fixture cleanup failed");
  };
  return { NOW, WORKFLOW, WORKER_1, MEMBER_1, openControlHarness, nextCommandId, envelope, settleMicrotasks, view, memberTarget, planWorkers, dashboardLaunch, launchCommands, cleanup };
}
