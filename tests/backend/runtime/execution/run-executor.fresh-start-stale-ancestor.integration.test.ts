import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { Plan1CanonicalInput, Plan1Input, plan1ExpiringContract, plan1ExpiringFailureStores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { WRITE_FIXTURE_EID, WriteFixtureCommit, WriteFixturePrepare, absentProbeEvidence, buildWriteFixtureRegistry,
  createWriteFixtureWorld, writeFixtureSessions } from "../../../support/fixtures/write-sequencer-fixtures.js";

const profiles = createProfileFixtureSet(), world = createRunExecutorTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(world.cleanup);

/** search (1 s freshness) → summary (fails once) → write: the Separations shape that stopped attempt #5. */
const compiled = compileWorkflow(defineWorkflow({ id: "fixture-fresh-start-stale-ancestor", version: 1, code: "fsa", label: "Fresh start stale ancestor",
  icon: "Users", category: "operations", input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  scenarios: ["write-fixture/happy"], identity: { matchKey: value => value.emplId }, presentation: { title: value => value.emplId },
  role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ task, transaction, result }) => {
    const search = task({ id: "search", contract: plan1ExpiringContract, replay: "checkpoint" }, [], ({ input }) => ({ ...input, text: "search", mode: "ok" as const }));
    const summary = task({ id: "summary", contract: plan1ExpiringContract, replay: "checkpoint" }, [search], ({ input }) => input);
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [search, summary], {
      prepareBind: ({ input }) => ({ eid: input.emplId }), commitBind: ({ input }) => ({ eid: input.emplId }),
    });
    return { steps: [[{ key: "search", label: "Search" }, [search]], [{ key: "summary", label: "Summary" }, [summary]], [{ key: "write", label: "Write" }, [write]]],
      result: result(Plan1Input, [write], ({ input }) => input) };
  } }));

async function harness() {
  const driver = createWriteFixtureWorld(), write = buildWriteFixtureRegistry(driver);
  const reads: string[] = [];
  let failed = false;
  const later = plan1ExpiringFailureStores(input => {
    reads.push(input.text);
    if (input.mode !== "fail" || failed) return false;
    failed = true; return true;
  });
  const stores = defineTaskStoreRegistry([...later.stores, ...write.stores], {
    scenarioIds: [...new Set([...later.corpus.scenarioIds, ...write.corpus.scenarioIds])],
    tasks: [...later.stores, ...write.stores].flatMap(store => Object.values(store.tasks)).map(({ contract }) => ({ id: contract.id, effect: contract.effect })) });
  const h = await world.executorHarness({ descriptor: compiled.descriptor, stores, sessions: writeFixtureSessions(driver) });
  const { database, clock } = h.authority;
  const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database, sessions: h.manager,
    emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000, operator: "local-operator", log: h.deps.log });
  const execution = canonicalChildExecution({ ...h.deps, writeSequencer: sequencer }, database, h.authority.path,
    id => id === compiled.descriptor.id ? compiled.descriptor : undefined);
  driver.probeResults.push(absentProbeEvidence(clock.now().toISOString()));
  return { authority: database.authority, clock, execution, reads };
}

it("a plain Start after a failed run re-reads a stale earlier checkpoint instead of refusing it as a resume", async () => {
  const { authority, clock, execution, reads } = await harness();
  const input = { emplId: WRITE_FIXTURE_EID, text: "same", mode: "fail" } as const;
  const a = execution.start(compiled.descriptor, input, { dryRun: true });
  assert.equal((await execution.execute(a, world.SIGNAL)).outcomes.at(-1)?.state, "failed");
  assert.equal(authority.failures.listByRun(a.envelope.runId)[0]?.nodeId, "summary");
  assert.deepEqual(reads, ["search", "same"]);

  clock.advanceWall(5_000);
  reads.length = 0;
  const b = execution.start(compiled.descriptor, input, { dryRun: true });
  assert.equal(b.envelope.itemId, a.envelope.itemId, "the later Start lands on the same item");
  assert.equal(b.envelope.continuation, undefined);
  assert.equal(b.envelope.startAt, undefined);
  const { run } = await execution.execute(b, world.SIGNAL);
  assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done",
    JSON.stringify(authority.failures.listByRun(b.envelope.runId).map(failure => [failure.code, failure.summary])));
  assert.deepEqual(reads, ["search", "same"], "the stale search was read again, then the summary");
  assert.deepEqual(authority.runCheckpoints.listByItem(compiled.descriptor.id, b.envelope.itemId)
    .filter(row => row.runId === b.envelope.runId).map(row => String(row.nodeId)).sort(), ["search", "summary"]);
});

it("a plain Start still replays an earlier checkpoint that is fresh enough", async () => {
  const { authority, execution, reads } = await harness();
  const input = { emplId: WRITE_FIXTURE_EID, text: "same", mode: "fail" } as const;
  const a = execution.start(compiled.descriptor, input, { dryRun: true });
  assert.equal((await execution.execute(a, world.SIGNAL)).outcomes.at(-1)?.state, "failed");

  reads.length = 0;
  const b = execution.start(compiled.descriptor, input, { dryRun: true });
  const { run } = await execution.execute(b, world.SIGNAL);
  assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  assert.deepEqual(reads, ["same"], "only the failed summary ran again");
  assert.deepEqual(authority.runCheckpoints.listByItem(compiled.descriptor.id, b.envelope.itemId)
    .filter(row => row.runId === b.envelope.runId).map(row => String(row.nodeId)), ["summary"]);
});
