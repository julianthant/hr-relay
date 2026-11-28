import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { readRerunValues } from "../../../../src/backend/runs/start/rerun-values.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/settings-command.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import type { StepManualDeclaration } from "../../../../src/models/workflow/step-omission.js";
import { EidSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow, composeWorkflowModule, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { bindWorkflowDelegationTargets } from "../../../../src/workflow-kit/workflow.js";
import { Plan1CanonicalInput, Plan1Input, Plan1Output, plan1Contract, plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

const CHILD = WorkflowIdSchema.parse("fixture-typed-child-member");
const common = { version: 1, label: "Synthetic typed child", icon: "Search" as const, category: "operations" as const,
  input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid" as const, surface: { shape: "single" as const },
  enqueue: "reject-active" as const, actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  identity: { matchKey: (input: { emplId: string }) => input.emplId }, presentation: { title: () => "Synthetic typed child" },
  scenarios: ["fixture-plan1/happy"] as const, role: defineWorkflowRole({ kind: "standalone" }) };
const READ_TYPED: StepManualDeclaration = {
  form: { fields: [{ key: "disposition", label: "Disposition", kind: "text", replaces: { nodeId: "read", path: "disposition" } }] },
  produces: { read: ({ facts, scope }) => Plan1Output.parse({ eid: (scope.input as { emplId: string }).emplId, disposition: facts.disposition, providerState: "typed" }) },
};
const FINISH_MANUALLY = { off: "manual", form: { fields: [] }, produces: {}, skips: ["finish"] } satisfies StepManualDeclaration;

/** The child reads then finishes; the parent releases one member, two for mode "repeat", and an ok and a failing one for "confirmed". */
/** `evolved` is version 2 of the child and parent: the child's result gains an optional field. */
function workflows(nested = false, evolved = false, finishManual?: StepManualDeclaration, exposeChild = true) {
  const version = evolved ? 2 : 1, Result = evolved ? Plan1Output.extend({ note: z.string().optional() }) : Plan1Output;
  const leaf = compileWorkflow(defineWorkflow({ ...common, id: "fixture-typed-child-leaf", code: "ftl", steps: ({ task, result }) => {
    const read = task({ id: "read", contract: plan1Contract, replay: "checkpoint" }, [], ({ input }) => input);
    return { steps: [[{ key: "reading", label: "Reading" }, [read]]], result: result(Plan1Output, [read], ({ outputs }) => outputs.read) };
  } }));
  const child = compileWorkflow(defineWorkflow({ ...common, version, id: CHILD, code: "ftc", steps: ({ task, delegate, group, result }) => {
    const read = task({ id: "read", contract: plan1Contract, replay: "checkpoint" }, [], ({ input }) => input);
    const finish = nested ? delegate({ id: "finish", target: { id: leaf.descriptor.id, input: Plan1Input, result: Plan1Output }, edgeId: "leaf",
      cardinality: "many", await: "terminal", join: "all",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } }, [read], {
      bind: ({ input }) => [input], deriveChildItemId: (_input, identity) => identity.canonicalItemId,
    }) : task({ id: "finish", contract: plan1Contract, replay: "checkpoint" }, [read], ({ input }) => input);
    const finishStep = { key: "finish", label: "Finish" };
    return { steps: [[group({ key: "reading", label: "Reading" }, { manual: READ_TYPED }), [read]],
      [finishManual === undefined ? finishStep : group(finishStep, { manual: finishManual }), [finish]]],
      result: result(Result, nested ? [read] : [read, finish], ({ outputs }) => outputs.read) };
  } }));
  const parent = compileWorkflow(defineWorkflow({ ...common, version, id: "fixture-typed-child-parent", code: "ftp",
    rows: [
      { key: "members", label: "Members", members: [{ step: "members" }] },
      ...(exposeChild ? [
        { key: "member-read", label: "Member read", members: [{ workflow: CHILD, step: "reading" }], target: { workflow: CHILD, step: "reading" } },
        { key: "member-finish", label: "Member finish", members: [{ workflow: CHILD, step: "finish" }],
          ...(finishManual === undefined || finishManual.ownStartOnly === true ? {} : { target: { workflow: CHILD, step: "finish" } }) },
      ] : []),
    ],
    steps: ({ delegate, result }) => {
      const members = delegate({ id: "members", target: { id: CHILD, input: Plan1Input, result: Result }, edgeId: "members",
        cardinality: "many", await: "terminal", join: "all",
        policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } }, [], {
        bind: ({ input }) => input.mode === "repeat" || input.mode === "confirmed"
          ? [{ ...input, emplId: EidSchema.parse("10800001"), mode: "ok" as const },
            { ...input, emplId: EidSchema.parse("10800002"), mode: input.mode === "confirmed" ? "fail" as const : "ok" as const }]
          : [{ ...input, mode: "ok" as const }],
        deriveChildItemId: (_input, identity) => identity.canonicalItemId,
      });
      return { steps: [[{ key: "members", label: "Members" }, [members]]], result: result(Plan1Input, [], ({ input }) => input) };
    } }));
  const modules = [composeWorkflowModule(child, plan1Stores.stores), composeWorkflowModule(parent, plan1Stores.stores),
    ...(nested ? [composeWorkflowModule(leaf, plan1Stores.stores)] : [])];
  bindWorkflowDelegationTargets(modules.map((module) => module.descriptor));
  return { parent, modules };
}

