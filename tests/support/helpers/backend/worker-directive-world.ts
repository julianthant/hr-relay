import { testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { type WorkerLoopDependencies } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { sequentialIdFactory, WORKFLOW_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { fixtureDuoCeremonyGates } from "../duo-ceremony-fixtures.js";
import { EXECUTOR_WORKER_ID, happySessionHarness, ManualScheduler, openAuthorityHarness, recordingLogger, recordingTimelineEmitter, type SessionFactoryHarness } from "../phase1f-executor-harness.js";
import { personLookupDescriptor } from "../registered-workflows.js";





export function createWorkerDirectiveTestWorld() {
  const disposers: (() => void | Promise<void>)[] = [];

  async function loopHarness(options: Readonly<{
    sessions?: SessionFactoryHarness;
    heartbeatIntervalMs?: number;
    exitWhenIdle?: boolean;
  }> = {}) {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const sessions = options.sessions ?? happySessionHarness();
    const scheduler = new ManualScheduler(authority.clock, 0);
    const emitter = recordingTimelineEmitter(authority.database, authority.clock);
    const stop = new AbortController();
    const deps: WorkerLoopDependencies = {
      ...testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: personLookupDescriptor, poolIndex: 1 }),
      workflowId: WorkflowIdSchema.parse(WORKFLOW_ID),
      workerId: EXECUTOR_WORKER_ID,
      descriptor: personLookupDescriptor,
      stores: taskStoreRegistry,
      authority: authority.database,
      sessionFactory: sessions.factory,
      emitter: emitter.emitter,
      clock: authority.clock,
      ids: sequentialIdFactory("c"),
      scheduler,
      taskDeadlineMs: 60_000,
      sessionAcquireMs: 20_000,
      duoCeremony: await fixtureDuoCeremonyGates(authority.clock),
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 500,
      idleRepollMs: 1_000,
      log: recordingLogger().log,
      stopSignal: stop.signal,
      exitWhenIdle: options.exitWhenIdle ?? true,
    };
    return { authority, sessions, scheduler, emitter, stop, deps };
  }
  const cleanup = async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  };
  return { disposers, loopHarness, cleanup };
}
