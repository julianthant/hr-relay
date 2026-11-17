// Values a run was started with in place of a step's reading: each typed step's group, its marks, and the steps that read them.
import type { JsonValue } from "../../../../rules/validation/canonical-json.js";
import type { RunRecord } from "../../../../models/run/record.js";
import type { StepOmissionEntry, StepOmissionField } from "../../../../models/workflow/step-omission.js";
import {
  usesTypedLine,
  type TimelineTypedValuesWire,
  type TimelineUsesTypedWire,
  type TypedValueMark,
} from "../../../../models/dashboard/run-detail.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../../workflow-kit/workflow.js";
import { ProjectionDegradedError } from "../../commands/refusals.js";

export interface TypedStepView {
  readonly typedValues?: TimelineTypedValuesWire;
  readonly usesTyped?: TimelineUsesTypedWire;
}

type TypedEntry = StepOmissionEntry & Readonly<{ workflow?: undefined }>;

function ownTypedEntries(run: RunRecord): readonly TypedEntry[] {
  return (run.envelope.stepOmissions ?? []).filter((entry): entry is TypedEntry => entry.workflow === undefined);
}

function currentFields(descriptor: AnyWorkflowDescriptor, step: string): readonly StepOmissionField[] {
  return descriptor.stepOmissions.find((spec) => spec.step === step)?.form.fields ?? [];
}

/** Stored keys in the current form's order, then any key the form no longer declares. */
function orderedKeys(entry: TypedEntry, fields: readonly StepOmissionField[]): readonly string[] {
  const declared = fields.map((field) => field.key).filter((key) => Object.hasOwn(entry.facts, key));
  const rest = Object.keys(entry.facts).filter((key) => !declared.includes(key)).sort();
  return [...declared, ...rest];
}

/** The label the field was shown with when typed; a run from before stored labels reads the workflow's current one. */
function labelOf(entry: TypedEntry, fields: readonly StepOmissionField[], key: string): string {
  const label = entry.labels?.[key] ?? fields.find((field) => field.key === key)?.label;
  if (label === undefined) {
    throw new ProjectionDegradedError(
      `typed value "${key}" of step "${entry.step}" has no stored label and the workflow no longer declares that field`,
    );
  }
  return label;
}

function displayTypedValue(entry: TypedEntry, key: string, value: JsonValue | undefined): string {
  if (value === null) return "(empty)";
  if (typeof value === "string") return value.length === 0 ? "(empty)" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.length === 0 ? "(empty)" : value.join(", ");
  }
  throw new ProjectionDegradedError(
    `typed value "${key}" of step "${entry.step}" is not a typed scalar or text list; it is not served`,
  );
}

function copiedKeys(run: RunRecord, step: string): ReadonlySet<string> {
  return new Set((run.envelope.sourceBound?.source.copiedFrom ?? [])
    .filter((coordinate) => coordinate.targetStepKey === step)
    .map((coordinate) => String(coordinate.targetFieldPath)));
}

function markOf(copied: ReadonlySet<string>, key: string): TypedValueMark {
  return copied.has(key) ? "From the earlier run" : "Typed by hand";
}

/** Each timeline step's typed group and "uses" line, keyed by step; empty for a run with nothing typed. */
export function projectTypedSteps(run: RunRecord, descriptor: AnyWorkflowDescriptor | undefined): ReadonlyMap<string, TypedStepView> {
  const entries = ownTypedEntries(run);
  const views = new Map<string, { typedValues?: TimelineTypedValuesWire; usesTyped?: TimelineUsesTypedWire }>();
  if (entries.length === 0) return views;
  if (descriptor === undefined) {
    throw new ProjectionDegradedError(`run ${run.envelope.runId} was started with typed values, but workflow "${run.envelope.workflow}" has no descriptor to read them against`);
  }
  for (const entry of entries) {
    const fields = currentFields(descriptor, entry.step);
    const copied = copiedKeys(run, entry.step);
    views.set(entry.step, {
      typedValues: {
        title: "Operator-entered values",
        reading: "Not run, typed by hand",
        fields: orderedKeys(entry, fields).map((key) => ({
          key,
          label: labelOf(entry, fields, key),
          value: displayTypedValue(entry, key, entry.facts[key]),
          mark: markOf(copied, key),
        })),
      },
    });
  }

  const nodes = new Map(descriptorRuntimeNodes(descriptor).map((node) => [String(node.id), node]));
  for (const category of descriptor.timeline) {
    const reads = new Set(category.nodes.flatMap((member) => (nodes.get(String(member.id))?.dependsOn ?? []).map(String)));
    const labels: string[] = [];
    for (const entry of entries) {
      if (entry.step === category.key) continue;
      const spec = descriptor.stepOmissions.find((candidate) => candidate.step === entry.step);
      if (spec === undefined || !Object.keys(spec.produces).some((nodeId) => reads.has(nodeId))) continue;
      for (const field of spec.form.fields) {
        if (!Object.hasOwn(entry.facts, field.key)) continue;
        if (field.replaces !== undefined && !reads.has(field.replaces.nodeId)) continue;
        const label = labelOf(entry, spec.form.fields, field.key);
        if (!labels.includes(label)) labels.push(label);
      }
    }
    if (labels.length === 0) continue;
    views.set(category.key, { ...views.get(category.key), usesTyped: { line: usesTypedLine(labels), labels } });
  }
  return views;
}

/** The mark of one produced leaf of an asserted checkpoint: copied when the field that replaces it was copied unedited. */
export function typedMarkOf(run: RunRecord, descriptor: AnyWorkflowDescriptor, step: string, nodeId: string, fieldPath: string): TypedValueMark {
  const field = currentFields(descriptor, step).find((candidate) =>
    candidate.replaces?.nodeId === nodeId && candidate.replaces.path === fieldPath);
  return field === undefined ? "Typed by hand" : markOf(copiedKeys(run, step), field.key);
}
