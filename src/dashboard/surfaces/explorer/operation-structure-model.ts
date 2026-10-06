import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { DeclaredActionIdentitySchema } from "../../../domain/task-provenance.js";
import { displayConditionMatches, type DisplayTemplateValue } from './operation-template-model.js';
import type { WorkflowOperationDisplaySnapshot } from "../../../domain/workflow/operation-display-snapshot.js";
import type { OperationActionObservationWire } from "../../../domain/dashboard/operation-structure.js";
import type { ActionValueProducer, DeclaredActionIdentity } from "../../../domain/task-provenance.js";

export type OperationInvocation = WorkflowOperationDisplaySnapshot["invocations"][number];
export type OperationAction = OperationInvocation["operation"]["actions"][number];
export type OperationPresentation = WorkflowOperationDisplaySnapshot["presentation"][number];
export type OperationValue = NonNullable<OperationActionObservationWire["occurrence"]["value"]>;
export type DefinitionValueReference = OperationInvocation["bindings"][number]["value"];
export type DefinitionSource = Readonly<{ label: string; invocationId?: string; actionId?: string; reference: DefinitionValueReference }>;

export function definitionActionAddress(invocationId: string, actionId: string): string {
  return `definition-${encodeURIComponent(JSON.stringify([invocationId, actionId]))}`;
}

export function definitionMutedActions(invocation: OperationInvocation, selected: Readonly<Record<string, string>>): ReadonlySet<string> {
  const actions = flattenActions(invocation.operation.actions);
  const muted = new Set<string>();
  for (const [index, action] of actions.entries()) {
    if (muted.has(action.id)) continue;
    const selection = selected[definitionActionAddress(invocation.id, action.id)];
    if (selection === undefined || selection === "") continue;
    if (selection === "unknown") {
      for (const downstream of actions.slice(index + flattenActions([action]).length)) muted.add(downstream.id);
      continue;
    }
    const outcome = action.outcomes?.find((item) => item.id === selection);
    if (outcome === undefined) throw new Error("operation-definition-unknown-outcome");
    for (const candidate of action.outcomes ?? []) {
      if (candidate.continuation === undefined || candidate.continuation === outcome.continuation) continue;
      const target = actions.find((item) => item.id === candidate.continuation);
      if (target === undefined) throw new Error("operation-definition-unknown-continuation");
      for (const descendant of flattenActions([target])) muted.add(descendant.id);
    }
  }
  return muted;
}

export function definitionValueSources(definition: WorkflowOperationDisplaySnapshot, invocation: OperationInvocation, slot: string): readonly DefinitionSource[] {
  const binding = invocation.bindings.find((item) => item.slot === slot);
  if (binding === undefined) return [];
  const visit = (reference: DefinitionValueReference, seen: ReadonlySet<string>): readonly DefinitionSource[] => {
    if (reference.kind === "transformation") {
      if (seen.has(reference.transformId)) throw new Error("operation-definition-source-cycle");
      const transform = definition.transforms.find((item) => item.id === reference.transformId);
      if (transform === undefined) throw new Error("operation-definition-source-transform-missing");
      return [{ label: `Transform ${reference.transformId} · ${reference.path}`, reference }, ...transform.inputs.flatMap((input) => visit(input.value, new Set([...seen, reference.transformId])))];
    }
    if (reference.kind === "task-output") {
      const producers = definition.invocations.filter((item) => item.entryId === reference.entryId).flatMap((producer) => flattenActions(producer.operation.actions).filter((action) => producer.operation.values.some((value) => value.id === action.valueSlot && value.source.kind === "contract-output" && value.source.path === reference.path)).map((action) => ({ label: `${producer.label ?? producer.operation.id} · ${action.label ?? reference.path}`, reference, invocationId: producer.id, actionId: action.id })));
      return producers.length === 0 ? [{ label: `Step ${reference.entryId} · ${reference.path}`, reference }] : producers;
    }
    return [{ label: reference.kind === "run-input" ? `Run input · ${reference.path}` : reference.kind === "configuration" ? `Configuration · ${reference.key}` : reference.kind === "constant" ? "Declared constant · value withheld" : `Child ${reference.entryId} · ${reference.path}`, reference }];
  };
  return visit(binding.value, new Set());
}

