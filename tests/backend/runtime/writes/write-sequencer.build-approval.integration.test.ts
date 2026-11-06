import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it, vi } from "vitest";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService, runContinuationPort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
  WRITE_FIXTURE_NODE_ID,
  WRITE_FIXTURE_RUN_ID,
  WRITE_FIXTURE_WORKFLOW_ID,
  writeFixtureDescriptor,
  writeFixtureDescriptorWithMovedKeySameContract,
  writeFixtureQueuedRun,
  writeFixtureTraversalDescriptor,
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";

const build = vi.hoisted(() => ({ id: "a".repeat(64) }));
vi.mock("../../../../src/backend/app/build-id.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../src/backend/app/build-id.js")>(),
  currentBuildId: () => build.id,
}));

const BUILD_X = "a".repeat(64);
const BUILD_Y = "b".repeat(64);
const { harness, claimRunning, contextFor, intentByKey, attemptingIntentFixture, cleanup } = createWriteSequencerTestWorld();
afterEach(async () => { build.id = BUILD_X; await cleanup(); });

const effects = (events: readonly string[]) => events.filter(event => event === "probe" || event === "prepare" || event.startsWith("commit-click:"));

describe("write sequencer — a write is approved under one build", () => {
  it("refuses an approval from another build before any key, intent, fence or click", async () => {
    const h = await harness();
    build.id = BUILD_X;
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
    assert.equal(run.envelope.buildId, BUILD_X);
    build.id = BUILD_Y;
    await assert.rejects(h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof TaskError && error.code === "WRITE_BUILD_CHANGED");
    assert.deepEqual(effects(h.world.events), []);
    assert.equal(intentByKey(h.database), undefined);
    assert.deepEqual(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
  });

  it("writes once when the approving build is the running build", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
    const outcome = await h.execute(contextFor(run, claim));
    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.equal(effects(h.world.events).filter(event => event.startsWith("commit-click:")).length, 1);
    assert.equal(intentByKey(h.database)?.status, "committed");
  });

  it("replays a committed outcome under a later build without another click", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
    await h.execute(contextFor(run, claim));
    const clicks = effects(h.world.events).length;
    build.id = BUILD_Y;
    await h.execute(contextFor(run, claim));
    assert.equal(effects(h.world.events).length, clicks, "the replay must not probe, prepare or click");
    assert.equal(intentByKey(h.database)?.status, "committed");
  });

  it("replays a committed write under a later build, then refuses the next uncommitted write", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
    await h.execute(contextFor(run, claim, writeFixtureTraversalDescriptor));
    const clicks = effects(h.world.events).filter(event => event.startsWith("commit-click:")).length;
    assert.equal(clicks, 1);
    build.id = BUILD_Y;
    await h.execute(contextFor(run, claim, writeFixtureTraversalDescriptor));
    assert.equal(effects(h.world.events).filter(event => event.startsWith("commit-click:")).length, clicks);
    const second = descriptorRuntimeNodes(writeFixtureTraversalDescriptor).find(node => node.kind === "transaction" && node.id === "second-write");
    if (second?.kind !== "transaction") throw new Error("second write node missing");
    const intents = h.database.authority.writeIntents.listByRun(run.envelope.runId).length;
    await assert.rejects(
      h.execute({ ...contextFor(run, claim, writeFixtureTraversalDescriptor), node: second }),
      (error: unknown) => error instanceof TaskError && error.code === "WRITE_BUILD_CHANGED",
    );
    assert.equal(effects(h.world.events).filter(event => event.startsWith("commit-click:")).length, clicks);
    assert.equal(h.database.authority.writeIntents.listByRun(run.envelope.runId).length, intents);
  });

  it("retries a refused write under the running build and writes once", async () => {
    const h = await harness();
    build.id = BUILD_X;
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
    build.id = BUILD_Y;
    await assert.rejects(h.execute(contextFor(run, claim)), (error: unknown) => error instanceof TaskError && error.code === "WRITE_BUILD_CHANGED");
    assert.deepEqual(effects(h.world.events), []);
    const service = new RunRecordService({ database: h.database, clock: h.clock, ids: h.ids, publishQueued: () => undefined });
    const endedAt = h.clock.now().toISOString();
    const requested = service.transition({
      commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt },
    });
    assert.equal(requested.state, "applied");
    if (requested.state !== "applied") throw new Error("cancel request refused");
    assert.equal(requested.run.cancelRequested, true);
    const terminal = service.terminalize({
      kind: "cancelled", commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: requested.run.version,
      claim, endedAt,
    }, writeFixtureDescriptor);
    assert.equal(terminal.state, "applied");
    if (terminal.state !== "applied") throw new Error("cancel terminalize refused");
    const retried = service.retry({
      commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: terminal.run.version,
      runtimeConfig: selectRunRuntime(h.database.authority),
    }, writeFixtureDescriptor);
    assert.equal(retried.state, "applied");
    if (retried.state !== "applied") throw new Error("retry refused");
    assert.equal(retried.run.envelope.buildId, BUILD_Y);
    const next = await claimQueued(h);
    assert.equal(next.run.envelope.runId, retried.run.envelope.runId);
    const outcome = await h.execute(contextFor(next.run, next.claim));
    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.equal(effects(h.world.events).filter(event => event.startsWith("commit-click:")).length, 1);
  });

  it("a delegated child keeps its parent's build and refuses the write under the next build", async () => {
    const h = await harness();
    build.id = BUILD_X;
    assert.equal(h.database.authority.runs.enqueue(writeFixtureQueuedRun()).state, "inserted");
    const parent = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parent);
    assert.equal(parent.envelope.buildId, BUILD_X);
    build.id = BUILD_Y;
    const service = new RunRecordService({ database: h.database, clock: h.clock, ids: h.ids, publishQueued: () => undefined });
    const created = service.create({
      commandId: randomUUID(), code: "wf", matchKey: "child-member", workflow: parent.envelope.workflow,
      descriptorVersion: parent.envelope.descriptorVersion, contractFingerprint: parent.envelope.contractFingerprint,
      configFingerprint: parent.envelope.configFingerprint, configSnapshotId: parent.envelope.configSnapshotId,
      resolvedInstance: parent.envelope.resolvedInstance, priority: parent.envelope.priority, shape: parent.envelope.shape,
      dryRun: parent.envelope.dryRun, input: parent.input, runtimeConfig: selectRunRuntime(h.database.authority),
      parent: { runId: parent.envelope.runId, tracePrefix: parent.envelope.traceId, edgeId: "member" },
    });
    assert.equal(created.state, "applied");
    if (created.state !== "applied") throw new Error("child create refused");
    assert.equal(created.run.envelope.buildId, BUILD_X);
    const cancelled = service.transition({
      commandId: randomUUID(), runId: parent.envelope.runId, expectedVersion: parent.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() },
    });
    assert.equal(cancelled.state, "applied");
    const child = await claimQueued(h);
    assert.equal(child.run.envelope.runId, created.run.envelope.runId);
    await assert.rejects(h.execute(contextFor(child.run, child.claim)), (error: unknown) => error instanceof TaskError && error.code === "WRITE_BUILD_CHANGED");
    assert.deepEqual(effects(h.world.events), []);
    assert.equal(intentByKey(h.database), undefined);
  });
});