async function harness(nested = false, finishManual?: StepManualDeclaration) {
  const { parent, modules } = workflows(nested, false, finishManual);
  let resolve = (id: string) => modules.find(module => module.descriptor.id === id)?.descriptor;
  const h = await world.executorHarness({ descriptor: parent.descriptor, stores: plan1Stores });
  const { database, clock, path, stateRoot } = h.authority;
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(settings => resolveConfigWithProvenance(settings, hostConfigFacts({}), clock,
      { stateRoot, artifactRoot: h.authority.profile.admission.artifactRoot }), createCredentialStore({ stateRoot })) }, {
    commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
  }).state, "applied");
  const execution = canonicalChildExecution(h.deps, database, path, id => resolve(id));
  const rerun = (runId: string) => {
    const run = database.authority.runs.get(runId);
    assert.ok(run !== undefined);
    const response = readRerunValues({ reader: execution.lifecycle, database, descriptors: { resolve: () => parent.descriptor } }, { runId, expectedVersion: run.version });
    assert.equal(response.state, "available", JSON.stringify(response));
    return response.snapshot;
  };
  return { database, path, execution, parent: parent.descriptor, rerun,
    useAdmissionDescriptors(manual: StepManualDeclaration, exposeChild: boolean) {
      const updated = workflows(nested, false, manual, exposeChild);
      assert.equal(updated.parent.descriptor.contractFingerprint, parent.descriptor.contractFingerprint);
      resolve = id => id === parent.descriptor.id && exposeChild ? parent.descriptor
        : updated.modules.find(module => module.descriptor.id === id)?.descriptor;
    },
  };
}
const stepStates = (steps: readonly { key: string; state: string }[]) => steps.map(({ key, state }) => [key, state]);

const TYPED = [{ workflow: CHILD, step: "reading", facts: { disposition: "typed by hand" } }];

it("hands a typed child entry to the one released child, which records it under its own step while the parent plans nothing", async () => {
  const { database, execution, parent, rerun } = await harness();
  const root = execution.start(parent, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false, selectedStepKeys: ["members"], stepOmissions: TYPED });
  assert.deepEqual(root.envelope.stepOmissions, [{ workflow: CHILD, step: "reading", facts: { disposition: "typed by hand" }, labels: { disposition: "Disposition" } }]);
  const { run } = await execution.execute(root, world.SIGNAL);
  assert.ok(run?.lifecycle.state === "terminal");
  assert.equal(run.lifecycle.outcome, "done", JSON.stringify(database.authority.failures.listByRun(root.envelope.runId)));
  const [child, ...others] = database.authority.runs.listChildren(root.envelope.runId);
  assert.ok(child !== undefined);
  assert.equal(others.length, 0);
  assert.deepEqual(child.envelope.stepOmissions, [{ step: "reading", facts: { disposition: "typed by hand" }, labels: { disposition: "Disposition" } }]);
  const checkpoints = database.authority.runCheckpoints.listByItem(CHILD, child.envelope.itemId).filter(({ runId }) => runId === child.envelope.runId);
  const read = checkpoints.find(({ nodeId }) => nodeId === "read");
  assert.equal(read?.assertion?.step, "reading");
  assert.deepEqual(read?.output.value, { eid: "10800000", disposition: "typed by hand", providerState: "typed" });
  assert.equal(checkpoints.find(({ nodeId }) => nodeId === "finish")?.assertion, undefined);
  const parentCheckpoints = database.authority.runCheckpoints.listByItem(parent.id, root.envelope.itemId).filter(({ runId }) => runId === root.envelope.runId);
  assert.ok(parentCheckpoints.every(({ assertion }) => assertion === undefined));
  const snapshot = rerun(root.envelope.runId);
  assert.deepEqual(snapshot.typed, root.envelope.stepOmissions);
  assert.deepEqual(snapshot.values, []);
  assert.deepEqual(snapshot.steps.map(({ key }) => key), ["members"]);
  assert.deepEqual(snapshot.children?.map(({ workflow, steps }) => [workflow, stepStates(steps)]), [[CHILD, [["reading", "unfinished"], ["finish", "completed"]]]]);
  assert.deepEqual(snapshot.children?.[0]?.steps[0]?.nodes, [{ nodeId: "read", state: "unfinished", reason: "operator-asserted" }]);
});

