import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../base/workflow.js";
import type { WorkflowStartWire } from "../../../domain/dashboard/bootstrap.js";
import { JsonValueSchema, type JsonValue } from "../../../domain/canonical-json.js";
import {
  planStepOmissions,
  stepOmissionCascade,
  stepOmissionFactsSchema,
  StepOmissionsSchema,
  type StepOmissionForm,
  type StepOmissionGraphView,
  type StepOmissions,
} from "../../../domain/workflow/step-omission.js";

/**
 * One start step, as the Steps screen draws it and the plan service validates
 * it (D285, extended by D307).
 *
 * `control` is the step's ONE way not to run:
 *
 * - `selectable` — the workflow's own boolean input condition already gates
 *   every node of the step, so the choice is written back into the submission
 *   (D285). Nothing else changes.
 * - `omittable` — the step folder declares an omission (D307): the operator may
 *   leave it out and TYPE the facts the rest of the run would have read from
 *   it. `form` is the closed field vocabulary to draw; `forces` names the other
 *   steps this choice would drag out with it, so the screen locks exactly what
 *   the planner would refuse.
 * - `required` — the step runs. Its `reason` says why, including the D307
 *   cascade case where a declared omission is BLOCKED because a step that must
 *   run reads what omitting this one would leave unread.
 */
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

/**
 * The D307 planner's graph projection for one descriptor: the runtime nodes
 * flattened to ids/kinds/dependencies, plus the descriptor's own timeline and
 * omission declarations. The executor builds the same view from the same
 * `descriptorRuntimeNodes`, so the screen, the plan service and the run all
 * classify against ONE graph.
 */
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

/**
 * The refusal kind the start surface answers with when an operator's omission
 * request does not reconcile with the descriptor (D307).
 *
 * The message names STEP KEYS and FIELD KEYS only. A typed fact is operator
 * input about a real person — a pay rate, a date, an employee id — and a
 * refusal that echoes it would put it in a wire body, a log line and a browser
 * console at once. `code` is the protocol; the sentence is for the operator.
 */
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
    /** D307 — typed facts describe ONE subject; a multi-subject plan cannot carry them. */
    | "single-subject-only"
    /** The D285 selection itself is malformed caller input (unknown/repeated key, required step deselected). */
    | "selection-invalid";

  constructor(code: StartStepOmissionRefusedError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StartStepOmissionRefusedError";
    this.code = code;
  }
}

/** Project only step choices the workflow's own boolean input condition can honor, plus D307's declared omissions. */
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
      // Two ways not to run one step is not a richer choice, it is an
      // ambiguity: the condition writes a flag into the submission and the
      // omission types the facts the step would have read, and nothing decides
      // which the operator meant. A descriptor that declares both is miswired.
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

/**
 * Reconcile one start request's typed omissions against the descriptor, BEFORE
 * a plan row exists (D307).
 *
 * Every `omittable` step the operator did not select must arrive with facts
 * that its own form parses; facts for a step that IS selected, for a step that
 * declares no omission, or for a step that is not on the timeline are refusals
 * rather than ignored input. The surviving entries then go through the SAME
 * `planStepOmissions` the executor runs, so a cascade the screen let through
 * refuses here instead of at the worker.
 *
 * Returns the canonical envelope value in timeline order, or `undefined` when
 * nothing is omitted — the envelope field is absent, never an empty list.
 */
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

/**
 * The bootstrap wire's control arm for one projected step.
 *
 * It is one TOTAL mapping rather than a ternary repeated at every producer:
 * the union gained a third arm in D307, and the three call sites that had
 * copied the two-arm ternary would each have silently kept serving
 * `required`'s shape for an `omittable` step.
 */
export function startStepWireControl(
  control: StartStepProjection["control"],
): WorkflowStartWire["steps"][number]["control"] {
  switch (control.state) {
    case "selectable": return { state: "selectable", inputField: control.inputField };
    case "omittable": return { state: "omittable", form: control.form, forces: [...control.forces] };
    case "required": return { state: "required", reason: control.reason };
  }
}