export function operationFieldTemplate(invocation: OperationInvocation, action: OperationAction) {
  if (action.templateId === undefined) return undefined;
  const template = invocation.operation.templates.find((item) => item.id === action.templateId);
  if (template === undefined) throw new Error("operation-render-template-missing");
  return template;
}

export function flattenPresentation(nodes: readonly OperationPresentation[]): readonly OperationPresentation[] {
  return nodes.flatMap((node) => [node, ...flattenPresentation(node.children ?? [])]);
}

export function presentationAddress(id: string): string { return `presentation-${encodeURIComponent(id)}`; }

export function definitionMutedPresentation(definition: WorkflowOperationDisplaySnapshot, selected: Readonly<Record<string, string>>): ReadonlySet<string> {
  const nodes = flattenPresentation(definition.presentation);
  const muted = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (muted.has(node.id)) continue;
    const invocation = node.kind === "operation" ? definition.invocations.find((item) => item.id === node.invocationId) : undefined;
    const choice = selected[presentationAddress(node.id)];
    const actionUnknown = invocation !== undefined && flattenActions(invocation.operation.actions).some((action) => selected[definitionActionAddress(invocation.id, action.id)] === "unknown");
    if (choice === "unknown" || actionUnknown) {
      for (const downstream of nodes.slice(index + 1)) muted.add(downstream.id);
      continue;
    }
    if (choice === undefined || choice === "") continue;
    const outcomes = node.outcomes ?? invocation?.outcomes;
    const chosen = outcomes?.find((item) => item.id === choice);
    if (chosen === undefined) throw new Error("operation-definition-unknown-presentation-outcome");
    for (const candidate of outcomes ?? []) {
      if (candidate.continuation === undefined || candidate.continuation === chosen.continuation) continue;
      const target = nodes.find((item) => item.id === candidate.continuation);
      if (target === undefined) throw new Error("operation-definition-unknown-presentation-continuation");
      for (const descendant of flattenPresentation([target])) muted.add(descendant.id);
    }
  }
  return muted;
}

export function operationAction(definition: WorkflowOperationDisplaySnapshot, observation: OperationActionObservationWire): Readonly<{ invocation: OperationInvocation; action: OperationAction }> {
  const invocation = definition.invocations.find((item) => item.id === observation.occurrence.invocationId);
  const action = invocation === undefined ? undefined : flattenActions(invocation.operation.actions).find((item) => item.id === observation.occurrence.logicalActionId);
  if (invocation === undefined || action === undefined) throw new Error("operation-render-unknown-frozen-action");
  return { invocation, action };
}

export function flattenActions(actions: readonly OperationAction[]): readonly OperationAction[] {
  return actions.flatMap((action) => [action, ...flattenActions(action.children ?? [])]);
}

export function operationValueText(value: OperationValue): string {
  if (value.state === "redacted") return "Protected value · redacted";
  if (value.state === "withheld") return `Value unavailable · ${value.reason}`;
  return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
}

export function operationSourceLabel(producer: ActionValueProducer): string {
  switch (producer.kind) {
    case "run-input": return `Run input · ${producer.path}`;
    case "configuration": return `Configuration · ${producer.key}`;
    case "constant": return "Declared constant";
    case "task-output": return `Step ${producer.entryId} · ${producer.path}`;
    case "child-output": return `Child ${producer.entryId} · ${producer.path}`;
    case "transformation": return `Transform ${producer.transformId} · ${producer.path}`;
  }
}

export function operationSourceIdentities(producer: ActionValueProducer): readonly DeclaredActionIdentity[] {
  switch (producer.kind) {
    case "task-output": return producer.source === undefined ? [] : [producer.source];
    case "child-output": return [...(producer.source === undefined ? [] : [producer.source]), ...(producer.inputs ?? []).flatMap((input) => [...(input.identity === undefined ? [] : [input.identity]), ...(input.identities ?? [])])];
    case "transformation": return (producer.inputs ?? []).flatMap((input) => input.identities);
    default: return [];
  }
}