it.each([
  { reason: "non-empty facts", stepOmissions: TYPED },
  { reason: "off is absent", manual: { form: { fields: [] }, produces: {}, skips: ["finish"] } },
  { reason: "own Start only", manual: { ...FINISH_MANUALLY, ownStartOnly: true } },
  { reason: "input binding", manual: { ...FINISH_MANUALLY, bindInput: (input: Parameters<NonNullable<StepManualDeclaration["bindInput"]>>[0]) => input } },
  { reason: "synthetic outputs", manual: { ...FINISH_MANUALLY, produces: { finish: () => plan1Contract.example }, skips: [] } },
  { reason: "unexposed child step", manual: FINISH_MANUALLY, exposeChild: false },
] satisfies readonly { reason: string; stepOmissions?: typeof TYPED; manual?: StepManualDeclaration; exposeChild?: boolean }[])
("refuses admission before creating any of several children when the omission has $reason", async ({ stepOmissions, manual, exposeChild }) => {
  const { database, execution, parent, useAdmissionDescriptors } = await harness(false, FINISH_MANUALLY);
  const root = execution.start(parent, { emplId: "10800000", text: "same", mode: "repeat" },
    { dryRun: false, selectedStepKeys: ["members"], stepOmissions: stepOmissions ?? [{ workflow: CHILD, step: "finish", facts: {} }] });
  // Start validates the authored rows. Exercise admission's own checks against the retained selection.
  if (manual !== undefined) useAdmissionDescriptors(manual, exposeChild ?? true);
  const { run } = await execution.execute(root, world.SIGNAL);
  assert.partialDeepStrictEqual(run?.lifecycle, { state: "terminal", outcome: "failed" });
  const [failure] = database.authority.failures.listByRun(root.envelope.runId);
  assert.equal(failure?.code, "RUN_CONTINUATION_REFUSED");
  assert.match(failure.summary, /delegation-typed-values-many-members/u);
  assert.equal(database.authority.runs.listChildren(root.envelope.runId).length, 0);
  assert.deepEqual(database.authority.dependencies.groups(root.envelope.runId), []);
});

it("delegates as today with nothing typed: every member runs its own reading and carries no typed entry", async () => {
  const { database, execution, parent, rerun } = await harness();
  const root = execution.start(parent, { emplId: "10800000", text: "same", mode: "repeat" }, { dryRun: false, selectedStepKeys: ["members"] });
  assert.equal(root.envelope.stepOmissions, undefined);
  const { run } = await execution.execute(root, world.SIGNAL);
  assert.ok(run?.lifecycle.state === "terminal");
  assert.equal(run.lifecycle.outcome, "done");
  const children = database.authority.runs.listChildren(root.envelope.runId);
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.envelope.stepOmissions, undefined);
    const read = database.authority.runCheckpoints.listByItem(CHILD, child.envelope.itemId).find(({ runId, nodeId }) => runId === child.envelope.runId && nodeId === "read");
    assert.equal(read?.assertion, undefined);
  }
  const snapshot = rerun(root.envelope.runId);
  assert.equal(snapshot.typed, undefined);
  assert.deepEqual(snapshot.children?.map(({ workflow, steps }) => [workflow, stepStates(steps)]), [[CHILD, [["reading", "completed"], ["finish", "completed"]]]]);
});

async function settle(execution: Awaited<ReturnType<typeof harness>>["execution"], root: ReturnType<Awaited<ReturnType<typeof harness>>["execution"]["start"]>) {
  const seen: unknown[] = [];
  let run = root;
  for (let pass = 0; pass < 4 && run.lifecycle.state !== "terminal"; pass++) {
    const next = await execution.execute(root, world.SIGNAL);
    seen.push([next.run?.lifecycle, next.outcomes.map(o => o.state)]);
    if (next.run !== undefined) run = next.run;
  }
  assert.ok(run.lifecycle.state === "terminal", JSON.stringify(seen));
  return run;
}

