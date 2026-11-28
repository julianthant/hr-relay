import { descriptorRuntimeNodes, workflowDelegatedDescriptor, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { WorkflowStartWire } from "../../../models/dashboard/bootstrap.js";
import { workbookStartChildInput } from "../workbooks.js";
import { JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import {
  delegatedStepOmissions,
  planStepOmissions,
  stepOmissionCascade,
  stepOmissionFactsSchema,
  StepOmissionsSchema,
  type StartRowKind,
  type StartRowLockReason,
  type StartRowMember,
  type StartRowOff,
  type StartRowTarget,
  type StepOmissionForm,
  type StepOmissionGraphView,
  type StepOmissionInput,
  type StepOmissions,
  type StepOmissionSpec,
} from "../../../models/workflow/step-omission.js";

// Project the same declared step choices the start planner validates.
export interface StartStepProjection {
  readonly key: string;
  readonly label: string;
  readonly includedByDefault: boolean;
  readonly control:
    | Readonly<{ state: "selectable"; inputField: string; selectedWhen: boolean }>
    | Readonly<{ state: "omittable"; form: StepOmissionForm; forces: readonly string[]; stop?: string }>
    | Readonly<{ state: "required"; reason: string }>;
}

/** One Start run row: what it shows, the step it switches, its kind and why it is locked. */
export interface StartRowProjection {
  readonly key: string;
  readonly label: string;
  readonly includedByDefault: boolean;
  readonly kind: StartRowKind;
  readonly off?: StartRowOff;
  readonly stop?: string;
  readonly requiresStep?: string;
  readonly startWithValuesAlone?: true;
  readonly lockReason?: StartRowLockReason;
  readonly members: readonly StartRowMember[];
  readonly target?: StartRowTarget;
  readonly manual?: Readonly<{ form: StepOmissionForm; forces: readonly string[] }>;
  readonly selection?: Readonly<{ inputField: string }>;
}

const REQUIRED_REASON = "This workflow requires every node in this step.";

/** `switch` when typing the values replaces every node of the step; `locked-manual` when some of its nodes still run. */
function manualKind(descriptor: AnyWorkflowDescriptor, spec: StepOmissionSpec): "switch" | "locked-manual" {
  if (spec.off !== undefined) return "switch";
  const step = descriptor.timeline.find(({ key }) => key === spec.step);
  if (step === undefined) throw new Error(`${descriptor.id} manual entry names step ${spec.step}, which is not on its timeline`);
  const replaced = new Set([...Object.keys(spec.produces), ...spec.skips ?? []]);
  return step.nodes.every(({ id }) => replaced.has(String(id))) ? "switch" : "locked-manual";
}


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
    const inferredSelection = sameCondition
      && (condition.kind === "is-true" || condition.kind === "is-false")
      && condition.of.from === "input"
      && !String(condition.of.path).includes(".")
      ? { inputField: String(condition.of.path), selectedWhen: condition.kind === "is-true" }
      : undefined;
    const selectable = step.selection ?? inferredSelection;
    if (step.selection !== undefined) {
      const constant = constants.find(constant => constant.field === step.selection?.inputField);
      if (constant?.value.kind !== "boolean") throw new Error(`${descriptor.id} start step ${key} selection has no boolean default`);
      if (inferredSelection !== undefined && JSON.stringify(inferredSelection) !== JSON.stringify(step.selection)) throw new Error(`${descriptor.id} start step ${key} contradicts its input condition`);
    }
    const spec = specByStep.get(key);
    if (spec !== undefined && selectable === undefined && manualKind(descriptor, spec) === "locked-manual") {
      return Object.freeze({
        key, label: step.label, includedByDefault: true,
        control: Object.freeze({ state: "required" as const, reason: REQUIRED_REASON }),
      });
    }
    if (spec !== undefined && selectable === undefined) {
      const row = cascade.get(key);
      if (row === undefined) throw new Error(`${descriptor.id} start step ${key} declares an omission with no cascade row`);
      const forces = Object.freeze(timelineOrder.filter((other) => row.forces.includes(other)));
      return Object.freeze(row.state === "omittable"
        ? {
          key, label: step.label, includedByDefault: true,
          control: Object.freeze({ state: "omittable" as const, form: spec.form, forces, ...(spec.stop === undefined ? {} : { stop: spec.stop }) }),
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
  submission?: JsonValue,
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
  const specByStep = new Map(descriptor.stepOmissions.map((spec) => [spec.step, spec]));
  const selected = new Set(selectedStepKeys);
  const submitted = new Map<string, Record<string, unknown>>();
  const children = new Map<string, Readonly<{ workflow: string; step: string; facts: Record<string, unknown> }>>();
  for (const entry of stepOmissions ?? []) {
    if (entry.workflow !== undefined) {
      const { workflow } = entry;
      if (!descriptor.startRows.some(({ target }) => target?.workflow === workflow && target.step === entry.step)) {
        throw new StartStepOmissionRefusedError("unknown-step", `${descriptor.id} has no start row for ${workflow}/${entry.step}`);
      }
      const key = JSON.stringify([workflow, entry.step]);
      if (children.has(key)) {
        throw new StartStepOmissionRefusedError("duplicate-step", `${descriptor.id} start step ${workflow}/${entry.step} is omitted twice`);
      }
      children.set(key, { workflow, step: entry.step, facts: entry.facts });
      continue;
    }
    const step = byKey.get(entry.step);
    if (step === undefined) {
      throw new StartStepOmissionRefusedError("unknown-step", `${descriptor.id} has no start step ${entry.step}`);
    }
    const spec = specByStep.get(entry.step);
    if (spec === undefined || step.control.state === "required" && manualKind(descriptor, spec) === "switch") {
      throw new StartStepOmissionRefusedError(
        "step-not-omittable",
        `${descriptor.id} start step ${entry.step} declares no omission; it must run`,
      );
    }
    if (selected.has(entry.step) && manualKind(descriptor, spec) === "switch") {
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
  const resolved: (ReturnType<typeof checkedEntry> & { workflow?: string })[] = [];
  for (const step of steps) {
    const spec = specByStep.get(step.key);
    if (spec === undefined) continue;
    const facts = submitted.get(step.key);
    if (facts === undefined) {
      // Off with nothing typed: a selection step is skipped by its input; a pure switch has no other way not to run.
      if (step.control.state === "omittable" && !selected.has(step.key)) {
        throw new StartStepOmissionRefusedError(
          "facts-missing",
          `${descriptor.id} start step ${step.key} is omitted and carries no typed facts`,
        );
      }
      continue;
    }
    resolved.push(checkedEntry(descriptor, step.key, spec, facts, submission));
  }
  if (resolved.length > 0) refuseCascade(descriptor, resolved);
  const byChild = new Map<string, ReturnType<typeof checkedEntry>[]>();
  // A child entry is checked in the child's descriptor; the parent plans nothing for it.
  for (const row of descriptor.startRows) {
    const workflow = row.target?.workflow;
    if (workflow === undefined || row.target === undefined) continue;
    const entry = children.get(JSON.stringify([workflow, row.target.step]));
    if (entry === undefined) continue;
    const required = delegatedStopStep(descriptor, workflow);
    if (required !== undefined && !selected.has(required)) {
      throw new StartStepOmissionRefusedError("cascade-refused", `${descriptor.id} step "${required}" is off, so ${workflow}/${entry.step} will not run.`);
    }
    const child = workflowDelegatedDescriptor(descriptor, workflow);
    const spec = child.stepOmissions.find(({ step }) => step === entry.step);
    if (spec === undefined) throw new Error(`${descriptor.id} start row ${row.key} targets ${workflow}/${entry.step}, which declares no manual entry`);
    const checked = checkedEntry(child, entry.step, spec, entry.facts);
    const entries = byChild.get(workflow) ?? [];
    entries.push(checked);
    byChild.set(workflow, entries);
    resolved.push({ workflow, ...checked });
  }
  for (const [workflow, entries] of byChild) refuseCascade(workflowDelegatedDescriptor(descriptor, workflow), entries);
  if (resolved.length === 0) return undefined;
  return StepOmissionsSchema.parse(resolved);
}

/** One step's typed facts, checked against its form and refine rule and stamped with each field's label. */
function checkedEntry(descriptor: AnyWorkflowDescriptor, step: string, spec: StepOmissionSpec, facts: Record<string, unknown>,
  submission?: JsonValue, input?: StepOmissionInput) {
  const parsed = stepOmissionFactsSchema(spec.form, input).safeParse(facts);
  // Facts stay private. Only input-dependent validation adds its authored reason.
  const issues = parsed.success
    ? (spec.refine?.(parsed.data, submission) ?? []).map(({ field }) => field)
    : parsed.error.issues.map((issue) => issue.path.map(String).join(".") || "(form)");
  if (issues.length > 0) {
    const reason = input !== undefined && !parsed.success ? parsed.error.issues[0]?.message : undefined;
    throw new StartStepOmissionRefusedError(
      "facts-invalid",
      `${descriptor.id} start step ${step} omission facts are invalid at: ${[...new Set(issues)].join(", ")}${reason === undefined ? "" : ` (${reason})`}`,
      parsed.success ? undefined : { cause: parsed.error },
    );
  }
  return {
    step,
    facts: parsed.data ?? {},
    labels: Object.fromEntries(spec.form.fields.map((field) => [field.key, field.label])),
  };
}

export function assertStartStepOmissionInputs(descriptor: AnyWorkflowDescriptor, omissions: StepOmissions | undefined, canonicalInput: unknown): void {
  for (const workflow of new Set(omissions?.flatMap(entry => entry.workflow === undefined ? [] : [entry.workflow]))) {
    const child = workflowDelegatedDescriptor(descriptor, workflow);
    if (!child.stepOmissions.some(spec => spec.bindInput !== undefined)) continue;
    const bound = bindSingleStartChild(descriptor, workflow, canonicalInput);
    for (const entry of delegatedStepOmissions(omissions, workflow) ?? []) {
      const spec = child.stepOmissions.find(({ step }) => step === entry.step);
      if (spec === undefined) throw new Error(`${child.id} declares no typed values for ${entry.step}`);
      checkedEntry(child, entry.step, spec, entry.facts, bound);
    }
  }
  for (const entry of omissions ?? []) {
    if (entry.workflow !== undefined) continue;
    const spec = descriptor.stepOmissions.find(({ step }) => step === entry.step);
    if (spec?.form.fields.some(field => field.kind === "text" && field.format !== undefined)) {
      checkedEntry(descriptor, entry.step, spec, entry.facts, undefined, { canonicalInput });
    }
  }
}

export function bindSingleStartChild(descriptor: AnyWorkflowDescriptor, workflow: string, canonicalInput: unknown): JsonValue {
  const delegates = descriptorRuntimeNodes(descriptor).filter(node => node.kind === "child-run" && node.target.id === workflow);
  const [node] = delegates;
  if (delegates.length !== 1 || node?.kind !== "child-run") {
    throw new Error(`${descriptor.id} needs one initial delegation to bind typed ${workflow} input`);
  }
  const beforeRosterChoice = workbookStartChildInput(descriptor.canonicalInput, node.target.input, canonicalInput);
  if (beforeRosterChoice !== undefined) return JsonValueSchema.parse(beforeRosterChoice);
  if (node.dependsOn.length !== 0) throw new Error(`${descriptor.id} needs one initial delegation to bind typed ${workflow} input`);
  const input = node.bind({ input: JsonValueSchema.parse(canonicalInput), outputs: {} });
  if (node.cardinality === "one") return JsonValueSchema.parse(input);
  if (!Array.isArray(input) || input.length !== 1) {
    throw new StartStepOmissionRefusedError("single-subject-only", `Start with one document to enter typed ${workflow} values.`);
  }
  return JsonValueSchema.parse(input[0]);
}

function refuseCascade(descriptor: AnyWorkflowDescriptor, entries: StepOmissions | readonly ReturnType<typeof checkedEntry>[]): void {
  const plan = planStepOmissions(stepOmissionGraphView(descriptor), StepOmissionsSchema.parse(entries));
  if (plan.refusals.length > 0) {
    throw new StartStepOmissionRefusedError(
      "cascade-refused",
      `${descriptor.id} refuses this omission: `
      + plan.refusals.map((refusal) => `[${refusal.code}]: ${refusal.message}`).join("; "),
    );
  }
}

/** Apply one explicit, server-validated selection to one raw typed submission; a step whose values are typed counts as selected. */
export function applyStartStepSelection(
  descriptor: AnyWorkflowDescriptor,
  rawInput: JsonValue,
  selectedStepKeys: readonly string[] | undefined,
  stepOmissions?: StepOmissions,
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
  const typed = new Set((stepOmissions ?? []).filter((entry) => entry.workflow === undefined).map(({ step }) => step));
  const customized: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(rawInput)) customized[key] = value;
  for (const step of steps) {
    if (step.control.state !== "selectable") continue;
    customized[step.control.inputField] = selected.has(step.key) || typed.has(step.key)
      ? step.control.selectedWhen
      : !step.control.selectedWhen;
  }
  return applyStepOmissionInputs(descriptor, JsonValueSchema.parse(customized), stepOmissions);
}

export function applyStepOmissionInputs(descriptor: AnyWorkflowDescriptor, input: JsonValue, omissions?: StepOmissions): JsonValue {
  let bound = input;
  for (const spec of descriptor.stepOmissions) {
    const entry = omissions?.find(({ workflow, step }) => workflow === undefined && step === spec.step);
    if (entry === undefined || spec.bindInput === undefined) continue;
    try {
      bound = spec.bindInput(bound, stepOmissionFactsSchema(spec.form).parse(entry.facts));
    } catch {
      throw new StartStepOmissionRefusedError("facts-invalid", `${descriptor.id} start step ${spec.step} cannot bind its typed values to the input`);
    }
  }
  return bound;
}

/** The Start run rows, each with its kind and lock reason, from the declared rows or one per timeline step; a child member or target reads the bound child. */
export function projectStartRows(descriptor: AnyWorkflowDescriptor): readonly StartRowProjection[] {
  const views = new Map<string | undefined, ReturnType<typeof rowView>>();
  const viewOf = (workflow: string | undefined) => {
    const known = views.get(workflow);
    if (known !== undefined) return known;
    const view = rowView(workflow === undefined ? descriptor : workflowDelegatedDescriptor(descriptor, workflow));
    views.set(workflow, view);
    return view;
  };
  const lockReason = (members: readonly StartRowMember[]): StartRowLockReason | undefined => {
    const declared = members.map(({ workflow, step }) => viewOf(workflow).lockOf.get(step)).find((reason) => reason !== undefined);
    if (declared !== undefined) return declared;
    const shown = members.flatMap((member) => {
      const view = viewOf(member.workflow);
      const step = view.descriptor.timeline.find(({ key }) => key === member.step);
      if (step === undefined) throw new Error(`${view.descriptor.id} start row names step ${member.step}, which is not on its timeline`);
      return (member.nodes ?? step.nodes.map(({ id }) => String(id))).map((id) => {
        const node = view.nodes.get(id);
        if (node === undefined) throw new Error(`${view.descriptor.id} start row names missing node ${id}`);
        return { node, view, ownStartOnly: view.specByStep.get(member.step)?.ownStartOnly === true };
      });
    });
    if (shown.some(({ node }) => node.kind === "transaction" || node.kind === "task" && node.dryRun === "stop-before-publish")) return "form-action";
    if (shown.some(({ node, view, ownStartOnly }) => ownStartOnly && node.kind === "task"
      && [...view.nodes.values()].some(other => other.kind === "transaction" && other.dependsOn.includes(node.id)))) return "bound-read";
    if (shown.some(({ node }) => node.kind === "gate")) return "approval";
    return undefined;
  };
  return Object.freeze(descriptor.startRows.map((row): StartRowProjection => {
    const view = row.target === undefined ? undefined : viewOf(row.target.workflow);
    const step = row.target === undefined ? undefined : view?.steps.get(row.target.step);
    const spec = row.target === undefined ? undefined : view?.specByStep.get(row.target.step);
    const requiresStep = row.target?.workflow === undefined ? undefined : delegatedStopStep(descriptor, row.target.workflow);
    const kind: StartRowKind = step === undefined || view === undefined ? "locked"
      : step.control.state === "selectable" || step.control.state === "omittable" ? "switch"
        : spec !== undefined && manualKind(view.descriptor, spec) === "locked-manual" ? "locked-manual" : "locked";
    const reason = kind === "switch" ? undefined : lockReason(row.members);
    const forces = step?.control.state === "omittable" ? step.control.forces : Object.freeze([]);
    const target = row.target;
    if (target?.workflow !== undefined && (step?.control.state === "selectable" || kind === "locked" || forces.some(forced =>
      !descriptor.startRows.some(other => other.target?.workflow === target.workflow && other.target?.step === forced)))) {
      throw new Error(`${descriptor.id} start row ${row.key} targets child step ${target.workflow}/${target.step}, which only its own typed values can switch`);
    }
    return Object.freeze({
      key: row.key,
      label: row.label,
      includedByDefault: step?.includedByDefault ?? true,
      kind,
      ...(kind === "switch" && spec?.off !== undefined ? { off: spec.off } : {}),
      ...(spec?.stop === undefined ? {} : { stop: spec.stop }),
      ...(requiresStep === undefined ? {} : { requiresStep }),
      ...(kind === "switch" && row.target?.workflow === undefined && descriptor.timeline.length === 1 && spec !== undefined
        && (spec.bindInput !== undefined || spec.off === "values" && Object.keys(spec.produces).length > 0)
        ? { startWithValuesAlone: true as const } : {}),
      ...(reason === undefined ? {} : { lockReason: reason }),
      members: row.members,
      ...(row.target === undefined ? {} : { target: row.target }),
      ...(spec === undefined || kind === "locked" ? {} : { manual: Object.freeze({ form: spec.form, forces }) }),
      ...(step?.control.state === "selectable" ? { selection: Object.freeze({ inputField: step.control.inputField }) } : {}),
    });
  }));
}

function delegatedStopStep(descriptor: AnyWorkflowDescriptor, workflow: string): string | undefined {
  const delegates = descriptorRuntimeNodes(descriptor).filter(node => node.kind === "child-run" && node.target.id === workflow);
  const stop = descriptor.stepOmissions.find(spec => spec.stop !== undefined && delegates.length > 0
    && delegates.every(node => spec.skips?.includes(node.id) === true));
  return stop?.step;
}

function rowView(descriptor: AnyWorkflowDescriptor) {
  return {
    descriptor,
    steps: new Map(projectStartSteps(descriptor).map((step) => [step.key, step])),
    specByStep: new Map(descriptor.stepOmissions.map((spec) => [spec.step, spec])),
    nodes: new Map(descriptorRuntimeNodes(descriptor).map((node) => [String(node.id), node])),
    lockOf: new Map(descriptor.stepLocks.map(({ step, reason }) => [step, reason])),
  };
}

export function startStepWireControl(
  control: StartStepProjection["control"],
): WorkflowStartWire["steps"][number]["control"] {
  switch (control.state) {
    case "selectable": return { state: "selectable", inputField: control.inputField };
    case "omittable": return { state: "omittable", form: control.form, forces: [...control.forces], ...(control.stop === undefined ? {} : { stop: control.stop }) };
    case "required": return { state: "required", reason: control.reason };
  }
}

export function startRowWire(row: StartRowProjection): NonNullable<WorkflowStartWire["rows"]>[number] {
  return {
    key: row.key, label: row.label, includedByDefault: row.includedByDefault, kind: row.kind,
    ...(row.off === undefined ? {} : { off: row.off }),
    ...(row.stop === undefined ? {} : { stop: row.stop }),
    ...(row.requiresStep === undefined ? {} : { requiresStep: row.requiresStep }),
    ...(row.startWithValuesAlone === undefined ? {} : { startWithValuesAlone: row.startWithValuesAlone }),
    ...(row.lockReason === undefined ? {} : { lockReason: row.lockReason }),
    members: row.members.map((member) => ({ ...member, ...(member.nodes === undefined ? {} : { nodes: [...member.nodes] }) })),
    ...(row.target === undefined ? {} : { target: { ...row.target } }),
    ...(row.manual === undefined ? {} : { manual: { form: row.manual.form, forces: [...row.manual.forces] } }),
    ...(row.selection === undefined ? {} : { selection: { ...row.selection } }),
  };
}
