import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { compileWorkflowOperationDisplay, OPERATION_DISPLAY_FORMAT_VERSION, type TaskOperationDeclaration, type WorkflowOperationEntryProjection } from "../../../../src/models/workflow/operation-display.js";
import { createConfirmedActionPublisher } from "../../../../src/backend/logs/confirmed-action-publisher.js";
import type { ConfirmedActionEvent } from "../../../../src/models/events/confirmed-action.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { DelegationEdgeIdSchema, EidSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { RerunSourceSchema } from "../../../../src/models/run/rerun.js";
import { captureRunContinuation } from "../../../../src/backend/runtime/checkpoints/run-continuation.js";
import { AuthenticatedRunContinuation } from "../../../../src/backend/runtime/checkpoints/run-continuation-delegation.js";
import { previewRerunWarnings, RerunRefusedError, validateCompletedTransactionContinuations } from "../../../../src/backend/runs/start/rerun.js";
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
const memoCommit = defineTaskContract({ ...WriteFixtureCommit, input: Input });
const commitMemoDescriptor = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: [], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
    commit: { uses: memoCommit, bind: ({ input }) => ({ eid: input.eid, memo: input.memo }) },
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

function completeDescriptor() {
  const entries: WorkflowOperationEntryProjection[] = descriptorRuntimeNodes(descriptor).map(node => {
    if (node.kind !== "task" && node.kind !== "transaction") throw new Error("unexpected display fixture node");
    const contracts = node.kind === "task" ? [{ role: "task" as const, contract: node.uses }]
      : node.kind === "transaction" ? [{ role: "prepare" as const, contract: node.prepare.uses }, { role: "commit" as const, contract: node.commit.uses }] : [];
    return { id: String(node.id), kind: node.kind,
      dependsOn: node.dependsOn.map(String), contracts: contracts.map(({ role, contract }) => {
        const operation: TaskOperationDeclaration = { version: OPERATION_DISPLAY_FORMAT_VERSION, id: `fixture-${role}`,
          system: role === "task" ? "local" : "ucpath", session: role === "task" ? { kind: "local", id: "fixture-local" }
            : { kind: "browser", id: "fixture-browser", system: "ucpath" }, actions: [{ id: "observe", kind: "compute" }] };
        return { role, contract: { ...contract, operation } };
      }) };
  });
  const invocations = entries.flatMap(entry => entry.contracts.map(contract => ({ id: `${entry.id}-${contract.role}`, entryId: entry.id,
    contractRole: contract.role, occurrencePath: [entry.id, contract.role], bindings: [] })));
  return defineWorkflowDescriptor({ ...metadata, flow: graph, operationDisplay: compileWorkflowOperationDisplay({ workflowId: descriptor.id, input: Input, entries,
    declaration: { capability: "complete", version: OPERATION_DISPLAY_FORMAT_VERSION, invocations,
      presentation: invocations.map(invocation => ({ id: `${invocation.id}-node`, kind: "operation", invocationId: invocation.id })) } }) });
}
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(failOn: readonly number[] = [2], selected: AnyWorkflowDescriptor = descriptor,
  publisherFactory?: Parameters<typeof sourceBoundHarness>[5], children: readonly AnyWorkflowDescriptor[] = [], pauseAtCommit = false) {
  const h = await sourceBoundHarness(selected, world => {
    const reads = sourceBoundReadStores(world, failOn), writes = buildWriteFixtureRegistry(world, selected === commitMemoDescriptor ? memoCommit : WriteFixtureCommit);
    return defineTaskStoreRegistry([...reads.stores, ...writes.stores], {
      scenarioIds: [...reads.corpus.scenarioIds, ...writes.corpus.scenarioIds], tasks: [...reads.corpus.tasks, ...writes.corpus.tasks],
    });
  }, undefined, undefined, undefined, publisherFactory, children);
  cleanups.push(h.dispose);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID));
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
  else assert.equal(h.database.authority.failures.listByRun(failed.envelope.runId)[0]?.nodeId, "finish");
  return { ...h, get descriptor() { return h.descriptor; }, failed };
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
    runtimeConfig: selectRunRuntime(h.database.authority), appVersion: "0.1.0" }, h.descriptor, { title: "Transaction continuation", actorId: "local-operator" });
}
function operatorRetry(h: Fixture, run = h.failed) {
  const result = h.kernel.execute({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
    source: "dashboard", family: "run", type: "retry", target: { runId: run.envelope.runId, expectedVersion: run.version } });
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
    browserMode: source.envelope.browserMode, retryOf: source.envelope.runId,
    input: { ...source.input, raw: corrected, parsed: { ...source.input.parsed, value: corrected } },
    sourceBound: source.envelope.sourceBound, continuation: captureRunContinuation(h.database.authority, source),
    runtimeConfig: selectRunRuntime(h.database.authority) }, { title: "Corrected transaction continuation", actorId: "local-operator" }));
}

