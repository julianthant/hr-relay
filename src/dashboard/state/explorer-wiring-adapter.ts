import type { FieldSource, FlowPart, FlowStep } from "../../models/workflow/explorer-preview.js";
import type { WorkflowExplorerWire } from "../../models/dashboard/explorer.js";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ExplorerWorkflowWire, ExplorerNodeWire, ExplorerTaskWire, SourceLinkWire } from "../../models/dashboard/explorer.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import type { BrowserSystemId } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { ExplorerQueries } from "../client/queries/explorer-queries.js";
import { useSettingsRead } from "./settings-read-model.js";

export type ExplorerProjection = Readonly<{ steps: readonly FlowStep[]; sources: ReadonlyMap<string, FieldSource>; stopAfter?: number; completion?: string }>;
export type ExplorerWiringState =
  | Readonly<{ state: "idle" | "loading" }>
  | Readonly<{ state: "ready"; projection: ExplorerProjection }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | Readonly<{ state: "refused"; failure: ErrorCatalogFailure; evidence: unknown; previous?: ExplorerProjection }>;

const systems: Readonly<Record<BrowserSystemId | "local", NonNullable<FlowStep["system"]>>> = { ucpath: "UCPath", crm: "CRM", kuali: "Kuali", "new-kronos": "Kronos", "old-kronos": "Kronos", i9: "I-9", onbase: "OnBase", servicenow: "ServiceNow", sharepoint: "SharePoint", local: "Local" };
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
    const sources = new Map<string, FieldSource>();
    const steps: FlowStep[] = [];
    const stepsByGroup = new Map<string, FlowStep[]>();
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
        for (const task of tasks) {
          const systemText = system ?? mismatch(`task system ${task.taskId}`);
          for (const field of task.fields) {
            const id = `${node.id}:${task.arm}:${task.taskId}:${field.side}:${field.path}`;
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
    const operatorSteps: FlowStep[] = [];
    for (const group of preview.groups) {
      if (group.operatorFields === undefined) {
        for (const step of stepsByGroup.get(group.key) ?? []) operatorSteps.push({ ...step, number: operatorSteps.length + 1 });
        continue;
      }
      const number = operatorSteps.length + 1;
      const fields = group.operatorFields.flatMap((field, index) => {
        if (field.visibility === "logs" || field.example === undefined) return [];
        const id = `operator:${group.key}:${index}`;
        sources.set(id, { origin: "Workflow definition", detail: "Fictional example for this definition preview; no run value is shown." });
        return [{ id, label: field.label, value: field.example, mode: "read" as const, source: id }];
      });
      operatorSteps.push({ number, title: group.label, ...(group.system === undefined ? {} : { system: systems[group.system] }),
        parts: [{ kind: "note", text: group.description ?? group.label },
          { kind: "note", text: "Definition preview with fictional examples. No run values are shown." },
          ...(fields.length === 0 ? [] : [{ kind: "rows" as const, fields }]),
          ...(group.operatorFields.some(field => field.visibility !== "logs" && field.example === undefined) ? [{ kind: "note" as const, text: "Some example values are not declared." }] : []),
        ] });
    }
    return { state: "ready", projection: { steps: operatorSteps, sources, completion: "No run values are available." } };
  } catch (evidence) {
    if (!(evidence instanceof ExplorerDefinitionDivergenceError)) throw evidence;
    return { state: "refused", failure: createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" }), evidence };
  }
}

const unavailableExplorerClient = {};
export function useExplorerWiring(client: Pick<ExplorerQueries, "workflowExplorer"> | undefined, workflowId: string | undefined, version?: number): ExplorerWiringState {
  const resource = useSettingsRead<WorkflowExplorerWire>(client ?? unavailableExplorerClient, `explorer:${workflowId ?? "none"}:${version ?? "current"}`);
  const result = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => {
    if (workflowId === undefined || client === undefined) return;
    void resource.read(() => client.workflowExplorer(), "DASHBOARD_READ_FAILED").catch(() => resource.snapshot());
  }, [client, workflowId, version, resource]);
  const projected = useMemo((): ExplorerWiringState => {
    const workflow = result.value?.workflows.find(workflow => workflow.id === workflowId);
    if (result.value === undefined) return { state: "loading" };
    if (!workflow) return { state: "unavailable", reason: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_WORKFLOW_UNAVAILABLE", {})).text };
    if (version !== undefined && workflow.version !== version) return { state: "refused", failure: createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" }), evidence: "explorer-catalog-version-mismatch" };
    return projectExplorerDefinition(workflow);
  }, [result.value, workflowId, version]);
  if (workflowId === undefined) return { state: "idle" };
  if (client === undefined) return { state: "unavailable", reason: "Registered workflow data is unavailable because the dashboard client is not connected." };
  if (result.state === "failed" && result.value === undefined) return { state: "refused", failure: createErrorCatalogFailure("DASHBOARD_READ_FAILED", {}), evidence: result.error };
  return result.state === "failed" && projected.state === "ready"
    ? { state: "refused", failure: createErrorCatalogFailure("DASHBOARD_READ_FAILED", {}), evidence: result.error, previous: projected.projection } : projected;
}
