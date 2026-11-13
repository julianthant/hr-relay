import { ViewNavigationContext } from "../../../src/dashboard/app/navigation/view-route-model.js";
import { servedFixtureSources as previewFixtureSources } from "../../mocks/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, it } from "vitest";
import { failureCodeFromTaskCode, formatErrorCatalogFailure, operatorFailureSentence } from "../../../src/models/failures/error-catalog.js";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import { WorkflowExplorerWireSchema, ExplorerWorkflowWireSchema, ExplorerNodeWireSchema, ExplorerTaskWireSchema, type ExplorerWorkflowWire, type WorkflowExplorerWire } from "../../../src/models/dashboard/explorer.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";
import { projectExplorerDefinition, useExplorerWiring } from "../../../src/dashboard/state/explorer-wiring-adapter.js";
import { allFields } from "../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { WorkflowExplorer } from "../../../src/dashboard/surfaces/explorer/explorer.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { buildWorkflowCatalog, type WorkflowCatalogEntry } from "../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const wire = buildWorkflowExplorer(explorerQueryDeps(manualClock(new Date("2026-08-09T12:00:00.000Z")), FingerprintSchema.parse("d".repeat(64))));
const compiled = structuredClone(wire.workflows.find(workflow => workflow.definitionPreview.state === "compiled")!);

function changed(change: (workflow: ExplorerWorkflowWire) => void): ExplorerWorkflowWire {
  const workflow = structuredClone(compiled);
  change(workflow);
  return workflow;
}

function lineageWorkflow(): ExplorerWorkflowWire {
  const base = structuredClone(wire.workflows.find(workflow => workflow.id === "separations")!);
  const task = wire.workflows.flatMap(workflow => workflow.nodes.flatMap(node => node.tasks)).find(task => task.arm === "task" && task.effect === "read")!;
  const field = (path: string, side: "input" | "output") => ({ path, side, kind: "string", presence: "always", recorded: { state: "unknown", reason: "No run is loaded" } });
  const binding = { state: "bound", storeNamespace: "crm", storeKind: "browser", driverSystem: "crm" };
  const sourceTask = { ...task, taskId: "crm/source-value", title: "Source contract", binding, fields: [field("value", "output")] };
  const destinationTask = { ...task, taskId: "crm/destination-value", title: "Destination contract", binding, fields: ["direct", "derived", "run", "config", "constant", "child"].map(path => field(path, "input")) };
  const node = (id: string, label: string, tasks: unknown[], dependsOn: string[] = []) => ({ ...base.nodes[0], id, label, purpose: { state: "authored", text: `${label} purpose` }, tasks, dependsOn, shape: { kind: "task", replay: "checkpoint" }, details: [], editableFields: [], coveragePoints: [] });
  const nodes = ExplorerNodeWireSchema.array().parse([
    { ...node("parallel-owner", "Declared parallel", []), shape: { kind: "parallel", join: "all-settled", branches: [{ id: "left", nodes: ["source-node"] }, { id: "right", nodes: ["destination-node"] }] } },
    node("source-node", "Declared source", [sourceTask]),
    { ...node("destination-node", "Declared destination", [destinationTask], ["source-node"]), shape: { kind: "task", replay: "checkpoint", condition: { kind: "is-present", of: { from: "input", path: "run" } } } },
  ]);
  const title = "Fictional declaration group";
  const workflow = ExplorerWorkflowWireSchema.parse({ ...base, nodes, edges: [],
    timeline: [{ key: base.timeline[0].key, label: title, nodes: nodes.map(node => node.id) }],
    reviewSpec: { ...base.reviewSpec, runOptions: { ...base.reviewSpec.runOptions, omittableSteps: [] },
      sessionStep: { ...base.reviewSpec.sessionStep, requirements: [], unavailableDelegations: [] },
      steps: [{ id: base.timeline[0].key, title, pages: { state: "unavailable", reason: "The synthetic graph has no authored page metadata." },
        decisions: nodes.flatMap(node => [
          { id: `${node.id}/succeeded`, nodeId: node.id, kind: node.shape.kind, outcome: "succeeded", action: "continue",
            label: { state: "authored", text: "The declared activity succeeds; continue." } },
          ...(node.shape.kind === "parallel" ? [{ id: `${node.id}/failed`, nodeId: node.id, kind: "parallel", outcome: "failed", action: "continue",
            label: { state: "authored", text: "Wait for every parallel result, including failed reads, then continue." } }] : []),
          ...(node.shape.kind === "task" && node.shape.condition !== undefined ? [{ id: `${node.id}/skipped`, nodeId: node.id, kind: "condition", outcome: "skipped", action: "continue",
            label: { state: "authored", text: "The conditional task does not apply; continue." } }] : []),
          ...node.tasks.flatMap(task => task.errorCodes.map(code => ({ id: `${node.id}/${task.taskId}/${code}`, nodeId: node.id, taskId: task.taskId,
            kind: "failure", outcome: code, action: "stop", failureCode: failureCodeFromTaskCode(code),
            label: { state: "authored", text: operatorFailureSentence(failureCodeFromTaskCode(code)) } }))),
        ]) }] },
    definitionPreview: { state: "compiled", groups: [{ key: base.timeline[0].key, label: title, entries: [{ id: "parallel-owner", kind: "parallel", nodeIds: nodes.map(node => node.id), dependsOn: [], taskIds: [sourceTask.taskId, destinationTask.taskId] }] }], systemsFirstUse: ["crm"] } });
  return workflow;
}
function partText(parts: readonly import("../../../src/models/workflow/explorer-preview.js").FlowPart[]): string[] {
  return parts.flatMap(part => part.kind === "form" || part.kind === "detail" ? [part.title, ...partText(part.parts)] : part.kind === "note" || part.kind === "action" ? [part.text] : []);
}