for (const door of ["retry", "start"] as const) it(`${door} replays a completed dependent read only after the transaction restores its semantic output`, async () => {
  const h = await fixture([3], receiptDescriptor), before = effects(h);
  assert.equal(h.world.events.filter(event => event === "read:T123456").length, 1);
  const next = door === "retry" ? requireLifecycleApplied(retry(h))
    : h.start(h.proposal(h.failed, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID));
  assert.equal((await h.execute(next)).state, "done");
  assert.deepEqual(effects(h), before);
  assert.equal(h.world.events.filter(event => event === "read:T123456").length, 1);
});

for (const door of ["retry", "start"] as const) it(`${door} reuses authenticated child-dependent transaction and receipt without relaunching the child`, async () => {
  const h = await fixture([3], childReceiptDescriptor, undefined, [sourceBoundReadDescriptor]), before = effects(h);
  const children = h.database.authority.runs.listChildren(h.failed.envelope.runId); assert.equal(children.length, 1);
  const next = door === "retry" ? requireLifecycleApplied(retry(h)) : h.start(h.proposal(h.failed, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID));
  assert.equal((await h.execute(next)).state, "done");
  assert.deepEqual(effects(h), before);
  assert.deepEqual(h.database.authority.runs.listChildren(h.failed.envelope.runId), children);
  assert.equal(h.database.authority.runs.listByWorkflow(sourceBoundReadDescriptor.id).length, 1);
  assert.equal(h.world.events.filter(event => event === "read:T123456").length, 1);
});

for (const changed of [false, true]) it(`authenticates original all-settled members after a post-terminal replacement with ${changed ? "changed" : "unchanged"} mappings`, async () => {
  const h = await fixture([2, 4], partialChildDescriptor(changed), undefined, [sourceBoundReadDescriptor]);
  const originals = h.database.authority.runs.listChildren(h.failed.envelope.runId), before = effects(h);
  assert.equal(originals.length, 2);
  const done = originals.find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done"); assert.ok(done);
  const next = operatorRetry(h);
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
  const h = await fixture([2], partialChildDescriptor(true), undefined, [sourceBoundReadDescriptor], true), before = effects(h);
  const failedChild = h.database.authority.runs.listChildren(h.failed.envelope.runId)
    .find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failedChild);
  const replacement = operatorRetry(h, failedChild);
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
  const h = await fixture([3], childReceiptDescriptor, undefined, [sourceBoundReadDescriptor]), before = effects(h);
  const repositories = h.database.authority;
  assert.throws(() => validateCompletedTransactionContinuations({ ...repositories,
    runResults: { ...repositories.runResults, get: () => undefined } }, h.descriptor, h.failed));
  const actual = repositories.dependencies.evidence(h.failed.envelope.runId, "child");
  assert.throws(() => validateCompletedTransactionContinuations({ ...repositories,
    dependencies: { ...repositories.dependencies, evidence: () => ({ ...actual, parentRunId: RunIdSchema.parse(randomUUID()) }) } }, h.descriptor, h.failed),
  /delegation-owner-mismatch/u);
  assert.deepEqual(effects(h), before);
});

it("keeps a real publisher healthy when complete-display continuation reuses a transaction without a new submit", async () => {
  const events: ConfirmedActionEvent[] = [];
  const h = await fixture([2], descriptor, (clock, workerId) => createConfirmedActionPublisher({ clock, workerId,
    streamId: "transaction-continuation", capacity: 32, append: event => { events.push(event); } }));
  assert.equal(h.publisher?.health().state, "healthy");
  const before = effects(h), confirmations = [...events];
  h.registerDescriptor(completeDescriptor());
  const plan = h.proposal(h.failed, undefined, false, WRITE_FIXTURE_EID, WRITE_FIXTURE_EID);
  const next = h.start(plan); assert.equal(next.envelope.operationDisplayCapability, "complete"); assert.ok(next.envelope.operationDisplaySnapshot);
  assert.equal((await h.execute(next)).state, "done");
  assert.equal(h.publisher?.health().state, "healthy");
  assert.deepEqual(events, confirmations);
  assert.deepEqual(effects(h), before);
});

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

it("refuses a commit-only non-key correction with unchanged prepare input and natural key", async () => {
  const h = await fixture([1], commitMemoDescriptor), before = effects(h);
  assert.throws(() => h.proposal(h.failed, undefined, false, WRITE_FIXTURE_EID, "changed commit memo"),
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
