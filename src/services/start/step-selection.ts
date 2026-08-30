import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../base/workflow.js";
import { JsonValueSchema, type JsonValue } from "../../domain/canonical-json.js";

export interface StartStepProjection {
  readonly key: string;
  readonly label: string;
  readonly includedByDefault: boolean;
  readonly control:
    | Readonly<{ state: "selectable"; inputField: string; selectedWhen: boolean }>
    | Readonly<{ state: "required"; reason: string }>;
}

const REQUIRED_REASON = "This workflow requires every node in this step.";

/** Project only step choices the workflow's own boolean input condition can honor. */
export function projectStartSteps(descriptor: AnyWorkflowDescriptor): readonly StartStepProjection[] {
  const nodes = new Map(descriptorRuntimeNodes(descriptor).map((node) => [String(node.id), node]));
  const constants = descriptor.surfaces.inputRun?.parser.constants ?? [];
  return Object.freeze(descriptor.timeline.map((step): StartStepProjection => {
    const members = step.nodes.map(({ id }) => {
      const node = nodes.get(String(id));
      if (node === undefined) throw new Error(`${descriptor.id} start step ${step.key} names missing node ${String(id)}`);
      return node;
    });
    const first = members[0];
    const condition = first?.kind === "task" ? first.when : undefined;
    const sameCondition = condition !== undefined
      && members.every((node) => node.kind === "task" && JSON.stringify(node.when) === JSON.stringify(condition));
    if (sameCondition
      && (condition.kind === "is-true" || condition.kind === "is-false")
      && condition.of.from === "input"
      && !String(condition.of.path).includes(".")) {
      const inputField = String(condition.of.path);
      const declared = constants.find((entry) => String(entry.field) === inputField)?.value;
      if (declared?.kind === "boolean") {
        const selectedWhen = condition.kind === "is-true";
        return Object.freeze({
          key: String(step.key), label: step.label,
          includedByDefault: declared.value === selectedWhen,
          control: Object.freeze({ state: "selectable", inputField, selectedWhen }),
        });
      }
    }
    return Object.freeze({
      key: String(step.key), label: step.label, includedByDefault: true,
      control: Object.freeze({ state: "required", reason: REQUIRED_REASON }),
    });
  }));
}

/** Apply one explicit, server-validated selection to one raw typed submission. */
export function applyStartStepSelection(
  descriptor: AnyWorkflowDescriptor,
  rawInput: JsonValue,
  selectedStepKeys: readonly string[] | undefined,
): JsonValue {
  if (selectedStepKeys === undefined) return rawInput;
  const steps = projectStartSteps(descriptor);
  const known = new Set(steps.map(({ key }) => key));
  const selected = new Set(selectedStepKeys);
  if (selected.size !== selectedStepKeys.length) throw new Error(`${descriptor.id} start step selection repeats a step key`);
  for (const key of selected) if (!known.has(key)) throw new Error(`${descriptor.id} has no start step ${key}`);
  for (const step of steps) {
    if (step.control.state === "required" && !selected.has(step.key)) {
      throw new Error(`${descriptor.id} start step ${step.key} is required and cannot be omitted`);
    }
  }
  if (rawInput === null || Array.isArray(rawInput) || typeof rawInput !== "object") {
    throw new Error(`${descriptor.id} step customization requires an object submission`);
  }
  const customized: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(rawInput)) customized[key] = value;
  for (const step of steps) {
    if (step.control.state !== "selectable") continue;
    customized[step.control.inputField] = selected.has(step.key)
      ? step.control.selectedWhen
      : !step.control.selectedWhen;
  }
  return JsonValueSchema.parse(customized);
}
