import { validateCompletedTransactionContinuations } from "../../../../src/backend/runs/start/recovery-plan.js";
import { failureDecision } from "../../../../src/backend/runs/queries/run-detail/receipts-failures.js";
import { FailureDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { failureDetailWireFixture } from "../../../support/helpers/trust/trust-wire-fixtures.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { DelegationEdgeIdSchema, EidSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { RerunSourceSchema } from "../../../../src/models/run/rerun.js";
import { captureRunContinuation } from "../../../../src/backend/storage/sqlite/run-continuation.js";
import { AuthenticatedRunContinuation } from "../../../../src/backend/storage/sqlite/run-continuation-delegation.js";
import { previewRerunWarnings, RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { sourceBoundReadContract, sourceBoundReadDescriptor, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, WriteFixtureCommit, WriteFixturePrepare, WriteFixtureProofSchema,
  writeFixtureMemoDescriptor, WRITE_FIXTURE_EID, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";

const Input = z.strictObject({ eid: EidSchema, memo: z.string().optional() });
const prior = writeFixtureMemoDescriptor;
const metadata = { id: prior.id, version: prior.version, contractFingerprint: prior.contractFingerprint,
  code: prior.code, label: prior.label, icon: prior.icon, category: prior.category, canonicalInput: defineCanonicalInput(Input, Input, [{ eid: WRITE_FIXTURE_EID }]),
  inputSubject: "eid", surface: prior.surface, enqueue: prior.enqueue, actions: prior.actions, surfaces: {}, details: [],
  identity: { matchKey: (input: z.output<typeof Input>) => `eid:${input.eid}` }, presentation: { title: (input: z.output<typeof Input>) => input.eid }, scenarios: ["write-fixture/happy"],
} as const;
const transactionFlow = () => flow(Input).step("before", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: [], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: EidSchema.parse(input.memo ?? input.eid) }) },
      commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 });
const graph = transactionFlow()
    .step("finish", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output });
const descriptor = defineWorkflowDescriptor({ ...metadata, flow: graph });
const memoCommit = defineTaskContract({ id: WriteFixtureCommit.id, title: WriteFixtureCommit.title,
  effect: WriteFixtureCommit.effect, input: Input, output: WriteFixtureCommit.output,
  errorCodes: WriteFixtureCommit.errorCodes, subject: WriteFixtureCommit.subject,
  scenarios: WriteFixtureCommit.scenarios, writeSafety: WriteFixtureCommit.writeSafety, example: WriteFixtureCommit.example });
const commitMemoDescriptor = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: [], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
    commit: { uses: memoCommit, bind: ({ input }) => ({ eid: input.eid, ...(input.memo === undefined ? {} : { memo: input.memo }) }) },
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
  .step("finish", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint", bind: ({ input }) => input })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
const receiptDescriptor = defineWorkflowDescriptor({ ...metadata, flow: transactionFlow()
  .step("receipt", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint",
    bind: ({ input, outputs }) => ({ eid: input.eid, memo: outputs[WRITE_FIXTURE_NODE_ID].output.transactionId }) })
  .step("finish", sourceBoundReadContract, { dependsOn: ["receipt"], replay: "checkpoint", bind: ({ input }) => input })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
const childReceiptDescriptor = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .childRun("child", { id: sourceBoundReadDescriptor.id, input: Input, result: sourceBoundReadContract.output }, {
    dependsOn: [], edgeId: DelegationEdgeIdSchema.parse("child"), cardinality: "one", await: "terminal", join: "one",
    policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
    bind: ({ input }) => ({ eid: input.eid }), deriveChildItemId: (_input, identity) => identity.canonicalItemId })
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["child"],
    prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => { if (outputs.child.state !== "done") throw new Error("child not done"); return { eid: outputs.child.output.eid }; } },
    commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => { if (outputs.child.state !== "done") throw new Error("child not done"); return { eid: outputs.child.output.eid }; } },
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
  .step("receipt", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint",
    bind: ({ input, outputs }) => ({ eid: input.eid, memo: outputs[WRITE_FIXTURE_NODE_ID].output.transactionId }) })
  .step("finish", sourceBoundReadContract, { dependsOn: ["receipt"], replay: "checkpoint", bind: ({ input }) => input })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });

