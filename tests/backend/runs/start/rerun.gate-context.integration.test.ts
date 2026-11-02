import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { validateCompletedTransactionContinuations } from "../../../../src/backend/runs/start/recovery-plan.js";
import { RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { sourceBoundReadContract, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, writeFixtureMemoDescriptor as prior,
  WriteFixtureCommit, WriteFixturePrepare, WRITE_FIXTURE_EID, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";

const Input = z.strictObject({ eid: EidSchema, memo: z.string().optional() });
const Approval = z.strictObject({ approved: z.boolean() });
const metadata = { id: prior.id, version: prior.version, contractFingerprint: prior.contractFingerprint,
  code: prior.code, label: prior.label, icon: prior.icon, category: prior.category,
  canonicalInput: defineCanonicalInput(Input, Input, [{ eid: WRITE_FIXTURE_EID }]), inputSubject: "eid",
  surface: prior.surface, enqueue: prior.enqueue, actions: prior.actions, surfaces: {}, details: [],
  identity: { matchKey: (input: z.output<typeof Input>) => `eid:${input.eid}` },
  presentation: { title: (input: z.output<typeof Input>) => input.eid }, scenarios: ["write-fixture/happy"],
} as const;
const skippedGateFlow = () => flow(Input).gate("approval", { dependsOn: [], label: "Approve identity", resolvedBy: "operator", result: Approval,
  when: { kind: "equals", of: { from: "input", path: "memo" }, value: "needs-approval" } });
const optionalConsumer = defineWorkflowDescriptor({ ...metadata, flow: skippedGateFlow()
  .step("consumer", sourceBoundReadContract, { dependsOn: ["approval"], replay: "checkpoint",
    bind: ({ input, outputs }) => ({ eid: input.eid, memo: outputs.approval?.approved ? "approved" : "supplied-eid" }) })
  .step("finish", sourceBoundReadContract, { dependsOn: ["consumer"], replay: "checkpoint", bind: ({ input }) => input })
  .build({ schema: sourceBoundReadContract.output, dependsOn: ["consumer"], derive: ({ outputs }) => outputs.consumer }) });
const gateTransaction = defineWorkflowDescriptor({ ...metadata, flow: skippedGateFlow()
  .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["approval"],
    prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
    commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
  .step("finish", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint", bind: ({ input }) => input })
  .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }) });
const ordinaryGate = defineWorkflowDescriptor({ ...metadata, flow: flow(Input)
  .step("fresh", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
  .gate("approval", { dependsOn: ["fresh"], label: "Approve identity", resolvedBy: "operator", result: Approval })
  .step("finish", sourceBoundReadContract, { dependsOn: ["approval"], replay: "checkpoint", bind: ({ input }) => input })
  .build({ schema: sourceBoundReadContract.output, dependsOn: ["finish"], derive: ({ outputs }) => outputs.finish }) });

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function harness(descriptor: AnyWorkflowDescriptor, failOn: readonly number[], onRead?: () => void) {
  const h = await sourceBoundHarness(descriptor, world => {
    const reads = sourceBoundReadStores(world, failOn, onRead), writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([...reads.stores, ...writes.stores], {
      scenarioIds: [...reads.corpus.scenarioIds, ...writes.corpus.scenarioIds], tasks: [...reads.corpus.tasks, ...writes.corpus.tasks],
    });
  });
  cleanups.push(h.dispose);
  return h;
}
type Harness = Awaited<ReturnType<typeof harness>>;
function retry(h: Harness, source: ReturnType<Harness["fresh"]>) {
  return requireLifecycleApplied(h.lifecycle.recover({ commandId: randomUUID(), runId: source.envelope.runId, expectedVersion: source.version,
    runtimeConfig: selectRunRuntime(h.database.authority), appVersion: "0.1.0" }, h.descriptor, { title: "Continue after failure", actorId: "local-operator" }));
}
function transactionEffects(h: Harness) {
  const source = h.database.authority.runs.listByWorkflow(h.descriptor.id)[0]; assert.ok(source);
  return { events: h.world.events.filter(event => !event.startsWith("read:")),
    intents: h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST),
    checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId).filter(row => row.nodeId === WRITE_FIXTURE_NODE_ID),
    confirmations: h.database.authority.timelineEvents.page({}).filter(row => row.payload.kind === "operation-confirmed") };
}

function operatorRecover(h: Harness, source: ReturnType<Harness["fresh"]>) {
  const result = h.kernel.execute({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
    source: "dashboard", family: "run", type: "recover-run", target: { runId: source.envelope.runId, expectedVersion: source.version } });
  assert.equal(result.state, "applied"); assert.ok(result.state === "applied");
  const target = result.affectedTargets[0]; assert.ok(target?.family === "run");
  const run = h.database.authority.runs.get(target.runId); assert.ok(run); return run;
}

