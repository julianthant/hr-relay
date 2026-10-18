import { useEffect, useMemo, useState } from "react";
import type { ExplorerWorkflowWire, ExplorerNodeWire, ExplorerTaskWire, SourceLinkWire } from "../../models/dashboard/explorer.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import type { BrowserSystemId } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { OperationActionKind } from "../../models/workflow/operation-display.js";
import { requireWorkflowOperationDisplaySnapshot, WorkflowOperationDisplaySnapshotError, type WorkflowOperationDisplaySnapshot } from "../../models/workflow/operation-display-snapshot.js";
import type { ExplorerQueries } from "../client/queries/explorer-queries.js";
import type { FieldSource, FlowPart, FlowStep } from "../surfaces/explorer/explorer-flow-model.js";
import { observeResource } from "./async-resource.js";

export type ExplorerProjection = Readonly<{ steps: readonly FlowStep[]; sources: ReadonlyMap<string, FieldSource> }>;
export type ExplorerWiringState =
  | Readonly<{ state: "idle" | "loading" }>
  | Readonly<{ state: "ready"; projection: ExplorerProjection }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | Readonly<{ state: "refused"; failure: ErrorCatalogFailure; evidence: unknown }>;

const systems: Readonly<Record<BrowserSystemId | "local", NonNullable<FlowStep["system"]>>> = { ucpath: "UCPath", crm: "CRM", kuali: "Kuali", "new-kronos": "Kronos", "old-kronos": "Kronos", i9: "I-9", onbase: "OnBase", servicenow: "ServiceNow", sharepoint: "SharePoint", local: "Local" };
const actionIcons: Readonly<Record<OperationActionKind, Extract<FlowPart, { kind: "action" }>["icon"]>> = {
  "open-page": "click", "resume-page": "rejoin", click: "click", keypress: "key", "read-field": "read", "fill-field": "key", "select-field": "key", "check-field": "key", compute: "compute", verify: "verify", branch: "compute", join: "rejoin", "operator-gate": "verify", delegate: "compute", "session-lifecycle": "click",
};
function taskSystem(task: ExplorerTaskWire): FlowStep["system"] {
  if (task.binding.state === "pending") return undefined;
  if (task.binding.driverSystem) return systems[task.binding.driverSystem];
  return task.binding.storeKind === "headless" ? "Local" : undefined;
}
class ExplorerDefinitionDivergenceError extends Error { override name = "ExplorerDefinitionDivergenceError"; }
function mismatch(fact: string): never { throw new ExplorerDefinitionDivergenceError(`explorer-definition-divergence: ${fact}`); }
const equal = (actual: unknown, expected: unknown, fact: string) => {
  if (canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) mismatch(fact);
};
const sourceText = (source: SourceLinkWire): string => source.state === "resolved" ? source.path : `${source.attemptedPath} · Unresolved: ${source.reason}`;

function structuralParts(node: ExplorerNodeWire): FlowPart[] {
  switch (node.shape.kind) {
    case "parallel": return [{ kind: "note", text: "These activities can run alongside one another before the workflow continues." }];
    case "branch": return [{ kind: "note", text: "The workflow follows the applicable alternative. No alternative is selected in this definition preview." }];
    case "gate": return [{ kind: "note", text: node.shape.resolvedBy === "operator" ? "Wait for operator review before continuing." : node.shape.resolvedBy === "children-terminal" ? "Wait for the linked activities to finish." : "Wait for the external decision before continuing." }];
    case "transaction": return [{ kind: "note", text: "Prepare and verify the change using its declared safety checks." }];
    case "child-run": return [{ kind: "note", text: node.shape.await === "terminal" ? "Run the linked workflow and wait for its result." : "Start the linked workflow and continue without waiting for its result." }];
    case "task": return [];
  }
}

function declaredActions(items: readonly WorkflowOperationDisplaySnapshot["invocations"][number]["operation"]["actions"][number][]): FlowPart[] {
  const labels: Readonly<Record<OperationActionKind, string>> = {
    "open-page": "Open the page", "resume-page": "Return to the page", click: "Select the control", keypress: "Use the keyboard",
    "read-field": "Read the field", "fill-field": "Fill the field", "select-field": "Select a value", "check-field": "Check the value",
    compute: "Calculate the result", verify: "Verify the result", branch: "Follow the applicable path", join: "Continue after the preceding activities",
    "operator-gate": "Wait for operator review", delegate: "Run the linked workflow", "session-lifecycle": "Use the system session",
  };
  return items.flatMap(action => [
    { kind: "action" as const, text: action.label ?? labels[action.kind], icon: actionIcons[action.kind] },
    ...declaredActions(action.children ?? []),
  ]);
}