function partialChildDescriptor(mapFailedMember: boolean) {
  return defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
    .childRun("child", { id: sourceBoundReadDescriptor.id, input: Input, result: sourceBoundReadContract.output }, {
      dependsOn: [], edgeId: DelegationEdgeIdSchema.parse("child"), cardinality: "many", await: "terminal", join: "all-settled",
      policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      bind: ({ input }) => [{ eid: input.eid }, { eid: EidSchema.parse("10899999") }],
      deriveChildItemId: (_input, identity) => identity.canonicalItemId })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["child"],
      prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => {
        const first = outputs.child[0]; if (first?.state !== "done") throw new Error("first child not done");
        return { eid: mapFailedMember && outputs.child[1]?.state === "done" ? outputs.child[1].output.eid : first.output.eid };
      } },
      commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => {
        const first = outputs.child[0]; if (first?.state !== "done") throw new Error("first child not done"); return { eid: first.output.eid };
      } }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .step("receipt", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint",
      bind: ({ input, outputs }) => ({ eid: input.eid, memo: outputs[WRITE_FIXTURE_NODE_ID].output.transactionId }) })
    .step("finish", sourceBoundReadContract, { dependsOn: ["receipt"], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(failOn: readonly number[] = [2], selected: AnyWorkflowDescriptor = descriptor,
  children: readonly AnyWorkflowDescriptor[] = [], pauseAtCommit = false) {
  const h = await sourceBoundHarness(selected, world => {
    const reads = sourceBoundReadStores(world, failOn), writes = buildWriteFixtureRegistry(world, selected === commitMemoDescriptor ? memoCommit : WriteFixtureCommit);
    return defineTaskStoreRegistry([...reads.stores, ...writes.stores], {
      scenarioIds: [...reads.corpus.scenarioIds, ...writes.corpus.scenarioIds], tasks: [...reads.corpus.tasks, ...writes.corpus.tasks],
    });
  }, undefined, undefined, undefined, children);
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID,
    selected === commitMemoDescriptor ? undefined : WRITE_FIXTURE_EID));
  if (pauseAtCommit) h.world.onCommitClick = () => {
    const active = h.fresh(source);
    requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version }));
  };
  if (children.length > 0) {
    assert.equal((await h.execute(source)).state, "yielded-delegation");
    const members = h.database.authority.runs.listChildren(source.envelope.runId); assert.ok(members.length > 0);
    for (const member of members) assert.ok(["done", "failed"].includes((await h.execute(member)).state));
  }
  assert.equal((await h.execute(source)).state, pauseAtCommit ? "abandoned" : "failed");
  delete h.world.onCommitClick;
  const failed = h.fresh(source);
  if (pauseAtCommit) assert.equal(failed.pause?.state, "paused");
  else {
    const failure = h.database.authority.failures.listByRun(failed.envelope.runId)[0]; assert.ok(failure);
    assert.equal(failure.nodeId, "finish", `${failure.code}: ${failure.summary}`); assert.equal(failure.code, "TASK_UNHANDLED_FAILURE");
    assert.match(failure.summary, /fixture downstream failure/u);
  }
  return { ...h, get descriptor() { return h.descriptor; }, failed };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function effects(h: Fixture) {
  return { gestures: h.world.events.filter(event => !event.startsWith("read:")),
    intents: h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST),
    checkpoints: h.database.authority.runCheckpoints.listByItem(descriptor.id, h.failed.envelope.itemId).filter(row => row.nodeId === WRITE_FIXTURE_NODE_ID),
    confirmations: h.database.authority.timelineEvents.page({}).filter(row => row.payload.kind === "operation-confirmed") };
}
function operatorRecover(h: Fixture, run = h.failed, replay = false) {
  const command = { commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
    source: "dashboard", family: "run", type: "recover-run", target: { runId: run.envelope.runId, expectedVersion: run.version } };
  const result = h.kernel.execute(command);
  if (replay) {
    const repeated = h.kernel.execute(command); assert.ok(repeated.state === "already-applied");
    assert.ok(result.state === "applied"); assert.deepEqual(repeated.affectedTargets, result.affectedTargets);
  }
  assert.equal(result.state, "applied"); assert.ok(result.state === "applied");
  const target = result.affectedTargets[0]; assert.ok(target?.family === "run");
  const next = h.database.authority.runs.get(target.runId); assert.ok(next); return next;
}
function correctedContinuation(h: Fixture, raw: z.input<typeof Input>) {
  const source = h.failed, descriptor = h.descriptor, corrected = Input.parse(raw);
  return requireLifecycleApplied(h.lifecycle.create({ commandId: randomUUID(), code: descriptor.code, matchKey: `eid:${WRITE_FIXTURE_EID}`,
    workflow: descriptor.id, descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    configFingerprint: source.envelope.configFingerprint, configSnapshotId: source.envelope.configSnapshotId,
    resolvedInstance: source.envelope.resolvedInstance, priority: source.envelope.priority, shape: source.envelope.shape, dryRun: false,
    ...(source.envelope.browserMode === undefined ? {} : { browserMode: source.envelope.browserMode }), retryOf: source.envelope.runId,
    input: { ...source.input, raw: corrected, parsed: { ...source.input.parsed, value: corrected } },
    ...(source.envelope.sourceBound === undefined ? {} : { sourceBound: source.envelope.sourceBound }), continuation: captureRunContinuation(h.database.authority, source),
    runtimeConfig: selectRunRuntime(h.database.authority) }, { title: "Corrected transaction continuation", actorId: "local-operator" }));
}

for (const door of ["first-delivery", "lost-acknowledgement"] as const) it(`${door} replays a completed dependent read only after the transaction restores its semantic output`, async () => {
  const h = await fixture([3], receiptDescriptor), before = effects(h);
  assert.equal(h.world.events.filter(event => event === "read:T123456").length, 1);
  const next = operatorRecover(h, h.failed, door === "lost-acknowledgement");
  assert.equal((await h.execute(next)).state, "done");
  assert.deepEqual(effects(h), before);
  assert.equal(h.world.events.filter(event => event === "read:T123456").length, 1);
});

for (const door of ["first-delivery", "lost-acknowledgement"] as const) it(`${door} reuses authenticated child-dependent transaction and receipt without relaunching the child`, async () => {
  const h = await fixture([3], childReceiptDescriptor, [sourceBoundReadDescriptor]), before = effects(h);
  const children = h.database.authority.runs.listChildren(h.failed.envelope.runId); assert.equal(children.length, 1);
  const next = operatorRecover(h, h.failed, door === "lost-acknowledgement");
  assert.equal((await h.execute(next)).state, "done");
  assert.deepEqual(effects(h), before);
  assert.deepEqual(h.database.authority.runs.listChildren(h.failed.envelope.runId), children);
  assert.equal(h.database.authority.runs.listByWorkflow(sourceBoundReadDescriptor.id).length, 1);
  assert.equal(h.world.events.filter(event => event === "read:T123456").length, 1);
});

for (const changed of [false, true]) it(`authenticates original all-settled members after a post-terminal replacement with ${changed ? "changed" : "unchanged"} mappings`, async () => {
  const h = await fixture([2, 4], partialChildDescriptor(changed), [sourceBoundReadDescriptor]);
  const originals = h.database.authority.runs.listChildren(h.failed.envelope.runId), before = effects(h);
  assert.equal(originals.length, 2);
  const done = originals.find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done"); assert.ok(done);
  const next = operatorRecover(h);
  const replacement = h.database.authority.runs.listChildren(h.failed.envelope.runId).find(child => child.lifecycle.state === "queued"); assert.ok(replacement);
  assert.equal((await h.execute(replacement)).state, "done");
  const creationScope = AuthenticatedRunContinuation.authenticate(h.database.authority, h.fresh(next).envelope).dependency("child", "child", true);
  assert.ok(creationScope?.children.some(member => member.run.envelope.runId === replacement.envelope.runId),
    "creation-issued replacement belongs to the new continuation's original scope");
  assert.equal(h.fresh(h.failed).version, h.failed.version, "replacement does not revise the source parent");
  assert.equal((await h.execute(next)).state, changed ? "failed" : "done");
  if (changed) assert.equal(h.database.authority.failures.listByRun(next.envelope.runId)[0]?.code, "RUN_CONTINUATION_REFUSED");
  assert.deepEqual(h.fresh(done), done, "completed sibling never launches again");
  assert.deepEqual(effects(h), before);
  assert.equal(h.world.events.filter(event => event === "read:T123456").length, 1);
});

it("refuses own-run transaction reuse after an in-flight child replacement without immutable original member authority", async () => {
  const h = await fixture([2], partialChildDescriptor(true), [sourceBoundReadDescriptor], true), before = effects(h);
  const failedChild = h.database.authority.runs.listChildren(h.failed.envelope.runId)
    .find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failedChild);
  const replacement = operatorRecover(h, failedChild);
  assert.equal((await h.execute(replacement)).state, "done");
  const paused = h.fresh(h.failed);
  const resumed = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: paused.envelope.runId, expectedVersion: paused.version }));
  assert.equal((await h.execute(resumed)).state, "failed");
  const failure = h.database.authority.failures.listByRun(resumed.envelope.runId)[0];
  assert.equal(failure?.code, "RUN_CONTINUATION_REFUSED");
  assert.match(JSON.stringify(failure), /run-continuation-original-child-authority-unavailable/u);
  assert.deepEqual(effects(h), before);
});

