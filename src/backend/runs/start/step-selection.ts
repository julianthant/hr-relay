import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { WorkflowStartWire } from "../../../models/dashboard/bootstrap.js";
import { JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import {
  planStepOmissions,
  stepOmissionCascade,
  stepOmissionFactsSchema,
  StepOmissionsSchema,
  type StepOmissionForm,
  type StepOmissionGraphView,
  type StepOmissions,
} from "../../../models/workflow/step-omission.js";

// Project the same declared step choices the start planner validates.
export interface StartStepProjection {
  readonly key: string;
  readonly label: string;
  readonly includedByDefault: boolean;
  readonly control:
    | Readonly<{ state: "selectable"; inputField: string; selectedWhen: boolean }>
    | Readonly<{ state: "omittable"; form: StepOmissionForm; forces: readonly string[] }>
    | Readonly<{ state: "required"; reason: string }>;
}

const REQUIRED_REASON = "This workflow requires every node in this step.";


export function stepOmissionGraphView(descriptor: AnyWorkflowDescriptor): StepOmissionGraphView {
  return {
    nodes: descriptorRuntimeNodes(descriptor).map((node) => ({
      id: String(node.id),
      kind: node.kind,
      dependsOn: node.dependsOn.map(String),
    })),
    timeline: descriptor.timeline,
    stepOmissions: descriptor.stepOmissions,
  };
}


export class StartStepOmissionRefusedError extends Error {
  readonly code:
    | "selection-required"
    | "unknown-step"
    | "step-not-omittable"
    | "step-not-omitted"
    | "duplicate-step"
    | "facts-missing"
    | "facts-invalid"
    | "cascade-refused"

    | "single-subject-only"

    | "selection-invalid";

  constructor(code: StartStepOmissionRefusedError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StartStepOmissionRefusedError";
    this.code = code;
  }
}


export function projectStartSteps(descriptor: AnyWorkflowDescriptor): readonly StartStepProjection[] {
  const nodes = new Map(descriptorRuntimeNodes(descriptor).map((node) => [String(node.id), node]));
  const constants = descriptor.surfaces.inputRun?.parser.constants ?? [];
  const specByStep = new Map(descriptor.stepOmissions.map((spec) => [spec.step, spec]));
  const cascade = stepOmissionCascade(stepOmissionGraphView(descriptor));
  const timelineOrder = descriptor.timeline.map((step) => String(step.key));
  const labelOf = (key: string): string => {
    const step = descriptor.timeline.find((entry) => String(entry.key) === key);
    if (step === undefined) {
      throw new Error(`${descriptor.id} omission cascade names step ${key}, which is not on its timeline`);
    }
    return step.label;
  };
  return Object.freeze(descriptor.timeline.map((step): StartStepProjection => {
    const key = String(step.key);
    const members = step.nodes.map(({ id }) => {
      const node = nodes.get(String(id));
      if (node === undefined) throw new Error(`${descriptor.id} start step ${key} names missing node ${String(id)}`);
      return node;
    });
    const first = members[0];
    const condition = first?.kind === "task" ? first.when : undefined;
    const sameCondition = condition !== undefined
      && members.every((node) => node.kind === "task" && JSON.stringify(node.when) === JSON.stringify(condition));
    const selectable = sameCondition
      && (condition.kind === "is-true" || condition.kind === "is-false")
      && condition.of.from === "input"
      && !String(condition.of.path).includes(".")
      ? { inputField: String(condition.of.path), selectedWhen: condition.kind === "is-true" }
      : undefined;
    const spec = specByStep.get(key);
    if (spec !== undefined) {
      // A conditional omission and an operator assertion cannot both own the same step.
      if (selectable !== undefined) {
        throw new Error(
          `${descriptor.id} start step ${key} declares both an input condition and a step omission; `
          + "a step has exactly one way not to run",
        );
      }
      const row = cascade.get(key);
      if (row === undefined) throw new Error(`${descriptor.id} start step ${key} declares an omission with no cascade row`);
      const forces = Object.freeze(timelineOrder.filter((other) => row.forces.includes(other)));
      return Object.freeze(row.state === "omittable"
        ? {
          key, label: step.label, includedByDefault: true,
          control: Object.freeze({ state: "omittable" as const, form: spec.form, forces }),
        }
        : {
          key, label: step.label, includedByDefault: true,
          control: Object.freeze({
            state: "required" as const,
            reason: row.by === key
              ? "A gate in this step reads what omitting it would leave unread, so this step must run."
              : `Omitting this step would also require omitting "${labelOf(row.by)}", which must run.`,
          }),
        });
    }
    if (selectable !== undefined) {
      const declared = constants.find((entry) => String(entry.field) === selectable.inputField)?.value;
      if (declared?.kind === "boolean") {
        return Object.freeze({
          key, label: step.label,
          includedByDefault: declared.value === selectable.selectedWhen,
          control: Object.freeze({ state: "selectable" as const, ...selectable }),
        });
      }
    }
    return Object.freeze({
      key, label: step.label, includedByDefault: true,
      control: Object.freeze({ state: "required" as const, reason: REQUIRED_REASON }),
    });
  }));
}


export function resolveStartStepOmissions(
  descriptor: AnyWorkflowDescriptor,
  selectedStepKeys: readonly string[] | undefined,
  stepOmissions: StepOmissions | undefined,
): StepOmissions | undefined {
  if (selectedStepKeys === undefined) {
    if (stepOmissions !== undefined) {
      throw new StartStepOmissionRefusedError(
        "selection-required",
        `${descriptor.id} step omissions require an explicit step selection; none was submitted`,
      );
    }
    return undefined;
  }
  const steps = projectStartSteps(descriptor);
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const selected = new Set(selectedStepKeys);
  const submitted = new Map<string, Record<string, unknown>>();
  for (const entry of stepOmissions ?? []) {
    const step = byKey.get(entry.step);
    if (step === undefined) {
      throw new StartStepOmissionRefusedError(
        "unknown-step",
        `${descriptor.id} has no start step ${entry.step}`,
      );
    }
    if (step.control.state !== "omittable") {
      throw new StartStepOmissionRefusedError(
        "step-not-omittable",
        `${descriptor.id} start step ${entry.step} declares no omission; it must run`,
      );
    }
    if (selected.has(entry.step)) {
      throw new StartStepOmissionRefusedError(
        "step-not-omitted",
        `${descriptor.id} start step ${entry.step} is selected to run; it carries no omission facts`,
      );
    }
    if (submitted.has(entry.step)) {
      throw new StartStepOmissionRefusedError(
        "duplicate-step",
        `${descriptor.id} start step ${entry.step} is omitted twice`,
      );
    }
    submitted.set(entry.step, entry.facts);
  }
  const resolved: { step: string; facts: Record<string, unknown> }[] = [];
  for (const step of steps) {
    if (step.control.state !== "omittable" || selected.has(step.key)) continue;
    const facts = submitted.get(step.key);
    if (facts === undefined) {
      throw new StartStepOmissionRefusedError(
        "facts-missing",
        `${descriptor.id} start step ${step.key} is omitted and carries no typed facts`,
      );
    }
    const parsed = stepOmissionFactsSchema(step.control.form).safeParse(facts);
    if (!parsed.success) {
      // Field KEYS only: the values are the operator's typed HR facts.
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join(".") || "(form)"))];
      throw new StartStepOmissionRefusedError(
        "facts-invalid",
        `${descriptor.id} start step ${step.key} omission facts are invalid at: ${fields.join(", ")}`,
        { cause: parsed.error },
      );
    }
    resolved.push({ step: step.key, facts: parsed.data });
  }
  if (resolved.length === 0) return undefined;
  const canonical = StepOmissionsSchema.parse(resolved);
  const plan = planStepOmissions(stepOmissionGraphView(descriptor), canonical);
  if (plan.refusals.length > 0) {
    throw new StartStepOmissionRefusedError(
      "cascade-refused",
      `${descriptor.id} refuses this omission: `
      + plan.refusals.map((refusal) => `[${refusal.code}]: ${refusal.message}`).join("; "),
    );
  }
  return canonical;
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
  if (selected.size !== selectedStepKeys.length) {
    throw new StartStepOmissionRefusedError("selection-invalid", `${descriptor.id} start step selection repeats a step key`);
  }
  for (const key of selected) {
    if (!known.has(key)) throw new StartStepOmissionRefusedError("selection-invalid", `${descriptor.id} has no start step ${key}`);
  }
  for (const step of steps) {
    if (step.control.state === "required" && !selected.has(step.key)) {
      throw new StartStepOmissionRefusedError("selection-invalid", `${descriptor.id} start step ${step.key} is required and cannot be omitted`);
    }
  }
  if (rawInput === null || Array.isArray(rawInput) || typeof rawInput !== "object") {
    throw new StartStepOmissionRefusedError("selection-invalid", `${descriptor.id} step customization requires an object submission`);
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


export function startStepWireControl(
  control: StartStepProjection["control"],
): WorkflowStartWire["steps"][number]["control"] {
  switch (control.state) {
    case "selectable": return { state: "selectable", inputField: control.inputField };
    case "omittable": return { state: "omittable", form: control.form, forces: [...control.forces] };
    case "required": return { state: "required", reason: control.reason };
  }
}