export function projectExplorerDefinition(workflow: ExplorerWorkflowWire): ExplorerWiringState {
  const pending = workflow.nodes.flatMap(node => node.tasks).find(task => task.binding.state === "pending");
  if (pending) return { state: "refused", failure: createErrorCatalogFailure("EXPLORER_TASK_BINDING_UNAVAILABLE", {}), evidence: { taskId: pending.taskId, binding: pending.binding } };
  if (workflow.definitionPreview.state === "unavailable") return { state: "unavailable", reason: workflow.definitionPreview.reason };
  try {
    const preview = workflow.definitionPreview;
    const nodes = new Map(workflow.nodes.map(node => [String(node.id), node]));
    equal(preview.groups.map(group => ({ key: group.key, label: group.label, ...(group.description === undefined ? {} : { description: group.description }), ...(group.system === undefined ? {} : { system: group.system }), ...(group.operatorFields === undefined ? {} : { operatorFields: group.operatorFields }), nodes: group.entries.flatMap(entry => entry.nodeIds) })), workflow.timeline, "ordered groups");
    const declaredNodes = preview.groups.flatMap(group => group.entries.flatMap(entry => entry.nodeIds));
    if (new Set(declaredNodes).size !== nodes.size || declaredNodes.length !== nodes.size) mismatch("node coverage");
    const usedSystems: string[] = [];
    for (const group of preview.groups) for (const entry of group.entries) {
      const node = nodes.get(entry.id);
      if (!node) mismatch(`entry ${entry.id}`);
      equal(entry.kind === "delegate" ? "child-run" : entry.kind, node.shape.kind, `kind ${entry.id}`);
      equal(entry.dependsOn, node.dependsOn, `dependencies ${entry.id}`);
      const nodeIds = node.shape.kind === "parallel" ? [node.id, ...node.shape.branches.flatMap(branch => branch.nodes)] : [node.id];
      equal(entry.nodeIds, nodeIds, `nodes ${entry.id}`);
      const tasks = entry.nodeIds.flatMap(id => {
        const declared = nodes.get(id);
        if (!declared) mismatch(`node ${id}`);
        return declared.tasks;
      });
      equal(entry.taskIds, tasks.map(task => task.taskId), `tasks ${entry.id}`);
      for (const task of tasks) if (task.binding.state === "bound" && task.binding.driverSystem && !usedSystems.includes(task.binding.driverSystem)) usedSystems.push(task.binding.driverSystem);
    }
    equal(preview.systemsFirstUse, usedSystems, "systems first use");
    const definition = workflow.operationStructure.state === "declared" ? requireWorkflowOperationDisplaySnapshot(workflow.operationStructure.definition, { workflowId: workflow.id, definitionFingerprint: workflow.contractFingerprint }) : undefined;
    if (definition) {
      const invocationIds: string[] = [];
      const presentation = (items: readonly typeof definition.presentation[number][]): void => {
        for (const item of items) {
          if (item.kind === "operation") {
            const invocation = definition.invocations.find(invocation => invocation.id === item.invocationId);
            if (!invocation || item.entryId !== undefined && item.entryId !== invocation.entryId) mismatch(`presentation ${item.id}`);
            invocationIds.push(invocation.id);
          } else if (item.entryId !== undefined && !nodes.has(item.entryId)) mismatch(`presentation entry ${item.id}`);
          if (item.children) presentation(item.children);
        }
      };
      presentation(definition.presentation);
      equal(invocationIds, definition.invocations.map(invocation => invocation.id), "ordered operation presentation");
      equal(definition.execution, workflow.nodes.map(node => ({ entryId: node.id, dependsOn: node.dependsOn })), "operation execution");
      for (const invocation of definition.invocations) {
        const node = nodes.get(invocation.entryId);
        const task = node?.tasks.find(task => task.taskId === invocation.taskId);
        if (!task) {
          const safety = node?.tasks.flatMap(task => task.writeSafety ? [task.writeSafety] : []) ?? [];
          const unavailableRead = node?.shape.kind === "transaction" && safety.some(safety => invocation.contractRole === "probe" && safety.probeTaskId === invocation.taskId || invocation.contractRole === "verify" && safety.verifyTaskId === invocation.taskId);
          if (unavailableRead) return { state: "unavailable", reason: "Required transaction safety details are unavailable in this definition preview." };
          mismatch(`invocation ${invocation.id}`);
        }
        equal(invocation.contractRole, task.arm, `contract role ${invocation.id}`);
        for (const slot of invocation.operation.values) {
          const side = slot.source.kind === "contract-output" ? "output" : "input";
          if (!task.fields.some(field => field.side === side && (field.path === slot.source.path || field.path.startsWith(`${slot.source.path}.`)))) mismatch(`contract ${side} slot ${invocation.id}:${slot.id}:${slot.source.path}`);
        }
        if (task.binding.state === "bound") {
          const system = task.binding.driverSystem ?? (task.binding.storeKind === "headless" ? "local" : undefined);
          if (system !== undefined && invocation.operation.system !== system) mismatch(`operation system ${invocation.id}`);
        }
      }
    }
    const sources = new Map<string, FieldSource>();
    const steps: FlowStep[] = [];
    const stepsByGroup = new Map<string, FlowStep[]>();
    const anchors = new Map<string, { step: number; fieldId: string; system: string; page: string }[]>();
    for (const group of preview.groups) for (const entry of group.entries) for (const nodeId of entry.nodeIds) {
      const node = nodes.get(nodeId);
      if (!node) mismatch(`node ${nodeId}`);
      const taskGroups: { system: FlowStep["system"]; tasks: ExplorerTaskWire[] }[] = [];
      for (const task of node.tasks) {
        const system = taskSystem(task);
        if (!system) mismatch(`task system ${task.taskId}`);
        const previous = taskGroups.at(-1);
        if (previous?.system === system) previous.tasks.push(task);
        else taskGroups.push({ system, tasks: [task] });
      }
      if (!taskGroups.length) taskGroups.push({ system: undefined, tasks: [] });
      for (const { system, tasks } of taskGroups) {
        const number = steps.length + 1;
        const parts: FlowPart[] = [{ kind: "note", text: `${group.label} · ${node.purpose.state === "authored" ? node.purpose.text : "Definition preview. No run values are available."}` }, ...structuralParts(node)];
        if (definition) for (const invocation of definition.invocations.filter(invocation => invocation.entryId === nodeId)) {
          parts.push(...declaredActions(invocation.operation.actions));
        }
        for (const task of tasks) {
          const systemText = system ?? mismatch(`task system ${task.taskId}`);
          for (const field of task.fields) {
            const id = `${node.id}:${task.arm}:${task.taskId}:${field.side}:${field.path}`;
            const anchorKey = `${node.id}:${field.side}:${field.path}`;
            anchors.set(anchorKey, [...(anchors.get(anchorKey) ?? []), { step: number, fieldId: id, system: systemText, page: task.title }]);
            sources.set(id, { origin: sourceText(task.contractSource), detail: `Contract ${task.taskId} · ${field.side}.${field.path}. Implementation: ${sourceText(task.implSource)}. System: ${systemText}. No run value is available.` });
          }
          parts.push({ kind: "note", text: `${task.title} · ${systemText}.` });
        }
        parts.push({ kind: "note", text: "Definition preview. No run values are available." });
        const step = { number, title: node.label, ...(system ? { system } : {}), parts };
        steps.push(step);
        stepsByGroup.set(group.key, [...(stepsByGroup.get(group.key) ?? []), step]);
      }
    }
    if (definition) for (const invocation of definition.invocations) for (const slot of invocation.operation.values) {
      if (slot.source.kind !== "contract-input") continue;
      const destinations = anchors.get(`${invocation.entryId}:input:${slot.source.path}`) ?? [];
      if (destinations.length !== 1) mismatch(`destination anchor ${invocation.id}:${slot.id}`);
      const binding = invocation.bindings.find(binding => binding.slot === slot.id);
      if (!binding) mismatch(`source binding ${invocation.id}:${slot.id}`);
      const reads: NonNullable<FieldSource["reads"]>[number][] = [];
      const chain: NonNullable<FieldSource["chain"]>[number][] = [];
      const details: string[] = [];
      const visit = (reference: typeof binding.value, visited: readonly string[]): void => {
        if (reference.kind === "task-output") {
          const matches = anchors.get(`${reference.entryId}:output:${reference.path}`) ?? [];
          if (matches.length !== 1) { details.push(`Unresolved source anchor: ${reference.entryId}.${reference.path}`); return; }
          reads.push({ ...matches[0], field: reference.path });
        } else if (reference.kind === "transformation") {
          const transform = definition.transforms.find(transform => transform.id === reference.transformId);
          if (!transform || visited.includes(reference.transformId)) mismatch(`transformation ${reference.transformId}`);
          chain.push({ step: destinations[0].step, title: transform.id, detail: `Declared transformation · ${reference.path}. No computed value is available.` });
          for (const input of transform.inputs) visit(input.value, [...visited, transform.id]);
        } else details.push(reference.kind === "run-input" ? `Run input · ${reference.path}` : reference.kind === "configuration" ? `Configuration · ${reference.key}` : reference.kind === "child-output" ? `Unresolved child-output anchor: ${reference.entryId}.${reference.path}` : `Static constant digest · ${reference.valueDigest}`);
      };
      visit(binding.value, []);
      const source = sources.get(destinations[0].fieldId);
      if (!source) mismatch(`destination source ${invocation.id}:${slot.id}`);
      sources.set(destinations[0].fieldId, { ...source, detail: `${source.detail}${details.length ? ` ${details.join("; ")}.` : ""}`, ...(reads.length ? { reads } : {}), ...(chain.length ? { chain } : {}) });
    }
    const operatorSteps: FlowStep[] = [];
    for (const group of preview.groups) {
      if (group.operatorFields === undefined) {
        for (const step of stepsByGroup.get(group.key) ?? []) operatorSteps.push({ ...step, number: operatorSteps.length + 1 });
        continue;
      }
      const number = operatorSteps.length + 1;
      const fields = group.operatorFields.flatMap((field, index) => {
        if (field.example === undefined) return [];
        const id = `operator:${group.key}:${index}`;
        sources.set(id, { origin: "Workflow definition", detail: "Fictional example for this definition preview; no run value is shown." });
        return [{ id, label: field.label, value: field.example, mode: "read" as const, source: id }];
      });
      operatorSteps.push({ number, title: group.label, ...(group.system === undefined ? {} : { system: systems[group.system] }),
        parts: [{ kind: "note", text: group.description ?? group.label },
          { kind: "note", text: "Definition preview with fictional examples. No run values are shown." },
          ...(fields.length === 0 ? [] : [{ kind: "rows" as const, fields }]),
          ...(group.operatorFields.some(field => field.example === undefined) ? [{ kind: "note" as const, text: "Some example values are not declared." }] : []),
        ] });
    }
    return { state: "ready", projection: { steps: operatorSteps, sources } };
  } catch (evidence) {
    if (!(evidence instanceof ExplorerDefinitionDivergenceError || evidence instanceof WorkflowOperationDisplaySnapshotError)) throw evidence;
    return { state: "refused", failure: createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" }), evidence };
  }
}

export function useExplorerWiring(client: Pick<ExplorerQueries, "workflowExplorer"> | undefined, workflowId: string | undefined, version?: number): ExplorerWiringState {
  const request = useMemo(() => ({ client, workflowId, version }), [client, workflowId, version]);
  const [result, setResult] = useState<Readonly<{ request: typeof request; value: ExplorerWiringState }>>();
  useEffect(() => {
    if (workflowId === undefined || client === undefined) return;
    return observeResource(() => client.workflowExplorer(), wire => {
      const workflow = wire.workflows.find(workflow => workflow.id === workflowId);
      let value: ExplorerWiringState;
      if (!workflow) value = { state: "unavailable", reason: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_WORKFLOW_UNAVAILABLE", {})).text };
      else if (version !== undefined && workflow.version !== version) value = { state: "refused", failure: createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" }), evidence: "explorer-catalog-version-mismatch" };
      else value = projectExplorerDefinition(workflow);
      setResult({ request, value });
    }, evidence => setResult({ request, value: { state: "refused", failure: createErrorCatalogFailure("DASHBOARD_READ_FAILED", {}), evidence } }));
  }, [client, workflowId, version, request]);
  if (workflowId === undefined) return { state: "idle" };
  if (client === undefined) return { state: "unavailable", reason: "Registered workflow data is unavailable because the dashboard client is not connected." };
  return result?.request === request ? result.value : { state: "loading" };
}