it("refuses missing or foreign native child receipt authority before transaction continuation admission", async () => {
  const h = await fixture([3], childReceiptDescriptor, [sourceBoundReadDescriptor]), before = effects(h);
  const repositories = h.database.authority;
  assert.throws(() => validateCompletedTransactionContinuations({ ...repositories,
    runResults: { ...repositories.runResults, get: () => undefined, getInitialSettlement: () => undefined, getSettlement: () => undefined } }, h.descriptor, h.failed));
  const actual = repositories.dependencies.evidence(h.failed.envelope.runId, "child");
  assert.throws(() => validateCompletedTransactionContinuations({ ...repositories,
    dependencies: { ...repositories.dependencies, evidence: () => ({ ...actual, parentRunId: RunIdSchema.parse(randomUUID()) }) } }, h.descriptor, h.failed),
  /delegation-owner-mismatch/u);
  assert.deepEqual(effects(h), before);
});

it("enters operator checkpoint recovery across a bounded chain without repeating the completed transaction", async () => {
  const h = await fixture([2, 3]);
  const before = effects(h); assert.equal(before.intents.length, 1); assert.equal(before.checkpoints.length, 1);
  const next = operatorRecover(h);
  assert.equal((await h.execute(next)).state, "failed");
  const second = h.fresh(next);
  assert.equal(h.database.authority.failures.listByRun(second.envelope.runId)[0]?.nodeId, "finish");
  assert.deepEqual(effects(h), before);
  const continued = operatorRecover(h, second);
  assert.equal(continued.envelope.sourceBound, undefined); assert.ok(continued.envelope.continuation);
  assert.equal((await h.execute(continued)).state, "done");
  assert.deepEqual(effects(h), before);
  assert.ok(h.database.authority.runCheckpoints.listByAttempt(descriptor.id, continued.envelope.itemId, "finish", continued.envelope.attempt)
    .some(row => row.runId === continued.envelope.runId));
  assert.equal(h.world.events.filter(event => event.startsWith("read:")).length, 2);
});

it("records a recovered continuation's later failure as after the source run's committed write", async () => {
  const h = await fixture([2, 3]);
  const before = effects(h);
  const next = operatorRecover(h);
  assert.ok(next.envelope.continuation);
  assert.equal((await h.execute(next)).state, "failed");
  assert.deepEqual(h.database.authority.writeIntents.listByRun(next.envelope.runId), []);
  const failure = h.database.authority.failures.listByRun(next.envelope.runId)[0]; assert.ok(failure);
  assert.equal(failure.nodeId, "finish");
  assert.equal(failure.writeState, "committed");
  const decision = failureDecision(FailureDetailWireSchema.parse({
    ...failureDetailWireFixture({ runId: next.envelope.runId, failureId: failure.failureId, traceId: failure.traceId, workflowId: descriptor.id }),
    writeState: failure.writeState,
    resolution: { capability: { state: "available" }, capture: { failureId: failure.failureId, runId: next.envelope.runId, resolution: { status: "unresolved", version: 1 } } } }));
  assert.equal(decision.type, "failed-after-write");
  assert.deepEqual(decision.options.map(({ id }) => id), ["mark-as-failed", "add-note"]);
  assert.deepEqual(effects(h), before);
});

it("uses the explicit operator recovery planner and executor for a completed natural-key continuation", async () => {
  const h = await fixture(), before = effects(h);
  const next = operatorRecover(h);
  assert.equal((await h.execute(next)).state, "done");
  assert.deepEqual(effects(h), before);
});

it("refuses a same-natural-key prepare correction before planning any transaction effects", async () => {
  const h = await fixture(), before = effects(h);
  assert.throws(() => validateCompletedTransactionContinuations(h.database.authority, h.descriptor, h.failed, { eid: WRITE_FIXTURE_EID, memo: "10899999" }),
    error => error instanceof RerunRefusedError && error.code === "invalid-value" && /mapped input changed/u.test(error.message));
  assert.deepEqual(effects(h), before);
});

it("refuses a commit-only non-key correction with unchanged prepare input and natural key", async () => {
  const h = await fixture([1], commitMemoDescriptor), before = effects(h);
  assert.throws(() => validateCompletedTransactionContinuations(h.database.authority, h.descriptor, h.failed, { eid: WRITE_FIXTURE_EID, memo: "changed commit memo" }),
    error => error instanceof RerunRefusedError && /mapped input changed/u.test(error.message));
  const next = correctedContinuation(h, { eid: WRITE_FIXTURE_EID, memo: "changed commit memo" });
  assert.equal((await h.execute(next)).state, "failed");
  assert.equal(h.database.authority.failures.listByRun(next.envelope.runId)[0]?.code, "RUN_CONTINUATION_REFUSED");
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
  const h = await fixture(), before = effects(h);
  const corrected = { eid: WRITE_FIXTURE_EID, memo: "10899999" };
  const next = correctedContinuation(h, corrected);
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

it("refuses a genuinely acknowledged predecessor repeat at recovery admission before any new occurrence", async () => {
  const h = await fixture([2, 3, 5]);
  const initialWarning = h.proposal(h.failed, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  assert.equal(initialWarning.rerun?.warnings.length, 1); assert.ok(initialWarning.rerun?.warningDigest);
  const fresh = h.start(h.proposal(h.failed, initialWarning.rerun.warningDigest, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID));
  assert.equal(fresh.envelope.continuation, undefined); assert.ok(fresh.envelope.sourceBound);
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
  const rejected = h.kernel.execute({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
    source: "dashboard", family: "run", type: "recover-run", target: { runId: failedRepeat.envelope.runId, expectedVersion: failedRepeat.version } });
  assert.ok(rejected.state === "rejected"); assert.equal(rejected.code, "RUN_CONTINUATION_REFUSED");
  assert.throws(() => validateCompletedTransactionContinuations(h.database.authority, h.descriptor, failedRepeat),
    error => error instanceof RerunRefusedError && error.code === "invalid-state" && /repeat-occurrence/u.test(error.message));
  assert.deepEqual(effects(h), before);
});

it("keeps an ordinary acknowledged repeat's own occurrence proof through Pause and Resume", async () => {
  const h = await fixture([2, 3]);
  const initialWarning = h.proposal(h.failed, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  assert.equal(initialWarning.rerun?.warnings.length, 1); assert.ok(initialWarning.rerun?.warningDigest);
  const fresh = h.start(h.proposal(h.failed, initialWarning.rerun.warningDigest, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID));
  assert.equal(fresh.envelope.continuation, undefined); assert.ok(fresh.envelope.sourceBound);
  assert.equal((await h.execute(fresh)).state, "failed");
  const failedBefore = h.fresh(fresh);
  assert.equal(h.database.authority.failures.listByRun(failedBefore.envelope.runId)[0]?.nodeId, "before");
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

const staleRead = defineTaskContract({ id: sourceBoundReadContract.id, title: sourceBoundReadContract.title, effect: sourceBoundReadContract.effect,
  input: sourceBoundReadContract.input, output: sourceBoundReadContract.output, errorCodes: sourceBoundReadContract.errorCodes,
  subject: sourceBoundReadContract.subject, scenarios: sourceBoundReadContract.scenarios, freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: sourceBoundReadContract.provenance, example: sourceBoundReadContract.example });
const staleReadDescriptor = (beforeReplay: "always-rerun" | "checkpoint") => defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .step("before", staleRead, { dependsOn: [], replay: beforeReplay, bind: ({ input }) => ({ eid: input.eid }) })
  .step("check", staleRead, { dependsOn: ["before"], replay: "checkpoint", bind: ({ outputs }) => ({ eid: outputs.before.eid }) })
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["check"], prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => ({ eid: outputs.check.eid }) },
    commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => ({ eid: outputs.check.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });

async function staleReadFixture(beforeReplay: "always-rerun" | "checkpoint", failOn: readonly number[], dryRun = false) {
  const hooks: { onRead?: () => void } = {};
  const h = await sourceBoundHarness(staleReadDescriptor(beforeReplay), world => {
    const reads = sourceBoundReadStores(world, failOn, () => hooks.onRead?.(), staleRead), writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([...reads.stores, ...writes.stores], {
      scenarioIds: [...reads.corpus.scenarioIds, ...writes.corpus.scenarioIds], tasks: [...reads.corpus.tasks, ...writes.corpus.tasks],
    });
  });
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, dryRun, WRITE_FIXTURE_EID));
  const beforeRows = () => h.database.authority.runCheckpoints.listByItem(source.envelope.workflow, source.envelope.itemId).filter(row => row.nodeId === "before");
  const commits = () => h.world.events.filter(event => event.startsWith("commit-click:")).length;
  const intents = () => h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST);
  return { h, hooks, source, beforeRows, commits, intents };
}

async function pausedInsideFirstRead(beforeReplay: "always-rerun" | "checkpoint", dryRun = false) {
  const f = await staleReadFixture(beforeReplay, [], dryRun), { h, source } = f;
  let reads = 0;
  f.hooks.onRead = () => {
    reads += 1;
    if (reads === 1) {
      const active = h.fresh(source);
      requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version }));
    }
    h.clock.advanceWall(1);
  };
  assert.equal((await h.execute(source)).state, "abandoned");
  const paused = h.fresh(source); assert.equal(paused.pause?.state, "paused");
  assert.equal(f.beforeRows().length, 1); assert.deepEqual(f.intents(), []);
  h.clock.advanceWall(1_000);
  const resumed = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: paused.envelope.runId, expectedVersion: paused.version }));
  assert.ok(resumed.envelope.continuation);
  return { ...f, resumed, outcome: await h.execute(resumed) };
}

