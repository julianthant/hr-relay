import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { executeClaimedRun, type RunExecutorDependencies, type WriteSequencerContext } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { requireLifecycleApplied, RunLifecycleRefusedError } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWriteSequencer, WriteParkedError, type WriteSequencerHooks } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { runClaim, type RunRecord } from "../../../../src/models/run/record.js";
import { defineWorkerSessionProvider } from "../../../../src/workflow-kit/session.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { type MutationCapability } from "../../../../src/models/ui/driver.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { unusedWorkerPool } from "../../../support/helpers/backend/unused-worker-pool.js";
import { testRunLifecycle, testRunService, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import {
  absentProbeEvidence, buildWriteFixtureRegistry, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID,
  WriteFixtureCommit, writeFixtureDescriptor, writeFixtureDriverDeclaration, writeFixtureQueuedRun,
  WriteFixtureProofSchema, WriteFixtureSaveCommit, writeFixtureSaveDescriptor, writeFixtureTraversalDescriptor, type WriteFixtureDriver,
} from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, claimRunning, contextFor, intentByKey, attemptingIntentFixture, cleanup } = createWriteSequencerTestWorld();
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

function probingSequencer(h: Harness, probe: CommitProbe, hooks?: WriteSequencerHooks) {
  const stores = probingRegistry(h, probe);
  const sequencer = createWriteSequencer({
    lifecycle: testRunLifecycle(h.database, h.clock), stores, authority: h.database, sessions: h.manager,
    emitter: h.emitter.emitter, clock: h.clock, ids: h.ids, scheduler: h.scheduler, taskDeadlineMs: 60_000,
    operator: "local-operator", log: recordingLogger().log, ...(hooks === undefined ? {} : { hooks }),
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

function requestCancel(h: Harness): void {
  const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(current);
  requireLifecycleApplied(testRunService(h.database, h.clock).transition({
    commandId: randomUUID(), runId: current.envelope.runId, expectedVersion: current.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() },
  }));
}

/** A command kernel over the harness database whose worker pool accepts Stop without running anything. */
function stopKernel(h: Harness) {
  const unused = (): never => { throw new Error("unrequested worker effect"); };
  return createCommandKernel({ authority: h.database, lifecycle: testRunService(h.database, h.clock), clock: h.clock, ids: h.ids,
    appVersion: "0.1.0", descriptors: { resolve: workflow => workflow === String(WRITE_FIXTURE_WORKFLOW_ID) ? writeFixtureDescriptor : undefined },
    configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { recheck: unused, resolveAbsent: unused },
    workerRuntime: { pool: { ...unusedWorkerPool(unused), admit: async () => undefined, assertMember: () => "running", start: async () => undefined, stop: async () => undefined } } });
}

/** #165's Stop: an ordinary run Cancel on the claimed run, which sets cancelRequested while the worker keeps the claim. */
function requestStop(h: Harness): void {
  requestCancel(h);
  assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.cancelRequested, true);
}

/** Beat ⑦ rolls back as if a command changed the run version after the settle-time read. */
function rejectBeatSeven(h: Harness): WriteSequencerHooks {
  return {
    afterSequencedStep(step) {
      if (step !== "commit-write-attempt") return;
      const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
      assert.ok(current);
      throw new RunLifecycleRefusedError({ state: "refused", refusal: { reason: "conflict", currentVersion: current.version } });
    },
  };
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
      requestStop(h);
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
      workflow: WRITE_FIXTURE_WORKFLOW_ID,
      workerId: lifetime.workerId, now: h.clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("claim failed");
    return { run: claimed.run, claim: { workerId: lifetime.workerId, claimGeneration: claimed.run.claimGeneration } };
  }

  function runWhole(h: Harness, probe: CommitProbe, held: ReturnType<typeof claimOnly>,
    signal = new AbortController().signal, descriptor = writeFixtureDescriptor, hooks?: WriteSequencerHooks) {
    const { stores, sequencer, bound } = probingSequencer(h, probe, hooks);
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(h.database, h.clock), descriptor, stores,
      authority: h.database, sessions: h.manager, emitter: h.emitter.emitter, clock: h.clock, ids: h.ids,
      scheduler: h.scheduler, taskDeadlineMs: 60_000, log: recordingLogger().log, writeSequencer: sequencer,
    };
    return bound(held.run, () => executeClaimedRun(deps, { ...held, signal }));
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

  /** Admits worker Stop's run Cancel; the worker's 250 ms observer then aborts the run's work signal. */
  async function admitStop(h: Harness, workSignal: AbortController): Promise<void> {
    requestStop(h);
    workSignal.abort(new Error("worker-reset-current-work"));
    await yieldToEventLoop();
  }

  it("Stop admitted after the fence settles the save once, then cancels the run before its next step", async () => {
    const probe = createCommitProbe();
    const h = await harness();
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    const held = claimOnly(h);
    const workSignal = new AbortController();
    probe.afterClick = () => admitStop(h, workSignal);

    const outcome = await runWhole(h, probe, held, workSignal.signal, writeFixtureTraversalDescriptor);

    assert.equal(outcome.state, "abandoned");
    assert.equal(probe.signalAbortedAfterHook, false);
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(probe.calls, 1);
    assert.equal(attemptsOf(h), 1);
    assert.equal(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID).length, 1);
    const settled = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(settled?.lifecycle.state === "terminal" && settled.lifecycle.outcome === "cancelled");
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(attemptsOf(h), 1);
    assert.deepEqual(h.sessions.closeReasons(), []);
    const startedNodes = h.emitter.events().flatMap(event => event.t === "span.started" && event.kind === "task" ? [event.spanPath] : []);
    assert.ok(!startedNodes.some(path => path.includes("/second-write") || path.includes("/after-write")), JSON.stringify(startedNodes));
  });

  it("retains the real fenced sequencer callback through Stop and parent abort, then settles its save committed", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    let started: () => void = () => undefined;
    const starting = new Promise<void>(resolve => { started = resolve; });
    h.world.afterCommitClickBeforeTaskSettlement = async () => { started(); await held; };
    const parent = new AbortController();
    let settled = false;
    const execution = h.execute({ ...contextFor(run, claim), signal: parent.signal }).then(
      value => ({ value }), (error: unknown) => ({ error })).finally(() => { settled = true; });
    await starting;
    requestStop(h);
    parent.abort(new Error("controlled exact stop observer"));
    await yieldToEventLoop();
    assert.equal(settled, false);
    assert.equal(intentByKey(h.database)?.status, "attempting");
    assert.deepEqual(h.sessions.closeReasons(), []);
    release();
    const result = await execution;
    assert.ok("value" in result);
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "running");
    assert.equal(h.database.authority.runs.get(run.envelope.runId)?.cancelRequested, true);
  });

  function assertParkedUnknown(h: Harness, outcome: Awaited<ReturnType<typeof runWhole>>): void {
    assert.ok(outcome.state === "parked-write" && outcome.code === "unknown", JSON.stringify(outcome));
    const parked = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked?.lifecycle.state === "parked-write", "the run is never queued or paused over an unresolved save");
    assert.equal(parked.lifecycle.code, "unknown");
    const intents = h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID);
    assert.deepEqual(intents.map(intent => intent.status), ["parked"]);
    assert.equal(parked.lifecycle.writeIntentId, intents[0]?.writeIntentId);
    assert.equal(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, parked.envelope.itemId, "submit-write"), undefined);
  }

  function assertNothingClaimable(h: Harness, poolIndex = 1): void {
    const lifetime = testWorkerLifetime(h.database, WRITE_FIXTURE_WORKFLOW_ID, poolIndex);
    const next = h.database.authority.runs.claimNext({
      workflow: WRITE_FIXTURE_WORKFLOW_ID, workerId: lifetime.workerId, now: h.clock.now().toISOString() });
    assert.notEqual(next.state, "claimed", "no worker can retry the unresolved save");
  }

  it("a pause committed after the click, before settlement, still settles the save and then pauses", async () => {
    const probe = createCommitProbe();
    let pauseRequested = false;
    const h = await harness({ onCapture: async (boundary) => {
      if (boundary !== "after-submit" || pauseRequested) return;
      pauseRequested = true;
      requestPause(h);
    } });
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));

    const outcome = await runWhole(h, probe, claimOnly(h));

    assert.ok(pauseRequested);
    assert.equal(outcome.state, "abandoned");
    assertPausedAndQueued(h);
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(probe.calls, 1);
    assert.equal(attemptsOf(h), 1);
    assert.ok(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID,
      h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.envelope.itemId ?? "", "submit-write"));
  });

  it("a pause committed during the save plus a beat-7 rollback parks the save UNKNOWN instead of pausing", async () => {
    const probe = createCommitProbe();
    const h = await harness();
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    probe.afterClick = () => requestPause(h);

    const outcome = await runWhole(h, probe, claimOnly(h), undefined, writeFixtureDescriptor, rejectBeatSeven(h));

    assertParkedUnknown(h, outcome);
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.pause?.state, "requested",
      "the pause is never acknowledged over the unresolved save");
    assert.equal(probe.calls, 1);
    assert.equal(attemptsOf(h), 1);
    assertNothingClaimable(h);
  });

  it("row Cancel admitted during the save plus a beat-7 rollback never cancels the unresolved save", async () => {
    const probe = createCommitProbe();
    const h = await harness();
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    probe.afterClick = () => requestCancel(h);

    const outcome = await runWhole(h, probe, claimOnly(h), undefined, writeFixtureDescriptor, rejectBeatSeven(h));

    assertParkedUnknown(h, outcome);
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.cancelRequested, true);
    assert.equal(probe.calls, 1);
    assert.equal(attemptsOf(h), 1);
    assertNothingClaimable(h);
  });

  it("worker Stop admitted during the save plus a beat-7 rollback parks the save and a later Stop or Cancel keeps it parked", async () => {
    const probe = createCommitProbe();
    const h = await harness();
    h.admitWorker(2); // a second member proves no retry; pool admission is closed once Stop is pending
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    const held = claimOnly(h);
    const workSignal = new AbortController();
    probe.afterClick = () => admitStop(h, workSignal);

    const outcome = await runWhole(h, probe, held, workSignal.signal, writeFixtureDescriptor, rejectBeatSeven(h));

    assertParkedUnknown(h, outcome);
    assert.equal(probe.signalAbortedAfterHook, false);
    // #165's Stop has no reset settlement: a later Stop leaves the unclaimed parked run alone and a Cancel is refused over its parked save.
    const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(run);
    assert.equal(run.cancelRequested, true);
    assert.equal(runClaim(run), undefined);
    const kernel = stopKernel(h);
    const request = { requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard" };
    const stop = await kernel.executeWorkerPool({ ...request, commandId: randomUUID(), family: "worker-browser", type: "stop-worker",
      target: { workerId: held.claim.workerId, workflowId: WRITE_FIXTURE_WORKFLOW_ID, lifetimeId: randomUUID(), expectedVersion: 1 } });
    assert.equal(stop.state, "applied", JSON.stringify(stop));
    assert.deepEqual(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID), run);
    const cancel = kernel.execute({ ...request, commandId: randomUUID(), family: "run", type: "cancel",
      target: { runId: WRITE_FIXTURE_RUN_ID, expectedVersion: run.version } });
    assert.ok(cancel.state === "rejected" && cancel.code === "invalid-state" && cancel.message.includes("which is parked"), JSON.stringify(cancel));
    assert.deepEqual(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID), run);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assertParkedUnknown(h, outcome);
    assert.equal(probe.calls, 1);
    assert.equal(attemptsOf(h), 1);
    assertNothingClaimable(h, 2);
  });

  it("a failure before the fence under a requested pause still pauses and the step runs once after resume", async () => {
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
      throw new Error("prepare failed before the fence");
    };

    const first = await runWhole(h, probe, claimOnly(h));

    assert.equal(first.state, "abandoned");
    assertPausedAndQueued(h);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID), []);
    assert.equal(probe.calls, 0);

    const second = await runWhole(h, probe, resume(h));

    assert.equal(second.state, "done");
    assert.equal(probe.calls, 1);
    assert.equal(attemptsOf(h), 1);
  });

  it("a failure after the fence that was not parked keeps the claim instead of settling the run", async () => {
    const h = await harness();
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    const held = claimOnly(h);
    const { stores, bound } = probingSequencer(h, createCommitProbe());
    const unparked = {
      executeTransaction(): Promise<unknown> {
        const fenced = h.database.authority.writeIntents.fenceAttempt({ ...attemptingIntentFixture(WRITE_FIXTURE_RUN_ID), claim: held.claim });
        assert.equal(fenced.state, "fenced");
        return Promise.reject(new Error("synthetic failure after the fence"));
      },
      executeDryRun(): Promise<unknown> { return Promise.reject(new Error("dry run is not exercised")); },
    };
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(h.database, h.clock), descriptor: writeFixtureDescriptor, stores,
      authority: h.database, sessions: h.manager, emitter: h.emitter.emitter, clock: h.clock, ids: h.ids,
      scheduler: h.scheduler, taskDeadlineMs: 60_000, log: recordingLogger().log, writeSequencer: unparked,
    };

    await assert.rejects(bound(held.run, () => executeClaimedRun(deps, { ...held, signal: new AbortController().signal })),
      /synthetic failure after the fence/);

    const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.equal(run?.lifecycle.state, "running", "neither failed nor paused: the claim stays for recovery");
    const kept = run === undefined ? undefined : runClaim(run);
    assert.deepEqual(kept && { workerId: kept.workerId, claimGeneration: kept.claimGeneration }, held.claim);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID).map(intent => intent.status), ["attempting"]);
  });
});
