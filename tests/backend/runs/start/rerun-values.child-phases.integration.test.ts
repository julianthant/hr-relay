import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { z } from "zod";
import { readRerunValues } from "../../../../src/backend/runs/start/rerun-values.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import type { StartRowDeclaration } from "../../../../src/models/workflow/step-omission.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { plan1Contract, plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, WRITE_FIXTURE_EID, WriteFixtureCommit, WriteFixturePrepare } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { rerunValuesDeps } from "../../../support/fixtures/rerun-values-fixtures.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";

const disposers: (() => void | Promise<void>)[] = [];
const profiles = createProfileFixtureSet();
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
afterAll(() => profiles.close());

const Input = z.strictObject({ eid: EidSchema });
const Output = z.strictObject({ transactionId: z.string().min(1) });
const Pair = z.strictObject({ eid: EidSchema });
const EID_A = "10800001", EID_B = "10800002";
const common = { version: 1, icon: "ShieldCheck" as const, category: "operations" as const, input: Input,
  canonicalInput: defineCanonicalInput(Input, Input, [{ eid: WRITE_FIXTURE_EID }]), inputSubject: "eid" as const,
  surface: { shape: "single" as const }, enqueue: "reject-active" as const, actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  identity: { matchKey: (value: z.output<typeof Input>) => `eid:${value.eid}` }, presentation: { title: () => "Synthetic child phases" },
  role: defineWorkflowRole({ kind: "standalone" }) };
const policy = { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } as const;

const writeChild = compileWorkflow(defineWorkflow({ ...common, id: "child-phases-write", code: "cpw", label: "Child phases write",
  scenarios: ["write-fixture/happy"], steps: ({ transaction, result }) => {
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [], {
      prepareBind: ({ input }) => input, commitBind: ({ input }) => input,
    });
    return { steps: [[{ key: "write", label: "Write" }, [write]]], result: result(Output, [write], ({ outputs }) => outputs.write.output) };
  } })).descriptor;

/** Two read nodes in one step: the first fails for the second person, the second fails for the first. */
const pairChild = compileWorkflow(defineWorkflow({ ...common, id: "child-phases-pair", code: "cpp", label: "Child phases pair",
  scenarios: ["fixture-plan1/happy"], steps: ({ task, result }) => {
    const first = task({ id: "first", contract: plan1Contract, replay: "checkpoint" }, [],
      ({ input }) => ({ emplId: input.eid, text: "first", mode: input.eid === EID_B ? "fail" as const : "ok" as const }));
    const second = task({ id: "second", contract: plan1Contract, replay: "checkpoint" }, [first],
      ({ input }) => ({ emplId: input.eid, text: "second", mode: "fail" as const }));
    return { steps: [[{ key: "pair", label: "Pair" }, [first, second]]], result: result(Pair, [first, second], ({ input }) => ({ eid: input.eid })) };
  } })).descriptor;

function parentOver(child: typeof writeChild, result: z.ZodType, rows: readonly StartRowDeclaration[], binds: readonly string[]) {
  return compileWorkflow(defineWorkflow({ ...common, id: `${child.id}-parent`, code: "cpr", label: "Child phases parent", rows, scenarios: ["write-fixture/happy"],
    steps: ({ delegate, result: derived }) => {
      const members = delegate({ id: "members", target: { id: child.id, input: Input, result }, edgeId: "members",
        cardinality: "many", await: "terminal", join: "all", policy }, [], {
        bind: () => binds.map((eid) => ({ eid })),
        deriveChildItemId: (_input, identity) => identity.canonicalItemId,
      });
      return { steps: [[{ key: "members", label: "Members" }, [members]]], result: derived(Input, [], ({ input }) => input) };
    } })).descriptor;
}

const members: StartRowDeclaration = { key: "members", label: "Members", members: [{ step: "members" }] };
const writeRows: readonly StartRowDeclaration[] = [members,
  { key: "prepare", label: "Prepare", members: [{ workflow: writeChild.id, step: "write", nodes: ["write"], phase: "prepare" }] },
  { key: "commit", label: "Commit", members: [{ workflow: writeChild.id, step: "write", nodes: ["write"], phase: "commit" }] }];

async function harness(child: typeof writeChild, result: z.ZodType, binds: readonly string[], rows: readonly StartRowDeclaration[]) {
  const parent = parentOver(child, result, rows, binds);
  const h = await sourceBoundHarness(parent, (world) => {
    const write = buildWriteFixtureRegistry(world), stores = [...plan1Stores.stores, ...write.stores];
    return defineTaskStoreRegistry(stores, { scenarioIds: [...new Set([...plan1Stores.corpus.scenarioIds, ...write.corpus.scenarioIds])],
      tasks: stores.flatMap((store) => Object.values(store.tasks)).map(({ contract }) => ({ id: contract.id, effect: contract.effect })) });
  }, undefined, undefined, profiles.create, [child], undefined, true);
  disposers.push(h.dispose);
  return h;
}
type Harness = Awaited<ReturnType<typeof harness>>;

