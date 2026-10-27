import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import type { ExecutorSpanEvent, SpanEmitter } from "../../../../src/backend/logs/span-emitter.js";
import type { WorkerLoopDependencies } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { sequentialIdFactory, WORKFLOW_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { fixtureDuoCeremonyGates } from "../duo-ceremony-fixtures.js";
import {
  happySessionHarness,
  ManualScheduler,
  recordingLogger,
  type AuthorityHarness,
  type SessionFactoryHarness,
} from "../phase1f-executor-harness.js";
import { personLookupDescriptor } from "../registered-workflows.js";

const HEARTBEAT_INTERVAL_MS = 500;

interface LoopHarness {
  readonly deps: WorkerLoopDependencies;
  readonly sessions: SessionFactoryHarness;
  readonly events: () => readonly ExecutorSpanEvent[];
  readonly scheduler: ManualScheduler;
  readonly stop: AbortController;
}

export async function createWorkerLoopHarness(
  authority: AuthorityHarness,
  workerSuffix: string,
  idPrefix: string,
  options: Readonly<{
    sessions?: SessionFactoryHarness;
    onSpan?: () => void;
    exitWhenIdle?: boolean;
  }> = {},
): Promise<LoopHarness> {
  const sessions = options.sessions ?? happySessionHarness();
  const scheduler = new ManualScheduler(authority.clock, 0);
  const stop = new AbortController();
  const events: ExecutorSpanEvent[] = [];
  const emitter: SpanEmitter = {
    emit: (event): void => {
      events.push(event);
      options.onSpan?.();
    },
  };
  return {
    sessions,
    scheduler,
    stop,
    events: () => Object.freeze([...events]),
    deps: {
      ...testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: personLookupDescriptor, poolIndex: Number(workerSuffix) }),
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
      duoCeremony: await fixtureDuoCeremonyGates(authority.clock),
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      idleRepollMs: 1_000,
      log: recordingLogger().log,
      stopSignal: stop.signal,
      exitWhenIdle: options.exitWhenIdle ?? true,
    },
  };
}
