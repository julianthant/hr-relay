import type { ExplorerNodeWire, ExplorerTaskWire, ExplorerWorkflowWire, SourceLinkWire } from "../../../models/dashboard/explorer.js";
import { describeNodeCondition } from "../../../models/workflow/node-condition.js";
import type { FieldSource, FlowField, FlowPart, FlowStep } from "./explorer-flow-model.js";

export interface RegisteredExplorerPreview {
  readonly title: string;
  readonly summary: string;
  readonly completion: string;
  readonly steps: readonly FlowStep[];
  readonly sources: ReadonlyMap<string, FieldSource>;
  readonly path?: Readonly<{ step: number; control: string }>;
  readonly choices: readonly Readonly<{ id: string; label: string; options: readonly (readonly [string, string])[] }>[];
}

function sourceDescription(source: SourceLinkWire): string {
  return source.state === "resolved" ? `Verified fingerprinted source: ${source.path}`
    : `Source unavailable: ${source.attemptedPath}. ${source.reason}`;
}

function taskSystem(task: ExplorerTaskWire): string | undefined {
  return task.binding.state === "bound" && task.binding.driverSystem !== undefined
    ? String(task.binding.driverSystem) : undefined;
}

function taskDestination(task: ExplorerTaskWire): string {
  if (task.binding.state === "pending") return "Implementation pending";
  if (task.binding.storeKind === "headless") return "Headless task";
  return taskSystem(task) ?? "System unavailable";
}

function fieldRows(node: ExplorerNodeWire, task: ExplorerTaskWire, step: number, sources: Map<string, FieldSource>): FlowPart | undefined {
  const fields: FlowField[] = task.fields.map((field) => {
    const id = `${node.id}:${task.arm}:${field.side}:${field.path}`;
    const recorded = field.recorded.state === "observed"
      ? `${field.recorded.source} · value available only from a selected run`
      : `${field.recorded.state}: ${"reason" in field.recorded ? field.recorded.reason : "definition only"}`;
    sources.set(`${step}:${id}`, {
      origin: `${task.title} · ${field.side} ${field.path}`,
      detail: `${sourceDescription(task.contractSource)}. ${recorded}`,
    });
    return { id, label: `${field.side === "input" ? "Input" : "Output"} · ${field.path}`,
      value: field.presence === "sometimes" ? "Declared · optional; no run value" : "Declared · no run value",
      mode: "read" as const, source: id, destination: `${taskDestination(task)} · ${task.title}` };
  });
  return fields.length === 0 ? undefined : { kind: "rows", fields };
}

type SourceAnchor = Readonly<{ step: number; fieldId: string; system: string; page: string }>;