type WriteHarness = Awaited<ReturnType<typeof harness>>;

async function claimQueued(h: WriteHarness) {
  const now = h.clock.now().toISOString();
  const member = h.database.authority.workerSlots.list(WRITE_FIXTURE_WORKFLOW_ID).find(slot => slot.poolIndex === 1 && slot.retiredAt === null);
  assert.ok(member);
  const lease = h.database.authority.workerLeases.get(member.workerId);
  if (lease === undefined) throw new Error("fixture claim authority unavailable");
  const workerLifetime = { leaseGeneration: lease.leaseGeneration, membershipRevision: member.membershipRevision };
  const claimed = h.database.authority.runs.claimNext({ workerLifetime, workflow: WRITE_FIXTURE_WORKFLOW_ID, workerId: member.workerId, now });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  const claim = { workerId: member.workerId, claimGeneration: claimed.run.claimGeneration };
  const base = { workerId: member.workerId, claimedAt: now, heartbeatAt: now, workerLifetime };
  assert.equal(h.database.authority.runs.transition({
    runId: claimed.run.envelope.runId, expectedVersion: claimed.run.version, claim,
    lifecycle: { state: "validating", ...base }, now,
  }).state, "applied");
  const running = h.database.authority.runs.transition({
    runId: claimed.run.envelope.runId, expectedVersion: claimed.run.version + 1, claim,
    lifecycle: { state: "running", ...base, currentNodeId: WRITE_FIXTURE_NODE_ID }, now,
  });
  if (running.state !== "applied") throw new Error("running transition failed");
  return { run: running.run, claim };
}

