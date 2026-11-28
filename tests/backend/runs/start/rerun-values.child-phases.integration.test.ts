import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { z } from "zod";
import { readRerunValues } from "../../../../src/backend/runs/start/rerun-values.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import type { StartRowDeclaration, StepOmissionEntry } from "../../../../src/models/workflow/step-omission.js";
import { EidSchema, IsoInstantSchema, ItemIdSchema, PositiveIntSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { bindWorkflowDelegationTargets, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { composeCommandRequest, type CommandAction } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { rerunsInOneClick } from "../../../../src/dashboard/surfaces/run-start/run-start-rerun-model.js";
import { sourceBadge, type StepRow } from "../../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { Plan1Output, plan1Contract, plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, WRITE_FIXTURE_EID, WriteFixtureCommit, WriteFixturePrepare } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { rerunValuesDeps } from "../../../support/fixtures/rerun-values-fixtures.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createI9CheckStartWorld } from "../../../support/helpers/backend/i9-check-start-world.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { projectWorkflowStartSteps } from "../../../../src/backend/runs/queries/bootstrap.js";
import { projectStartRows, startRowWire } from "../../../../src/backend/runs/start/step-selection.js";
import { restoreRerunDraft, selectedStepKeys } from "../../../../src/dashboard/surfaces/run-start/run-launch-draft-model.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import type { RerunValuesSnapshot } from "../../../../src/models/dashboard/rerun-values.js";

const disposers: (() => void | Promise<void>)[] = [];
const profiles = createProfileFixtureSet();
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
afterAll(() => profiles.close());

const Input = z.strictObject({ eid: EidSchema });
const Output = z.strictObject({ transactionId: z.string().min(1).nullable() });
const Pair = z.strictObject({ eid: EidSchema });
const EID_A = "10800001", EID_B = "10800002";
const common = { version: 1, icon: "ShieldCheck" as const, category: "operations" as const, input: Input,
  canonicalInput: defineCanonicalInput(Input, Input, [{ eid: WRITE_FIXTURE_EID }]), inputSubject: "eid" as const,
  surface: { shape: "single" as const }, enqueue: "reject-active" as const, actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  identity: { matchKey: (value: z.output<typeof Input>) => `eid:${value.eid}` }, presentation: { title: () => "Synthetic child phases" },
  role: defineWorkflowRole({ kind: "standalone" }) };
const policy = { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } as const;

const writeChild = compileWorkflow(defineWorkflow({ ...common, id: "child-phases-write", code: "cpw", label: "Child phases write",
  scenarios: ["write-fixture/happy"], steps: ({ transaction, group, result }) => {
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [], {
      prepareBind: ({ input }) => input, commitBind: ({ input }) => input,
    });
    const step = group({ key: "write", label: "Import" }, { manual: {
      off: "manual", form: { fields: [] }, produces: {}, skips: ["write"], skipsGatesAndTransactions: true,
    } });
    return { steps: [[step, [write]]], result: result(Output, [write], ({ outputs }) => outputs.write?.output ?? { transactionId: null }) };
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

/** A typed-by-hand pair step the parent's Rerun can switch off, then a later step. */
const stagedChild = compileWorkflow(defineWorkflow({ ...common, id: "child-phases-staged", code: "cps", label: "Child phases staged",
  scenarios: ["fixture-plan1/happy"], steps: ({ task, group, result }) => {
    const read = (id: string) => task({ id, contract: plan1Contract, replay: "checkpoint" }, [], ({ input }) => ({ emplId: input.eid, text: id, mode: "ok" as const }));
    const first = read("first"), second = read("second"), third = read("third");
    const typed = ({ scope }: { scope: { input: unknown } }) => Plan1Output.parse({ eid: (scope.input as { eid: string }).eid, disposition: "typed", providerState: "typed" });
    return { steps: [[group({ key: "pair", label: "Pair" }, { manual: {
      form: { fields: [{ key: "note", label: "Note", kind: "text", optional: true, withheld: true }] }, produces: { first: typed, second: typed },
    } }), [first, second]],
      [{ key: "later", label: "Later" }, [third]]], result: result(Pair, [first, second, third], ({ input }) => ({ eid: input.eid })) };
  } })).descriptor;

function parentOver(child: AnyWorkflowDescriptor, result: z.ZodType, rows: readonly StartRowDeclaration[], binds: readonly string[], awaited = true, version = 1) {
  return compileWorkflow(defineWorkflow({ ...common, version, id: `${child.id}-parent`, code: "cpr", label: "Child phases parent", rows, scenarios: ["write-fixture/happy"],
    steps: ({ delegate, result: derived }) => {
      const members = delegate({ id: "members", target: { id: child.id, input: Input, result }, edgeId: "members",
        cardinality: "many", ...(awaited ? { await: "terminal", join: "all" } as const : { await: "none", join: "none" } as const), policy }, [], {
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

async function harness(child: AnyWorkflowDescriptor, result: z.ZodType, binds: readonly string[], rows: readonly StartRowDeclaration[], awaited = true) {
  const parent = parentOver(child, result, rows, binds, awaited);
  const h = await sourceBoundHarness(parent, (world) => {
    const write = buildWriteFixtureRegistry(world), stores = [...plan1Stores.stores, ...write.stores];
    return defineTaskStoreRegistry(stores, { scenarioIds: [...new Set([...plan1Stores.corpus.scenarioIds, ...write.corpus.scenarioIds])],
      tasks: stores.flatMap((store) => Object.values(store.tasks)).map(({ contract }) => ({ id: contract.id, effect: contract.effect })) });
  }, undefined, undefined, profiles.create, [child], undefined, true);
  disposers.push(h.dispose);
  return h;
}
type Harness = Awaited<ReturnType<typeof harness>>;

async function runThrough(h: Harness, dryRun: boolean, stepOmissions?: readonly StepOmissionEntry[]): Promise<RunRecord> {
  const plan = stepOmissions === undefined ? h.proposal(undefined, undefined, dryRun)
    : h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: WRITE_FIXTURE_EID }], dryRun, selectedStepKeys: ["members"], stepOmissions });
  const root = h.start(plan);
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
/** The Run dialog's workflow as the bootstrap serves this descriptor's steps and rows. */
function startWorkflow(descriptor: AnyWorkflowDescriptor): RunStartWorkflow {
  return { workflowId: descriptor.id, version: descriptor.version, label: descriptor.label, categoryId: descriptor.category, role: { kind: "standalone" },
    icon: descriptor.icon, enqueue: descriptor.enqueue, spreadsheetIntake: false, requiredWorkbookFields: [],
    inputRun: { state: "absent", reason: "upload" }, steps: projectWorkflowStartSteps(descriptor), rows: projectStartRows(descriptor).map(startRowWire) };
}
/** What Rerun opens switched on: the parent's selected steps, and the child rows it switched off. */
const restartKeys = (snapshot: RerunValuesSnapshot, workflow: RunStartWorkflow) => {
  const draft = restoreRerunDraft(snapshot, workflow);
  return { steps: selectedStepKeys(draft, workflow), off: draft.manualRows };
};
const facts = (nodes: readonly { phase?: string; state: string; reason: string }[]) => nodes.map(({ phase, state, reason }) => [phase, state, reason]);

describe("child step facts over a transaction's phases and several child runs", () => {
  it("keeps a delegated Import done outside Relay off when Rerun opens", async () => {
    const target = { workflow: writeChild.id, step: "write" };
    const row: StartRowDeclaration = { key: "import", label: "Import", members: [target], target };
    const h = await harness(writeChild, Output, [WRITE_FIXTURE_EID], [members, row]);
    const run = await runThrough(h, false, [{ ...target, facts: {} }]);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify(run.lifecycle));
    const [child] = h.database.authority.runs.listChildren(run.envelope.runId);
    assert.ok(child);
    assert.deepEqual(child.envelope.stepOmissions, [{ step: "write", facts: {}, labels: {} }]);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(child.envelope.runId), []);

    const rerun = readRerunValues(rerunValuesDeps(h), { runId: run.envelope.runId, expectedVersion: run.version });
    assert.ok(rerun.state === "available", JSON.stringify(rerun));
    assert.deepEqual(facts(rerun.snapshot.children?.[0]?.steps[0]?.nodes ?? []), [
      ["prepare", "unfinished", "step-omitted"], ["commit", "unfinished", "step-omitted"],
    ]);
    assert.deepEqual(restartKeys(rerun.snapshot, startWorkflow(h.descriptor)), { steps: ["members"], off: ["import"] });

    const { completion: _completion, sessionId: _sessionId, envelope, ...retained } = child;
    const { stepOmissions: _omissions, ...pendingEnvelope } = envelope;
    const pending: RunRecord = { ...retained, lifecycle: { state: "queued" }, envelope: { ...pendingEnvelope,
      runId: RunIdSchema.parse("00000000-0000-4000-8000-00000000fa18"), itemId: ItemIdSchema.parse("00000000-0000-4000-8000-00000000fa19"),
    } };
    const deps = rerunValuesDeps(h);
    const runs = { ...h.database.authority.runs, listChildren: () => [child, pending] };
    const mixed = readRerunValues({ ...deps, database: { authority: { ...h.database.authority, runs },
      withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, { runId: run.envelope.runId, expectedVersion: run.version });
    assert.ok(mixed.state === "available", JSON.stringify(mixed));
    assert.deepEqual(restartKeys(mixed.snapshot, startWorkflow(h.descriptor)), { steps: ["members"], off: [] });
  });

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

  const pairMembers: StartRowDeclaration = { key: "pair", label: "Pair", members: [{ workflow: pairChild.id, step: "pair" }] };
  /** A parent waiting on its members, cancelled with the dashboard's own Cancel request, which carries no reason. */
  async function cancelledParent(binds: readonly string[], child = pairChild, rows: readonly StartRowDeclaration[] = [members, pairMembers],
    stepOmissions?: readonly StepOmissionEntry[]) {
    const h = await harness(child, Pair, binds, rows);
    const root = h.start(h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: WRITE_FIXTURE_EID }], dryRun: false,
      selectedStepKeys: ["members"], ...(stepOmissions === undefined ? {} : { stepOmissions }) }));
    await h.execute(root);
    const waiting = h.fresh(root);
    const cancel = composeCommandRequest({ kind: "command", command: "cancel", expectedVersion: waiting.version } as unknown as CommandAction,
      { runId: waiting.envelope.runId, expectedVersion: waiting.version }, { actorId: "local-operator", source: "run-detail", requestedAt: h.clock.now().toISOString() });
    assert.ok(cancel.state === "ready");
    const request = CommandRequestSchema.parse(cancel.request);
    assert.ok(!("reason" in request));
    assert.equal(h.kernel.execute(request).state, "applied");
    const run = h.fresh(root);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled", JSON.stringify(run.lifecycle));
    return { h, run, members: h.database.authority.runs.listChildren(root.envelope.runId) };
  }
  const pairRow = { key: "pair", label: "Pair", kind: "switch", includedByDefault: true, members: [{ workflow: pairChild.id, step: "pair" }] } as unknown as StepRow;

  it("reads a cancelled parent's child from the child's own executions: skipped finished, an opened gate begun", async () => {
    const { h, run, members: [member] } = await cancelledParent([EID_A]);
    assert.ok(member !== undefined);
    // The member skipped its first node and stopped with the second opened, as a child waiting at an approval does.
    const executions = (runId: string) => runId !== member.envelope.runId ? [] : [
      { nodeId: "first", attempt: 1, startedAt: "2026-11-25T12:00:00.000Z", endedAt: "2026-11-25T12:00:01.000Z", outcome: "skipped" as const },
      { nodeId: "second", attempt: 1, startedAt: "2026-11-25T12:00:02.000Z" }];
    const response = readRerunValues({ ...rerunValuesDeps(h), executions }, { runId: run.envelope.runId, expectedVersion: run.version });
    assert.ok(response.state === "available", JSON.stringify(response));
    assert.deepEqual(response.snapshot.children?.[0]?.steps[0]?.nodes.map(({ nodeId, state, reason }) => [nodeId, state, reason]),
      [["first", "completed", "condition-skipped"], ["second", "unfinished", "incomplete-execution"]]);
    assert.equal(sourceBadge(pairRow, response.snapshot), "cancelled");
  });

  const stagedPair: StartRowDeclaration = { key: "pair", label: "Pair", members: [{ workflow: stagedChild.id, step: "pair" }], target: { workflow: stagedChild.id, step: "pair" } };
  const stagedLater: StartRowDeclaration = { key: "later", label: "Later", members: [{ workflow: stagedChild.id, step: "later" }] };

  it.each([null, "fictional withheld manual note"])("refills delegated manual values only when the withheld note is empty (%s)", async note => {
    const entry = { workflow: stagedChild.id, step: "pair", facts: { note } };
    const { h, run } = await cancelledParent([EID_A], stagedChild, [members, stagedPair, stagedLater], [entry]);
    assert.deepEqual(run.envelope.stepOmissions, [{ ...entry, labels: { note: "Note" } }]);
    const response = readRerunValues(rerunValuesDeps(h), { runId: run.envelope.runId, expectedVersion: run.version });
    assert.ok(response.state === "available", JSON.stringify(response));
    assert.deepEqual(response.snapshot.typed, note === null ? [{ ...entry, labels: { note: "Note" } }] : undefined);
    if (note !== null) assert.equal(JSON.stringify(response).includes(note), false);
  });

  const skipped = (nodeId: string) => [{ nodeId, attempt: 1, startedAt: "2026-11-25T12:00:00.000Z", endedAt: "2026-11-25T12:00:01.000Z", outcome: "skipped" as const }];
  /** The cancelled parent's Rerun values with these member checkpoints, failures and executions, its members listed in `order`. */
  function readStaged(h: Harness, run: RunRecord, change: Readonly<{ checkpoints: (member: RunRecord) => readonly string[]; failed?: Readonly<{ member: RunRecord; nodeId: string }>;
    executions: (runId: string) => ReturnType<typeof skipped> }>, order: (runs: RunRecord[]) => RunRecord[]) {
    const authority = h.database.authority, failureId = "00000000-0000-4000-8000-0000000fa11d";
    type Checkpoint = ReturnType<typeof authority.runCheckpoints.listByItem>[number];
    type Failure = ReturnType<typeof authority.failures.listByRun>[number];
    const children = authority.runs.listChildren(run.envelope.runId).map(child => child.envelope.runId !== change.failed?.member.envelope.runId ? child
      : { ...child, lifecycle: { ...child.lifecycle, failureId } } as RunRecord);
    const runCheckpoints = { ...authority.runCheckpoints, listByItem: (workflow: string, itemId: string) => [...authority.runCheckpoints.listByItem(workflow, itemId),
      ...children.filter(child => workflow === stagedChild.id && child.envelope.itemId === itemId)
        .flatMap(child => change.checkpoints(child).map(nodeId => ({ runId: child.envelope.runId, nodeId }) as unknown as Checkpoint))] };
    const failures = { ...authority.failures, listByRun: (runId: string) => change.failed !== undefined && runId === change.failed.member.envelope.runId
      ? [{ failureId, runId, nodeId: change.failed.nodeId } as unknown as Failure] : authority.failures.listByRun(runId) };
    const runs = { ...authority.runs, listChildren: (id: string) => id === run.envelope.runId ? order([...children]) : authority.runs.listChildren(id) };
    const response = readRerunValues({ ...rerunValuesDeps(h), executions: change.executions, database: { authority: { ...authority, runs, runCheckpoints, failures },
      withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, { runId: run.envelope.runId, expectedVersion: run.version });
    assert.ok(response.state === "available", JSON.stringify(response));
    return response.snapshot;
  }
  const forwardOrder = (runs: RunRecord[]) => runs, reversedOrder = (runs: RunRecord[]) => runs.reverse();

  it("folds a node one member checkpointed and another condition-skipped the same way in either member order, and Rerun restarts there both ways", async () => {
    // The pair row comes first, so its badge alone decides whether Rerun switches it off.
    const { h, run, members: [skipping, ran] } = await cancelledParent([EID_A, EID_B], stagedChild, [stagedPair, stagedLater, members]);
    assert.ok(skipping !== undefined && ran !== undefined);
    // Both members checkpointed the second node, so the first node is the one that decides.
    const mixed = { checkpoints: (member: RunRecord) => member.envelope.runId === ran.envelope.runId ? ["first", "second"] : ["second"],
      executions: (runId: string) => runId === skipping.envelope.runId ? skipped("first") : [] };
    const forward = readStaged(h, run, mixed, forwardOrder), reversed = readStaged(h, run, mixed, reversedOrder);
    assert.deepEqual(forward.children?.[0]?.steps[0]?.nodes, [{ nodeId: "first", state: "completed", reason: "condition-skipped" }, { nodeId: "second", state: "completed", reason: "checkpoint" }]);
    assert.deepEqual(reversed.children, forward.children);
    // Preselection reads a condition-skipped node as not run, so Rerun keeps the pair row on both ways; had both members run it, Rerun would switch it off.
    const workflow = startWorkflow(h.descriptor), on = { steps: ["members"], off: [] };
    assert.deepEqual(restartKeys(forward, workflow), on);
    assert.deepEqual(restartKeys(reversed, workflow), on);
    assert.deepEqual(restartKeys(readStaged(h, run, { checkpoints: () => ["first", "second"], executions: () => [] }, forwardOrder), workflow), { steps: ["members"], off: ["pair"] });
  });

  it("folds a node one member failed and another condition-skipped as not run, so Rerun restarts where it did before the badges", async () => {
    const { h, run, members: [failing, skipping] } = await cancelledParent([EID_A, EID_B], stagedChild, [members, stagedPair, stagedLater]);
    assert.ok(failing !== undefined && skipping !== undefined);
    // Both members ran the pair step; the later node failed for one member and was condition-skipped for the other.
    const mixed = { checkpoints: () => ["first", "second"], failed: { member: failing, nodeId: "third" },
      executions: (runId: string) => runId === skipping.envelope.runId ? skipped("third") : [] };
    const forward = readStaged(h, run, mixed, forwardOrder), reversed = readStaged(h, run, mixed, reversedOrder);
    assert.deepEqual(forward.children?.[0]?.steps[1]?.nodes, [{ nodeId: "third", state: "completed", reason: "condition-skipped" }]);
    assert.deepEqual(reversed.children, forward.children);
    // Read as failed, the later row would move the restart past the members row and switch the pair row off.
    const workflow = startWorkflow(h.descriptor), on = { steps: ["members"], off: [] };
    assert.deepEqual(restartKeys(forward, workflow), on);
    assert.deepEqual(restartKeys(reversed, workflow), on);
  });

  describe("the failed members of a finished batch", () => {
    const rows: readonly StartRowDeclaration[] = [members, { key: "pair", label: "Pair", members: [{ workflow: pairChild.id, step: "pair" }] }];
    /** A Done parent over one failed member and one still queued. */
    async function mixedBatch() {
      const h = await harness(pairChild, Pair, [EID_A, EID_B], rows, false);
      const root = h.start(h.proposal(undefined, undefined, false));
      await h.execute(root);
      const [failing, unfinished] = h.database.authority.runs.listChildren(root.envelope.runId);
      assert.ok(unfinished !== undefined && failing !== undefined);
      await h.execute(failing);
      const run = h.fresh(root), failed = h.fresh(failing);
      assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify(run.lifecycle));
      assert.ok(failed.lifecycle.state === "terminal" && failed.lifecycle.outcome === "failed", JSON.stringify(failed.lifecycle));
      assert.equal(h.fresh(unfinished).lifecycle.state, "queued");
      return { h, run, failed };
    }
    function read(h: Harness, run: RunRecord, change: Partial<Parameters<typeof readRerunValues>[0]> = {}) {
      const response = readRerunValues({ ...rerunValuesDeps(h), ...change }, { runId: run.envelope.runId, expectedVersion: run.version });
      assert.equal(response.state, "available", JSON.stringify(response));
      return response.snapshot;
    }

    it("are served though an unfinished member leaves every step of theirs unfinished", async () => {
      const { h, run, failed } = await mixedBatch();
      const snapshot = read(h, run);
      assert.deepEqual(snapshot.children?.[0]?.steps.map(({ state }) => state), ["unfinished"], "the least advanced member shows");
      assert.deepEqual(snapshot.failedMembers, [failed.envelope.runId]);
      assert.equal(rerunsInOneClick(snapshot), false);
    });

    it("are served though the batch ran under an older descriptor", async () => {
      const { h, run, failed } = await mixedBatch();
      const evolved = parentOver(pairChild, Pair, rows, [EID_A, EID_B], false, 2);
      bindWorkflowDelegationTargets([evolved, pairChild]);
      const snapshot = read(h, run, { descriptors: { resolve: () => evolved } });
      assert.deepEqual(snapshot.children?.[0]?.steps.map(({ state }) => state), ["unfinished"]);
      assert.deepEqual(snapshot.failedMembers, [failed.envelope.runId]);
      assert.equal(rerunsInOneClick(snapshot), false);
    });

    it("are the latest run of each member: a retry stands for the run it retried", async () => {
      const { h, run, failed } = await mixedBatch();
      const retried = (outcome: "done" | "failed") => {
        const retryId = RunIdSchema.parse("00000000-0000-4000-8000-00000000fa17");
        const { completion: _completion, sessionId: _sessionId, ...settled } = failed;
        const retry: RunRecord = { ...settled, envelope: { ...failed.envelope, runId: retryId, retryOf: failed.envelope.runId, attempt: PositiveIntSchema.parse(failed.envelope.attempt + 1) },
          lifecycle: { state: "terminal", outcome, endedAt: IsoInstantSchema.parse(h.clock.now().toISOString()) } };
        const runs = { ...h.database.authority.runs, listChildren: (id: string) => id === run.envelope.runId ? [...h.database.authority.runs.listChildren(id), retry] : [] };
        return read(h, run, { database: { authority: { ...h.database.authority, runs }, withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }).failedMembers;
      };
      assert.equal(retried("done"), undefined);
      assert.deepEqual(retried("failed"), ["00000000-0000-4000-8000-00000000fa17"]);
    });
  });

  describe("the served I-9 Check parent", () => {
    const world = createI9CheckStartWorld();
    afterAll(world.cleanup);

    it("cancels with the dashboard's Cancel request while it awaits its PDFs, and Rerun reads and restores it", async () => {
      const f = await world.fixture();
      assert.equal((await f.canonical.step(f.run, new AbortController().signal)).outcome.state, "yielded-delegation");
      const waiting = f.database.authority.runs.get(f.run.envelope.runId);
      assert.ok(waiting !== undefined && waiting.lifecycle.state !== "terminal", JSON.stringify(waiting?.lifecycle));
      assert.ok(f.database.authority.runs.listChildren(waiting.envelope.runId).every(child => child.envelope.workflow === "ocr" && child.lifecycle.state !== "terminal"));
      const cancel = composeCommandRequest({ kind: "command", command: "cancel", expectedVersion: waiting.version } as unknown as CommandAction,
        { runId: waiting.envelope.runId, expectedVersion: waiting.version }, { actorId: "local-operator", source: "run-detail", requestedAt: f.clock.now().toISOString() });
      assert.ok(cancel.state === "ready");
      const request = CommandRequestSchema.parse(cancel.request);
      assert.ok(!("reason" in request));
      assert.equal(f.canonical.kernel.execute(request).state, "applied");
      const run = f.database.authority.runs.get(waiting.envelope.runId);
      assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled", JSON.stringify(run?.lifecycle));
      const descriptor = DESCRIPTORS.find(entry => entry.id === "i9-check-start");
      assert.ok(descriptor !== undefined);
      const response = readRerunValues({ reader: testRunService(f.database, f.clock), database: f.database,
        descriptors: { resolve: id => DESCRIPTORS.find(entry => entry.id === id) } }, { runId: run.envelope.runId, expectedVersion: run.version });
      assert.ok(response.state === "available", JSON.stringify(response));
      assert.equal(response.snapshot.source.outcome, "cancelled");
      // The cascade-cancelled PDFs settle the all-settled join, and nothing after it ran, so Rerun starts every step again.
      assert.deepEqual(response.snapshot.steps[0]?.nodes[0], { nodeId: "read-documents", state: "completed", reason: "delegation-settled" });
      assert.deepEqual(restartKeys(response.snapshot, startWorkflow(descriptor)), { steps: ["documents", "roster-reference", "retention"], off: [] });
    });
  });
});
