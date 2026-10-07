import type { z } from "zod";
import { ExplorerNodeWireSchema, ExplorerWorkflowWireSchema, WorkflowExplorerWireSchema, type ExplorerNodeWire, type ExplorerWorkflowWire } from "../../../src/models/dashboard/explorer.js";
import { parseNodeCondition } from "../../../src/models/workflow/node-condition.js";
import { FIXTURE_EXPLORER_WIRE } from "./dashboard/fixture-explorer.js";

const template = FIXTURE_EXPLORER_WIRE.workflows.find((workflow) => String(workflow.id) === "person-lookup");
const task = template?.nodes[0];
if (template === undefined || task === undefined) throw new Error("real Explorer fixture lacks its task template");
const taskTemplate: ExplorerNodeWire = task;
const workflowTemplate: ExplorerWorkflowWire = template;

type Shape = z.input<typeof ExplorerNodeWireSchema>["shape"];
type Definition = Readonly<{ id: string; label: string; dependsOn?: readonly string[]; shape?: Shape }>;

function makeNode(definition: Definition): ExplorerNodeWire {
  return ExplorerNodeWireSchema.parse({
    ...taskTemplate,
    id: definition.id,
    label: definition.label,
    purpose: { state: "authored", text: `Synthetic path preview node ${definition.label}.` },
    dependsOn: definition.dependsOn ?? [],
    shape: definition.shape ?? taskTemplate.shape,
    details: [],
    editableFields: [],
    coveragePoints: [],
  });
}

function edgesFor(nodes: readonly ExplorerNodeWire[]): ExplorerWorkflowWire["edges"] {
  return nodes.flatMap((node) => [
    ...node.dependsOn.map((from) => ({ from, to: node.id, kind: "depends-on" as const })),
    ...(node.shape.kind === "branch"
      ? node.shape.cases.flatMap((branchCase) => branchCase.nodes.map((to) => ({
        from: node.id, to, kind: "branch-case" as const, label: branchCase.name,
      })))
      : []),
  ]);
}

function workflow(id: string, label: string, definitions: readonly Definition[]): ExplorerWorkflowWire {
  const nodes = definitions.map(makeNode);
  return ExplorerWorkflowWireSchema.parse({
    ...workflowTemplate,
    id,
    label,
    role: { kind: "standalone" },
    nodes,
    timeline: nodes.map((node, index) => ({ key: `step-${index + 1}`, label: node.label, nodes: [node.id] })),
    edges: edgesFor(nodes),
    scenarios: [],
    sources: {
      descriptor: { state: "unresolved", attemptedPath: "tests/support/fixtures/explorer-timeline-wire.ts", reason: "Synthetic timeline fixture." },
      module: { state: "unresolved", attemptedPath: "tests/support/fixtures/explorer-timeline-wire.ts", reason: "Synthetic timeline fixture." },
      closureFileCount: 1,
    },
  });
}

const childId = "timeline-child";
const parent = workflow("timeline-parent", "Branching timeline fixture", [
  { id: "start", label: "Start" },
  { id: "route", label: "Select route", shape: { kind: "branch", cases: [
    { name: "Route A", nodes: ["call-a"] }, { name: "Route B", nodes: ["call-b"] },
  ] } },
  { id: "call-a", label: "Call child A", shape: { kind: "child-run", edgeId: "child-edge-a", targetWorkflowId: childId, cardinality: "one", await: "terminal", join: "one", onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } },
  { id: "after-a", label: "After A", dependsOn: ["call-a"] },
  { id: "call-b", label: "Call child B", shape: { kind: "child-run", edgeId: "child-edge-b", targetWorkflowId: childId, cardinality: "one", await: "none", join: "all-settled", onChildFailed: "allow-partial", cascadeCancel: "independent", afterChildRetry: "manual-parent-resume", visibility: "linked" } },
  { id: "after-b", label: "After B", dependsOn: ["call-b"] },
  { id: "shared-continuation", label: "Shared continuation", dependsOn: ["after-a", "after-b"] },
  { id: "independent-route", label: "Independent route", shape: { kind: "branch", cases: [
    { name: "Include", nodes: ["call-c"] }, { name: "Skip", nodes: ["independent-skip"] },
  ] } },
  { id: "call-c", label: "Call child collection", shape: { kind: "child-run", edgeId: "child-edge-c", targetWorkflowId: childId, cardinality: "many", await: "terminal", join: "all", onChildFailed: "block-parent", cascadeCancel: "cascade", afterChildRetry: "manual-parent-resume", visibility: "hidden-unless-failed" } },
  { id: "call-d", label: "Call child without join", shape: { kind: "child-run", edgeId: "child-edge-d", targetWorkflowId: childId, cardinality: "one", await: "none", join: "none", onChildFailed: "allow-partial", cascadeCancel: "independent", afterChildRetry: "manual-parent-resume", visibility: "linked" } },
  { id: "independent-skip", label: "Independent skipped step", dependsOn: ["independent-route"] },
  { id: "terminal-route", label: "Choose terminal path", shape: { kind: "branch", cases: [
    { name: "Continue", nodes: ["late-work"] }, { name: "Stop", nodes: ["stop"] },
  ] } },
  { id: "late-work", label: "Late work", dependsOn: ["terminal-route"] },
  { id: "late-followup", label: "Late follow-up", dependsOn: ["late-work"] },
  { id: "stop", label: "Stop here", dependsOn: ["terminal-route"] },
  { id: "unjoined-continuation", label: "Unjoined continuation", dependsOn: ["terminal-route"] },
  { id: "unknown-call", label: "Unavailable child call", shape: { kind: "child-run", edgeId: "missing-child-edge", targetWorkflowId: "unregistered-child", cardinality: "one", await: "terminal", join: "one", onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } },
]);

