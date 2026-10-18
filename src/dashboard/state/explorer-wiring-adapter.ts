import type { WorkflowExplorerWire } from "../../models/dashboard/explorer.js";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ExplorerWorkflowWire, ExplorerNodeWire, ExplorerTaskWire, SourceLinkWire } from "../../models/dashboard/explorer.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import type { BrowserSystemId } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { OperationActionKind } from "../../models/workflow/operation-display.js";
import { describeNodeCondition } from "../../models/workflow/node-condition.js";
import { requireWorkflowOperationDisplaySnapshot, WorkflowOperationDisplaySnapshotError, type WorkflowOperationDisplaySnapshot } from "../../models/workflow/operation-display-snapshot.js";
import type { ExplorerQueries } from "../client/queries/explorer-queries.js";
import type { FieldSource, FlowPart, FlowStep } from "../surfaces/explorer/explorer-flow-model.js";
import { useSettingsRead } from "./settings-read-model.js";

export type ExplorerProjection = Readonly<{ steps: readonly FlowStep[]; sources: ReadonlyMap<string, FieldSource> }>;
export type ExplorerWiringState =
  | Readonly<{ state: "idle" | "loading" }>
  | Readonly<{ state: "ready"; projection: ExplorerProjection }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | Readonly<{ state: "refused"; failure: ErrorCatalogFailure; evidence: unknown; previous?: ExplorerProjection }>;

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

function structuralParts(node: ExplorerNodeWire, nodes: readonly ExplorerNodeWire[]): FlowPart[] {
  const parts: FlowPart[] = [{ kind: "note", text: `Node ${node.id}. Dependencies: ${node.dependsOn.length ? node.dependsOn.join(", ") : "none"}.` }];
  const shape = node.shape;
  if (shape.kind === "task" && shape.condition) parts.push({ kind: "note", text: `Condition: ${describeNodeCondition(shape.condition)}.` });
  if (shape.kind === "parallel") parts.push({ kind: "detail", id: `structure:${node.id}`, title: `Parallel branches · join ${shape.join}`, parts: shape.branches.map(branch => ({ kind: "note", text: `Branch ${branch.id}: ${branch.nodes.join(", ")}. These members run alongside the other branches.` })) });
  if (shape.kind === "branch") parts.push({ kind: "detail", id: `structure:${node.id}`, title: "Declared alternatives", parts: shape.cases.map(branch => ({ kind: "note", text: `Alternative ${branch.name}: ${branch.nodes.length ? branch.nodes.join(", ") : "no members"}. Selection is unavailable without a run.` })) });
  if (shape.kind === "child-run") parts.push({ kind: "note", text: `Delegate ${shape.edgeId} to ${shape.targetWorkflowId}; cardinality ${shape.cardinality}; await ${shape.await}; join ${shape.join}; child failure ${shape.onChildFailed}; cancellation ${shape.cascadeCancel}; child retry ${shape.afterChildRetry}; visibility ${shape.visibility}.` });
  if (shape.kind === "gate") parts.push({ kind: "note", text: `Gate resolved by ${shape.resolvedBy}${shape.statusKey ? ` · ${shape.statusKey}` : ""}. No resolution is inferred.` });
  if (shape.kind === "transaction") parts.push({ kind: "note", text: `Transaction · dry run ${shape.dryRun}; probe ${shape.probePolicy}; probe-to-fence limit ${shape.probeToFenceMaxMs} ms; lease ${shape.leaseScope}; retry before fence ${shape.retryBeforeFence}.` });
  for (const parent of nodes) {
    if (parent.shape.kind === "parallel") for (const branch of parent.shape.branches) if (branch.nodes.includes(node.id)) parts.push({ kind: "note", text: `Member of parallel ${parent.id}, branch ${branch.id}; join ${parent.shape.join}. Declaration numbering does not imply sequential execution.` });
    if (parent.shape.kind === "branch") for (const branch of parent.shape.cases) if (branch.nodes.includes(node.id)) parts.push({ kind: "note", text: `Member of ${parent.id}, alternative ${branch.name}. Other alternatives are not implied to execute.` });
  }
  return parts;
}

function declaredActions(items: readonly WorkflowOperationDisplaySnapshot["invocations"][number]["operation"]["actions"][number][]): FlowPart[] {
  return items.flatMap(action => [
    { kind: "action" as const, text: `${action.id} · ${action.label ?? action.kind} · ${action.kind}${action.target ? ` · target ${action.target}` : ""}${action.transform ? ` · transform ${action.transform}` : ""}${action.page ? ` · page ${action.page.screen}${action.page.form ? ` / ${action.page.form}` : ""}` : ""}${action.valueSlot ? ` · value ${action.valueSlot}` : ""}${action.templateId ? ` · template ${action.templateId}` : ""}${action.continuedFrom ? ` · continues ${action.continuedFrom}` : ""}${action.confirmationActionId ? ` · confirmed by ${action.confirmationActionId}` : ""}`, icon: actionIcons[action.kind] },
    ...(action.outcomes ?? []).map(outcome => ({ kind: "note" as const, text: `Outcome ${outcome.id} · ${outcome.label}: ${canonicalJsonStringify(outcome.when)}${outcome.continuation ? ` · continuation ${outcome.continuation}` : ""}. No outcome is selected.` })),
    ...(action.children ? [{ kind: "detail" as const, id: `action-children:${action.id}`, title: `Declared children of action ${action.id}`, parts: declaredActions(action.children) }] : []),
  ]);
}

