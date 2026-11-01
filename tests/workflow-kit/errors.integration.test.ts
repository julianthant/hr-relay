import { releaseSeededWriteOwners } from "../support/helpers/timeline-write-fixture.js";
import { registryWithCrmSearch } from "../support/helpers/backend/run-executor-world.js";
import { crmDriver } from "../../src/backend/systems/crm/driver-declaration.js";
import { defineTask } from "../../src/workflow-kit/task.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun, type RunExecutorDependencies, type WriteSequencerContext } from "../../src/backend/runtime/execution/run-executor.js";
import { withBoundRunConfigFingerprint } from "../../src/backend/runtime/workers/worker-sessions.js";
import { createWriteSequencer } from "../../src/backend/runtime/writes/write-sequencer.js";
import { createTimelineEmitter } from "../../src/backend/storage/events/timeline-emitter.js";
import { CrmSearchOnboardingRecords } from "../../src/models/systems/crm/search-onboarding-records.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { TaskError } from "../../src/workflow-kit/errors.js";
import { CONFIG_SNAPSHOT } from "../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, sequentialIdFactory, WORKFLOW_ID } from "../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerLifetime, testRunLifecycle, testWorkerPorts } from "../support/fixtures/run-lifecycle-fixtures.js";
import {
  buildWriteFixtureRegistry,
  createWriteFixtureWorld,
  WRITE_FIXTURE_EID,
  WRITE_FIXTURE_IMPL_FINGERPRINT,
  WRITE_FIXTURE_KEY,
  WRITE_FIXTURE_NODE_ID,
  WRITE_FIXTURE_NOW,
  WRITE_FIXTURE_WORKER_ID,
  WRITE_FIXTURE_WORKFLOW_ID,
  writeFixtureDescriptor,
  writeFixtureQueuedRun,
  writeFixtureSessionManager,
  writeFixtureSessions,
  writeFixtureTransactionNode,
} from "../support/fixtures/write-sequencer-fixtures.js";
import {
  healthyUcpathDriver,
  ManualScheduler,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../support/helpers/registered-workflows.js";
import { openBoundDatabaseFixture } from "../support/helpers/admission-fixture.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const SIGNAL = new AbortController().signal;

describe("failure, retry, and resume", () => {
  it("terminalizes a node failure with the exact structured record and authorization consequence", async () => {
    const mismatched = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: () => Object.freeze({
        system: "crm" as const,
        searchOnboardingRecords: () => Promise.reject(new TaskError(
          CrmSearchOnboardingRecords.id,
          "PERSON_LOOKUP_CRM_CHECK_FAILED",
          "CRM returned an unexpected page",
        )),
        readOnboardingDates: () => Promise.reject(new Error("unused")),
      }),
    });
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database, clock } = authority;
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(database, clock),
      descriptor: personLookupDescriptor,
      stores: registryWithCrmSearch(defineTask(crmDriver, CrmSearchOnboardingRecords, {
        sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
        async run({ input, ctx }) {
          const output = { state: "checked" as const, records: await ctx.driver.searchOnboardingRecords(input) };
          ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
          return output;
        },
      })),
      authority: database,
      sessions: await sessionManagerFor(mismatched, clock),
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
    assert.equal(run.lifecycle.outcome, "failed");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.equal(failure.nodeId, "cross-verify");
    assert.equal(failure.taskId, "crm/search-onboarding-records");
    assert.equal(failure.code, "PERSON_LOOKUP_CRM_CHECK_FAILED");
    const authorization = database.authority.runs.get(RUN_ID)?.completion;
    assert.ok(authorization && authorization.kind === "failed");
    assert.equal(run.version, authorization.expectedVersion + 1);
    assert.equal(run.claimGeneration, authorization.claim.claimGeneration);
    assert.deepEqual(mismatched.closeReasons(), ["poisoned"]);
  });
});

describe("dry-run — structurally zero intent, zero fence, zero commit", () => {
  it("executeTransaction refuses a dry-run context before any side effect", async () => {
    const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
    const opened = await openBoundDatabaseFixture("write-sequencer-test", clock);
    const database = opened.database;
    disposers.push(async () => { releaseSeededWriteOwners(database, clock.now().toISOString()); await opened.close(); });
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    testWorkerPorts(database, clock, { path: opened.path, descriptor: writeFixtureDescriptor, poolIndex: 1 });
    const world = createWriteFixtureWorld();
    const registry = buildWriteFixtureRegistry(world);
    const manager = await writeFixtureSessionManager(writeFixtureSessions(world), registry, clock);
    const sequencer = createWriteSequencer({
      lifecycle: testRunLifecycle(database, clock),
      stores: registry,
      authority: database,
      sessions: manager,
      emitter: recordingEmitter().emitter,
      clock,
      ids: sequentialIdFactory("c"),
      scheduler: new ManualScheduler(clock),
      taskDeadlineMs: 60_000,
      operator: "local-operator",
      log: recordingLogger().log,
      resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    });
    const now = clock.now().toISOString();
    const enqueued = database.authority.runs.enqueue(writeFixtureQueuedRun({ dryRun: true }));
    assert.equal(enqueued.state, "inserted");
    const claimMember2 = database.authority.workerSlots.get(WRITE_FIXTURE_WORKER_ID);
    if (claimMember2 === undefined) throw new Error("fixture-claim-member-required");
    const claimed = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WRITE_FIXTURE_WORKFLOW_ID, claimMember2.poolIndex).workerLifetime,
      workflow: WRITE_FIXTURE_WORKFLOW_ID,
      workerId: WRITE_FIXTURE_WORKER_ID,
      now,
    });
    if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
    const claim: { workerId: string; claimGeneration: number } = {
      workerId: WRITE_FIXTURE_WORKER_ID,
      claimGeneration: claimed.run.claimGeneration,
    };
    const base = { workerId: WRITE_FIXTURE_WORKER_ID, workerLifetime: testWorkerLifetime(database, WRITE_FIXTURE_WORKFLOW_ID, claimMember2.poolIndex).workerLifetime, claimedAt: now, heartbeatAt: now };
    const validating = database.authority.runs.transition({
      runId: claimed.run.envelope.runId,
      expectedVersion: claimed.run.version,
      claim,
      lifecycle: { state: "validating", ...base },
      now,
    });
    assert.equal(validating.state, "applied");
    const running = database.authority.runs.transition({
      runId: claimed.run.envelope.runId,
      expectedVersion: claimed.run.version + 1,
      claim,
      lifecycle: { state: "running", ...base, currentNodeId: WRITE_FIXTURE_NODE_ID },
      now,
    });
    if (running.state !== "applied") throw new Error("running transition failed");
    const run = running.run;
    const context: WriteSequencerContext = {
      descriptor: writeFixtureDescriptor,
      node: writeFixtureTransactionNode(writeFixtureDescriptor),
      run,
      claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } as WriteSequencerContext["claim"],
      scope: { input: { eid: WRITE_FIXTURE_EID }, outputs: {} },
      dryRun: true,
      signal: new AbortController().signal,
    };
    await assert.rejects(
      withBoundRunConfigFingerprint(manager, run.envelope.configFingerprint, () => sequencer.executeTransaction(context)),
      (error: unknown) => error instanceof TaskError && error.code === "capability-unavailable",
    );
    assert.deepEqual(world.events, []);
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY), undefined);
  });
});