function declaredActions(
  workflow: ExplorerWorkflowWire,
  node: ExplorerNodeWire,
  step: number,
  sources: Map<string, FieldSource>,
  anchors: ReadonlyMap<string, readonly SourceAnchor[]>,
): FlowPart[] {
  if (workflow.operationStructure.state === "legacy") {
    return [{ kind: "note", text: `Action details unavailable: ${workflow.operationStructure.reason}` }];
  }
  const invocations = workflow.operationStructure.definition.invocations.filter((entry) => entry.entryId === node.id);
  if (invocations.length === 0) return [];
  const describe = (actions: readonly (typeof invocations[number]["operation"]["actions"][number])[]): FlowPart[] => actions.flatMap((action) => [
    { kind: "action" as const,
      icon: action.kind === "click" ? "click" as const : action.kind === "verify" ? "verify" as const
        : action.kind === "join" ? "rejoin" as const : action.kind === "compute" ? "compute" as const : "read" as const,
      text: action.label ?? `${action.kind} · ${action.id}` },
    ...describe(action.children ?? []),
  ]);
  return invocations.flatMap((invocation) => {
    const values: FlowField[] = invocation.operation.values.map((value) => {
      const id = `${node.id}:${invocation.id}:value:${value.id}`;
      const binding = invocation.bindings.find((candidate) => candidate.slot === value.id)?.value;
      const source = binding === undefined
        ? `${value.source.kind} ${value.source.path}; no workflow value binding is declared`
        : binding.kind === "run-input" ? `Run input ${binding.path}; no run is selected`
          : binding.kind === "configuration" ? `Configuration ${binding.key}; value withheld`
            : binding.kind === "constant" ? `Static constant digest ${binding.valueDigest}; value withheld`
              : binding.kind === "transformation" ? `Declared transform ${binding.transformId} output ${binding.path}; no run is selected`
                : `${binding.kind} ${binding.entryId}.${binding.path}; no run is selected`;
      const candidates = binding?.kind === "task-output" || binding?.kind === "child-output"
        ? anchors.get(`${binding.entryId}:${binding.path}`) ?? [] : [];
      sources.set(`${step}:${id}`, {
        origin: `Declared value ${value.id}`,
        detail: candidates.length > 1 ? `${source}. Multiple source fields match; no jump is available.`
          : candidates.length === 0 && (binding?.kind === "task-output" || binding?.kind === "child-output")
            ? `${source}. No exact displayed source field exists.` : source,
        ...(candidates.length === 1 ? { reads: [{ system: candidates[0].system, page: candidates[0].page,
          field: binding?.kind === "task-output" || binding?.kind === "child-output" ? binding.path : String(value.id),
          step: candidates[0].step, fieldId: candidates[0].fieldId }] } : {}),
      });
      return { id, label: `Value · ${value.id}`, value: "Declared · no run value", mode: "read" as const,
        source: id, destination: `${invocation.operation.system} · ${invocation.operation.id}` };
    });
    return [
      { kind: "note" as const, text: `Declared operation ${invocation.operation.id} · ${invocation.operation.system}` },
      ...(values.length === 0 ? [] : [{ kind: "rows" as const, fields: values }]),
      ...describe(invocation.operation.actions),
    ];
  });
}