for (const door of ["retry", "resume"] as const) it(`preserves a closed skipped gate for its completed optional consumer across ${door}`, async () => {
  let pause: (() => void) | undefined;
  const h = await harness(optionalConsumer, [2], () => pause?.());
  let source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID, "supplied-eid"));
  if (door === "resume") pause = () => {
    pause = undefined;
    const active = h.fresh(source);
    requireLifecycleApplied(h.lifecycle.pause({ commandId: randomUUID(), runId: active.envelope.runId, expectedVersion: active.version }));
  };
  assert.equal((await h.execute(source)).state, door === "resume" ? "abandoned" : "failed");
  source = h.fresh(source);
  if (door === "resume") {
    assert.equal(source.pause?.state, "paused");
    source = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: randomUUID(), runId: source.envelope.runId, expectedVersion: source.version }));
    assert.equal((await h.execute(source)).state, "failed");
    source = h.fresh(source);
  }
  assert.equal(h.database.authority.failures.listByRun(source.envelope.runId)[0]?.nodeId, "finish");
  const continued = retry(h, source);
  assert.equal((await h.execute(continued)).state, "done");
  assert.equal(h.world.events.filter(event => event === "read:supplied-eid").length, 2, "consumer runs once; only successful final work runs again");
  assert.equal(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId).filter(row => row.nodeId === "consumer").length, 1);
  assert.equal(h.database.authority.gateResults.listByRun(source.envelope.runId).length, 0);
});

it("authenticates own fresh-read checkpoints after ordinary gate resolution without a Pause self-capture", async () => {
  const h = await harness(ordinaryGate, [1]);
  let source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID, "ordinary-gate"));
  assert.equal((await h.execute(source)).state, "failed"); source = h.fresh(source);
  const continued = retry(h, source);
  assert.equal((await h.execute(continued)).state, "parked-gate");
  const parked = h.fresh(continued);
  assert.ok(!parked.envelope.continuation?.sources.some(row => row.runId === parked.envelope.runId));
  const ownCheckpoint = h.database.authority.runCheckpoints.listByAttempt(h.descriptor.id, parked.envelope.itemId, "fresh", parked.envelope.attempt);
  assert.equal(ownCheckpoint.length, 1); assert.equal(ownCheckpoint[0]?.runId, parked.envelope.runId);
  const resolved = h.kernel.execute({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
    source: "dashboard", family: "gate", type: "resolve-gate", target: { runId: parked.envelope.runId, gateId: "approval", expectedVersion: parked.version },
    payload: { result: { schemaHash: deriveSchemaHash(Approval, "output"), value: { approved: true } } } });
  assert.equal(resolved.state, "applied");
  const requeued = h.fresh(continued);
  assert.ok(!requeued.envelope.continuation?.sources.some(row => row.runId === requeued.envelope.runId));
  assert.equal((await h.execute(requeued)).state, "done");
  assert.deepEqual(h.database.authority.runCheckpoints.listByAttempt(h.descriptor.id, parked.envelope.itemId, "fresh", parked.envelope.attempt), ownCheckpoint);
  assert.equal(h.world.events.filter(event => event === "read:ordinary-gate").length, 2, "fresh read and final read execute once each");
});

for (const door of ["recover", "operator-recover"] as const) it(`${door} classifies a transaction's authenticated conditional-gate skip without inventing a result`, async () => {
  const h = await harness(gateTransaction, [1]);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  let source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID, "supplied-eid"));
  assert.equal((await h.execute(source)).state, "failed"); source = h.fresh(source);
  const before = transactionEffects(h);
  const next = door === "recover" ? retry(h, source) : operatorRecover(h, source);
  assert.equal((await h.execute(next)).state, "done");
  assert.deepEqual(transactionEffects(h), before);
});

it("refuses missing gate authority when corrected input makes the conditional gate required", async () => {
  const h = await harness(gateTransaction, [1]);
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const source = h.start(h.proposal(undefined, undefined, false, WRITE_FIXTURE_EID, "supplied-eid"));
  assert.equal((await h.execute(source)).state, "failed");
  const before = transactionEffects(h);
  assert.throws(() => validateCompletedTransactionContinuations(h.database.authority, h.descriptor, h.fresh(source), { eid: WRITE_FIXTURE_EID, memo: "needs-approval" }),
    error => error instanceof RerunRefusedError && error.code === "invalid-value" && /dependency is unavailable/u.test(error.message));
  assert.deepEqual(transactionEffects(h), before);
});
