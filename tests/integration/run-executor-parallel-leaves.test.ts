import { testRunLifecycle } from "../fixtures/run-lifecycle-fixtures.js";
/**
 * D315 — a parallel entry's leaves checkpoint independently, so a failed leaf
 * retries on the item's next attempt while its successful sibling replays.
 *
 * The proof runs a definition-compiled descriptor through the REAL interpreter
 * over a REAL authority database: attempt 1 fails at the CRM leaf after the
 * UCPath leaf checkpointed; attempt 2 (D221 — the item's next attempt) opens
 * no UCPath session and re-executes exactly the failed leaf.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun, type RunExecutorDependencies } from "../../src/core/run-executor.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { taskStoreRegistry } from "../../src/backend/app/task-registry.js";
import { UUID_5 } from "../fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, WORKER_ID, sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  ManualScheduler,
  healthyCrmDriver,
  healthyUcpathDriver,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingTimelineEmitter,
  recordingLogger,
  sessionFactoryHarness,
  sessionManagerFor,
  type AuthorityHarness,
} from "../helpers/phase1f-executor-harness.js";
import {
  compileFixtureWorkflow,
  parallelLeavesWorkflow,
} from "../fixtures/workflow-definition-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;
const compiled = compileFixtureWorkflow(parallelLeavesWorkflow);
const { descriptor } = compiled;

function queuedRun(options: Readonly<{ runId?: string; attempt?: number }> = {}) {
  const run = personLookupQueuedRun(options);
  const envelope = run.envelope as Record<string, unknown>;
  envelope.workflow = String(descriptor.id);
  envelope.traceId = `${descriptor.code}-170000-3333`;
  envelope.contractFingerprint = descriptor.contractFingerprint;
  const input = run.input as { parsed: Record<string, unknown> };
  input.parsed.schemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  return run;
}

function depsFor(
  authority: AuthorityHarness,
  sessions: ReturnType<typeof sessionFactoryHarness>,
): Readonly<{ deps: RunExecutorDependencies; emitter: ReturnType<typeof recordingTimelineEmitter> }> {
  const emitter = recordingTimelineEmitter(authority.database, authority.clock);
  return {
    emitter,
    deps: {
      lifecycle: testRunLifecycle(authority.database, authority.clock),
      descriptor,
      stores: taskStoreRegistry,
      authority: authority.database,
      sessions: sessionManagerFor(sessions, authority.clock),
      emitter: emitter.emitter,
      clock: authority.clock,
      ids: sequentialIdFactory("e"),
      scheduler: new ManualScheduler(authority.clock, 0),
      taskDeadlineMs: 60_000,
      log: recordingLogger().log,
    },
  };
}

describe("parallel leaves retry independently (D315)", () => {
  it("replays the successful leaf's checkpoint and re-executes only the failed leaf on the next attempt", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database, clock } = authority;

    let ucpathSearches = 0;
    const failingCrm = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return {
          ...driver,
          searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
            ucpathSearches += 1;
            return driver.searchPersonOrg(...args);
          },
        };
      },
      crm: () => Object.freeze({
        system: "crm" as const,
        readOnboardingRecord: (): Promise<never> => Promise.reject(new Error("CRM exploded")),
        readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
      }),
    });
    database.authority.runs.enqueue(queuedRun());
    const claimed = database.authority.runs.claimNext({
      workflow: descriptor.id,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    const first = depsFor(authority, failingCrm);
    const failed = await executeClaimedRun(first.deps, {
      run: claimed.run,
      claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
      signal: SIGNAL,
    });
    assert.equal(failed.state, "failed");
    assert.equal(ucpathSearches, 1);
    // The UCPath leaf checkpointed under attempt 1 before its sibling failed.
    const searchRow = database.authority.runCheckpoints.latest(descriptor.id, claimed.run.envelope.itemId, "search");
    assert.ok(searchRow !== undefined, "the successful leaf owns a checkpoint of its own");
    assert.equal(searchRow.attempt, 1);
    assert.equal(database.authority.runCheckpoints.latest(descriptor.id, claimed.run.envelope.itemId, "verify"), undefined);

    // Attempt 2 of the same logical item — the failed leaf's independent retry.
    const retry = queuedRun({ runId: UUID_5, attempt: 2 });
    const retryEnvelope = retry.envelope as Record<string, unknown>;
    retryEnvelope.retryOf = RUN_ID;
    database.authority.runs.enqueue(retry);
    const reclaimed = database.authority.runs.claimNext({
      workflow: descriptor.id,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(reclaimed.state, "claimed");
    if (reclaimed.state !== "claimed") return;
    let ucpathSearchesRetry = 0;
    const healthy = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return {
          ...driver,
          searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
            ucpathSearchesRetry += 1;
            return driver.searchPersonOrg(...args);
          },
        };
      },
      crm: () => healthyCrmDriver(),
    });
    const second = depsFor(authority, healthy);
    const outcome = await executeClaimedRun(second.deps, {
      run: reclaimed.run,
      claim: { workerId: WORKER_ID, claimGeneration: reclaimed.run.claimGeneration },
      signal: SIGNAL,
    });
    assert.equal(outcome.state, "done");
    assert.equal(ucpathSearchesRetry, 0, "the successful leaf replays; it never re-searches");
    assert.equal(healthy.opens("ucpath"), 0);
    assert.equal(healthy.opens("crm"), 1);

    const result = database.authority.runResults.get(UUID_5);
    assert.ok(result);
    const search = result.dependencies.find((dependency) => dependency.nodeId === "search");
    const verify = result.dependencies.find((dependency) => dependency.nodeId === "verify");
    assert.ok(search?.state === "resolved" && verify?.state === "resolved");
    assert.equal(search.checkpoint.attempt, 1, "the replayed leaf cites its attempt-1 checkpoint");
    assert.equal(verify.checkpoint.attempt, 2, "the retried leaf checkpoints under attempt 2");
    assert.equal(verify.checkpoint.runId, UUID_5);
    const spans = second.emitter.events().map((event) => event.spanPath);
    assert.ok(spans.every((path) => !path.includes("/search#")), "a replayed leaf must not re-span");
    assert.ok(spans.some((path) => path.includes("/verify#")), "the retried leaf spans on attempt 2");
  });
});
