import type { TypedInputSurface } from "../../../models/workflow/ingress.js";
import { typedInputDefaults, typedInputText, typedControlAvailable } from "./run-start-model.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import type { RunStartWorkflow } from "./run-start.js";
import type { RerunSource } from "../../../models/run/rerun.js";

export function defaultRerunSteps(snapshot: RerunValuesSnapshot, workflow: RunStartWorkflow): string[] {
  if (snapshot.source.workflow !== workflow.workflowId) throw new Error(formatErrorCatalogFailure(
    createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" })).text);
  if (snapshot.source.descriptorVersion !== workflow.version
    || snapshot.steps.length !== workflow.steps.length || workflow.steps.some((step) => !snapshot.steps.some((source) => source.key === step.key))) {
    return workflow.steps.map(step => step.key);
  }
  const selected = new Set(workflow.steps.filter((step) => snapshot.source.outcome === "done" || step.control.state === "required"
    || snapshot.steps.find((source) => source.key === step.key)?.state !== "completed").map((step) => step.key));
  // Retain completed prerequisites when omitting them would force unfinished
  // selected work out. The ordinary toggle still permits that explicit cascade.
  for (;;) {
    const before = selected.size;
    for (const step of workflow.steps) if (step.control.state === "omittable"
      && step.control.forces.some((key) => selected.has(key))) selected.add(step.key);
    if (selected.size === before) break;
  }
  return workflow.steps.filter((step) => selected.has(step.key)).map((step) => step.key);
}

export function partialRerunTypedInput(surface: TypedInputSurface, input: Extract<RerunValuesSnapshot["sourceInput"], { state: "partial" }>) {
  const mode = surface.modes.find(mode => input.value[surface.modeField] === mode.value)?.value ?? surface.initialMode;
  const draft = { ...typedInputDefaults(surface, mode) };
  for (const control of surface.controls) {
    const value = input.value[control.field];
    if (typeof value === typeof draft[control.field] && (typeof value === "boolean" || typeof value === "string")) draft[control.field] = value;
  }
  for (const control of surface.controls) if (!typedControlAvailable(surface, draft, control.field)) {
    const defaults = typedInputDefaults(surface, mode);
    if (defaults[control.field] !== undefined) draft[control.field] = defaults[control.field];
  }
  const value = JsonValueSchema.parse({ ...input.value, ...draft });
  return { draft, text: input.identityCopied ? typedInputText(surface, value) : "", input: value };
}

export interface RerunValueDraft { readonly text: string; readonly copied: boolean }
export function initialRerunValueDrafts(snapshot: RerunValuesSnapshot, workflow: RunStartWorkflow): Readonly<Record<number, RerunValueDraft>> {
  if (workflow.inputRun.state !== "present") return {};
  const inputFields = new Set(workflow.inputRun.surface.parser.rules.map(rule => rule.emit));
  return Object.fromEntries(snapshot.values.flatMap((candidate, index) => candidate.state === "available" && candidate.targetStepKey === undefined && inputFields.has(candidate.targetFieldPath)
    ? [[index, { text: candidateText(candidate.value), copied: true }]] : []));
}
export function candidateText(value: JsonValue): string {
  return typeof value === "string" ? value : canonicalJsonStringify(value);
}
export function readCandidateDraft(candidate: RerunValuesSnapshot["values"][number], text: string): JsonValue {
  if (candidate.state !== "available") throw new Error("RERUN_VALUE_UNAVAILABLE");
  if (typeof candidate.value === "string") return text;
  return JsonValueSchema.parse(JSON.parse(text));
}
export function setRerunField(target: Record<string, JsonValue>, path: string, value: JsonValue): void {
  const keys = path.split(".");
  for (const [index, key] of keys.entries()) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("RERUN_VALUE_PATH_INVALID");
    if (index === keys.length - 1) target[key] = structuredClone(value);
    else {
      if (!Object.hasOwn(target, key)) target[key] = {};
      const child = target[key];
      if (child === null || typeof child !== "object" || Array.isArray(child)) throw new Error("RERUN_VALUE_PATH_CONFLICT");
      target = child as Record<string, JsonValue>;
    }
  }
}
/** Only fields the operator copied or edited override the new ingress. */
export function rerunSubmission(snapshot: RerunValuesSnapshot, base: JsonValue,
  drafts: Readonly<Record<number, RerunValueDraft>>): { submission: JsonValue; copiedFrom: NonNullable<RerunSource["copiedFrom"]> } {
  if (base === null || typeof base !== "object" || Array.isArray(base)) throw new Error("RERUN_INPUT_OBJECT_REQUIRED");
  const submission = structuredClone(base) as Record<string, JsonValue>;
  const copiedFrom: NonNullable<RerunSource["copiedFrom"]> = [];
  for (const [index, draft] of Object.entries(drafts)) {
    const candidate = snapshot.values[Number(index)];
    if (candidate?.state !== "available" || candidate.targetStepKey !== undefined) throw new Error("RERUN_VALUE_COORDINATE_INVALID");
    const value = readCandidateDraft(candidate, draft.text);
    setRerunField(submission, candidate.targetFieldPath, value);
    if (draft.copied && canonicalJsonStringify(value) === canonicalJsonStringify(candidate.value)) {
      copiedFrom.push({ nodeId: candidate.nodeId, fieldPath: candidate.fieldPath, targetFieldPath: candidate.targetFieldPath });
    }
  }
  return { submission, copiedFrom };
}

export function rerunTypedSourceInput(surface: TypedInputSurface | undefined, source: RerunValuesSnapshot["sourceInput"]): JsonValue | undefined {
  if (source.state === "unavailable") return undefined;
  if (source.state === "available") return source.value;
  if (surface === undefined || !source.identityCopied) return undefined;
  return partialRerunTypedInput(surface, source).input;
}