async function runThrough(h: Harness, dryRun: boolean): Promise<RunRecord> {
  const root = h.start(h.proposal(undefined, undefined, dryRun));
  await h.execute(root);
  for (const child of h.database.authority.runs.listChildren(root.envelope.runId)) {
    // The harness's write sequencer leases the parent workflow's session manager, so a child's transaction needs the run's config bound there too.
    const { configFingerprint, browserMode, contractFingerprint } = child.envelope;
    await withBoundRunConfigFingerprint(h.manager, configFingerprint, () => h.execute(child), browserMode, { runId: child.envelope.runId, descriptorFingerprint: contractFingerprint });
  }
  if (h.fresh(root).lifecycle.state !== "terminal") await h.execute(root);
  return h.fresh(root);
}
function children(h: Harness, run: RunRecord) {
  const response = readRerunValues(rerunValuesDeps(h), { runId: run.envelope.runId, expectedVersion: run.version });
  assert.equal(response.state, "available", JSON.stringify(response));
  return response.snapshot.children;
}
const facts = (nodes: readonly { phase?: string; state: string; reason: string }[]) => nodes.map(({ phase, state, reason }) => [phase, state, reason]);

describe("child step facts over a transaction's phases and several child runs", () => {
  it("shows a dry-run child's transaction prepared by preview and its commit unfinished", async () => {
    const h = await harness(writeChild, Output, [WRITE_FIXTURE_EID], writeRows);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    const run = await runThrough(h, true);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify(run.lifecycle));
    const [child] = children(h, run) ?? [];
    assert.equal(child?.workflow, writeChild.id);
    assert.deepEqual(child?.steps.map(({ key, state }) => [key, state]), [["write", "unfinished"]]);
    assert.deepEqual(facts(child?.steps[0]?.nodes ?? []), [["prepare", "completed", "previewed"], ["commit", "unfinished", "not-recorded"]]);
  });

  it("shows a dry-run child whose write is already present as both phases already present, not as a prepared page", async () => {
    const h = await harness(writeChild, Output, [WRITE_FIXTURE_EID], writeRows);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    const run = await runThrough(h, true);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify(run.lifecycle));
    const [child] = children(h, run) ?? [];
    assert.deepEqual(child?.steps.map(({ key, state }) => [key, state]), [["write", "completed"]]);
    assert.deepEqual(facts(child?.steps[0]?.nodes ?? []), [["prepare", "completed", "already-present"], ["commit", "completed", "already-present"]]);
  });

  it("shows a child whose prepare threw as prepare failed and commit unfinished", async () => {
    const h = await harness(writeChild, Output, [WRITE_FIXTURE_EID], writeRows);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    h.world.onPrepare = () => { throw new Error("synthetic prepare failure"); };
    const run = await runThrough(h, false);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed", JSON.stringify(run.lifecycle));
    const [child] = children(h, run) ?? [];
    assert.deepEqual(child?.steps.map(({ key, state }) => [key, state]), [["write", "failed"]]);
    assert.deepEqual(facts(child?.steps[0]?.nodes ?? []), [["prepare", "failed", "failure"], ["commit", "unfinished", "not-recorded"]]);
  });

  it("keeps a prepare that finished before the probe-to-fence budget expired completed, and its commit not completed", async () => {
    const h = await harness(writeChild, Output, [WRITE_FIXTURE_EID], writeRows);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    h.world.onPrepare = () => h.clock.advanceMonotonic(30_001);
    const run = await runThrough(h, false);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed", JSON.stringify(run.lifecycle));
    assert.equal(h.database.authority.writeIntents.listByRun(h.database.authority.runs.listChildren(run.envelope.runId)[0]?.envelope.runId ?? "").length, 0);
    const [child] = children(h, run) ?? [];
    assert.deepEqual(facts(child?.steps[0]?.nodes ?? []), [["prepare", "completed", "prepared"], ["commit", "failed", "failure"]]);
  });

  it("takes each node from the least advanced child run, not the step from the least advanced run", async () => {
    const rows: readonly StartRowDeclaration[] = [members, { key: "pair", label: "Pair", members: [{ workflow: pairChild.id, step: "pair" }] }];
    const h = await harness(pairChild, Pair, [EID_A, EID_B], rows);
    const run = await runThrough(h, false);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed", JSON.stringify(run.lifecycle));
    const runs = h.database.authority.runs.listChildren(run.envelope.runId);
    assert.equal(runs.length, 2);
    const [child] = children(h, run) ?? [];
    assert.deepEqual(child?.steps.map(({ key, state }) => [key, state]), [["pair", "failed"]]);
    assert.deepEqual(child?.steps[0]?.nodes.map(({ nodeId, state }) => [nodeId, state]), [["first", "failed"], ["second", "unfinished"]]);
  });
});
