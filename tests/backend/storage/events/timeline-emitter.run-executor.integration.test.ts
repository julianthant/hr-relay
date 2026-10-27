import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { crmDriver } from "../../../../src/backend/systems/crm/driver-declaration.js";
import { CrmSearchOnboardingRecords } from "../../../../src/models/systems/crm/search-onboarding-records.js";
import { registryWithCrmSearch, createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("failure, retry, and resume", () => {

  it("replays compatible checkpoints on a cross-run retry and re-executes always-rerun nodes", async () => {
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
        searchOnboardingRecords: (): Promise<never> => Promise.reject(new Error("CRM exploded")),
        readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
      }),
    });
    const failingSearch = defineTask(crmDriver, CrmSearchOnboardingRecords, {
      sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const output = { state: "checked" as const, records: await ctx.driver.searchOnboardingRecords(input) };
        ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
        return output;
      },
    });
    const first = await executorHarness({ sessions: failingCrm, stores: registryWithCrmSearch(failingSearch) });
    const { database, clock } = first.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const failed = await executeClaimedRun(first.deps, { ...claimed, signal: SIGNAL });
    assert.equal(failed.state, "failed");
    assert.equal(ucpathSearches, 1);


    const retryRun = personLookupQueuedRun({ runId: UUID_5, attempt: 2 });
    const retryEnvelope = retryRun.envelope as Record<string, unknown>;
    retryEnvelope.runId = UUID_5;
    retryEnvelope.retryOf = RUN_ID;
    database.authority.runs.enqueue(retryRun);
    const { workerId, workerLifetime } = testWorkerLifetime(database, WORKFLOW_ID, 1);
    const reclaimed = database.authority.runs.claimNext({
      workerLifetime, workflow: WORKFLOW_ID,
      workerId: workerId,
      now: clock.now().toISOString(),
    });
    assert.equal(reclaimed.state, "claimed");
    if (reclaimed.state !== "claimed") return;

    let ucpathSearchesRetry = 0;
    const healthySessions = sessionFactoryHarness({
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
    const second = await executorHarness({ sessions: healthySessions });
    // Reuse the FIRST authority database — the checkpoints live there.
    const secondDeps: RunExecutorDependencies = {
      ...second.deps,
      lifecycle: testRunLifecycle(database, clock),
      authority: database,
      emitter: createTimelineEmitter({ repository: database.authority.timelineEvents, clock }),
      clock,
    };
    const outcome = await executeClaimedRun(secondDeps, {
      run: reclaimed.run,
      claim: { workerId: workerId, claimGeneration: reclaimed.run.claimGeneration },
      signal: SIGNAL,
    });
    assert.equal(outcome.state, "done");
    // `searching` replayed from its checkpoint — zero new UCPath searches —
    // while `active-status` (always-rerun) executed fresh.
    assert.equal(ucpathSearchesRetry, 0);
    assert.equal(healthySessions.opens("ucpath"), 0);
    assert.equal(healthySessions.opens("crm"), 1);

    const result = database.authority.runResults.get(UUID_5);
    assert.ok(result);
    const active = result.dependencies.find((dependency) => dependency.nodeId === "active-status");
    assert.ok(active?.state === "resolved");

    assert.equal(active.checkpoint.runId, UUID_5);
    const replay = database.authority.timelineEvents.page({ runId: UUID_5 }).filter((event) => event.payload.kind === "checkpoint-replayed");
    assert.ok(replay.some((event) => event.payload.kind === "checkpoint-replayed"
      && event.payload.checkpoint.nodeId === "searching" && event.payload.checkpoint.runId === RUN_ID
      && event.payload.runId === UUID_5 && event.payload.attempt === 2));
    const spans = database.authority.timelineEvents.page({ runId: UUID_5 }).flatMap((record) =>
      record.payload.kind === "span" ? [record.payload.event.spanPath] : []);
    assert.ok(spans.every((path) => !path.includes("/searching#")), "replayed searching must not re-span");
  });
});
