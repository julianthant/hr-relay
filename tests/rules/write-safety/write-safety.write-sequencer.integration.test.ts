import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunLifecycle,testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import type { WriteSequencerContext } from "../../../src/backend/runtime/execution/run-executor.js";
import { withBoundRunConfigFingerprint,type WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import {
createWriteSequencer,
type ProductionWriteSequencer,
type TransactionDryRunPreview,
type WriteSequencerHooks
} from "../../../src/backend/runtime/writes/write-sequencer.js";
import { type RunRecord } from "../../../src/models/run/record.js";
import { manualClock,type TestClock } from "../../../src/rules/time/clock.js";
import {
WriteSafetyAuthorityError
} from "../../../src/rules/write-safety/write-safety.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import {
absentProbeEvidence,
ambiguousProbeVerdict,
buildWriteFixtureRegistry,
createWriteFixtureWorld,
unknownProbeVerdict,
WRITE_FIXTURE_EID,
WRITE_FIXTURE_IMPL_FINGERPRINT,
WRITE_FIXTURE_KEY,
WRITE_FIXTURE_NODE_ID,
WRITE_FIXTURE_NOW,
WRITE_FIXTURE_RUN_ID,
WRITE_FIXTURE_WORKER_ID,
WRITE_FIXTURE_WORKFLOW_ID,
writeFixtureDescriptor,
writeFixtureQueuedRun,
writeFixtureSessionManager,
writeFixtureSessions,
writeFixtureTransactionNode,
type WriteFixtureWorld
} from "../../support/fixtures/write-sequencer-fixtures.js";
import { ManualScheduler,recordingEmitter,recordingLogger } from "../../support/helpers/phase1f-executor-harness.js";
import {
AuthorityDatabase,
type AuthorityWriteCommitHooks
} from "../../support/helpers/synthetic-storage-admission.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface Harness {
  readonly world: WriteFixtureWorld;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly manager: WorkerSessionManager;
  readonly sessions: ReturnType<typeof writeFixtureSessions>;
  readonly scheduler: ManualScheduler;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly sequencer: ProductionWriteSequencer;
  // Bind the immutable run fingerprint as the worker loop does before entering the sequencer.
  readonly execute: (context: WriteSequencerContext) => Promise<unknown>;
  readonly executeDryRun: (context: WriteSequencerContext) => Promise<TransactionDryRunPreview>;
}

function harness(options: Readonly<{
  hooks?: WriteSequencerHooks;
  commitHooks?: AuthorityWriteCommitHooks;
  emitterThrowsOn?: "data.observed" | "failed-task-span" | "transaction.fenced" | "verify-start";
}> = {}): Harness {
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-write-sequencer-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "write-sequencer-test" },
    clock,
    options.commitHooks,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  testWorkerPorts(database, clock, { path: join(root, "authority.sqlite"), descriptor: writeFixtureDescriptor, poolIndex: 1 });
  const world = createWriteFixtureWorld();
  const registry = buildWriteFixtureRegistry(world);
  const sessions = writeFixtureSessions(world);
  const manager = writeFixtureSessionManager(sessions, registry, clock);
  const emitter = recordingEmitter();
  const spanSink = {
    emit(event: Parameters<typeof emitter.emitter.emit>[0]): void {
      const throwOnFailedTaskSpan = options.emitterThrowsOn === "failed-task-span"
        && event.t === "span.ended"
        && event.kind === "task"
        && event.outcome === "failed";
      const throwOnVerifyStart = options.emitterThrowsOn === "verify-start"
        && event.t === "span.started"
        && event.kind === "task"
        && event.spanPath.endsWith("/verify");
      const throwOnEventArm = options.emitterThrowsOn !== undefined
        && options.emitterThrowsOn !== "failed-task-span"
        && options.emitterThrowsOn !== "verify-start"
        && event.t === options.emitterThrowsOn;
      if (throwOnEventArm || throwOnFailedTaskSpan || throwOnVerifyStart) {
        const failureArm = throwOnFailedTaskSpan
          ? "failed-task-span"
          : throwOnVerifyStart ? "verify-start" : event.t;
        world.events.push(`emitter-throw:${failureArm}`);
        throw new Error(`injected ${failureArm} writer failure`);
      }
      emitter.emitter.emit(event);
    },
  };
  const ids = sequentialIdFactory("c");
  const scheduler = new ManualScheduler(clock);
  const sequencer = createWriteSequencer({
    lifecycle: testRunLifecycle(database, clock),
    stores: registry,
    authority: database,
    sessions: manager,
    emitter: spanSink,
    clock,
    ids,
    scheduler,
    taskDeadlineMs: 60_000,
    operator: "local-operator",
    log: recordingLogger().log,
    resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  });
  const execute = (context: WriteSequencerContext): Promise<unknown> =>
    withBoundRunConfigFingerprint(
      manager,
      context.run.envelope.configFingerprint,
      () => sequencer.executeTransaction(context),
    );
  const executeDryRun = (context: WriteSequencerContext): Promise<TransactionDryRunPreview> =>
    withBoundRunConfigFingerprint(
      manager,
      context.run.envelope.configFingerprint,
      () => sequencer.executeDryRun(context),
    );
  return { world, database, clock, manager, sessions, scheduler, emitter, ids, sequencer, execute, executeDryRun };
}

