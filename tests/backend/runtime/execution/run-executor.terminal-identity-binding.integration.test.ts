import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema } from "../../../../src/backend/logs/span-emitter.js";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../../../src/backend/runtime/execution/run-executor.js";
import type { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory,WORKER_ID,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
happySessionHarness,
ManualScheduler,
openAuthorityHarness,
personLookupQueuedRun,
recordingEmitter,
recordingLogger,
sessionManagerFor,
type AuthorityHarness,
type SessionFactoryHarness
} from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const authorityHarnesses = new WeakMap<AuthorityDatabase, AuthorityHarness>();

const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface ExecutorHarness {
  readonly authority: AuthorityHarness;
  readonly sessions: SessionFactoryHarness;
  readonly manager: WorkerSessionManager;
  readonly scheduler: ManualScheduler;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly deps: RunExecutorDependencies;
}

function executorHarness(options: Readonly<{
  sessions?: SessionFactoryHarness;
  autoFireAtOrBelowMs?: number;
  taskDeadlineMs?: number;
  stores?: RunExecutorDependencies["stores"];
  descriptor?: AnyWorkflowDescriptor;
}> = {}): ExecutorHarness {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  authorityHarnesses.set(authority.database, authority);
  const sessions = options.sessions ?? happySessionHarness();
  const manager = sessionManagerFor(sessions, authority.clock);
  const scheduler = new ManualScheduler(authority.clock, options.autoFireAtOrBelowMs ?? 0);
  const emitter = {
    emitter: createTimelineEmitter({ repository: authority.database.authority.timelineEvents, clock: authority.clock }),
    events: () => authority.database.authority.timelineEvents.page({}).flatMap((record) => {
      if (record.payload.kind !== "span" || record.payload.event.t === "run.queued") return [];
      const { pid: _pid, ...event } = record.payload.event;
      return [ExecutorSpanEventSchema.parse(event)];
    }),
  };
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor: options.descriptor ?? personLookupDescriptor,
    stores: options.stores ?? taskStoreRegistry,
    authority: authority.database,
    sessions: manager,
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("b"),
    scheduler,
    taskDeadlineMs: options.taskDeadlineMs ?? 60_000,
    log: recordingLogger().log,
  };
  return { authority, sessions, manager, scheduler, emitter, deps };
}

const SIGNAL = new AbortController().signal;

describe("terminal identity binding", () => {
  it("refuses to execute a run bound to a different descriptor identity", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const run = personLookupQueuedRun();
    const envelope = run.envelope as Record<string, unknown>;
    envelope.contractFingerprint = UUID_6.replaceAll("-", "").padEnd(64, "0");
    database.authority.runs.enqueue(run);
    const claimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    await assert.rejects(
      executeClaimedRun(harness.deps, {
        run: claimed.run,
        claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
        signal: SIGNAL,
      }),
      /the worker is miswired/,
    );
  });
});
