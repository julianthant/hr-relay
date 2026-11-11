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
    assert.equal(failure.nodeId, "finish", `${failure.code}: ${failure.summary}`); assert.equal(failure.code, "UNHANDLED");
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

const changedSourceDescriptor = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .step("before", staleRead, { dependsOn: [], replay: "always-rerun", bind: ({ input }) => ({ eid: input.eid, memo: "source" }) })
  .step("mapped", staleRead, { dependsOn: ["before"], replay: "checkpoint", bind: ({ outputs }) => ({ eid: outputs.before.eid }) })
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["mapped"], prepare: { uses: WriteFixturePrepare, bind: ({ outputs }) => ({ eid: outputs.mapped.eid }) },
    commit: { uses: WriteFixtureCommit, bind: ({ outputs }) => ({ eid: outputs.mapped.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });

it("refuses a paused run whose completed downstream checkpoint no longer matches its re-read source", async () => {
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
  const resumed = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: paused.envelope.runId, expectedVersion: paused.version }));
  assert.equal((await h.execute(resumed)).state, "failed");
  const failure = h.database.authority.failures.listByRun(resumed.envelope.runId)[0];
  assert.equal(failure?.code, "RUN_CONTINUATION_REFUSED", JSON.stringify(failure));
  assert.match(JSON.stringify(failure), /run-continuation-task-input-mismatch/u);
  assert.deepEqual(sourceValues, []);
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 0);
  assert.deepEqual(h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST), []);
});
