import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { executeClaimedRun, type RunExecutorDependencies, type WriteSequencerContext } from "../../../../src/backend/runtime/execution/run-executor.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWriteSequencer, WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { type RunRecord } from "../../../../src/models/run/record.js";
import { defineWorkerSessionProvider } from "../../../../src/workflow-kit/session.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { type MutationCapability } from "../../../../src/models/ui/driver.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { testRunLifecycle, testRunService, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import {
  absentProbeEvidence, buildWriteFixtureRegistry, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID,
  WriteFixtureCommit, writeFixtureDescriptor, writeFixtureDriverDeclaration, writeFixtureQueuedRun,
  WriteFixtureProofSchema, WriteFixtureSaveCommit, writeFixtureSaveDescriptor, type WriteFixtureDriver,
} from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

type Harness = Awaited<ReturnType<typeof harness>>;

interface CommitCtx {
  readonly signal: AbortSignal;
  readonly driver: WriteFixtureDriver;
  readonly mutation: MutationCapability;
  recordData(point: { direction: "write"; field: string; value: string }): void;
}

/** Records what the commit callback saw; `afterClick` runs between the click and the callback's return. */
function createCommitProbe() {
  return {
    calls: 0,
    signalAbortedAfterHook: undefined as boolean | undefined,
    afterClick: undefined as (() => Promise<void> | void) | undefined,
    captureBoundaries: [] as (string | undefined)[],
  };
}
type CommitProbe = ReturnType<typeof createCommitProbe>;

async function commitBody(h: Harness, probe: CommitProbe, ctx: CommitCtx) {
  probe.calls += 1;
  await ctx.driver.commit("ucpath.write-fixture.save-submit", ctx.mutation);
  await probe.afterClick?.();
  probe.signalAbortedAfterHook = ctx.signal.aborted;
  const proof = WriteFixtureProofSchema.parse(h.world.commitOutput);
  ctx.recordData({ direction: "write", field: "transactionId", value: proof.transactionId });
  return proof;
}

const sessionProvider = defineWorkerSessionProvider("ucpath");

/** The fixture registry with both commit tasks replaced by probing copies of the same behaviour. */
function probingRegistry(h: Harness, probe: CommitProbe) {
  const base = buildWriteFixtureRegistry(h.world);
  const sessions = [{ system: "ucpath", access: "transaction", session: "reuse-worker" }] as const;
  const replacements = {
    submitWriteFixture: defineTask(writeFixtureDriverDeclaration, WriteFixtureCommit, {
      sessions, async run({ ctx }) { return commitBody(h, probe, ctx); },
    }),
    saveWriteFixture: defineTask(writeFixtureDriverDeclaration, WriteFixtureSaveCommit, {
      sessions, async run({ ctx }) { return commitBody(h, probe, ctx); },
    }),
  };
  const stores = base.stores.map((store) => {
    if (store.namespace !== "ucpath") return store;
    const tasks = (store as unknown as { tasks: Record<string, never> }).tasks;
    return defineBrowserStore("ucpath", writeFixtureDriverDeclaration, sessionProvider,
      { ...tasks, ...replacements } as unknown as Record<string, never>);
  });
  return defineTaskStoreRegistry(stores, base.corpus);
}

function probingSequencer(h: Harness, probe: CommitProbe) {
  const stores = probingRegistry(h, probe);
  const sequencer = createWriteSequencer({
    lifecycle: testRunLifecycle(h.database, h.clock), stores, authority: h.database, sessions: h.manager,
    emitter: h.emitter.emitter, clock: h.clock, ids: h.ids, scheduler: h.scheduler, taskDeadlineMs: 60_000,
    operator: "local-operator", log: recordingLogger().log,
  });
  const bound = <Result>(run: RunRecord, work: () => Promise<Result>): Promise<Result> =>
    withBoundRunConfigFingerprint(h.manager, run.envelope.configFingerprint, work, "headless",
      { runId: run.envelope.runId, descriptorFingerprint: run.envelope.contractFingerprint });
  return {
    stores,
    sequencer,
    bound,
    execute: (context: WriteSequencerContext) => bound(context.run, () => sequencer.executeTransaction(context)),
  };
}

function requestPause(h: Harness): void {
  const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(current);
  requireLifecycleApplied(testRunService(h.database, h.clock).pause({
    commandId: randomUUID(), runId: current.envelope.runId, expectedVersion: current.version,
  }));
}

function attemptsOf(h: Harness): number {
  return h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID)
    .flatMap((intent) => h.database.authority.writeAttempts.listByIntent(intent.writeIntentId)).length;
}