function assertReadAgain(f: Awaited<ReturnType<typeof staleReadFixture>>, runId: string, firstObservedAt: string) {
  const rows = f.beforeRows(); assert.equal(rows.length, 2);
  const latest = rows.at(-1); assert.ok(latest); assert.equal(latest.runId, runId);
  assert.ok(Date.parse(latest.provenance[0]?.observedAt ?? "") > Date.parse(firstObservedAt));
}

it("reads a stale always-rerun checkpoint again when Recover continues before the write", async () => {
  const f = await staleReadFixture("always-rerun", [2]), { h } = f;
  f.hooks.onRead = () => h.clock.advanceWall(1);
  assert.equal((await h.execute(f.source)).state, "failed");
  const failed = h.fresh(f.source);
  assert.equal(h.database.authority.failures.listByRun(failed.envelope.runId)[0]?.nodeId, "check");
  const firstObservedAt = f.beforeRows()[0]?.provenance[0]?.observedAt; assert.ok(firstObservedAt);
  h.clock.advanceWall(1_000);
  const next = operatorRecover({ ...h, failed }, failed);
  assert.ok(next.envelope.continuation);
  const outcome = await h.execute(next);
  assert.equal(outcome.state, "done", JSON.stringify(h.database.authority.failures.listByRun(next.envelope.runId)));
  assertReadAgain(f, next.envelope.runId, firstObservedAt);
  assert.equal(f.commits(), 1);
  assert.deepEqual(f.intents().map(intent => intent.status), ["committed"]);
});

it("reads a stale always-rerun checkpoint again when a paused run resumes before the write", async () => {
  const f = await pausedInsideFirstRead("always-rerun");
  const firstObservedAt = f.beforeRows()[0]?.provenance[0]?.observedAt; assert.ok(firstObservedAt);
  assert.equal(f.outcome.state, "done", JSON.stringify(f.h.database.authority.failures.listByRun(f.resumed.envelope.runId)));
  assertReadAgain(f, f.resumed.envelope.runId, firstObservedAt);
  assert.equal(f.commits(), 1);
  assert.deepEqual(f.intents().map(intent => intent.status), ["committed"]);
});

it("reads a stale always-rerun checkpoint again when a paused dry run resumes", async () => {
  const f = await pausedInsideFirstRead("always-rerun", true);
  const firstObservedAt = f.beforeRows()[0]?.provenance[0]?.observedAt; assert.ok(firstObservedAt);
  assert.equal(f.outcome.state, "done", JSON.stringify(f.h.database.authority.failures.listByRun(f.resumed.envelope.runId)));
  assertReadAgain(f, f.resumed.envelope.runId, firstObservedAt);
  assert.equal(f.commits(), 0);
  assert.deepEqual(f.intents(), []);
});

it("still refuses a stale checkpoint-policy fact when a paused run resumes before the write", async () => {
  const f = await pausedInsideFirstRead("checkpoint");
  assert.equal(f.outcome.state, "failed");
  const failure = f.h.database.authority.failures.listByRun(f.resumed.envelope.runId)[0];
  assert.equal(failure?.code, "RESUME_VALIDATION_FAILED");
  assert.match(JSON.stringify(failure), /CheckpointFreshnessError/u);
  assert.equal(f.beforeRows().length, 1);
  assert.equal(f.commits(), 0);
  assert.deepEqual(f.intents(), []);
});

// The child reads through the parent's 0 ms contract, because the store serves one implementation per task id.
const staleChildDescriptor = defineWorkflowDescriptor({ id: sourceBoundReadDescriptor.id, version: 1,
  contractFingerprint: sourceBoundReadDescriptor.contractFingerprint, code: "sr", label: "Source read", icon: "Search", category: "operations",
  canonicalInput: sourceBoundReadDescriptor.canonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
  actions: sourceBoundReadDescriptor.actions, surfaces: {}, details: [], identity: { matchKey: (input: z.output<typeof Input>) => input.eid },
  presentation: { title: (input: z.output<typeof Input>) => input.eid }, scenarios: ["source-read/happy"],
  flow: flow(Input).step("read", staleRead, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: staleRead.output, dependsOn: ["read"], derive: ({ outputs }) => outputs.read }) });