function compositionParts(definition: WorkflowOperationDisplaySnapshot, items: readonly WorkflowOperationDisplaySnapshot["presentation"][number][] = definition.presentation): FlowPart[] {
  return items.map(item => {
    if (item.kind === "operation") {
      const invocation = definition.invocations.find(invocation => invocation.id === item.invocationId);
      if (!invocation) mismatch(`presentation ${item.id}`);
      return { kind: "detail", id: `display:${item.id}`, title: `${invocation.label ?? invocation.id} · node ${invocation.entryId} · task ${invocation.taskId}`, parts: [...invocation.outcomes.map(outcome => ({ kind: "note" as const, text: `Invocation outcome ${outcome.id} · ${outcome.label}: ${canonicalJsonStringify(outcome.when)}${outcome.continuation ? ` · continuation ${outcome.continuation}` : ""}. No outcome is selected.` })), ...declaredActions(invocation.operation.actions), ...compositionParts(definition, item.children ?? [])] };
    }
    return { kind: "detail", id: `display:${item.id}`, title: `${item.id} · ${item.kind}`, parts: [
      { kind: "action", icon: actionIcons[item.kind], text: `${item.kind} · ${item.id}${item.entryId ? ` · node ${item.entryId}` : " · workflow scope"}${item.targetWorkflowId ? ` · target ${item.targetWorkflowId}` : ""}${item.transform ? ` · transform ${item.transform}` : ""}` },
      ...(item.outcomes ?? []).map(outcome => ({ kind: "note" as const, text: `Outcome ${outcome.id} · ${outcome.label}: ${canonicalJsonStringify(outcome.when)}${outcome.continuation ? ` · continuation ${outcome.continuation}` : ""}. No outcome is selected.` })),
      ...compositionParts(definition, item.children ?? []),
    ] };
  });
}

export function projectExplorerDefinition(workflow: ExplorerWorkflowWire): ExplorerWiringState {
  const pending = workflow.nodes.flatMap(node => node.tasks).find(task => task.binding.state === "pending");
  if (pending) return { state: "refused", failure: createErrorCatalogFailure("EXPLORER_TASK_BINDING_UNAVAILABLE", {}), evidence: { taskId: pending.taskId, binding: pending.binding } };
  if (workflow.definitionPreview.state === "unavailable") return { state: "unavailable", reason: workflow.definitionPreview.reason };
  try {
    const preview = workflow.definitionPreview;
    const nodes = new Map(workflow.nodes.map(node => [String(node.id), node]));
    equal(preview.groups.map(group => ({ key: group.key, label: group.label, nodes: group.entries.flatMap(entry => entry.nodeIds) })), workflow.timeline, "ordered groups");
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
          if (unavailableRead) return { state: "unavailable", reason: `Transaction ${node.id} requires ${invocation.contractRole} task ${invocation.taskId}, whose contract fields, sources and system metadata are unavailable in the Explorer projection.` };
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
        const parts: FlowPart[] = [{ kind: "note", text: `${group.label} · ${node.purpose.state === "authored" ? node.purpose.text : node.purpose.reason}` }, ...structuralParts(node, workflow.nodes)];
        if (number === 1 && definition) parts.push({ kind: "detail", id: "declared-presentation", title: "Declared operation and control structure", parts: compositionParts(definition) });
        for (const task of tasks) {
          const systemText = system ?? mismatch(`task system ${task.taskId}`);
          const fields = task.fields.map(field => {
            const id = `${node.id}:${task.arm}:${task.taskId}:${field.side}:${field.path}`;
            const anchorKey = `${node.id}:${field.side}:${field.path}`;
            anchors.set(anchorKey, [...(anchors.get(anchorKey) ?? []), { step: number, fieldId: id, system: systemText, page: task.title }]);
            sources.set(id, { origin: sourceText(task.contractSource), detail: `Contract ${task.taskId} · ${field.side}.${field.path}. Implementation: ${sourceText(task.implSource)}. System: ${systemText}. No run value is available.` });
            return { id, label: `${field.side} · ${field.path}`, value: "Unavailable · no run value", mode: field.side === "input" ? "fill" as const : "read" as const, source: id };
          });
          parts.push({ kind: "note", text: `Task ${task.taskId} · system ${systemText}.` });
          parts.push({ kind: "form", id: `${node.id}:${task.arm}:${task.taskId}`, title: task.title, mode: task.effect, parts: [{ kind: "rows", fields }] });
        }
        if (!definition) parts.push({ kind: "note", text: workflow.operationStructure.state === "legacy" ? workflow.operationStructure.reason : "Operation declaration unavailable" });
        steps.push({ number, title: node.label, ...(system ? { system } : {}), parts });
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
    return { state: "ready", projection: { steps, sources } };
  } catch (evidence) {
    if (!(evidence instanceof ExplorerDefinitionDivergenceError || evidence instanceof WorkflowOperationDisplaySnapshotError)) throw evidence;
    return { state: "refused", failure: createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" }), evidence };
  }
}

const unavailableExplorerClient = {};
export function useExplorerWiring(client: Pick<ExplorerQueries, "workflowExplorer"> | undefined, workflowId: string | undefined, version?: number): ExplorerWiringState {
  const resource = useSettingsRead<WorkflowExplorerWire>(client ?? unavailableExplorerClient, `explorer:${workflowId ?? "none"}:${version ?? "current"}`);
  const result = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => {
    if (workflowId === undefined || client === undefined) return;
    void resource.read(() => client.workflowExplorer(), "DASHBOARD_READ_FAILED").catch(() => undefined);
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
