import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { executeClaimedRun,type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { UUID_5,UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID,WORKFLOW_ID,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
ManualScheduler,
healthyCrmDriver,
healthyUcpathDriver,
openAuthorityHarness,
personLookupQueuedRun,
recordingEmitter,
recordingLogger,
sessionFactoryHarness,
sessionManagerFor,
type AuthorityHarness,
} from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});
const SIGNAL = new AbortController().signal;

function countingSessions() {
  let searches = 0;
  const sessions = sessionFactoryHarness({
    ucpath: () => {
      const driver = healthyUcpathDriver();
      return {
        ...driver,
        searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
          searches += 1;
          return driver.searchPersonOrg(...args);
        },
      };
    },
    crm: () => healthyCrmDriver(),
  });
  return { sessions, searches: () => searches };
}

/** One id factory across every attempt: durable outbox/authorization ids must not collide. */
const ids = sequentialIdFactory("e");

async function depsFor(authority: AuthorityHarness, sessions: ReturnType<typeof sessionFactoryHarness>): Promise<RunExecutorDependencies> {
  return {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor: personLookupDescriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessions: await sessionManagerFor(sessions, authority.clock),
    emitter: recordingEmitter().emitter,
    clock: authority.clock,
    ids,
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
  };
}

async function runAttempt(
  authority: AuthorityHarness,
  run: Record<string, unknown>,
): Promise<{ state: string; runId: string }> {
  const { workerId, workerLifetime } = testAdmittedWorker(authority.database, authority.clock, {
    path: authority.path, workflow: WORKFLOW_ID, poolIndex: 1, browserSystems: ["ucpath", "crm"],
  });
  authority.database.authority.runs.enqueue(run);
  const claimed = authority.database.authority.runs.claimNext({
    workerLifetime, workflow: WORKFLOW_ID,
    workerId: workerId,
    now: authority.clock.now().toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  const counting = countingSessions();
  const outcome = await executeClaimedRun(await depsFor(authority, counting.sessions), {
    run: claimed.run,
    claim: { workerId: workerId, claimGeneration: claimed.run.claimGeneration },
    signal: SIGNAL,
  });
  assert.equal(outcome.state, "done");
  return { state: `searches=${String(counting.searches())} ucpath=${String(counting.sessions.opens("ucpath"))}`, runId: claimed.run.envelope.runId };
}

describe("run executor recovery choices", () => {
  it("resume replays the read checkpoint; restart executes the read again as the same item's next attempt", async () => {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database } = authority;

    const first = await runAttempt(authority, personLookupQueuedRun());
    assert.equal(first.state, "searches=1 ucpath=1");

    // Attempt 2 — Resume from checkpoints: the search replays, no UCPath session opens.
    const resume = personLookupQueuedRun({ runId: UUID_5, attempt: 2 });
    (resume.envelope as Record<string, unknown>).retryOf = RUN_ID;
    const second = await runAttempt(authority, resume);
    assert.equal(second.state, "searches=0 ucpath=0");
    const itemId = (resume.envelope as { itemId: string }).itemId;
    const attemptsOf = (nodeId: string): readonly number[] => database.authority.runCheckpoints
      .listByItem(WORKFLOW_ID, itemId)
      .filter((row) => row.nodeId === nodeId)
      .map((row) => row.attempt)
      .toSorted();
    // Resume replayed the reads (no attempt-2 row) and re-executed the always-rerun fold.
    assert.deepEqual(attemptsOf("searching"), [1]);
    assert.deepEqual(attemptsOf("cross-verify"), [1]);
    assert.deepEqual(attemptsOf("active-status"), [1, 2]);

    // Attempt 3 — Restart from start: the search executes again under attempt 3.
    const restart = personLookupQueuedRun({ runId: UUID_7, attempt: 3 });
    const envelope = restart.envelope as Record<string, unknown>;
    envelope.retryOf = UUID_5;
    envelope.recovery = "restart-from-start";
    const third = await runAttempt(authority, restart);
    assert.equal(third.state, "searches=1 ucpath=1");

    assert.deepEqual(attemptsOf("searching"), [1, 3]);
    assert.deepEqual(attemptsOf("cross-verify"), [1, 3]);
    assert.deepEqual(attemptsOf("active-status"), [1, 2, 3]);
    const restartRows = database.authority.runCheckpoints.listByItem(WORKFLOW_ID, itemId).filter((row) => row.attempt === 3);
    assert.ok(restartRows.every((row) => row.runId === UUID_7), "every attempt-3 row was produced by the restart run");
    const result = database.authority.runResults.get(UUID_7);
    assert.ok(result);
    const activeStatus = result.dependencies.find((candidate) => candidate.nodeId === "active-status");
    assert.equal(activeStatus?.state, "resolved");
    assert.equal(activeStatus?.state === "resolved" ? activeStatus.checkpoint.attempt : undefined, 3);
  });
});
