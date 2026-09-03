/**
 * D314 — Restart from start reruns every read and computation.
 *
 * The same logical item runs three times through the REAL interpreter over
 * one REAL authority database: attempt 1 completes, attempt 2 (Resume from
 * checkpoints) replays the UCPath search from its checkpoint, and attempt 3
 * (Restart from start, `recovery: "restart-from-start"`) executes the search
 * again — a fresh UCPath session, a fresh checkpoint under attempt 3 — while
 * the always-rerun node executes on every attempt exactly as before.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun, type RunExecutorDependencies } from "../../src/core/run-executor.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { UUID_5, UUID_7 } from "./fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, WORKER_ID, WORKFLOW_ID, sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
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
} from "./fixtures/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
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

function depsFor(authority: AuthorityHarness, sessions: ReturnType<typeof sessionFactoryHarness>): RunExecutorDependencies {
  return {
    descriptor: personLookupDescriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessions: sessionManagerFor(sessions, authority.clock),
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
  authority.database.authority.runs.enqueue(run);
  const claimed = authority.database.authority.runs.claimNext({
    workflow: WORKFLOW_ID,
    workerId: WORKER_ID,
    now: authority.clock.now().toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  const counting = countingSessions();
  const outcome = await executeClaimedRun(depsFor(authority, counting.sessions), {
    run: claimed.run,
    claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
    signal: SIGNAL,
  });
  assert.equal(outcome.state, "done");
  return { state: `searches=${String(counting.searches())} ucpath=${String(counting.sessions.opens("ucpath"))}`, runId: claimed.run.envelope.runId };
}

describe("run executor recovery choices (D314)", () => {
  it("resume replays the read checkpoint; restart executes the read again as the same item's next attempt", async () => {
    const authority = openAuthorityHarness();
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
    // Restart executed every read and computation again under attempt 3, and
    // the prior attempts' checkpoints are untouched: D301 never rewrites history.
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
