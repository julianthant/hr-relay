import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { RerunSourceSchema } from "../../../../src/models/run/rerun.js";
import { captureRunContinuation } from "../../../../src/backend/runtime/checkpoints/run-continuation.js";
import { previewRerunWarnings, RerunRefusedError, validateCompletedTransactionContinuations } from "../../../../src/backend/runs/start/rerun.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { sourceBoundReadContract, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, WriteFixtureCommit, WriteFixturePrepare, WriteFixtureProofSchema,
  writeFixtureMemoDescriptor, WRITE_FIXTURE_EID, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";

const Input = z.strictObject({ eid: EidSchema, memo: z.string().optional() });
const prior = writeFixtureMemoDescriptor;
const descriptor = defineWorkflowDescriptor({ id: prior.id, version: prior.version, contractFingerprint: prior.contractFingerprint,
  code: prior.code, label: prior.label, icon: prior.icon, category: prior.category, canonicalInput: defineCanonicalInput(Input, Input, [{ eid: WRITE_FIXTURE_EID }]),
  inputSubject: "eid", surface: prior.surface, enqueue: prior.enqueue, actions: prior.actions, surfaces: {}, details: [],
  identity: { matchKey: input => `eid:${input.eid}` }, presentation: { title: input => input.eid }, scenarios: ["write-fixture/happy"],
  flow: flow(Input).step("before", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: [], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: EidSchema.parse(input.memo ?? input.eid) }) },
      commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .step("finish", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }),
});
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(failOn: readonly number[] = [2]) {
  const h = await sourceBoundHarness(descriptor, world => {
    const reads = sourceBoundReadStores(world, failOn), writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([...reads.stores, ...writes.stores], {
      scenarioIds: [...reads.corpus.scenarioIds, ...writes.corpus.scenarioIds], tasks: [...reads.corpus.tasks, ...writes.corpus.tasks],
    });
  });
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID));
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source);
  assert.equal(h.database.authority.failures.listByRun(failed.envelope.runId)[0]?.nodeId, "finish");
  return { ...h, failed };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function effects(h: Fixture) {
  return { gestures: h.world.events.filter(event => !event.startsWith("read:")),
    intents: h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST),
    checkpoints: h.database.authority.runCheckpoints.listByItem(descriptor.id, h.failed.envelope.itemId).filter(row => row.nodeId === WRITE_FIXTURE_NODE_ID),
    confirmations: h.database.authority.timelineEvents.page({}).filter(row => row.payload.kind === "operation-confirmed") };
}
function retry(h: Fixture, run = h.failed) {
  return h.lifecycle.retry({ commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: run.version,
    runtimeConfig: selectRunRuntime(h.database.authority), appVersion: "0.1.0" }, descriptor, { title: "Transaction continuation", actorId: "local-operator" });
}

