import { servedFixtureSources as previewFixtureSources } from "../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, it } from "vitest";
import { formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import { WorkflowExplorerWireSchema, ExplorerWorkflowWireSchema, ExplorerTaskWireSchema, SourceLinkWireSchema, type ExplorerWorkflowWire, type WorkflowExplorerWire } from "../../../src/models/dashboard/explorer.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { WorkflowOperationDisplaySnapshotSchema, type WorkflowOperationDisplaySnapshot } from "../../../src/models/workflow/operation-display-snapshot.js";
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
const compiled = wire.workflows.find(workflow => workflow.definitionPreview.state === "compiled")!;

function changed(change: (workflow: ExplorerWorkflowWire) => void): ExplorerWorkflowWire {
  const workflow = structuredClone(compiled);
  change(workflow);
  return workflow;
}

function redigest(definition: WorkflowOperationDisplaySnapshot): WorkflowOperationDisplaySnapshot {
  const { contentDigest: _digest, ...payload } = definition;
  return WorkflowOperationDisplaySnapshotSchema.parse({ ...payload, contentDigest: sha256Hex(`hrauto:operation-display-snapshot:v2\0${canonicalJsonStringify(payload)}`) });
}
function lineageWorkflow(): ExplorerWorkflowWire {
  const base = wire.workflows.find(workflow => workflow.id === "separations")!;
  const task = wire.workflows.flatMap(workflow => workflow.nodes.flatMap(node => node.tasks)).find(task => task.arm === "task" && task.effect === "read")!;
  const field = (path: string, side: "input" | "output") => ({ path, side, kind: "string", presence: "always", recorded: { state: "unknown", reason: "No run is loaded" } });
  const binding = { state: "bound", storeNamespace: "crm", storeKind: "browser", driverSystem: "crm" };
  const sourceTask = { ...task, taskId: "crm/source-value", title: "Source contract", binding, fields: [field("value", "output")] };
  const destinationTask = { ...task, taskId: "crm/destination-value", title: "Destination contract", binding, fields: ["direct", "derived", "run", "config", "constant", "child"].map(path => field(path, "input")) };
  const node = (id: string, label: string, tasks: unknown[], dependsOn: string[] = []) => ({ ...base.nodes[0], id, label, purpose: { state: "authored", text: `${label} purpose` }, tasks, dependsOn, shape: { kind: "task", replay: "checkpoint" }, details: [], editableFields: [], coveragePoints: [] });
  const nodes = [
    { ...node("parallel-owner", "Declared parallel", []), shape: { kind: "parallel", join: "all-settled", branches: [{ id: "left", nodes: ["source-node"] }, { id: "right", nodes: ["destination-node"] }] } },
    node("source-node", "Declared source", [sourceTask]),
    { ...node("destination-node", "Declared destination", [destinationTask], ["source-node"]), shape: { kind: "task", replay: "checkpoint", condition: { kind: "is-present", of: { from: "input", path: "run" } } } },
  ];
  const workflow = ExplorerWorkflowWireSchema.parse({ ...base, nodes, edges: [],
    timeline: [{ key: base.timeline[0].key, label: "Fictional declaration group", nodes: nodes.map(node => node.id) }],
    definitionPreview: { state: "compiled", groups: [{ key: base.timeline[0].key, label: "Fictional declaration group", entries: [{ id: "parallel-owner", kind: "parallel", nodeIds: nodes.map(node => node.id), dependsOn: [], taskIds: [sourceTask.taskId, destinationTask.taskId] }] }], systemsFirstUse: ["crm"] } });
  const refs = {
    direct: { kind: "task-output", entryId: "source-node", path: "value" },
    derived: { kind: "transformation", transformId: "combine-values", path: "value" },
    run: { kind: "run-input", path: "run" }, config: { kind: "configuration", key: "fixture.setting", schemaHash: "a".repeat(64) },
    constant: { kind: "constant", valueDigest: "b".repeat(64) }, child: { kind: "child-output", entryId: "source-node", path: "value" },
  };
  const operation = (id: string, values: unknown[], actions: unknown[]) => ({ version: 1, id, system: "crm", session: { kind: "browser", id: "fixture-session", system: "crm" }, values, templates: [], transforms: [], actions });
  const snapshot = WorkflowOperationDisplaySnapshotSchema.parse({ capability: "complete", declarationVersion: 1, snapshotVersion: 2, workflowId: workflow.id, definitionFingerprint: workflow.contractFingerprint,
    transforms: [{ id: "combine-values", inputSchemaHash: "a".repeat(64), outputSchemaHash: "a".repeat(64), inputs: [{ id: "upstream", inputPath: "value", value: refs.direct }, { id: "caller", inputPath: "caller", value: refs.run }] }],
    invocations: [
      { id: "source-operation", entryId: "source-node", taskId: sourceTask.taskId, contractRole: "task", occurrencePath: ["source-operation"], bindings: [], outcomes: [{ id: "source-found", label: "Source declared result", when: { kind: "is-present", value: refs.direct }, continuation: "read-value" }], operation: operation("source-operation", [{ id: "output-value", source: { kind: "contract-output", path: "value" } }], [{ id: "read-value", kind: "read-field", valueSlot: "output-value" }]) },
      { id: "destination-operation", entryId: "destination-node", taskId: destinationTask.taskId, contractRole: "task", occurrencePath: ["destination-operation"], bindings: Object.entries(refs).map(([slot, value]) => ({ slot, value })), outcomes: [], operation: operation("destination-operation", Object.keys(refs).map(id => ({ id, source: { kind: "contract-input", path: id } })), [{ id: "fill-direct", kind: "fill-field", target: "crm.destination", valueSlot: "direct" }, { id: "verify-output", kind: "verify", children: [{ id: "nested-read", kind: "read-field" }] }]) },
    ],
    presentation: [{ id: "parallel-presentation", kind: "branch", entryId: "parallel-owner", outcomes: [{ id: "declared-case", label: "Input present", when: { kind: "is-present", value: refs.run } }], children: [{ id: "source-presentation", kind: "operation", invocationId: "source-operation", entryId: "source-node" }, { id: "destination-presentation", kind: "operation", invocationId: "destination-operation", entryId: "destination-node" }, { id: "delegate-display", kind: "delegate", targetWorkflowId: "person-lookup" }, { id: "transform-display", kind: "compute", transform: "combine-values" }, { id: "join-display", kind: "join", entryId: "parallel-owner" }] }],
    execution: workflow.nodes.map(node => ({ entryId: node.id, dependsOn: node.dependsOn })), contentDigest: "c".repeat(64),
  });
  workflow.operationStructure = { state: "declared", definition: redigest(snapshot) };
  return workflow;
}
function partText(parts: readonly import("../../../src/dashboard/surfaces/explorer/explorer-flow-model.js").FlowPart[]): string[] {
  return parts.flatMap(part => part.kind === "form" || part.kind === "detail" ? [part.title, ...partText(part.parts)] : part.kind === "note" || part.kind === "action" ? [part.text] : []);
}

describe("Explorer registered projection", () => {
  it("requires canonical preview metadata and projects every compiled declaration in exact order without run values", () => {
    const missing = structuredClone(wire) as unknown as { workflows: Record<string, unknown>[] };
    delete missing.workflows[0].definitionPreview;
    assert.equal(WorkflowExplorerWireSchema.safeParse(missing).success, false);
    for (const workflow of wire.workflows) {
      if (workflow.definitionPreview.state !== "compiled") continue;
      const result = projectExplorerDefinition(workflow);
      assert.equal(result.state, "ready", result.state === "refused" ? String(result.evidence) : workflow.id);
      if (result.state !== "ready") continue;
      assert.deepEqual(result.projection.steps.map(step => step.title), workflow.definitionPreview.groups.flatMap(group => group.operatorFields === undefined ? group.entries.flatMap(entry => entry.nodeIds.map(id => workflow.nodes.find(node => node.id === id)!.label)) : [group.label]));
      for (const step of result.projection.steps) for (const field of allFields(step.parts)) {
        const declared = workflow.timeline.flatMap(group => group.operatorFields ?? []).find(declared => declared.label === field.label);
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
  it("projects ordered declared actions and refuses changed snapshot identities, digests and invocation order", () => {
    const workflow = structuredClone(compiled);
    const node = workflow.nodes.find(node => node.tasks.length)!;
    const task = node.tasks[0];
    const system = task.binding.state === "bound" ? task.binding.driverSystem ?? "local" : "local";
    const payload = {
      capability: "complete", declarationVersion: 1, snapshotVersion: 2, workflowId: workflow.id,
      definitionFingerprint: workflow.contractFingerprint, transforms: [],
      invocations: [{ id: "test-operation", entryId: node.id, taskId: task.taskId, contractRole: task.arm, occurrencePath: ["test-operation"], bindings: [], outcomes: [],
        operation: { version: 1, id: "test-operation", system, session: { kind: system === "local" ? "local" : "browser", id: "test-session", ...(system === "local" ? {} : { system }) }, values: [], templates: [], transforms: [],
          actions: [{ id: "first-action", kind: "read-field", label: "Read declared input" }, { id: "second-action", kind: "verify", label: "Verify declared output" }] } }],
      presentation: [{ id: "present-operation", kind: "operation", invocationId: "test-operation", entryId: node.id }],
      execution: workflow.nodes.map(node => ({ entryId: node.id, dependsOn: node.dependsOn })),
    };
    const snapshot = WorkflowOperationDisplaySnapshotSchema.parse({ ...payload, contentDigest: sha256Hex(`hrauto:operation-display-snapshot:v2\0${canonicalJsonStringify(payload)}`) });
    workflow.operationStructure = { state: "declared", definition: snapshot };
    const result = projectExplorerDefinition(workflow);
    assert.equal(result.state, "ready", result.state === "refused" ? String(result.evidence) : "");
    if (result.state === "ready") {
      assert.ok(workflow.operationStructure.state === "declared");
      assert.deepEqual(workflow.operationStructure.definition.invocations[0].operation.actions.map(action => action.label), ["Read declared input", "Verify declared output"]);
      assert.doesNotMatch(result.projection.steps.flatMap(step => partText(step.parts)).join("\n"), /first-action|second-action|read-field|present-operation/u);
    }
    const wrongIdentity = structuredClone(workflow);
    if (wrongIdentity.operationStructure.state === "declared") wrongIdentity.operationStructure.definition.workflowId = workflow.nodes[0].id as unknown as typeof workflow.id;
    assert.equal(projectExplorerDefinition(wrongIdentity).state, "refused");
    const corrupt = structuredClone(workflow);
    if (corrupt.operationStructure.state === "declared") corrupt.operationStructure.definition.invocations[0].operation.actions.reverse();
    assert.equal(projectExplorerDefinition(corrupt).state, "refused");
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
    assert.equal(calls, 0);
    const recovery = [...host.querySelectorAll("button")].find(button => button.textContent === "Open Separations");
    assert.ok(recovery);
      await act(async () => recovery.click());
      assert.equal(calls, 1);
      assert.ok(host.textContent?.includes("No run values are available."));
      assert.deepEqual([...host.querySelectorAll('[aria-label="Workflow steps"] h2')].map(node => node.textContent), served.nodes.map(node => node.label));
      assert.equal(host.querySelector('[data-disclosure="1-declared-presentation"]'), null);
      assert.ok(host.textContent?.includes("Declared source purpose"));
      assert.doesNotMatch(host.textContent ?? "", /source-node|destination-node|Invocation outcome|input ·|Unresolved source anchor/u);
      assert.equal(host.querySelector('[aria-label="Show source for input · direct"]'), null);
      assert.ok(served.operationStructure.state === "declared");
      assert.equal(served.operationStructure.definition.invocations[0].outcomes[0].label, "Source declared result");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps a selected served workflow unavailable without an injected client instead of showing a fictional flow", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const served = lineageWorkflow();
  const catalog: WorkflowCatalogEntry[] = [{ id: served.id, label: served.label, categoryId: "uncategorized", role: { kind: "standalone" }, source: "served", launch: { state: "served" } }];
  try {
    await act(async () => root.render(createElement(WorkflowExplorer, { catalog })));
    const recovery = [...host.querySelectorAll("button")].find(button => button.textContent === "Open Separations");
    assert.ok(recovery);
    await act(async () => recovery.click());
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
    assert.ok(workflow.operationStructure.state === "declared");
    const presentation = workflow.operationStructure.definition.presentation[0];
    assert.deepEqual(presentation.children?.map(child => child.kind), ["operation", "operation", "delegate", "compute", "join"]);
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
    const direct = result.projection.sources.get("destination-node:task:crm/destination-value:input:direct");
    assert.equal(direct?.reads?.[0].step, 2);
    assert.equal(result.projection.sources.get("destination-node:task:crm/destination-value:input:derived")?.chain?.[0].step, 5);
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
    workflow.operationStructure = { state: "legacy", reason: "No complete action declaration" };
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
    workflow.operationStructure = { state: "legacy", reason: "No complete action declaration" };
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
  it("maps each declared action kind to its distinct existing action icon", () => {
    const workflow = lineageWorkflow();
    assert.ok(workflow.operationStructure.state === "declared");
    const icons = { "open-page": "click", "resume-page": "rejoin", click: "click", keypress: "key", "read-field": "read", "fill-field": "key", "select-field": "key", "check-field": "key", compute: "compute", verify: "verify", branch: "compute", join: "rejoin", "operator-gate": "verify", delegate: "compute", "session-lifecycle": "click" } as const;
    const original = workflow.operationStructure.definition.invocations[0].operation.actions[0];
    workflow.operationStructure.definition.invocations[0].operation.actions = Object.keys(icons).map(kind => ({ ...original, id: `action-${kind}`, kind: kind as keyof typeof icons }));
    workflow.operationStructure.definition = redigest(workflow.operationStructure.definition);
    const result = projectExplorerDefinition(workflow);
    assert.equal(result.state, "ready");
    if (result.state !== "ready") return;
    const actions = (parts: readonly import("../../../src/dashboard/surfaces/explorer/explorer-flow-model.js").FlowPart[]): Extract<typeof parts[number], { kind: "action" }>[] => parts.flatMap(part => part.kind === "detail" || part.kind === "form" ? actions(part.parts) : part.kind === "action" ? [part] : []);
    const mapped = result.projection.steps.filter(step => step.title === "Declared source").flatMap(step => actions(step.parts));
    assert.equal(mapped.length, Object.keys(icons).length);
    assert.deepEqual(mapped.map(action => action.icon), Object.values(icons));
  });
  it("resolves exact output anchors and transformation lineage and retains all non-field sources", () => {
    const result = projectExplorerDefinition(lineageWorkflow());
    assert.equal(result.state, "ready");
    if (result.state !== "ready") return;
    const source = (path: string) => result.projection.sources.get(`destination-node:task:crm/destination-value:input:${path}`)!;
    const direct = source("direct");
    assert.deepEqual(direct.reads, [{ step: 2, fieldId: "source-node:task:crm/source-value:output:value", system: "CRM", page: "Source contract", field: "value" }]);
    assert.deepEqual(source("derived").reads, direct.reads);
    assert.deepEqual(source("derived").chain?.map(item => [item.step, item.title]), [[3, "combine-values"]]);
    assert.ok(source("derived").detail?.includes("Run input · run"));
    for (const [path, expected] of [["run", "Run input · run"], ["config", "Configuration · fixture.setting"], ["constant", `Static constant digest · ${"b".repeat(64)}`], ["child", "Unresolved child-output anchor: source-node.value"]]) {
      assert.ok(source(path).detail?.includes(expected));
      assert.equal(source(path).reads, undefined);
    }
  });
  it("names missing or ambiguous source anchors, retains exact unresolved evidence, and refuses lineage cycles", () => {
    for (const ambiguous of [false, true]) {
      const workflow = lineageWorkflow();
      const sourceNode = workflow.nodes.find(node => node.id === "source-node")!;
      if (ambiguous) {
        sourceNode.tasks.push(ExplorerTaskWireSchema.parse({ ...sourceNode.tasks[0], taskId: "crm/other-source-value" }));
        assert.ok(workflow.definitionPreview.state === "compiled");
        workflow.definitionPreview.groups[0].entries[0].taskIds = workflow.nodes.flatMap(node => node.tasks.map(task => task.taskId));
      } else {
        sourceNode.tasks[0].fields = [];
        assert.ok(workflow.operationStructure.state === "declared");
        workflow.operationStructure.definition.invocations[0].operation.values = [];
        const { valueSlot: _slot, ...action } = workflow.operationStructure.definition.invocations[0].operation.actions[0];
        workflow.operationStructure.definition.invocations[0].operation.actions[0] = action;
        workflow.operationStructure.definition = redigest(workflow.operationStructure.definition);
      }
      const path = "src/fixture/missing-contract.ts";
      sourceNode.tasks[0].contractSource = SourceLinkWireSchema.parse({ state: "unresolved", attemptedPath: path, reason: "exact fixture missing reason" });
      const result = projectExplorerDefinition(workflow);
      assert.equal(result.state, "ready");
      if (result.state !== "ready") continue;
      const direct = result.projection.sources.get("destination-node:task:crm/destination-value:input:direct")!;
      assert.ok(direct.detail?.includes("Unresolved source anchor: source-node.value"));
      assert.equal(direct.reads, undefined);
      if (ambiguous) assert.equal(result.projection.sources.get("source-node:task:crm/source-value:output:value")?.origin, `${path} · Unresolved: exact fixture missing reason`);
    }
    const missingDestination = lineageWorkflow();
    missingDestination.nodes[2].tasks[0].fields = missingDestination.nodes[2].tasks[0].fields.filter(field => field.path !== "direct");
    assert.equal(projectExplorerDefinition(missingDestination).state, "refused");
    const cyclic = lineageWorkflow();
    assert.ok(cyclic.operationStructure.state === "declared");
    const transform = cyclic.operationStructure.definition.transforms[0];
    transform.inputs[0].value = { kind: "transformation", transformId: transform.id, path: transform.inputs[0].inputPath };
    cyclic.operationStructure.definition = redigest(cyclic.operationStructure.definition);
    assert.equal(projectExplorerDefinition(cyclic).state, "refused");
  });
  it("refuses independently re-digested declaration order mismatches", () => {
    const workflow = lineageWorkflow();
    assert.ok(workflow.operationStructure.state === "declared");
    workflow.operationStructure.definition.invocations.reverse();
    workflow.operationStructure.definition = redigest(workflow.operationStructure.definition);
    const result = projectExplorerDefinition(workflow);
    assert.equal(result.state, "refused");
    if (result.state === "refused") assert.match(String(result.evidence), /ordered operation presentation/u);
  });
  it("joins each invocation role and output slot to its exact task metadata after a valid re-digest", () => {
    assert.equal(projectExplorerDefinition(lineageWorkflow()).state, "ready");
    for (const wrongRole of [false, true]) {
      const workflow = lineageWorkflow();
      assert.ok(workflow.operationStructure.state === "declared");
      const invocation = workflow.operationStructure.definition.invocations[0];
      if (wrongRole) invocation.contractRole = "commit";
      else invocation.operation.values[0].source.path = "missingOutput";
      workflow.operationStructure.definition = redigest(workflow.operationStructure.definition);
      const result = projectExplorerDefinition(workflow);
      assert.equal(result.state, "refused");
      if (result.state === "refused") assert.match(String(result.evidence), wrongRole ? /contract role source-operation/u : /contract output slot source-operation:output-value:missingOutput/u);
    }
    const parent = lineageWorkflow();
    parent.nodes[1].tasks[0] = ExplorerTaskWireSchema.parse({ ...parent.nodes[1].tasks[0], fields: [{ ...parent.nodes[1].tasks[0].fields[0], path: "profile.name" }] });
    assert.ok(parent.operationStructure.state === "declared");
    parent.operationStructure.definition.invocations[0].operation.values[0].source.path = "profile";
    parent.operationStructure.definition.invocations[1].bindings[0].value = { kind: "task-output", entryId: parent.nodes[1].id, path: "profile.name" };
    parent.operationStructure.definition.transforms[0].inputs[0].value = { kind: "task-output", entryId: parent.nodes[1].id, path: "profile.name" };
    parent.operationStructure.definition = redigest(parent.operationStructure.definition);
    const validParent = projectExplorerDefinition(parent);
    assert.equal(validParent.state, "ready");
    if (validParent.state === "ready") assert.equal(validParent.projection.sources.get("destination-node:task:crm/destination-value:input:direct")?.reads?.[0].field, "profile.name");
    parent.operationStructure.definition.invocations[0].operation.values[0].source.path = "profile.na";
    parent.operationStructure.definition = redigest(parent.operationStructure.definition);
    assert.equal(projectExplorerDefinition(parent).state, "refused");
  });
  it("renders nonempty invocation outcomes and keeps taskless controls without an invented system", () => {
    const workflow = lineageWorkflow();
    assert.ok(workflow.operationStructure.state === "declared");
    workflow.operationStructure.definition = WorkflowOperationDisplaySnapshotSchema.parse({ ...workflow.operationStructure.definition,
      invocations: workflow.operationStructure.definition.invocations.map((invocation, index) => index === 0 ? { ...invocation, outcomes: [{ id: "source-present", label: "Source value is present", when: { kind: "is-present", value: { kind: "task-output", entryId: "source-node", path: "value" } }, continuation: "read-value" }] } : invocation),
    });
    workflow.operationStructure.definition = redigest(workflow.operationStructure.definition);
    const result = projectExplorerDefinition(workflow);
    assert.equal(result.state, "ready");
    if (result.state !== "ready") return;
    assert.equal(result.projection.steps[0].system, undefined);
    const text = result.projection.steps.flatMap(step => partText(step.parts)).join("\n");
    assert.deepEqual(workflow.operationStructure.definition.invocations[0].outcomes, [{ id: "source-present", label: "Source value is present", when: { kind: "is-present", value: { kind: "task-output", entryId: "source-node", path: "value" } }, continuation: "read-value" }]);
    assert.doesNotMatch(text, /source-present|source-node|read-value|Invocation outcome/u);
  });
  it("reports missing transaction probe and verify contracts as unavailable before drawing a partial timeline", () => {
    const transaction = wire.workflows.flatMap(workflow => workflow.nodes).find(node => node.shape.kind === "transaction" && node.tasks.some(task => task.writeSafety?.verifyTaskId))!;
    assert.ok(transaction, "fixture requires a canonical prepare/commit transaction with read safety contracts");
    const safety = transaction.tasks.find(task => task.writeSafety)!.writeSafety!;
    for (const role of ["probe", "verify"] as const) {
      const workflow = lineageWorkflow();
      const node = { ...structuredClone(transaction), dependsOn: [] };
      workflow.nodes = [node];
      workflow.timeline = [{ key: workflow.timeline[0].key, label: "Transaction group", nodes: [node.id] }];
      workflow.definitionPreview = { state: "compiled", groups: [{ key: workflow.timeline[0].key, label: "Transaction group", entries: [{ id: node.id, kind: "transaction", nodeIds: [node.id], dependsOn: [], taskIds: node.tasks.map(task => task.taskId) }] }], systemsFirstUse: [...new Set(node.tasks.flatMap(task => task.binding.state === "bound" && task.binding.driverSystem ? [task.binding.driverSystem] : []))] };
      assert.ok(workflow.operationStructure.state === "declared");
      const invocation = structuredClone(workflow.operationStructure.definition.invocations[0]);
      invocation.entryId = node.id;
      invocation.taskId = role === "probe" ? safety.probeTaskId : safety.verifyTaskId!;
      invocation.contractRole = role;
      invocation.bindings = []; invocation.operation.values = [];
      workflow.operationStructure.definition.invocations = [invocation];
      workflow.operationStructure.definition.presentation = [{ id: "transaction-read", kind: "operation", invocationId: invocation.id, entryId: node.id }];
      workflow.operationStructure.definition.execution = [{ entryId: node.id, dependsOn: [] }];
      workflow.operationStructure.definition = redigest(workflow.operationStructure.definition);
      const result = projectExplorerDefinition(workflow);
      assert.equal(result.state, "unavailable");
      if (result.state === "unavailable") {
        assert.equal(result.reason, "Required transaction safety details are unavailable in this definition preview.");
        assert.equal(result.reason.includes(invocation.taskId), false);
        assert.equal(workflow.operationStructure.definition.invocations[0].contractRole, role);
        assert.equal(workflow.operationStructure.definition.invocations[0].taskId, invocation.taskId);
      }
      assert.equal("projection" in result, false);
    }
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