function resolutionKernel(h: WriteHarness, descriptor: AnyWorkflowDescriptor) {
  const lifecycle = new RunRecordService({ database: h.database, clock: h.clock, ids: h.ids, publishQueued: () => undefined });
  const unused = (): never => { throw new Error("unused operator resolution port"); };
  const descriptors = { resolve: (workflow: string) => workflow === String(descriptor.id) ? descriptor : undefined };
  return createCommandKernel({
    authority: h.database, lifecycle, clock: h.clock, ids: h.ids, appVersion: "1.0.0", descriptors,
    configIdentity: { configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint },
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } },
    writeResolution: createWriteResolutionExecutor({ authority: h.database, continuation: runContinuationPort(lifecycle), descriptors, ids: h.ids }),
  });
}

async function parkUnknownWrite(h: WriteHarness) {
  build.id = BUILD_X;
  const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
  const original = attemptingIntentFixture(run.envelope.runId);
  assert.equal(h.database.authority.writeIntents.fenceAttempt({ ...original, claim }).state, "fenced");
  const now = h.clock.now().toISOString();
  const intent = h.database.authority.writeIntents.parkAttempt({
    writeIntentId: original.intent.writeIntentId, generation: 1, expectedVersion: 1, code: "unknown",
    message: "clicked, cannot prove it landed", now,
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "build approval park"),
  });
  assert.equal(intent.status, "parked");
  const parked = h.database.authority.runs.transition({
    runId: run.envelope.runId, expectedVersion: run.version, claim, now,
    lifecycle: {
      state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
      parkedAt: now, code: "unknown", message: "clicked, cannot prove it landed",
    },
  });
  if (parked.state !== "applied") throw new Error("park transition failed");
  return { run: parked.run, intent };
}

describe("parked write resolution under another build", () => {
  it("refuses mark-absent when the permanent key moved, before any click", async () => {
    const h = await harness();
    const { run, intent } = await parkUnknownWrite(h);
    build.id = BUILD_Y;
    assert.throws(
      () => resolutionKernel(h, writeFixtureDescriptorWithMovedKeySameContract).execute(CommandRequestSchema.parse({
        commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
        family: "run", type: "resolve-write-absent",
        target: {
          runId: run.envelope.runId, expectedVersion: run.version, writeIntentId: intent.writeIntentId,
          intentGeneration: intent.generation, writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest,
        },
        payload: { occurrenceKeyDigest: intent.idempotencyKeyDigest },
      })),
      /permanent-key-identity moved/u,
    );
    assert.equal(h.database.authority.writeIntents.get(intent.writeIntentId)?.status, "parked");
    assert.deepEqual(effects(h.world.events), []);
  });

  it("settles an unchanged key as retryable, then refuses the next write before a click", async () => {
    const h = await harness();
    const { run, intent } = await parkUnknownWrite(h);
    build.id = BUILD_Y;
    const resolved = resolutionKernel(h, writeFixtureDescriptor).execute(CommandRequestSchema.parse({
      commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
      family: "run", type: "resolve-write-absent",
      target: {
        runId: run.envelope.runId, expectedVersion: run.version, writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation, writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest,
      },
      payload: { occurrenceKeyDigest: intent.idempotencyKeyDigest },
    }));
    assert.equal(resolved.state, "applied");
    assert.equal(h.database.authority.writeIntents.get(intent.writeIntentId)?.status, "retryable");
    const current = h.database.authority.runs.get(run.envelope.runId);
    assert.ok(current);
    assert.equal(current.lifecycle.state, "queued");
    assert.equal(current.envelope.buildId, BUILD_X);
    const claimed = await claimQueued(h);
    await assert.rejects(
      h.execute(contextFor(claimed.run, claimed.claim)),
      (error: unknown) => error instanceof TaskError && error.code === "WRITE_BUILD_CHANGED",
    );
    assert.equal(effects(h.world.events).some(event => event.startsWith("commit-click:")), false);
    assert.equal(h.database.authority.writeIntents.get(intent.writeIntentId)?.status, "retryable");
  });
});