it("keeps the synthetic lineage review bound to its graph and declared task failures", () => {
  const workflow = lineageWorkflow();
  assert.deepEqual(workflow.reviewSpec.steps.map(step => step.id), workflow.timeline.map(group => group.key));
  const step = workflow.reviewSpec.steps[0]; assert.ok(step);
  const failure = step.decisions.find(decision => decision.kind === "failure"); assert.ok(failure);
  assert.ok(workflow.nodes.some(node => node.id === failure.nodeId && node.tasks.some(task => task.taskId === failure.taskId && task.errorCodes.some(code => code === failure.outcome))));
  assert.equal(ExplorerWorkflowWireSchema.safeParse({ ...workflow, reviewSpec: { ...workflow.reviewSpec,
    steps: [{ ...step, decisions: step.decisions.filter(decision => decision.id !== failure.id) }] } }).success, false);
});

describe("Explorer registered projection", () => {
  it("requires canonical preview metadata and projects every compiled declaration in exact order without run values", () => {
    const missing = structuredClone(wire) as unknown as { workflows: Record<string, unknown>[] };
    delete missing.workflows[0].definitionPreview;
    assert.equal(WorkflowExplorerWireSchema.safeParse(missing).success, false);
    for (const original of wire.workflows) {
      const workflow = structuredClone(original);
      if (workflow.definitionPreview.state !== "compiled") continue;
      const result = projectExplorerDefinition(workflow);
      assert.equal(result.state, "ready", result.state === "refused" ? String(result.evidence) : workflow.id);
      if (result.state !== "ready") continue;
      const expectedSteps = workflow.definitionPreview.groups.flatMap(group => group.operatorFields === undefined
        ? group.entries.flatMap(entry => entry.nodeIds.map(id => ({ title: workflow.nodes.find(node => node.id === id)!.label, operatorFields: group.operatorFields })))
        : [{ title: group.label, operatorFields: group.operatorFields }]);
      assert.deepEqual(result.projection.steps.map(step => step.title), expectedSteps.map(step => step.title));
      for (const [index, step] of result.projection.steps.entries()) for (const field of allFields(step.parts)) {
        const declared = expectedSteps[index].operatorFields?.find(declared => declared.visibility !== "logs" && declared.label === field.label);
        assert.ok(declared);
        assert.equal(field.value, declared.example);
        assert.ok(result.projection.sources.has(field.source!));
        for (const read of result.projection.sources.get(field.source!)?.reads ?? []) assert.ok(result.projection.steps.some(step => step.number === read.step && allFields(step.parts).some(field => field.id === read.fieldId)));
      }
    }
  });
  it("refuses contradictory ordered groups, entry tasks, kinds, dependencies and first-use systems", () => {
    for (const mutation of [
      (w: ExplorerWorkflowWire) => { if (w.definitionPreview.state === "compiled") w.definitionPreview.groups[0].label += " changed"; },
      (w: ExplorerWorkflowWire) => { if (w.definitionPreview.state === "compiled") w.definitionPreview.groups[0].entries[0].taskIds.push(w.nodes.find(node => node.tasks.length)!.tasks[0].taskId); },
      (w: ExplorerWorkflowWire) => { if (w.definitionPreview.state === "compiled") w.definitionPreview.groups[0].entries[0].kind = w.definitionPreview.groups[0].entries[0].kind === "gate" ? "task" : "gate"; },
      (w: ExplorerWorkflowWire) => { if (w.definitionPreview.state === "compiled") w.definitionPreview.groups[0].entries[0].dependsOn.push(w.nodes.at(-1)!.id); },
      (w: ExplorerWorkflowWire) => { if (w.definitionPreview.state === "compiled") w.definitionPreview.systemsFirstUse.push(w.definitionPreview.systemsFirstUse[0]); },
    ]) {
      const modified = changed(mutation);
      assert.notDeepEqual(modified, compiled);
      assert.equal(projectExplorerDefinition(modified).state, "refused");
    }
  });
  it("retains unresolved exact source paths/reasons without constructing nonexistent jump anchors", () => {
    const modified = changed(w => { w.nodes.find(node => node.tasks.length)!.tasks[0].implSource = { state: "unresolved", attemptedPath: w.sources.module.state === "resolved" ? w.sources.module.path : w.sources.module.attemptedPath, reason: "fixture source missing" }; });
    const result = projectExplorerDefinition(modified);
    assert.equal(result.state, "ready");
    if (result.state === "ready") assert.ok([...result.projection.sources.values()].some(source => source.detail?.includes("Unresolved: fixture source missing")));
  });
  it("keeps unavailable metadata distinct from an empty ready graph", () => {
    assert.deepEqual(projectExplorerDefinition(changed(w => { w.definitionPreview = { state: "unavailable", reason: "No compiled definition" }; })), { state: "unavailable", reason: "No compiled definition" });
  });
});