function claimRunning(
  database: AuthorityDatabase,
  clock: TestClock,
  runInput: Record<string, unknown> = writeFixtureQueuedRun(),
  workerId: string = WRITE_FIXTURE_WORKER_ID,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const now = clock.now().toISOString();
  const enqueued = database.authority.runs.enqueue(runInput);
  assert.equal(enqueued.state, "inserted");
  const claimed = database.authority.runs.claimNext({
    workflow: WRITE_FIXTURE_WORKFLOW_ID,
    workerId,
    now,
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const base = { workerId, claimedAt: now, heartbeatAt: now };
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
  return { run: running.run, claim };
}

function contextFor(
  run: RunRecord,
  claim: { workerId: string; claimGeneration: number },
  descriptor: AnyWorkflowDescriptor = writeFixtureDescriptor,
  dryRun = false,
): WriteSequencerContext {
  return {
    descriptor,
    node: writeFixtureTransactionNode(descriptor),
    run,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } as WriteSequencerContext["claim"],
    scope: { input: { eid: WRITE_FIXTURE_EID }, outputs: {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

function intentByKey(database: AuthorityDatabase) {
  return database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
}

describe("the seven-beat happy path", () => {

  it("keeps a probe observation emitted when that task throws later", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.probeThrowsAfterRecord = new Error("probe failed after observing the page");

    await assert.rejects(h.execute(contextFor(run, claim)), (error: unknown) => {
      assert.ok(error instanceof WriteSafetyAuthorityError);
      assert.equal(error.authorityReason.code, "prewrite-probe-exception");
      assert.doesNotMatch(error.message, /probe failed after observing the page/u);
      assert.equal(error.cause, h.world.probeThrowsAfterRecord);
      return true;
    });

    assert.deepEqual(h.emitter.events().map((event) => [
      event.t,
      "outcome" in event ? event.outcome : "",
    ]), [
      ["span.started", ""],
      ["data.observed", ""],
      ["span.ended", "failed"],
    ]);
    assert.equal(intentByKey(h.database), undefined, "a pre-fence throw creates no intent");
  });

  it("preserves a probe task error first when its failed-span writer also throws", async () => {
    const h = harness({ emitterThrowsOn: "failed-task-span" });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.probeThrowsAfterRecord = new Error("PRIMARY_PROBE_TASK_FAILURE");

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.ok(error.cause instanceof AggregateError);
        assert.equal(error.cause.cause, h.world.probeThrowsAfterRecord);
        assert.deepEqual(
          error.cause.errors.map((entry: unknown) => entry instanceof Error ? entry.message : String(entry)),
          ["PRIMARY_PROBE_TASK_FAILURE", "injected failed-task-span writer failure"],
        );
        return true;
      },
    );

    assert.equal(intentByKey(h.database), undefined);
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));
  });

  it("fails an undeclared transaction observation by task and field before staging", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.recordUndeclaredProbeField = true;

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.ok(error.cause instanceof z.ZodError);
        assert.match(
          error.cause.message,
          /no declared evidence classification.*ucpath\/read-write-fixture-probe.*undeclaredProbeField/u,
        );
        assert.doesNotMatch(error.message, /undeclaredProbeField/u);
        return true;
      },
    );

    assert.deepEqual(h.world.events, ["probe"]);
    assert.equal(
      h.emitter.events().filter((event) => event.t === "data.observed").length,
      1,
      "the earlier valid batch remains; the undeclared batch emits nothing",
    );
    assert.equal(intentByKey(h.database), undefined);
  });
});