/** Pure adapter over the validated server projection; choices change only this hypothetical view. */
export function registeredExplorerPreview(
  workflow: ExplorerWorkflowWire,
  selected: Readonly<Record<string, string>> = {},
): RegisteredExplorerPreview {
  if (workflow.definitionPreview.state !== "compiled") {
    throw new Error(`workflow ${workflow.id} has no compiled definition preview: ${workflow.definitionPreview.reason}`);
  }
  const nodes = new Map(workflow.nodes.map((node) => [String(node.id), node]));
  const sources = new Map<string, FieldSource>();
  const anchors = new Map<string, SourceAnchor[]>();
  const choices: { id: string; label: string; options: readonly (readonly [string, string])[] }[] = [];
  const steps: FlowStep[] = [];
  if (workflow.definitionPreview.systemsFirstUse.length > 0) {
    steps.push({ number: 1, title: "Declared systems", parts: [
      { kind: "note", text: "Systems appear in first-use declaration order. This definition preview opens no session." },
      { kind: "sessions", systems: workflow.definitionPreview.systemsFirstUse },
    ] });
  }
  const firstGroupStep = steps.length + 1;
  for (const [index, group] of workflow.definitionPreview.groups.entries()) {
    const step = firstGroupStep + index;
    for (const entry of group.entries) for (const id of entry.nodeIds) {
      const node = nodes.get(String(id));
      if (node === undefined) throw new Error(`workflow ${workflow.id} preview references missing node ${id}`);
      for (const task of node.tasks) for (const field of task.fields.filter((one) => one.side === "output")) {
        const key = `${node.id}:${field.path}`;
        const list = anchors.get(key) ?? [];
        list.push({ step, fieldId: `${node.id}:${task.arm}:output:${field.path}`,
          system: taskDestination(task), page: node.label });
        anchors.set(key, list);
      }
    }
  }
  let path: RegisteredExplorerPreview["path"];
  for (const group of workflow.definitionPreview.groups) {
    const number = steps.length + 1;
    const parts: FlowPart[] = [];
    if (number === firstGroupStep) parts.push({ kind: "note", text: `Definition source: ${sourceDescription(workflow.sources.descriptor)}` });
    for (const entry of group.entries) {
      for (const id of entry.nodeIds) {
        const node = nodes.get(String(id));
        if (node === undefined) throw new Error(`workflow ${workflow.id} preview references missing node ${id}`);
        const nested: FlowPart[] = [];
        nested.push({ kind: "note", text: node.purpose.state === "authored" ? node.purpose.text : `Purpose unavailable: ${node.purpose.reason}` });
        if (node.dependsOn.length > 0) nested.push({ kind: "note", text: `Execution depends on: ${node.dependsOn.join(", ")}` });
        if (node.shape.kind === "task" && node.shape.condition !== undefined) {
          const choiceId = `${node.id}-condition`;
          const options = [["include", "Condition satisfied"], ["omit", "Condition not satisfied"]] as const;
          if (selected[choiceId] !== undefined && !options.some(([value]) => value === selected[choiceId])) {
            throw new Error(`workflow ${workflow.id} has unknown hypothetical condition choice ${selected[choiceId]}`);
          }
          choices.push({ id: choiceId, label: node.label, options });
          nested.push({ kind: "note", text: `Declared condition: ${describeNodeCondition(node.shape.condition)}` });
          nested.push({ kind: "mock-choice", id: choiceId, label: "Hypothetical condition", value: selected[choiceId] ?? "include", options });
          if (path === undefined) path = { step: number, control: `preview-${choiceId}` };
        }
        if (node.shape.kind === "branch") {
          const choiceId = `${node.id}-case`;
          const options = node.shape.cases.map((one) => [one.name, one.name] as const);
          if (selected[choiceId] !== undefined && !options.some(([value]) => value === selected[choiceId])) {
            throw new Error(`workflow ${workflow.id} has unknown hypothetical branch choice ${selected[choiceId]}`);
          }
          choices.push({ id: choiceId, label: node.label, options });
          nested.push({ kind: "mock-choice", id: choiceId, label: "Hypothetical branch", value: selected[choiceId] ?? options[0][0], options });
          const picked = node.shape.cases.find((one) => one.name === (selected[choiceId] ?? options[0][0]));
          nested.push({ kind: "note", text: `Declared case ${picked?.name}: ${picked?.nodes.join(", ") ?? "unavailable"}` });
          if (path === undefined) path = { step: number, control: `preview-${choiceId}` };
        }
        if (node.shape.kind === "parallel") {
          nested.push({ kind: "action", icon: "rejoin", text: `Parallel join: ${node.shape.join}` });
          for (const branch of node.shape.branches) nested.push({ kind: "note", text: `${branch.id}: ${branch.nodes.join(", ")}` });
        }
        if (node.shape.kind === "gate") nested.push({ kind: "note", text: `Gate resolved by ${node.shape.resolvedBy}` });
        if (node.shape.kind === "child-run") nested.push({ kind: "note", text: `Delegates to ${node.shape.targetWorkflowId} · ${node.shape.await}` });
        for (const task of node.tasks) {
          const rows = fieldRows(node, task, number, sources);
          nested.push({ kind: "note", text: `${task.title} · ${task.effect} · ${taskDestination(task)}. ${sourceDescription(task.implSource)}` });
          if (rows !== undefined) nested.push(rows);
        }
        nested.push(...declaredActions(workflow, node, number, sources, anchors));
        parts.push({ kind: "detail", id: String(node.id), title: node.label, parts: nested });
      }
    }
    steps.push({ number, title: group.label, parts });
  }
  if (workflow.scenarios.length > 0) {
    const final = steps.at(-1);
    if (final === undefined) throw new Error(`workflow ${workflow.id} preview has no declared step`);
    steps[steps.length - 1] = { ...final, parts: [...final.parts, {
      kind: "detail", id: "declared-scenario-sources", title: "Declared scenario sources",
      parts: workflow.scenarios.map((scenario) => ({ kind: "note" as const,
        text: scenario.source.state === "resolved"
          ? `${scenario.scenarioId}: listed source ${scenario.source.path}. This preview does not execute it.`
          : `${scenario.scenarioId}: source unavailable at ${scenario.source.attemptedPath}. ${scenario.source.reason}` })),
    }] };
  }
  const summary = workflow.summary.state === "authored" ? workflow.summary.text : workflow.summary.reason;
  return { title: workflow.label, summary, completion: "Definition preview complete. No workflow was run.",
    steps, sources, ...(path === undefined ? {} : { path }), choices };
}