it("invalidates settled and pending requests across workflow and client A -> B -> A", async () => {
  const pending: { resolve: (wire: WorkflowExplorerWire) => void; reject: (error: unknown) => void }[] = [];
  const makeClient = () => ({ workflowExplorer: () => new Promise<WorkflowExplorerWire>((resolve, reject) => pending.push({ resolve, reject })) });
  const a = makeClient(), b = makeClient();
  const seen: ReturnType<typeof useExplorerWiring>[] = [];
  function Probe({ client, id, version }: { client: typeof a; id?: string; version?: number }) { seen.push(useExplorerWiring(client, id, version)); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (client: typeof a, id?: string, version?: number) => { await act(async () => root.render(createElement(Probe, { client, id, version }))); };
  try {
    await render(a); assert.equal(pending.length, 0);
    await render(a, compiled.id); await act(async () => pending[0].resolve(wire)); assert.equal(seen.at(-1)?.state, "ready");
    const start = seen.length;
    await render(b, compiled.id); assert.ok(seen.slice(start).every(value => value.state === "loading"));
    await render(a, "missing-workflow");
    await render(a, compiled.id);
    await act(async () => { pending[1].reject(new Error("old client")); pending[2].resolve(wire); });
    assert.equal(seen.at(-1)?.state, "loading");
    await act(async () => pending[3].resolve(wire)); assert.equal(seen.at(-1)?.state, "ready");
    await render(a, compiled.id, compiled.version + 1);
    assert.equal(seen.at(-1)?.state, "loading");
    await act(async () => pending[4].resolve(wire)); assert.equal(seen.at(-1)?.state, "refused");
  } finally { await act(async () => root.unmount()); }
});

it("renders the actual authored onboarding branch through the served definition and existing timeline", async () => {
  const workflow = wire.workflows.find(workflow => workflow.id === "onboarding"); assert.ok(workflow);
  const projected = projectExplorerDefinition(workflow); assert.ok(projected.state === "ready");
  assert.ok(projected.projection.steps.some(step => step.title === "i9-route"));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => new Response(JSON.stringify({ ...wire, workflows: [workflow] }), { status: 200 }) });
  const catalog: WorkflowCatalogEntry[] = [{ id: workflow.id, label: workflow.label, categoryId: "uncategorized", role: { kind: "composition" }, source: "served", launch: { state: "served" } }];
  try {
    await act(async () => root.render(createElement(ViewNavigationContext.Provider, {
      value: { view: { explorerWorkflow: workflow.id }, start: false, setStart() {}, update() {} },
      children: createElement(DashboardClientProvider, { client, children: createElement(WorkflowExplorer, { catalog, client }) }),
    })));
    assert.ok([...host.querySelectorAll('[aria-label="Workflow steps"] h2')].some(node => node.textContent === "i9-route"));
    assert.ok(host.textContent?.includes("No alternative is selected in this definition preview."));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("mounts a served entry without a fictional preview through the injected-client scaffold", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let calls = 0;
  const served = lineageWorkflow();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: () => { calls++; return Promise.resolve(new Response(JSON.stringify({ ...wire, workflows: [served] }), { status: 200 })); } });
  assert.ok(served);
  const catalog: WorkflowCatalogEntry[] = [{ id: served.id, label: served.label, categoryId: "uncategorized", role: { kind: "standalone" }, source: "served", launch: { state: "served" } }];
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(WorkflowExplorer, { catalog, client }) })));
    assert.equal(calls, 1);
    assert.ok(host.textContent?.includes("No run values are available."));
    assert.deepEqual([...host.querySelectorAll('[aria-label="Workflow steps"] h2')].map(node => node.textContent), served.nodes.map(node => node.label));
    assert.equal(host.querySelector('[data-disclosure="1-declared-presentation"]'), null);
    assert.ok(host.textContent?.includes("Declared source purpose"));
    assert.doesNotMatch(host.textContent ?? "", /source-node|destination-node|Invocation outcome|input ·|Unresolved source anchor/u);
    assert.equal(host.querySelector('[aria-label="Show source for input · direct"]'), null);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps a selected served workflow unavailable without an injected client instead of showing a fictional flow", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const served = lineageWorkflow();
  const catalog: WorkflowCatalogEntry[] = [{ id: served.id, label: served.label, categoryId: "uncategorized", role: { kind: "standalone" }, source: "served", launch: { state: "served" } }];
  try {
    await act(async () => root.render(createElement(WorkflowExplorer, { catalog })));
    assert.ok(host.textContent?.includes("Registered workflow data is unavailable because the dashboard client is not connected."));
    assert.equal(host.textContent?.includes("Separation filed and Kuali document verified"), false);
    assert.equal(host.textContent?.includes("Source contract"), false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("renders complete mock previews without requesting registered data", async () => {
  const host = document.createElement("div"); const root = createRoot(host);
  const client = createDashboardClient({ baseUrl: "http://unused.test", fetchImpl: () => { throw new Error("unexpected mock request"); } });
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(WorkflowExplorer, { catalog: buildWorkflowCatalog([], true, previewFixtureSources([])), client }) })));
    assert.ok(host.textContent?.includes("Separation filed and Kuali document verified"));
  } finally { await act(async () => root.unmount()); }
});

