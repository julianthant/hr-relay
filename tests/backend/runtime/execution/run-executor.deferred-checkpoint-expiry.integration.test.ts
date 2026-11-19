import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it } from "vitest";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { bindWorkflowDelegationTargets } from "../../../../src/workflow-kit/workflow.js";
import { Plan1CanonicalInput, Plan1Input, Plan1Output, plan1ExpiringContract, plan1ExpiringFailureStores, plan1ExpiringLeaf } from "../../../support/fixtures/plan1-operation-workflows.js";
import { WRITE_FIXTURE_EID, WriteFixtureCommit, WriteFixturePrepare, absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, writeFixtureSessions } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";

const profiles = createProfileFixtureSet();
const world = createRunExecutorTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(world.cleanup);

const { descriptor } = compileWorkflow(defineWorkflow({
  id: "fixture-deferred-expiry", version: 1, code: "fde", label: "Deferred checkpoint expiry", icon: "Search",
  category: "operations", input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid", surface: { shape: "single" },
  enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], scenarios: ["write-fixture/happy"],
  identity: { matchKey: value => value.emplId }, presentation: { title: value => value.emplId }, role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ task, transaction, delegate, result }) => {
    const read = task({ id: "read", contract: plan1ExpiringContract, replay: "always-rerun" }, [], ({ input }) => ({ ...input, text: "read" }));
    const check = task({ id: "check", contract: plan1ExpiringContract, replay: "checkpoint" }, [read], ({ input }) => input);
    const write = transaction({ id: "write", label: "Save", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [check], {
      prepareBind: ({ outputs }) => ({ eid: outputs.check.eid }), commitBind: ({ outputs }) => ({ eid: outputs.check.eid }),
    });
    const child = delegate({ id: "child", target: { id: plan1ExpiringLeaf.descriptor.id, input: Plan1Input, result: Plan1Output },
      edgeId: "child", cardinality: "one", await: "terminal", join: "one",
      policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent", afterChildRetry: "resume-parent", visibility: "inline" } },
    [check], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "read", label: "Read" }, [read]], [{ key: "check", label: "Check" }, [check]],
      [{ key: "write", label: "Save" }, [write]], [{ key: "child", label: "Child" }, [child]]],
    result: result(Plan1Input, [child], ({ input }) => input) };
  },
}));

it.each([true, false])("records the expired checkpoint and prior writes on a plain Start (dryRun=%s)", async dryRun => {
  bindWorkflowDelegationTargets([plan1ExpiringLeaf.descriptor]);
  const driver = createWriteFixtureWorld();
  const writes = buildWriteFixtureRegistry(driver);
  let expireDuringRead = false;
  const reads = plan1ExpiringFailureStores(input => {
    if (expireDuringRead && input.text === "read") clock.advanceWall(2_000);
    return false;
  });
  const stores = defineTaskStoreRegistry([...reads.stores, ...writes.stores], {
    scenarioIds: [...reads.corpus.scenarioIds, ...writes.corpus.scenarioIds], tasks: [...reads.corpus.tasks, ...writes.corpus.tasks],
  });
  const { deps, authority: { database, path, clock } } = await world.executorHarness({ descriptor, stores, sessions: writeFixtureSessions(driver) });
  const sequencer = createWriteSequencer({ ...deps, authority: database, ids: { uuid: randomUUID }, operator: "local-operator" });
  const execution = canonicalChildExecution({ ...deps, writeSequencer: sequencer }, database, path,
    id => [descriptor, plan1ExpiringLeaf.descriptor].find(candidate => candidate.id === id));
  driver.probeResults.push(absentProbeEvidence(clock.now().toISOString()));
  const run = execution.start(descriptor, { emplId: WRITE_FIXTURE_EID, text: "check", mode: "ok" }, { dryRun });
  const runId = run.envelope.runId;
  const first = await execution.step(run, world.SIGNAL);
  assert.equal(first.outcome.state, "yielded-delegation", JSON.stringify(database.authority.failures.listByRun(runId)));
  assert.equal((await execution.step(run, world.SIGNAL)).outcome.state, "done");
  const intents = () => database.authority.writeIntents.listByRun(runId);
  const prior = intents();
  assert.deepEqual(prior.map(row => row.status), dryRun ? [] : ["committed"]);

  // Reclaiming the parent plans a fresh check, then the always-rerun read takes it past its 1 s limit.
  expireDuringRead = true;
  const reclaimed = await execution.step(run, world.SIGNAL);
  assert.equal(reclaimed.run.envelope.runId, runId);
  assert.equal(reclaimed.run.envelope.continuation, undefined);
  assert.equal(reclaimed.run.envelope.startAt, undefined);
  assert.equal(reclaimed.outcome.state, "failed");
  const [failure] = database.authority.failures.listByRun(runId);
  assert.ok(failure);
  assert.match(failure.summary, /CheckpointFreshnessError/u);
  assert.match(failure.causeChain[0]?.summary ?? "", /checkpoint "check"/u);
  assert.equal(failure.writeState, dryRun ? "not-attempted" : "committed");
  assert.equal(failure.nodeId, "check");
  assert.equal(failure.taskId, plan1ExpiringContract.id);
  assert.equal(failure.code, "RESUME_VALIDATION_FAILED");
  assert.deepEqual(intents(), prior);
  assert.equal(driver.events.filter(event => event.startsWith("commit-click:")).length, dryRun ? 0 : 1);
});
