import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { executeClaimedRun,type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
compileFixtureWorkflow,
parallelLeavesWorkflow,
} from "../../../support/fixtures/workflow-definition-fixtures.js";
import {
ManualScheduler,
healthyCrmDriver,
healthyUcpathDriver,
openAuthorityHarness,
personLookupQueuedRun,
recordingLogger,
recordingTimelineEmitter,
sessionFactoryHarness,
sessionManagerFor,
type AuthorityHarness,
} from "../../../support/helpers/phase1f-executor-harness.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
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
    envelope.descriptorVersion = descriptor.version;
  const input = run.input as { parsed: Record<string, unknown> };
  input.parsed.schemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  return run;
}

async function depsFor(
  authority: AuthorityHarness,
  sessions: ReturnType<typeof sessionFactoryHarness>,
): Promise<Readonly<{ deps: RunExecutorDependencies; emitter: ReturnType<typeof recordingTimelineEmitter> }>> {
  const emitter = recordingTimelineEmitter(authority.database, authority.clock);
  return {
    emitter,
    deps: {
      lifecycle: testRunLifecycle(authority.database, authority.clock),
      descriptor,
      stores: taskStoreRegistry,
      authority: authority.database,
      sessions: await sessionManagerFor(sessions, authority.clock),
      emitter: emitter.emitter,
      clock: authority.clock,
      ids: sequentialIdFactory("e"),
      scheduler: new ManualScheduler(authority.clock, 0),
      taskDeadlineMs: 60_000,
      log: recordingLogger().log,
    },
  };
}

describe("parallel leaves retry independently", () => {
  it("replays the successful leaf's checkpoint and re-executes only the failed leaf on the next attempt", async () => {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database, clock } = authority;
    const { workerId, workerLifetime } = testAdmittedWorker(database, clock, {
      path: authority.path, workflow: descriptor.id, poolIndex: 1, browserSystems: ["ucpath", "crm"],
    });

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
      workerLifetime, workflow: descriptor.id,
      workerId: workerId,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    const first = await depsFor(authority, failingCrm);
    const failed = await executeClaimedRun(first.deps, {
      run: claimed.run,
      claim: { workerId: workerId, claimGeneration: claimed.run.claimGeneration },
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
      workerLifetime, workflow: descriptor.id,
      workerId: workerId,
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
    const second = await depsFor(authority, healthy);
    const outcome = await executeClaimedRun(second.deps, {
      run: reclaimed.run,
      claim: { workerId: workerId, claimGeneration: reclaimed.run.claimGeneration },
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