it("enters real lifecycle Retry and source-bound Start across a bounded chain without repeating the completed transaction", async () => {
  const h = await fixture([2, 3]);
  const before = effects(h); assert.equal(before.intents.length, 1); assert.equal(before.checkpoints.length, 1);
  const next = requireLifecycleApplied(retry(h));
  assert.equal((await h.execute(next)).state, "failed");
  const second = h.fresh(next);
  assert.equal(h.database.authority.failures.listByRun(second.envelope.runId)[0]?.nodeId, "finish");
  assert.deepEqual(effects(h), before);
  const plan = h.proposal(second, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  assert.deepEqual(plan.rerun?.warnings, []);
  const continued = h.start(plan);
  assert.ok(continued.envelope.sourceBound); assert.ok(continued.envelope.continuation);
  assert.equal((await h.execute(continued)).state, "done");
  assert.deepEqual(effects(h), before);
  assert.ok(h.database.authority.runCheckpoints.listByAttempt(descriptor.id, continued.envelope.itemId, "finish", continued.envelope.attempt)
    .some(row => row.runId === continued.envelope.runId));
  assert.equal(h.world.events.filter(event => event.startsWith("read:")).length, 2);
});

it("uses the ordinary source-bound planner and executor directly for a completed natural-key continuation", async () => {
  const h = await fixture(), before = effects(h);
  const plan = h.proposal(h.failed, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  assert.deepEqual(plan.rerun?.warnings, []);
  const next = h.start(plan);
  assert.equal((await h.execute(next)).state, "done");
  assert.deepEqual(effects(h), before);
});

it("refuses a same-natural-key prepare correction before planning any transaction effects", async () => {
  const h = await fixture(), before = effects(h);
  assert.throws(() => h.proposal(h.failed, undefined, false, WRITE_FIXTURE_EID, "10899999"),
    error => error instanceof RerunRefusedError && error.code === "invalid-value" && /mapped input changed/u.test(error.message));
  assert.deepEqual(effects(h), before);
});

it("refuses stale source selection before creating a continuation", async () => {
  const h = await fixture(), before = effects(h);
  const source = RerunSourceSchema.parse({ runId: h.failed.envelope.runId, expectedVersion: h.failed.version - 1, intent: "rerun",
    selectedStepKeys: descriptor.timeline.map(step => step.key) });
  assert.throws(() => previewRerunWarnings(h.database.authority, descriptor, source),
    error => error instanceof RerunRefusedError && error.code === "source-stale");
  assert.deepEqual(effects(h), before);
});

it("executor refuses changed prepare mapping under the same natural key before entering the sequencer", async () => {
  const h = await fixture(), before = effects(h), source = h.failed;
  const corrected = { eid: WRITE_FIXTURE_EID, memo: "10899999" };
  const next = requireLifecycleApplied(h.lifecycle.create({ commandId: randomUUID(), code: descriptor.code, matchKey: `eid:${WRITE_FIXTURE_EID}`,
    workflow: descriptor.id, descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    configFingerprint: source.envelope.configFingerprint, configSnapshotId: source.envelope.configSnapshotId,
    resolvedInstance: source.envelope.resolvedInstance, priority: source.envelope.priority, shape: source.envelope.shape, dryRun: false,
    browserMode: source.envelope.browserMode, retryOf: source.envelope.runId,
    input: { ...source.input, raw: corrected, parsed: { ...source.input.parsed, value: corrected } },
    sourceBound: source.envelope.sourceBound, continuation: captureRunContinuation(h.database.authority, source),
    runtimeConfig: selectRunRuntime(h.database.authority) }, { title: "Corrected transaction continuation", actorId: "local-operator" }));
  assert.equal((await h.execute(next)).state, "failed");
  assert.equal(h.database.authority.failures.listByRun(next.envelope.runId)[0]?.code, "RUN_CONTINUATION_REFUSED");
  assert.deepEqual(effects(h), before);
});

for (const missing of ["checkpoint", "permanent-proof"] as const) it(`refuses missing retained ${missing} during admission with no transaction effects`, async () => {
  const h = await fixture(), before = effects(h), repositories = h.database.authority;
  const unavailable = { ...repositories,
    ...(missing === "checkpoint" ? { runCheckpoints: { ...repositories.runCheckpoints, get: () => undefined } }
      : { writeIntents: { ...repositories.writeIntents, findByPermanentKey: () => undefined } }) };
  assert.throws(() => validateCompletedTransactionContinuations(unavailable, descriptor, h.failed), RerunRefusedError);
  assert.deepEqual(effects(h), before);
});

it("refuses a genuinely acknowledged predecessor repeat at Retry and planning before any new occurrence", async () => {
  const h = await fixture([2, 3, 5]);
  const fresh = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID));
  assert.equal((await h.execute(fresh)).state, "failed");
  const beforeTransaction = h.fresh(fresh);
  assert.equal(h.database.authority.failures.listByRun(beforeTransaction.envelope.runId)[0]?.nodeId, "before");
  const warning = h.proposal(beforeTransaction, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  assert.equal(warning.rerun?.warnings.length, 1); assert.ok(warning.rerun?.warningDigest);
  const acknowledged = h.proposal(beforeTransaction, warning.rerun.warningDigest, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
  h.world.commitOutput = { transactionId: "T234567" };
  const repeated = h.start(acknowledged);
  assert.equal((await h.execute(repeated)).state, "failed");
  const failedRepeat = h.fresh(repeated);
  assert.equal(h.database.authority.failures.listByRun(failedRepeat.envelope.runId)[0]?.nodeId, "finish");
  const before = effects(h);
  assert.equal(before.intents.length, 2); assert.equal(new Set(before.intents.map(intent => intent.idempotencyKey)).size, 2);
  assert.ok(before.intents.some(intent => intent.status === "committed" && intent.occurrence !== undefined));
  assert.deepEqual(retry(h, failedRepeat), { state: "refused", refusal: { reason: "policy-refused" } });
  assert.throws(() => h.proposal(failedRepeat, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID),
    error => error instanceof RerunRefusedError && error.code === "invalid-state" && /repeat-occurrence/u.test(error.message));
  assert.deepEqual(effects(h), before);
});

it("keeps an ordinary acknowledged repeat's own occurrence proof through Pause and Resume", async () => {
  const h = await fixture([2, 3]);
  const fresh = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID));
  assert.equal((await h.execute(fresh)).state, "failed");
  const failedBefore = h.fresh(fresh);
  const warning = h.proposal(failedBefore, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  assert.equal(warning.rerun?.warnings.length, 1); assert.ok(warning.rerun?.warningDigest);
  const acknowledged = h.proposal(failedBefore, warning.rerun.warningDigest, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
  h.world.commitOutput = { transactionId: "T234567" };
  let repeated = h.start(acknowledged);
  h.world.onCommitClick = () => {
    const active = h.fresh(repeated);
    requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version }));
  };
  assert.equal((await h.execute(repeated)).state, "abandoned");
  delete h.world.onCommitClick;
  repeated = h.fresh(repeated); assert.equal(repeated.pause?.state, "paused");
  const before = effects(h); assert.equal(before.intents.length, 2);
  assert.ok(before.intents.some(intent => intent.status === "committed" && intent.occurrence !== undefined && WriteFixtureProofSchema.parse(intent.completionProof.value).transactionId === "T234567"));
  repeated = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: repeated.envelope.runId, expectedVersion: repeated.version }));
  assert.equal((await h.execute(repeated)).state, "done");
  assert.deepEqual(effects(h), before);
});