const ownSettlementDescriptor = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .step("before", staleRead, { dependsOn: [], replay: "always-rerun", bind: ({ input }) => ({ eid: input.eid, memo: "source" }) })
  .step("check", staleRead, { dependsOn: [], replay: "always-rerun", bind: ({ input }) => ({ eid: input.eid }) })
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["before"], prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => ({ eid: outputs.before.eid }) },
    commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
  .childRun("child", { id: sourceBoundReadDescriptor.id, input: Input, result: sourceBoundReadContract.output }, {
    dependsOn: [], edgeId: DelegationEdgeIdSchema.parse("child"), cardinality: "one", await: "terminal", join: "one",
    policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
    bind: ({ input }) => ({ eid: input.eid }), deriveChildItemId: (_input, identity) => identity.canonicalItemId })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });

for (const [door, probe] of [["resume", "absent"], ["recover", "absent"], ["resume", "present"]] as const) it(`replays its own settled transaction from the receipt after ${door} when a later read differs${probe === "present" ? " and the record was already present" : ""}`, async () => {
  const changed = EidSchema.parse("10899999"), hooks: { settled?: () => boolean; onRead?: (memo: string | undefined) => void } = {};
  const h = await sourceBoundHarness(ownSettlementDescriptor, world => {
    const read = defineTask(staleRead, { sessions: [], async run({ input, ctx }) {
      hooks.onRead?.(input.memo);
      const eid = input.memo === "source" && hooks.settled?.() === true ? changed : input.eid;
      ctx.recordData({ direction: "read", field: "eid", value: eid });
      return { eid };
    } });
    const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([defineServiceStore("ocr", { read }), ...writes.stores], {
      scenarioIds: [...staleRead.scenarios, ...writes.corpus.scenarioIds],
      tasks: [{ id: staleRead.id, effect: staleRead.effect }, ...writes.corpus.tasks],
    });
  }, undefined, undefined, undefined, [staleChildDescriptor], undefined, true);
  cleanups.push(h.dispose);
  h.world.probeResults.push(probe === "present" ? { state: "present", proof: { transactionId: "T123456" } } : absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID));
  const rows = (nodeId: string) => h.database.authority.runCheckpoints.listByItem(source.envelope.workflow, source.envelope.itemId).filter(row => row.nodeId === nodeId);
  const failures = (runId: string) => JSON.stringify(h.database.authority.failures.listByRun(runId));
  hooks.settled = () => rows(WRITE_FIXTURE_NODE_ID).length > 0;
  let stopped = false;
  hooks.onRead = memo => {
    h.clock.advanceWall(1);
    if (stopped || memo !== (door === "resume" ? "source" : undefined)) return;
    stopped = true;
    if (door === "recover") throw new Error("fixture check failure");
    const active = h.fresh(source);
    requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version }));
  };
  assert.equal((await h.execute(source)).state, door === "resume" ? "abandoned" : "failed", failures(source.envelope.runId));
  const halted = h.fresh(source);
  h.clock.advanceWall(1_000);
  const next = door === "resume"
    ? requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: halted.envelope.runId, expectedVersion: halted.version }))
    : operatorRecover({ ...h, failed: halted }, halted);
  assert.ok(next.envelope.continuation);
  assert.equal((await h.execute(next)).state, "yielded-delegation", failures(next.envelope.runId));
  const children = h.database.authority.runs.listChildren(next.envelope.runId); assert.equal(children.length, 1);
  for (const member of children) assert.equal((await h.execute(member)).state, "done", failures(member.envelope.runId));
  h.clock.advanceWall(1_000);
  const outcome = await h.execute(next);
  assert.equal(outcome.state, "done", failures(next.envelope.runId));
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, probe === "present" ? 0 : 1);
  if (probe === "absent") assert.deepEqual(h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST).map(intent => intent.status), ["committed"]);
  assert.equal(h.database.authority.runs.listByWorkflow(sourceBoundReadDescriptor.id).length, 1);
  const settlement = rows(WRITE_FIXTURE_NODE_ID); assert.equal(settlement.length, 1);
  if (probe === "present") assert.match(JSON.stringify(settlement[0]?.output), /"disposition":"already-present"/u);
  const latest = rows("before").at(-1); assert.ok(latest); assert.equal(latest.runId, next.envelope.runId);
  assert.match(JSON.stringify(latest.output), new RegExp(changed, "u"));
});

it("refuses own-run transaction reuse when a conditional mapping task reaches an in-flight child replacement", async () => {
  const replaced = EidSchema.parse("10899999");
  const mappedEid = ({ outputs }: { outputs: { mapped?: { eid: z.output<typeof EidSchema> } } }) => {
    if (outputs.mapped === undefined) throw new Error("mapped skipped"); return { eid: outputs.mapped.eid };
  };
  const selected = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
    .childRun("child", { id: staleChildDescriptor.id, input: Input, result: sourceBoundReadContract.output }, {
      dependsOn: [], edgeId: DelegationEdgeIdSchema.parse("child"), cardinality: "many", await: "terminal", join: "all-settled",
      policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      bind: ({ input }) => [{ eid: input.eid }, { eid: replaced }], deriveChildItemId: (_input, identity) => identity.canonicalItemId })
    .step("mapped", staleRead, { dependsOn: ["child"], replay: "always-rerun", when: { kind: "equals", of: { from: "input", path: "eid" }, value: WRITE_FIXTURE_EID },
      bind: ({ outputs }) => {
        const first = outputs.child[0]; if (first?.state !== "done") throw new Error("first child not done");
        return { eid: outputs.child[1]?.state === "done" ? outputs.child[1].output.eid : first.output.eid };
      } })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["mapped"], prepare: { uses: WriteFixturePrepare, bind: mappedEid },
      commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .transaction("later-write", { dependsOn: ["mapped"], prepare: { uses: WriteFixturePrepare, bind: mappedEid },
      commit: { uses: WriteFixtureCommit, bind: () => ({ eid: replaced }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
  let replacedReads = 0;
  const h = await sourceBoundHarness(selected, world => {
    const read = defineTask(staleRead, { sessions: [], async run({ input, ctx }) {
      h.clock.advanceWall(1);
      if (input.eid === replaced && (replacedReads += 1) === 1) throw new Error("fixture member failure");
      ctx.recordData({ direction: "read", field: "eid", value: input.eid });
      return { eid: input.eid };
    } });
    const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([defineServiceStore("ocr", { read }), ...writes.stores], {
      scenarioIds: [...staleRead.scenarios, ...writes.corpus.scenarioIds],
      tasks: [{ id: staleRead.id, effect: staleRead.effect }, ...writes.corpus.tasks],
    });
  }, undefined, undefined, undefined, [staleChildDescriptor], undefined, true);
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()), absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID));
  const failures = (runId: string) => JSON.stringify(h.database.authority.failures.listByRun(runId));
  const commits = () => h.world.events.filter(event => event.startsWith("commit-click:")).length;
  assert.equal((await h.execute(source)).state, "yielded-delegation", failures(source.envelope.runId));
  const members = h.database.authority.runs.listChildren(source.envelope.runId); assert.equal(members.length, 2);
  for (const member of members) assert.ok(["done", "failed"].includes((await h.execute(member)).state));
  h.world.onCommitClick = () => {
    const active = h.fresh(source);
    requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version }));
  };
  assert.equal((await h.execute(source)).state, "abandoned", failures(source.envelope.runId));
  delete h.world.onCommitClick;
  assert.equal(commits(), 1);
  const failedChild = h.database.authority.runs.listChildren(source.envelope.runId)
    .find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failedChild);
  const replacement = operatorRecover({ ...h, failed: failedChild }, failedChild);
  assert.equal((await h.execute(replacement)).state, "done", failures(replacement.envelope.runId));
  h.clock.advanceWall(1_000);
  const paused = h.fresh(source); assert.equal(paused.pause?.state, "paused");
  const resumed = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: paused.envelope.runId, expectedVersion: paused.version }));
  assert.equal((await h.execute(resumed)).state, "failed", failures(resumed.envelope.runId));
  const failure = h.database.authority.failures.listByRun(resumed.envelope.runId).at(-1);
  assert.equal(failure?.code, "RUN_CONTINUATION_REFUSED", JSON.stringify(failure));
  assert.match(JSON.stringify(failure), /run-continuation-original-child-authority-unavailable/u);
  assert.equal(commits(), 1);
});