describe("beat ① — pre-fence probe indeterminacy refuses loudly", () => {
  for (const [verdict, expected] of [
    [ambiguousProbeVerdict(WRITE_FIXTURE_NOW), /found 2 matches/],
    [unknownProbeVerdict(WRITE_FIXTURE_NOW), /is indeterminate; refusing to fence or click/],
  ] as const) {
    it(`${verdict.state} means no fence and no click`, async () => {
      const h = harness();
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(verdict);
      await assert.rejects(h.execute(contextFor(run, claim)), (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.equal(
          error.authorityReason.code,
          verdict.state === "ambiguous" ? "prewrite-probe-ambiguous" : "prewrite-probe-unknown",
        );
        assert.match(String(error), expected);
        assert.doesNotMatch(String(error), /grid did not render/u);
        return true;
      });
      assert.equal(intentByKey(h.database), undefined);
      assert.deepEqual(h.world.events, ["probe"]);
    });
  }

  it("a throwing pre-write probe preserves classified authority evidence without fencing", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(new Error("UCPath grid exposed 10001573 before it failed"));
    await assert.rejects(h.execute(contextFor(run, claim)), (error: unknown) => {
      assert.ok(error instanceof WriteSafetyAuthorityError);
      assert.equal(error.authorityReason.code, "prewrite-probe-exception");
      assert.equal(error.authorityReason.evidence.kind, "exception");
      assert.doesNotMatch(error.message, /10001573/u);
      return true;
    });
    assert.equal(intentByKey(h.database), undefined);
  });
});

describe("dry-run — structurally zero intent, zero fence, zero commit", () => {

  it("identifies a refused preview by safe key digest without exposing the person identifier", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    h.world.probeResults.push(unknownProbeVerdict(WRITE_FIXTURE_NOW));

    await assert.rejects(
      h.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.equal(error.authorityReason.code, "preview-probe-unknown");
        assert.equal(error.authorityReason.evidence.kind, "probe");
        assert.match(error.message, /key digest a6409bc35921…/u);
        assert.doesNotMatch(error.message, /10812345|2345/u);
        assert.doesNotMatch(error.message, /grid did not render/u);
        return true;
      },
    );
  });
});

describe("a driver lease without the claimed run's bound fingerprint refuses", () => {
  it("refuses the probe lease loudly: no browser, no fence, no click, nothing settled", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    // Call outside the binding window to probe the real session-manager refusal.
    await assert.rejects(
      h.sequencer.executeTransaction(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /driver lease requires the claimed run's bound config fingerprint; none is bound/);
        return true;
      },
    );
    assert.deepEqual(h.world.events, [], "no probe, prepare, observation, or click ran");
    assert.equal(intentByKey(h.database), undefined, "no fence");
    const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.equal(current?.lifecycle.state, "running", "a pre-lease precondition refusal leaves settlement to the interpreter");
  });

  it("refuses executeDryRun's staging lease the same way — the preview arm is not an escape hatch", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    await assert.rejects(
      h.sequencer.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /driver lease requires the claimed run's bound config fingerprint; none is bound/);
        return true;
      },
    );
    assert.deepEqual(h.world.events, [], "no prepare or observation ran");
  });
});
