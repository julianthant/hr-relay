import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { failureDecision } from "../../../../src/backend/runs/queries/run-detail/receipts-failures.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { FailureDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { settledWriteState } from "../../../../src/models/trust/failure.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { Plan1CanonicalInput, Plan1Input, Plan1Output, plan1Contract, plan1TransientFailureStores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { WRITE_FIXTURE_EID, WriteFixtureCommit, WriteFixturePrepare, absentProbeEvidence, buildWriteFixtureRegistry,
  createWriteFixtureWorld, writeFixtureSessions } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { failureDetailWireFixture } from "../../../support/helpers/trust/trust-wire-fixtures.js";

const profiles = createProfileFixtureSet(), world = createRunExecutorTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(world.cleanup);
const compiled = compileWorkflow(defineWorkflow({ id: "fixture-failure-after-settled-write", version: 1, code: "ffw", label: "Failure after settled write",
  icon: "Users", category: "operations", input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  scenarios: ["write-fixture/happy"], identity: { matchKey: value => value.emplId }, presentation: { title: value => value.emplId },
  role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ task, transaction, result }) => {
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [], {
      prepareBind: ({ input }) => ({ eid: input.emplId }), commitBind: ({ input }) => ({ eid: input.emplId }),
    });
    const observe = task({ id: "observe", contract: plan1Contract, replay: "checkpoint" }, [write], ({ input }) => input);
    return { steps: [[{ key: "write", label: "Write" }, [write]], [{ key: "observe", label: "Observe" }, [observe]]],
      result: result(Plan1Output, [observe], ({ outputs }) => outputs.observe) };
  } }));

async function settledWriteHarness(onRun: () => void = () => undefined) {
  const driver = createWriteFixtureWorld(), write = buildWriteFixtureRegistry(driver), later = plan1TransientFailureStores(onRun);
  const stores = defineTaskStoreRegistry([...later.stores, ...write.stores], {
    scenarioIds: [...new Set([...later.corpus.scenarioIds, ...write.corpus.scenarioIds])],
    tasks: [...later.stores, ...write.stores].flatMap(store => Object.values(store.tasks)).map(({ contract }) => ({ id: contract.id, effect: contract.effect })) });
  const h = await world.executorHarness({ descriptor: compiled.descriptor, stores, sessions: writeFixtureSessions(driver) });
  const { database, clock } = h.authority, authority = database.authority;
  const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database, sessions: h.manager,
    emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000, operator: "local-operator", log: h.deps.log });
  const execution = canonicalChildExecution({ ...h.deps, writeSequencer: sequencer }, database, h.authority.path,
    id => id === compiled.descriptor.id ? compiled.descriptor : undefined);
  driver.probeResults.push(absentProbeEvidence(clock.now().toISOString()));
  return { driver, authority, execution };
}

it("records the run's committed write on a later node failure and serves it as a failure after a write", async () => {
  let settledBefore: readonly unknown[] = [];
  const { authority, execution } = await settledWriteHarness(() => { settledBefore = authority.writeIntents.listByRun(run.envelope.runId); });
  const run = execution.start(compiled.descriptor, { emplId: WRITE_FIXTURE_EID, text: "same", mode: "fail" }, { dryRun: false });
  const result = await execution.execute(run, world.SIGNAL);
  assert.equal(result.outcomes.at(-1)?.state, "failed");

  const intents = authority.writeIntents.listByRun(run.envelope.runId);
  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.status, "committed");
  assert.deepEqual(intents, settledBefore, "the failure leaves the committed intent untouched");
  const failure = authority.failures.listByRun(run.envelope.runId)[0]; assert.ok(failure);
  assert.equal(failure.nodeId, "observe");
  assert.equal(failure.writeState, settledWriteState(intents));
  assert.equal(failure.writeState, "committed");

  const wire = FailureDetailWireSchema.parse({
    ...failureDetailWireFixture({ runId: run.envelope.runId, failureId: failure.failureId, traceId: failure.traceId, workflowId: compiled.descriptor.id }),
    writeState: failure.writeState,
    resolution: { capability: { state: "available" }, capture: { failureId: failure.failureId, runId: run.envelope.runId, resolution: { status: "unresolved", version: 1 } } } });
  const decision = failureDecision(wire);
  assert.equal(decision.type, "failed-after-write");
  assert.deepEqual(decision.options.map(({ id }) => id), ["mark-as-failed", "add-note"]);
});

it("a plain Start after another run's committed write replays its outcome and never clicks Save again", async () => {
  const { driver, authority, execution } = await settledWriteHarness();
  const input = { emplId: WRITE_FIXTURE_EID, text: "same", mode: "fail" } as const;
  const clicks = () => driver.events.filter(event => event.startsWith("commit-click")).length;
  const a = execution.start(compiled.descriptor, input, { dryRun: false });
  assert.equal((await execution.execute(a, world.SIGNAL)).outcomes.at(-1)?.state, "failed");
  assert.equal(clicks(), 1);

  const b = execution.start(compiled.descriptor, input, { dryRun: false });
  assert.equal(b.envelope.retryOf, undefined);
  assert.equal(b.envelope.itemId, a.envelope.itemId);
  assert.equal((await execution.execute(b, world.SIGNAL)).outcomes.at(-1)?.state, "done");
  assert.equal(clicks(), 1, "the committed Save is not repeated");
  assert.deepEqual(authority.writeIntents.listByRun(b.envelope.runId), []);
  assert.deepEqual(authority.runCheckpoints.listByItem(compiled.descriptor.id, b.envelope.itemId)
    .filter(row => row.runId === b.envelope.runId).map(row => row.nodeId), ["observe"], "B reads observe itself");
});