const changedSourceDescriptor = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .step("before", staleRead, { dependsOn: [], replay: "always-rerun", bind: ({ input }) => ({ eid: input.eid, memo: "source" }) })
  .step("mapped", staleRead, { dependsOn: ["before"], replay: "checkpoint", bind: ({ outputs }) => ({ eid: outputs.before.eid }) })
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["mapped"], prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => ({ eid: outputs.mapped.eid }) },
    commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => ({ eid: outputs.mapped.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });

for (const interrupted of [false, true]) it(`refuses a paused run whose completed downstream checkpoint no longer matches its re-read source${interrupted ? " after a pause inside the re-read" : ""}`, async () => {
  const sourceValues = [WRITE_FIXTURE_EID, EidSchema.parse("10899999")];
  const hooks: { onSource?: () => void; onMapped?: () => void } = {};
  const h = await sourceBoundHarness(changedSourceDescriptor, world => {
    const read = defineTask(staleRead, { sessions: [], async run({ input, ctx }) {
      const eid = input.memo === "source" ? sourceValues.shift() : input.eid; assert.ok(eid);
      ctx.recordData({ direction: "read", field: "eid", value: eid });
      if (input.memo === "source") hooks.onSource?.(); else hooks.onMapped?.();
      return { eid };
    } });
    const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([defineServiceStore("ocr", { read }), ...writes.stores], {
      scenarioIds: [...staleRead.scenarios, ...writes.corpus.scenarioIds],
      tasks: [{ id: staleRead.id, effect: staleRead.effect }, ...writes.corpus.tasks],
    });
  });
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID));
  // Only "before" ages past its 0 ms bound; "mapped" stays fresh, so the input comparison alone guards the write.
  hooks.onSource = () => h.clock.advanceWall(1);
  hooks.onMapped = () => {
    const active = h.fresh(source);
    requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version }));
  };
  assert.equal((await h.execute(source)).state, "abandoned", JSON.stringify(h.database.authority.failures.listByRun(source.envelope.runId)));
  delete hooks.onSource; delete hooks.onMapped;
  const paused = h.fresh(source); assert.equal(paused.pause?.state, "paused");
  let resumed = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: paused.envelope.runId, expectedVersion: paused.version }));
  if (interrupted) {
    // The re-read publishes its row, then the claim ends before "mapped" is compared; both rows are fresh on the next resume.
    hooks.onSource = () => {
      const active = h.fresh(source);
      requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version }));
    };
    assert.equal((await h.execute(resumed)).state, "abandoned", JSON.stringify(h.database.authority.failures.listByRun(source.envelope.runId)));
    delete hooks.onSource;
    const again = h.fresh(source); assert.equal(again.pause?.state, "paused");
    resumed = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: again.envelope.runId, expectedVersion: again.version }));
  }
  assert.equal((await h.execute(resumed)).state, "failed");
  const failure = h.database.authority.failures.listByRun(resumed.envelope.runId).at(-1);
  assert.equal(failure?.code, interrupted ? "RESUME_VALIDATION_FAILED" : "RUN_CONTINUATION_REFUSED", JSON.stringify(failure));
  assert.match(JSON.stringify(failure), interrupted ? /Completed node \\"mapped\\" has incompatible corrected input/u : /run-continuation-task-input-mismatch/u);
  assert.deepEqual(sourceValues, []);
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 0);
  assert.deepEqual(h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST), []);
});

const childAfterReadDescriptor = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .step("before", sourceBoundReadContract, { dependsOn: [], replay: "always-rerun", bind: ({ input }) => ({ eid: input.eid, memo: "source" }) })
  .childRun("child", { id: sourceBoundReadDescriptor.id, input: Input, result: sourceBoundReadContract.output }, {
    dependsOn: ["before"], edgeId: DelegationEdgeIdSchema.parse("child"), cardinality: "one", await: "terminal", join: "one",
    policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
    bind: ({ outputs }) => ({ eid: outputs.before.eid }), deriveChildItemId: (_input, identity) => identity.canonicalItemId })
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["child"],
    prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => { if (outputs.child.state !== "done") throw new Error("child not done"); return { eid: outputs.child.output.eid }; } },
    commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => { if (outputs.child.state !== "done") throw new Error("child not done"); return { eid: outputs.child.output.eid }; } },
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
  .step("finish", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid, memo: "finish" }) })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });

// The clock never moves, so the parent's re-read row carries the delegation manifest's own createdAt.
for (const changed of [false, true]) it(`${changed ? "refuses" : "reuses"} a retained delegation on Recover when the parent re-read its input at the manifest's wall time${changed ? " with a new value" : ""}`, async () => {
  const sourceValues = [WRITE_FIXTURE_EID, changed ? EidSchema.parse("10899999") : WRITE_FIXTURE_EID];
  let finishCalls = 0;
  const h = await sourceBoundHarness(childAfterReadDescriptor, world => {
    const read = defineTask(sourceBoundReadContract, { sessions: [], async run({ input, ctx }) {
      if (input.memo === "finish" && (finishCalls += 1) === 1) throw new Error("fixture downstream failure");
      const eid = input.memo === "source" ? sourceValues.shift() : input.eid; assert.ok(eid);
      ctx.recordData({ direction: "read", field: "eid", value: eid });
      return { eid };
    } });
    const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([defineServiceStore("ocr", { read }), ...writes.stores], {
      scenarioIds: [...sourceBoundReadContract.scenarios, ...writes.corpus.scenarioIds],
      tasks: [{ id: sourceBoundReadContract.id, effect: sourceBoundReadContract.effect }, ...writes.corpus.tasks],
    });
  }, undefined, undefined, undefined, [sourceBoundReadDescriptor], undefined, true);
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID));
  const failures = () => JSON.stringify(h.database.authority.failures.listByRun(source.envelope.runId));
  assert.equal((await h.execute(source)).state, "yielded-delegation", failures());
  const children = h.database.authority.runs.listChildren(source.envelope.runId); assert.equal(children.length, 1);
  for (const member of children) assert.equal((await h.execute(member)).state, "done");
  assert.equal((await h.execute(source)).state, "failed");
  const manifest = h.database.authority.delegationManifests.listByParentRun(source.envelope.runId)[0]; assert.ok(manifest);
  const rows = h.database.authority.runCheckpoints.listByItem(source.envelope.workflow, source.envelope.itemId).filter(row => row.nodeId === "before");
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.writtenAt, manifest.createdAt);
  const failed = h.fresh(source), next = operatorRecover({ ...h, failed }, failed);
  const outcome = await h.execute(next);
  const commits = h.world.events.filter(event => event.startsWith("commit-click:")).length;
  assert.deepEqual(sourceValues, []);
  assert.equal(h.database.authority.runs.listByWorkflow(sourceBoundReadDescriptor.id).length, 1);
  if (!changed) {
    assert.equal(outcome.state, "done", JSON.stringify(h.database.authority.failures.listByRun(next.envelope.runId)));
    assert.equal(commits, 1);
    return;
  }
  assert.equal(outcome.state, "failed");
  const failure = h.database.authority.failures.listByRun(next.envelope.runId).at(-1);
  assert.equal(failure?.code, "RUN_CONTINUATION_REFUSED", JSON.stringify(failure));
  assert.match(JSON.stringify(failure), /run-continuation-child-input-mismatch/u);
  assert.equal(commits, 0);
  assert.deepEqual(h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST), []);
});

const inheritedChildDescriptor = defineWorkflowDescriptor({ id: sourceBoundReadDescriptor.id, version: 1,
  contractFingerprint: sourceBoundReadDescriptor.contractFingerprint, code: "sr", label: "Source read", icon: "Search", category: "operations",
  canonicalInput: sourceBoundReadDescriptor.canonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
  actions: sourceBoundReadDescriptor.actions, surfaces: {}, details: [], identity: { matchKey: (input) => input.eid },
  presentation: { title: (input) => input.eid }, scenarios: ["source-read/happy"],
  flow: flow(Input).step("read", staleRead, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: staleRead.output, dependsOn: ["read"], derive: ({ outputs }) => outputs.read }),
});

function inheritedInputDescriptor(child: boolean) {
  const start = flow(Input)
    .step("before", staleRead, { dependsOn: [], replay: "always-rerun", bind: ({ input }) => ({ eid: input.eid, memo: "source" }) })
    .step("check", staleRead, { dependsOn: ["before"], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid, memo: "check" }) });
  if (child) return defineWorkflowDescriptor({ ...metadata, flow: start
    .childRun("child", { id: sourceBoundReadDescriptor.id, input: Input, result: staleRead.output }, {
      dependsOn: ["before"], edgeId: DelegationEdgeIdSchema.parse("child"), cardinality: "one", await: "terminal", join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      bind: ({ outputs }) => ({ eid: outputs.before.eid }), deriveChildItemId: (_input, identity) => identity.canonicalItemId })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["before", "child"],
      prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => { if (outputs.child.state !== "done") throw new Error("child not done"); return { eid: outputs.child.output.eid }; } },
      commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => { if (outputs.child.state !== "done") throw new Error("child not done"); return { eid: outputs.child.output.eid }; } },
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
  return defineWorkflowDescriptor({ ...metadata, flow: start
    .step("mapped", staleRead, { dependsOn: ["before", "check"], replay: "checkpoint", bind: ({ outputs }) => ({ eid: outputs.before.eid }) })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["mapped"], prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => ({ eid: outputs.mapped.eid }) },
      commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => ({ eid: outputs.mapped.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
}

for (const child of [true, false]) for (const changed of [false, true]) it(`R-${child ? 4 : 5} ${changed ? "refuses changed" : "reuses unchanged"} inherited ${child ? "delegation" : "task"} input after its reference was replaced on Resume`, async () => {
  const sourceValues = [WRITE_FIXTURE_EID, changed ? EidSchema.parse("10899999") : WRITE_FIXTURE_EID];
  const hooks: { onSource?: () => void; onMapped?: () => void; onCheck?: () => void } = {};
  let checkCalls = 0;
  const h = await sourceBoundHarness(inheritedInputDescriptor(child), world => {
    const read = defineTask(staleRead, { sessions: [], async run({ input, ctx }) {
      if (input.memo === "check") {
        if (++checkCalls === 1) throw new Error("fixture downstream failure");
        hooks.onCheck?.();
      }
      const eid = input.memo === "source" ? sourceValues.shift() : input.eid; assert.ok(eid);
      ctx.recordData({ direction: "read", field: "eid", value: eid });
      if (input.memo === "source") hooks.onSource?.();
      else if (input.memo !== "check") hooks.onMapped?.();
      return { eid };
    } });
    const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([defineServiceStore("ocr", { read }), ...writes.stores], {
      scenarioIds: [...staleRead.scenarios, ...writes.corpus.scenarioIds],
      tasks: [{ id: staleRead.id, effect: staleRead.effect }, ...writes.corpus.tasks],
    });
  }, undefined, undefined, undefined, child ? [inheritedChildDescriptor] : [], undefined, true);
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID));
  if (!child) hooks.onCheck = () => h.clock.advanceWall(1);
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source), parent = operatorRecover({ ...h, failed });
  const failures = (run = parent) => JSON.stringify(h.database.authority.failures.listByRun(run.envelope.runId));
  const pause = () => { const active = h.fresh(parent); requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version })); };
  const resume = () => { const active = h.fresh(parent); return requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version })); };
  if (child) {
    assert.equal((await h.execute(parent)).state, "yielded-delegation", failures());
    const members = h.database.authority.runs.listChildren(parent.envelope.runId); assert.equal(members.length, 1);
    const member = members[0]; assert.ok(member);
    assert.equal((await h.execute(member)).state, "done");
    h.clock.advanceWall(1);
  } else {
    hooks.onMapped = pause;
    assert.equal((await h.execute(parent)).state, "abandoned", failures());
    delete hooks.onMapped;
    assert.equal(h.database.authority.runCheckpoints.listByAttempt(parent.envelope.workflow, parent.envelope.itemId, "before", parent.envelope.attempt).length, 0);
    resume();
  }
  hooks.onSource = pause;
  assert.equal((await h.execute(h.fresh(parent))).state, "abandoned", failures());
  delete hooks.onSource;
  let next = resume();
  assert.equal(next.envelope.continuation?.checkpoints.find(row => row.nodeId === "before")?.runId, parent.envelope.runId);
  if (child) {
    assert.equal((await h.execute(next)).state, "failed", failures());
    assert.match(failures(), /delegation-replay-divergent/u);
    const stopped = h.fresh(parent);
    next = operatorRecover({ ...h, failed: stopped });
  }
  const outcome = await h.execute(next), detail = failures(next);
  assert.equal(outcome.state, changed ? "failed" : "done", detail);
  assert.deepEqual(sourceValues, []);
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, changed ? 0 : 1);
  if (child) assert.equal(h.database.authority.runs.listByWorkflow(sourceBoundReadDescriptor.id).length, 1);
  if (changed) {
    const failure = h.database.authority.failures.listByRun(next.envelope.runId).at(-1);
    assert.equal(failure?.code, child ? "RUN_CONTINUATION_REFUSED" : "RESUME_VALIDATION_FAILED", detail);
    assert.match(detail, child ? /run-continuation-child-input-mismatch/u : /Completed node \\"mapped\\" has incompatible corrected input/u);
    assert.deepEqual(h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST), []);
  }
});