export function operationAddress(identity: DeclaredActionIdentity): string {
  const { value: _value, ...address } = identity as DeclaredActionIdentity & { value?: unknown };
  return encodeURIComponent(canonicalJsonStringify(DeclaredActionIdentitySchema.parse(address)));
}

export function operationStepLabel(node: OperationPresentation, definition: WorkflowOperationDisplaySnapshot): string {
  if (node.kind === "operation") {
    const invocation = definition.invocations.find((candidate) => candidate.id === node.invocationId);
    if (invocation === undefined) throw new Error("operation-render-unknown-frozen-invocation");
    return invocation.label ?? invocation.operation.id;
  }
  if (node.kind === "delegate") return `Run ${node.targetWorkflowId}`;
  return node.kind.replaceAll("-", " ");
}

export function operationObservationParent(definition: WorkflowOperationDisplaySnapshot, observation: OperationActionObservationWire): OperationAction | undefined {
  const { invocation, action } = operationAction(definition, observation);
  const find = (actions: readonly OperationAction[], parent?: OperationAction): OperationAction | undefined => {
    for (const candidate of actions) {
      if (candidate.id === action.id) return parent;
      const result = find(candidate.children ?? [], candidate.kind === "verify" ? parent : candidate);
      if (result !== undefined) return result;
    }
    return undefined;
  };
  return find(invocation.operation.actions);
}

export function operationObservationKey(definition: WorkflowOperationDisplaySnapshot, observation: OperationActionObservationWire): string {
  const parent = operationObservationParent(definition, observation);
  const identity = observation.occurrence;
  return [identity.invocationId, identity.attempt, identity.claimGeneration, identity.taskAttempt, identity.physicalSessionId, parent?.id ?? identity.invocationId].join(":");
}

export function contiguousOperationRows<T extends { readonly logId: string }>(rows: readonly T[], definition: WorkflowOperationDisplaySnapshot, observations: readonly OperationActionObservationWire[], breaks: ReadonlySet<string>): readonly Readonly<{ rows: readonly T[]; observations: readonly OperationActionObservationWire[] }>[] {
  const byId = new Map<string, OperationActionObservationWire>(observations.map((observation) => [observation.logId, observation]));
  const groups: { rows: T[]; observations: OperationActionObservationWire[]; key?: string }[] = [];
  for (const row of rows) {
    const observation = byId.get(row.logId);
    const key = observation === undefined ? undefined : operationObservationKey(definition, observation);
    const previous = groups.at(-1);
    if (key !== undefined && previous?.key === key && !breaks.has(previous.rows.at(-1)!.logId)) {
      previous.rows.push(row); previous.observations.push(observation!);
    } else groups.push({ rows: [row], observations: observation === undefined ? [] : [observation], ...(key === undefined ? {} : { key }) });
  }
  return groups;
}

export function observedOperationOutcome(action: OperationAction, observations: readonly OperationActionObservationWire[]): Readonly<{ state: "selected"; label: string } | { state: "unavailable"; reason: string }> | undefined {
  if (action.outcomes === undefined || action.outcomes.length === 0) return undefined;
  const values: Record<string, DisplayTemplateValue> = {};
  for (const outcome of action.outcomes) {
    const candidates = observations.filter((item) => item.occurrence.state === "confirmed" && item.occurrence.value?.slot === outcome.when.variable);
    const value = candidates.at(-1)?.occurrence.value;
    if (value?.state !== "observed" || !(typeof value.value === "string" || typeof value.value === 'boolean' || value.value === null)) return { state: "unavailable", reason: "Retained result unavailable" };
    values[outcome.when.variable] = value.value;
  }
  const selected = action.outcomes.filter((outcome) => displayConditionMatches(outcome.when, values));
  if (selected.length !== 1) return { state: "unavailable", reason: selected.length === 0 ? "No declared result matched" : "Declared result is ambiguous" };
  return { state: "selected", label: selected[0].label };
}

export function operationGroupBreakIds(rows: readonly { readonly logId: string }[], indexes: readonly (number | undefined)[]): ReadonlySet<string> {
  return new Set(indexes.flatMap((index) => {
    if (index === undefined || index === -1) return [];
    const row = rows[index];
    if (row === undefined) throw new Error("operation-log-anchor-outside-retained-sequence");
    return [row.logId];
  }));
}