it("resets hypothetical choices on injected-client replacement without dispatching or querying", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const client = () => createDashboardClient({ baseUrl: "http://unused.test", fetchImpl: () => { throw new Error("local choices cannot query or dispatch"); } });
  const catalog = buildWorkflowCatalog([], true, previewFixtureSources([]));
  const render = async (current: ReturnType<typeof client>) => { await act(async () => root.render(createElement(DashboardClientProvider, { client: current, children: createElement(WorkflowExplorer, { catalog, client: current }) }))); };
  try {
    await render(client());
    const control = host.querySelector('[aria-label="Identity check preview"]');
    assert.ok(control instanceof HTMLButtonElement);
    await act(async () => control.click());
    const option = document.querySelector('[role="option"][data-value="rejected"]');
    assert.ok(option instanceof HTMLElement);
    await act(async () => option.click());
    assert.ok((host.querySelector('[data-step-number="16"]') as HTMLElement).hidden);
    await render(client());
    assert.equal((host.querySelector('[data-step-number="16"]') as HTMLElement).hidden, false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

describe("complete source and structure declarations", () => {
  it("preserves parallel membership, joins, conditions and every composition action without choosing a path", () => {
    const result = projectExplorerDefinition(lineageWorkflow());
    assert.equal(result.state, "ready", result.state === "refused" ? String(result.evidence) : "");
    if (result.state !== "ready") return;
    const text = result.projection.steps.flatMap(step => partText(step.parts));
    const workflow = lineageWorkflow();
    assert.deepEqual(workflow.nodes[0].shape, { kind: "parallel", join: "all-settled", branches: [{ id: "left", nodes: ["source-node"] }, { id: "right", nodes: ["destination-node"] }] });
    assert.ok(text.some(text => text.includes("activities can run alongside")));
    assert.doesNotMatch(text.join("\n"), /parallel-owner|source-node|destination-node|combine-values|Declared children|runs when the run/u);
  });
  it("refuses pending bindings and splits multi-system tasks in declaration order without Local", () => {
    const pending = lineageWorkflow();
    pending.nodes[2].tasks[0].binding = { state: "pending", note: "Implementation not registered" };
    const refusal = projectExplorerDefinition(pending);
    assert.equal(refusal.state, "refused");
    if (refusal.state === "refused") {
      assert.equal(refusal.failure.code, "EXPLORER_TASK_BINDING_UNAVAILABLE");
      assert.deepEqual(refusal.evidence, { taskId: pending.nodes[2].tasks[0].taskId, binding: pending.nodes[2].tasks[0].binding });
    }
    pending.definitionPreview = { state: "unavailable", reason: "Preview not compiled" };
    assert.equal(projectExplorerDefinition(pending).state, "refused");
    const workflow = lineageWorkflow();
    const source = workflow.nodes[1];
    source.tasks.push(ExplorerTaskWireSchema.parse({ ...source.tasks[0], taskId: "kuali/other-source", binding: { state: "bound", storeNamespace: "kuali", storeKind: "browser", driverSystem: "kuali" }, fields: [{ ...source.tasks[0].fields[0], path: "other" }] }));
    source.tasks.push(ExplorerTaskWireSchema.parse({ ...source.tasks[0], taskId: "crm/final-source", fields: [{ ...source.tasks[0].fields[0], path: "final" }] }));
    assert.ok(workflow.definitionPreview.state === "compiled");
    workflow.definitionPreview.groups[0].entries[0].taskIds = workflow.nodes.flatMap(node => node.tasks.map(task => task.taskId));
    workflow.definitionPreview.systemsFirstUse = ["crm", "kuali"];
    const result = projectExplorerDefinition(workflow);
    assert.equal(result.state, "ready", result.state === "refused" ? String(result.evidence) : "");
    if (result.state !== "ready") return;
    assert.deepEqual(result.projection.steps.map(step => [step.number, step.title, step.system]), [
      [1, "Declared parallel", undefined], [2, "Declared source", "CRM"], [3, "Declared source", "Kuali"], [4, "Declared source", "CRM"], [5, "Declared destination", "CRM"],
    ]);
    assert.deepEqual(result.projection.steps.flatMap(step => allFields(step.parts)), []);
    assert.deepEqual([...result.projection.sources.keys()], workflow.nodes.flatMap(node => node.tasks.flatMap(task => task.fields.map(field => `${node.id}:${task.arm}:${task.taskId}:${field.side}:${field.path}`))));
    for (const step of result.projection.steps) for (const field of allFields(step.parts)) {
      assert.ok(step.system);
      assert.ok(result.projection.sources.has(field.id));
      assert.ok(result.projection.sources.get(field.id)?.detail?.includes(`System: ${step.system}`));
      assert.notEqual(step.system, "Local");
    }
    assert.doesNotMatch(partText(result.projection.steps[2].parts).join("\n"), /parallel-owner|branch left/u);
  });
  it("rethrows unrelated projection exceptions instead of classifying them as invalid definitions", () => {
    const workflow = lineageWorkflow();
    const fault = new Error("unexpected projection fault");
    Object.defineProperty(workflow, "timeline", { get() { throw fault; } });
    assert.throws(() => projectExplorerDefinition(workflow), error => error === fault);
  });
  it("labels headless task fields as Local from their binding", () => {
    const workflow = lineageWorkflow();
    for (const node of workflow.nodes) for (const task of node.tasks) task.binding = { state: "bound", storeNamespace: "local", storeKind: "headless" };
    assert.ok(workflow.definitionPreview.state === "compiled");
    workflow.definitionPreview.systemsFirstUse = [];
    const result = projectExplorerDefinition(workflow);
    assert.equal(result.state, "ready");
    if (result.state === "ready") {
      assert.deepEqual(result.projection.steps.flatMap(step => allFields(step.parts)), []);
      assert.equal(result.projection.steps.filter(step => step.system === "Local").length, 2);
    }
  });
  it("names branch alternatives and membership without simulating all alternatives", () => {
    const workflow = lineageWorkflow();
    const branch = workflow.nodes.find(node => node.id === "source-node")!;
    branch.tasks = [];
    branch.shape = { kind: "branch", cases: [{ name: "with-record", nodes: [workflow.nodes[2].id] }, { name: "without-record", nodes: [] }] };
    assert.ok(workflow.definitionPreview.state === "compiled");
    workflow.definitionPreview.groups[0].entries[0].taskIds = workflow.nodes[2].tasks.map(task => task.taskId);
    const result = projectExplorerDefinition(workflow);
    assert.equal(result.state, "ready");
    if (result.state !== "ready") return;
    const text = result.projection.steps.flatMap(step => partText(step.parts)).join("\n");
    assert.deepEqual(branch.shape, { kind: "branch", cases: [{ name: "with-record", nodes: [workflow.nodes[2].id] }, { name: "without-record", nodes: [] }] });
    assert.ok(text.includes("The workflow follows the applicable alternative. No alternative is selected in this definition preview."));
    assert.doesNotMatch(text, /with-record|without-record|destination-node/u);
  });
  it("keeps taskless controls without an invented system", () => {
    const result = projectExplorerDefinition(lineageWorkflow());
    assert.equal(result.state, "ready");
    if (result.state !== "ready") return;
    assert.equal(result.projection.steps[0].system, undefined);
    assert.doesNotMatch(result.projection.steps.flatMap(step => partText(step.parts)).join("\n"), /source-node|parallel-owner/u);
  });
});

it("maps failed Explorer reads to the shared dashboard read catalog text", async () => {
  const root = createRoot(document.createElement("div"));
  const evidence = new Error("fixture read failed");
  const client = { workflowExplorer: async () => { throw evidence; } };
  let result: ReturnType<typeof useExplorerWiring> | undefined;
  function Probe() { result = useExplorerWiring(client, compiled.id); return null; }
  try {
    await act(async () => root.render(createElement(Probe)));
    assert.equal(result?.state, "refused");
    if (result?.state === "refused") {
      assert.equal(result.failure.code, "DASHBOARD_READ_FAILED");
      assert.equal(result.evidence, evidence);
      assert.equal(formatErrorCatalogFailure(result.failure).text, "The dashboard could not load this from the local service. Try again.");
    }
  } finally { await act(async () => root.unmount()); }
});

it("revisits a served definition from its exact retained projection and exposes a failed refresh without replacing it", async () => {
  let calls = 0;
  const held = Promise.withResolvers<WorkflowExplorerWire>();
  const client = { workflowExplorer: () => ++calls === 1 ? Promise.resolve(wire) : held.promise };
  let state: ReturnType<typeof useExplorerWiring> | undefined;
  const seen: ReturnType<typeof useExplorerWiring>[] = [];
  function Probe() { state = useExplorerWiring(client, compiled.id); seen.push(state); return null; }
  const current = () => seen.at(-1);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    const loaded = state; assert.ok(loaded?.state === "ready");
    await act(async () => root.render(null)); seen.length = 0;
    await act(async () => root.render(createElement(Probe)));
    assert.equal(calls, 2); assert.ok(seen.every(value => value.state === "ready"));
    const revisited = seen.at(-1); assert.ok(revisited?.state === "ready"); assert.deepEqual(revisited.projection, loaded.projection);
    const evidence = new Error("synthetic refresh rejected");
    await act(async () => held.reject(evidence));
    const failed = current(); assert.ok(failed?.state === "refused"); assert.deepEqual(failed.previous, loaded.projection); assert.equal(failed.evidence, evidence);
  } finally { act(() => root.unmount()); }
});