it("omits a stored conditional dependency that the completed consumer never saw", async () => {
  const selected = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
    .step("before", staleRead, { dependsOn: [], replay: "always-rerun", bind: ({ input }) => ({ eid: input.eid, memo: "source" }) })
    .step("optional", staleRead, { dependsOn: ["before"], replay: "checkpoint", bind: ({ outputs }) => ({ eid: outputs.before.eid }),
      when: { kind: "equals", of: { from: "node", nodeId: "before", path: "eid" }, value: WRITE_FIXTURE_EID } })
    .step("check", staleRead, { dependsOn: ["before"], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid, memo: "check" }) })
    .step("mapped", staleRead, { dependsOn: ["before", "optional", "check"], replay: "checkpoint",
      bind: ({ input, outputs }) => ({ eid: input.eid, memo: outputs.optional === undefined ? "skipped" : "present" }) })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["mapped"], prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => ({ eid: outputs.mapped.eid }) },
      commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => ({ eid: outputs.mapped.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
  let checkCalls = 0, sourceCalls = 0;
  const hooks: { onMapped?: () => void } = {};
  const h = await sourceBoundHarness(selected, world => {
    const read = defineTask(staleRead, { sessions: [], async run({ input, ctx }) {
      if (input.memo === "check" && ++checkCalls === 1) throw new Error("fixture downstream failure");
      const eid = input.memo === "source" && ++sourceCalls > 1 ? EidSchema.parse("10899999") : input.eid;
      ctx.recordData({ direction: "read", field: "eid", value: eid });
      if (input.memo === "skipped") hooks.onMapped?.();
      return { eid };
    } });
    const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([defineServiceStore("ocr", { read }), ...writes.stores], {
      scenarioIds: [...staleRead.scenarios, ...writes.corpus.scenarioIds],
      tasks: [{ id: staleRead.id, effect: staleRead.effect }, ...writes.corpus.tasks],
    });
  });
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID));
  assert.equal((await h.execute(source)).state, "failed");
  h.clock.advanceWall(1);
  const failed = h.fresh(source), next = operatorRecover({ ...h, failed });
  hooks.onMapped = () => { const active = h.fresh(next); requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version })); };
  assert.equal((await h.execute(next)).state, "abandoned", JSON.stringify(h.database.authority.failures.listByRun(next.envelope.runId)));
  delete hooks.onMapped;
  const paused = h.fresh(next), resumed = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: paused.envelope.runId, expectedVersion: paused.version }));
  assert.equal((await h.execute(resumed)).state, "done", JSON.stringify(h.database.authority.failures.listByRun(resumed.envelope.runId)));
  assert.equal(sourceCalls, 2);
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
});

it("reuses a retained delegation whose conditional prerequisite depends on a node it was not admitted from", async () => {
  const selected = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
    .step("before", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
    .step("optional", sourceBoundReadContract, { dependsOn: ["before"], replay: "checkpoint", bind: ({ outputs }) => ({ eid: outputs.before.eid }),
      when: { kind: "is-present", of: { from: "node", nodeId: "before", path: "eid" } } })
    .childRun("child", { id: sourceBoundReadDescriptor.id, input: Input, result: sourceBoundReadContract.output }, {
      dependsOn: ["optional"], edgeId: DelegationEdgeIdSchema.parse("child"), cardinality: "one", await: "terminal", join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      bind: ({ outputs }) => { assert.ok(outputs.optional); return { eid: outputs.optional.eid }; },
      deriveChildItemId: (_input, identity) => identity.canonicalItemId })
    .step("finish", sourceBoundReadContract, { dependsOn: ["child"], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid, memo: "finish" }) })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["child", "finish"],
      prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => { if (outputs.child.state !== "done") throw new Error("child not done"); return { eid: outputs.child.output.eid }; } },
      commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => { if (outputs.child.state !== "done") throw new Error("child not done"); return { eid: outputs.child.output.eid }; } },
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
  let finishCalls = 0;
  const h = await sourceBoundHarness(selected, world => {
    const read = defineTask(sourceBoundReadContract, { sessions: [], async run({ input, ctx }) {
      if (input.memo === "finish" && ++finishCalls === 1) throw new Error("fixture downstream failure");
      ctx.recordData({ direction: "read", field: "eid", value: input.eid }); return { eid: input.eid };
    } });
    const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([defineServiceStore("ocr", { read }), ...writes.stores], {
      scenarioIds: [...sourceBoundReadContract.scenarios, ...writes.corpus.scenarioIds],
      tasks: [{ id: sourceBoundReadContract.id, effect: sourceBoundReadContract.effect }, ...writes.corpus.tasks],
    });
  }, undefined, undefined, undefined, [sourceBoundReadDescriptor], undefined, true);
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID));
  assert.equal((await h.execute(source)).state, "yielded-delegation");
  const [child] = h.database.authority.runs.listChildren(source.envelope.runId); assert.ok(child);
  assert.equal((await h.execute(child)).state, "done");
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source); assert.equal(h.database.authority.failures.listByRun(failed.envelope.runId)[0]?.nodeId, "finish");
  const next = operatorRecover({ ...h, failed });
  assert.equal((await h.execute(next)).state, "done", JSON.stringify(h.database.authority.failures.listByRun(next.envelope.runId)));
  assert.equal(h.database.authority.runs.listByWorkflow(sourceBoundReadDescriptor.id).length, 1);
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
  assert.deepEqual(h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST).map(intent => intent.status), ["committed"]);
});