const child = workflow(childId, "Nested timeline child", [
  { id: "child-start", label: "Child start" },
  { id: "child-choice", label: "Child outcome", shape: { kind: "branch", cases: [
    { name: "Return", nodes: ["child-return"] }, { name: "Stop", nodes: ["child-stop"] },
  ] } },
  { id: "child-return", label: "Return path", dependsOn: ["child-choice"], shape: { kind: "task", replay: "checkpoint", condition: parseNodeCondition({ kind: "is-true", of: { from: "input", path: "includeOptional" } }) } },
  { id: "child-stop", label: "Child stop", dependsOn: ["child-choice"] },
]);

export const EXPLORER_TIMELINE_WIRE = WorkflowExplorerWireSchema.parse({
  ...FIXTURE_EXPLORER_WIRE,
  workflows: [...FIXTURE_EXPLORER_WIRE.workflows, parent, child],
});

export const EXPLORER_TIMELINE_BROWSER_WIRE = WorkflowExplorerWireSchema.parse({
  ...EXPLORER_TIMELINE_WIRE,
  workflows: [parent, child],
});

export const EXPLORER_TIMELINE_PARENT_ID = "timeline-parent";
export const EXPLORER_TIMELINE_CHILD_ID = childId;

const nestedTargetId = "timeline-nested-target";
const leafTargetId = "timeline-leaf-target";
const callShape = (edgeId: string, targetWorkflowId: string): Shape => ({
  kind: "child-run", edgeId, targetWorkflowId: targetWorkflowId,
  cardinality: "one", await: "terminal", join: "one", onChildFailed: "fail-parent",
  cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline",
});
const leafTarget = workflow(leafTargetId, "Identity evidence child", [
  { id: "evidence-choice", label: "Evidence route", shape: { kind: "branch", cases: [
    { name: "Check", nodes: ["evidence-check"] }, { name: "Skip", nodes: ["evidence-skip"] },
  ] } },
  { id: "evidence-check", label: "Check evidence", dependsOn: ["evidence-choice"] },
  { id: "evidence-skip", label: "Skip evidence", dependsOn: ["evidence-choice"] },
]);
const nestedTarget = workflow(nestedTargetId, "Identity resolver child", [
  { id: "nested-start", label: "Prepare identity" },
  { id: "nested-call", label: "Nested evidence call", dependsOn: ["nested-start"], shape: callShape("nested-evidence-edge", leafTargetId) },
]);
const multiTargetParent = workflow("timeline-multi-target", "Multiple registered targets", [
  { id: "resolver-call", label: "Resolve identity call", shape: callShape("resolver-edge", nestedTargetId) },
  { id: "direct-call", label: "Direct evidence call", shape: callShape("direct-evidence-edge", leafTargetId) },
]);

export const EXPLORER_MULTI_TARGET_WIRE = WorkflowExplorerWireSchema.parse({
  ...FIXTURE_EXPLORER_WIRE,
  workflows: [multiTargetParent, nestedTarget, leafTarget],
});
