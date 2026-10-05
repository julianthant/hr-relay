import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../domain/canonical-json.js";
import type { RerunValuesSnapshot } from "../../../domain/dashboard/rerun-values.js";
import type { RunStartWorkflow } from "./run-start.js";
import type { RerunSource } from "../../../domain/run/rerun.js";

export function defaultRerunSteps(snapshot: RerunValuesSnapshot, workflow: RunStartWorkflow): string[] {
  if (snapshot.source.workflow !== workflow.workflowId || snapshot.source.descriptorVersion !== workflow.version
    || snapshot.steps.length !== workflow.steps.length || workflow.steps.some((step) => !snapshot.steps.some((source) => source.key === step.key))) {
    throw new Error("RERUN_DESCRIPTOR_MISMATCH");
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
