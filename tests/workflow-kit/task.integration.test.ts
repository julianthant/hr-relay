import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createTimelineEmitter } from "../../src/backend/storage/events/timeline-emitter.js";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../src/backend/runtime/execution/run-executor.js";
import { crmDriver } from "../../src/backend/systems/crm/driver-declaration.js";
import { crmSession } from "../../src/backend/systems/crm/session-provider.js";
import { crmStore } from "../../src/backend/systems/crm/task-registry.js";
import { CrmSearchOnboardingRecords } from "../../src/models/systems/crm/search-onboarding-records.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../src/workflow-kit/task.js";
import { EXECUTABLE_SCENARIO_IDS } from "../../src/workflow-kit/validation/scenario-execution.js";
import { RUN_ID, sequentialIdFactory, WORKFLOW_ID } from "../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerLifetime, testRunLifecycle, testWorkerPorts } from "../support/fixtures/run-lifecycle-fixtures.js";
import {
  happySessionHarness,
  ManualScheduler,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingLogger,
  sessionManagerFor,
} from "../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../support/helpers/registered-workflows.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;

describe("failure, retry, and resume", () => {

  it("fails a task whose provenance does not cover its output, before any checkpoint", async () => {

    const brokenCrossVerify = defineTask(crmDriver, CrmSearchOnboardingRecords, {
      sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const records = await ctx.driver.searchOnboardingRecords(input);
        return { state: "checked" as const, records };
      },
    });
    const crmTasks = {
      ...crmStore.tasks,
      searchOnboardingRecords: brokenCrossVerify,
    };
    const brokenCrmStore = defineBrowserStore("crm", crmDriver, crmSession, crmTasks);
    const stores: (typeof taskStoreRegistry.stores)[number][] = taskStoreRegistry.stores.map((store) =>
      store.namespace === "crm" ? brokenCrmStore : store);
    const corpus = {
      scenarioIds: EXECUTABLE_SCENARIO_IDS,
      tasks: stores.flatMap((store) => Object.values(store.tasks))
        .map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
    };
    const registry = defineTaskStoreRegistry(stores, corpus);

    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database, clock } = authority;
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(database, clock),
      descriptor: personLookupDescriptor,
      stores: registry,
      authority: database,
      sessions: await sessionManagerFor(happySessionHarness(), clock),
      emitter: createTimelineEmitter({ repository: database.authority.timelineEvents, clock }),
      clock,
      ids: sequentialIdFactory("b"),
      scheduler: new ManualScheduler(clock, 0),
      taskDeadlineMs: 60_000,
      log: recordingLogger().log,
    };
    const now = clock.now().toISOString();
    testWorkerPorts(database, clock, { path: authority.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    const slot = database.authority.workerSlots.list(WORKFLOW_ID).find(slot => slot.poolIndex === 1 && slot.retiredAt === null);
    if (slot === undefined) throw new Error("executor-fixture-worker-missing");
    database.authority.runs.enqueue(personLookupQueuedRun());
    const claimMember1 = database.authority.workerSlots.get(slot.workerId);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const claimed = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember1.poolIndex).workerLifetime, workflow: WORKFLOW_ID, workerId: slot.workerId, now });
    if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
    const claim = { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration };
    const outcome = await executeClaimedRun(deps, { run: claimed.run, claim, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /recorded no provenance points/);

    assert.equal(
      database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "cross-verify"),
      undefined,
    );
  });
});