const CommittedOutcome = z.looseObject({ disposition: z.literal("committed") });

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("pause and stop never reach a fenced write", () => {
  it("a parent abort after the fence never reaches the commit and the write settles committed", async () => {
    const probe = createCommitProbe();
    const h = await harness({ onCapture: async (boundary) => { probe.captureBoundaries.push(boundary); } });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    const parent = new AbortController();
    probe.afterClick = async () => {
      parent.abort(new Error("operator paused while the save was in flight"));
      await yieldToEventLoop();
    };
    const { execute } = probingSequencer(h, probe);

    const outcome = CommittedOutcome.parse(await execute({ ...contextFor(run, claim), signal: parent.signal }));

    assert.equal(outcome.disposition, "committed");
    assert.equal(probe.signalAbortedAfterHook, false, "the commit callback's ctx.signal never aborts after the fence");
    assert.equal(probe.calls, 1);
    assert.ok(probe.captureBoundaries.includes("after-submit"), "the after-submit capture still runs");
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(attemptsOf(h), 1);
    assert.notEqual(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.deepEqual(h.sessions.closeReasons(), []);
  });

  it("a stop after the fence settles the save, never UNKNOWN", async () => {
    const probe = createCommitProbe();
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });
    const parent = new AbortController();
    probe.afterClick = async () => {
      parent.abort(new Error("worker-reset-current-work"));
      await yieldToEventLoop();
    };
    const { execute } = probingSequencer(h, probe);

    const outcome = CommittedOutcome.parse(
      await execute({ ...contextFor(run, claim, writeFixtureSaveDescriptor), signal: parent.signal }),
    );

    assert.equal(outcome.disposition, "committed");
    assert.equal(probe.calls, 1);
    assert.equal(probe.signalAbortedAfterHook, false);
    assert.ok(h.world.events.includes("verify"), "the saved-effect verification still runs");
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(attemptsOf(h), 1);
    assert.notEqual(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("a pause requested before the fence refuses the fence atomically", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    h.world.onPrepare = () => requestPause(h);

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(!(error instanceof WriteParkedError), "a refused fence is not a parked write");
        return true;
      },
    );

    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.pause?.state, "requested");
    assert.deepEqual(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID), []);
    assert.equal(attemptsOf(h), 0);
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, 0);
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "running");
  });
});

describe("pause around a transaction node in a whole claimed run", () => {
  function claimOnly(h: Harness) {
    const lifetime = testWorkerLifetime(h.database, WRITE_FIXTURE_WORKFLOW_ID, 1);
    const claimed = h.database.authority.runs.claimNext({
      workerLifetime: lifetime.workerLifetime, workflow: WRITE_FIXTURE_WORKFLOW_ID,
      workerId: lifetime.workerId, now: h.clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("claim failed");
    return { run: claimed.run, claim: { workerId: lifetime.workerId, claimGeneration: claimed.run.claimGeneration } };
  }

  function runWhole(h: Harness, probe: CommitProbe, held: ReturnType<typeof claimOnly>) {
    const { stores, sequencer, bound } = probingSequencer(h, probe);
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(h.database, h.clock), descriptor: writeFixtureDescriptor, stores,
      authority: h.database, sessions: h.manager, emitter: h.emitter.emitter, clock: h.clock, ids: h.ids,
      scheduler: h.scheduler, taskDeadlineMs: 60_000, log: recordingLogger().log, writeSequencer: sequencer,
    };
    return bound(held.run, () => executeClaimedRun(deps, { ...held, signal: new AbortController().signal }));
  }

  function resume(h: Harness) {
    const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(current && current.pause?.state === "paused");
    requireLifecycleApplied(testRunService(h.database, h.clock).resumePaused({
      commandId: randomUUID(), runId: current.envelope.runId, expectedVersion: current.version,
    }));
    return claimOnly(h);
  }

  function assertPausedAndQueued(h: Harness): void {
    const paused = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(paused);
    assert.equal(paused.lifecycle.state, "queued");
    assert.equal(paused.pause?.state, "paused");
  }

  it("pause after the fence pauses after the transaction node", async () => {
    const probe = createCommitProbe();
    const h = await harness();
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    probe.afterClick = () => requestPause(h);

    const first = await runWhole(h, probe, claimOnly(h));

    assert.equal(first.state, "abandoned");
    assertPausedAndQueued(h);
    assert.equal(probe.signalAbortedAfterHook, false);
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(probe.calls, 1);
    assert.equal(attemptsOf(h), 1);
    assert.ok(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID,
      h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.envelope.itemId ?? "", "submit-write"),
      "the settled transaction is checkpointed before the pause is acknowledged");

    const second = await runWhole(h, probe, resume(h));

    assert.equal(second.state, "done");
    assert.equal(probe.calls, 1, "Resume reuses the settled transaction: no second commit");
    assert.equal(attemptsOf(h), 1, "Resume opens no second write attempt");
    assert.equal(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID).length, 1);
    assert.equal(h.world.events.filter((event) => event === "probe").length, 1, "Resume runs no second probe");
  });

  it("pause during prepare pauses instead of failing and the transaction runs once after resume", async () => {
    const probe = createCommitProbe();
    const h = await harness();
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    h.world.probeResults.push(
      absentProbeEvidence(h.clock.now().toISOString()),
      absentProbeEvidence(h.clock.now().toISOString()),
    );
    h.world.onPrepare = () => {
      h.world.onPrepare = undefined;
      requestPause(h);
    };

    const first = await runWhole(h, probe, claimOnly(h));

    assert.equal(first.state, "abandoned", "a refused fence under a requested pause is a pause, not a failure");
    assertPausedAndQueued(h);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID), []);
    assert.equal(probe.calls, 0);

    const second = await runWhole(h, probe, resume(h));

    assert.equal(second.state, "done");
    assert.equal(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID).length, 1);
    assert.equal(attemptsOf(h), 1);
    assert.equal(probe.calls, 1);
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, 1);
  });
});