it("serves a child row's steps from the least advanced of several child runs", async () => {
  const { execution, parent, rerun } = await harness();
  const root = execution.start(parent, { emplId: "10800000", text: "same", mode: "confirmed" }, { dryRun: false, selectedStepKeys: ["members"] });
  const run = await settle(execution, root);
  assert.ok(run.lifecycle.state === "terminal");
  assert.equal(run.lifecycle.outcome, "failed");
  assert.deepEqual(rerun(root.envelope.runId).children?.map(({ workflow, steps }) => [workflow, stepStates(steps)]),
    [[CHILD, [["reading", "failed"], ["finish", "unfinished"]]]]);
});

it("reports completed delegation nodes in both a parent row and a nested child row", async () => {
  const { execution, parent, rerun } = await harness(true);
  const root = execution.start(parent, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
  const { run } = await execution.execute(root, world.SIGNAL);
  assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  const snapshot = rerun(root.envelope.runId);
  assert.deepEqual(snapshot.steps, [{ key: "members", state: "completed", nodes: [
    { nodeId: "members", state: "completed", reason: "delegation-settled" },
  ] }]);
  assert.deepEqual(snapshot.children?.[0]?.steps.find(({ key }) => key === "finish"), {
    key: "finish", state: "completed", nodes: [{ nodeId: "finish", state: "completed", reason: "delegation-settled" }],
  });
});

it("reads a delegation a failed child never started as not recorded", async () => {
  const { execution, parent, rerun } = await harness(true);
  const root = execution.start(parent, { emplId: "10800000", text: "same", mode: "confirmed" }, { dryRun: false, selectedStepKeys: ["members"] });
  assert.equal((await settle(execution, root)).lifecycle.state, "terminal");
  const finish = rerun(root.envelope.runId).children?.[0]?.steps.find(({ key }) => key === "finish");
  assert.deepEqual(finish, { key: "finish", state: "unfinished", nodes: [{ nodeId: "finish", state: "unfinished", reason: "not-recorded" }] });
});

it("refuses the Rerun source when a retained delegation no longer authenticates", async () => {
  const { database, path, execution, parent } = await harness();
  const root = execution.start(parent, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
  const { run } = await execution.execute(root, world.SIGNAL);
  assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  const member = database.authority.dependencies.groups(root.envelope.runId).find(({ group }) => group.invocation.nodeId === "members")?.group.children[0];
  assert.ok(member);
  const raw = new DatabaseSync(path);
  try {
    const tampered = raw.prepare("UPDATE delegation_dependencies SET payload_json = replace(payload_json, ?, ?) WHERE id = ?")
      .run(`"childItemId":${JSON.stringify(member.dependency.childItemId)}`, `"childItemId":${JSON.stringify(randomUUID())}`, member.dependency.dependencyId);
    assert.equal(tampered.changes, 1);
  } finally { raw.close(); }
  const source = database.authority.runs.get(root.envelope.runId);
  assert.ok(source);
  assert.deepEqual(readRerunValues({ reader: execution.lifecycle, database, descriptors: { resolve: () => parent } }, { runId: source.envelope.runId, expectedVersion: source.version }),
    { state: "refused", code: "source-invalid" });
});

it("keeps a completed delegated source available on Rerun after the parent and child descriptors change, with every current step unfinished", async () => {
  const { database, execution, parent } = await harness();
  const root = execution.start(parent, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
  const { run } = await execution.execute(root, world.SIGNAL);
  assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  const evolved = workflows(false, true).parent.descriptor;
  assert.notEqual(evolved.contractFingerprint, parent.contractFingerprint);
  const before = database.authority.runs.get(root.envelope.runId);
  assert.ok(before);
  const response = readRerunValues({ reader: execution.lifecycle, database, descriptors: { resolve: () => evolved } }, { runId: before.envelope.runId, expectedVersion: before.version });
  assert.equal(response.state, "available", JSON.stringify(response));
  assert.deepEqual(stepStates(response.snapshot.steps), [["members", "unfinished"]]);
  assert.deepEqual(response.snapshot.steps[0]?.nodes, [{ nodeId: "members", state: "unfinished", reason: "not-recorded" }]);
  assert.deepEqual(response.snapshot.children?.map(({ workflow, steps }) => [workflow, stepStates(steps)]), [[CHILD, [["reading", "unfinished"], ["finish", "unfinished"]]]]);
  assert.deepEqual(database.authority.runs.get(root.envelope.runId), before);
});
