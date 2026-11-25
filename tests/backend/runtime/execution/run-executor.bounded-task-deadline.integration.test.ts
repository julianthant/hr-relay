import { testRunLifecycle, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import {
  healthyCrmDriver,
  ManualScheduler,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";
import { sequentialIdFactory, RUN_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

describe("bounded task deadline", () => {

  it("bounds a task that never settles and ignores its abort signal", async () => {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    let wedged: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      wedged = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          wedged?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const scheduler = new ManualScheduler(authority.clock, 0);
    const { database, clock } = authority;
    database.authority.runs.enqueue(personLookupQueuedRun());
    testWorkerPorts(database, clock, { path: authority.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    const member = database.authority.workerSlots.list(WORKFLOW_ID).find((slot) => slot.poolIndex === 1);
    assert.ok(member);
    const workerId = member.workerId;
    const claimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;

    const executing = executeClaimedRun({
      lifecycle: testRunLifecycle(database, authority.clock),
      descriptor: personLookupDescriptor,
      stores: taskStoreRegistry,
      authority: database,
      sessions: await sessionManagerFor(sessions, authority.clock),
      emitter: recordingEmitter().emitter,
      clock: authority.clock,
      ids: sequentialIdFactory("e"),
      scheduler,
      taskDeadlineMs: 5_000,
      log: recordingLogger().log,
    }, {
      run: claimed.run,
      claim: { workerId, claimGeneration: claimed.run.claimGeneration },
      signal: new AbortController().signal,
    });
    await started;
    const deadline = scheduler.pending()
      .find((entry) => entry.deadlineMonotonicMs === authority.clock.monotonicMs() + 5_000);
    assert.ok(deadline, "the task deadline must be armed while the task runs");
    deadline.fire();
    const outcome = await executing;
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /exceeded its immutable 5000ms task deadline/);
    assert.deepEqual(sessions.closeReasons(), ["poisoned"]);
  });
});
