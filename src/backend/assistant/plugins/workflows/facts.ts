import { createHash } from "node:crypto";
import { closeSync, constants, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { workflowDryRunSupport, type AnyWorkflowDescriptor } from "../../../../workflow-kit/workflow.js";

export const ASSISTANT_WORKFLOW_FACTS_PATH = "src/backend/assistant/plugins/workflows/facts.json";
const MAX_BYTES = 200_000;

export const AssistantWorkflowFactSchema = z.strictObject({
  id: z.string().min(1), label: z.string().min(1), summary: z.string().min(1).nullable(), category: z.string().min(1),
  input: z.strictObject({
    placeholder: z.string(), entries: z.string(), fields: z.array(z.string()),
    examples: z.array(z.strictObject({ label: z.string(), text: z.string(), note: z.string() })),
  }).nullable(),
  start: z.enum(["dry-run", "live-read", "dashboard-upload", "dashboard-input", "unavailable"]),
  steps: z.array(z.strictObject({ label: z.string(), description: z.string().nullable() })),
  omittableSteps: z.array(z.string()),
  rerun: z.enum(["check-run", "unavailable"]),
});
export type AssistantWorkflowFact = z.infer<typeof AssistantWorkflowFactSchema>;

/** Why the facts did not load, and the served workflow they came from when one is known; never a value. */
export class AssistantWorkflowFactsError extends Error {
  constructor(readonly code: "ASSISTANT_WORKFLOW_FACTS_STALE" | "ASSISTANT_WORKFLOW_FACTS_INVALID" | "ASSISTANT_WORKFLOW_FACTS_DUPLICATE" | "ASSISTANT_WORKFLOW_FACTS_TOO_LARGE",
    readonly workflowId?: string, options?: ErrorOptions) {
    super(code.toLowerCase().replaceAll("_", "-"), options);
    this.name = "AssistantWorkflowFactsError";
  }
}

export function assistantWorkflowRunMode(descriptor: AnyWorkflowDescriptor): "dry-run" | "live-read" | "unavailable" {
  const support = workflowDryRunSupport(descriptor);
  if (support.state === "supported") return "dry-run";
  return "reason" in support && support.reason === "no-transaction-node" ? "live-read" : "unavailable";
}

function freshStart(descriptor: AnyWorkflowDescriptor, mode: ReturnType<typeof assistantWorkflowRunMode>, needsDate: boolean): AssistantWorkflowFact["start"] {
  const { inputRun, uploadRun } = descriptor.surfaces;
  if (inputRun === undefined) return uploadRun === undefined ? "unavailable" : "dashboard-upload";
  if (mode === "unavailable") return mode;
  return descriptor.workbookReference !== undefined || needsDate ? "dashboard-input" : mode;
}

function fact(descriptor: AnyWorkflowDescriptor): AssistantWorkflowFact {
  const inputRun = descriptor.surfaces.inputRun, mode = assistantWorkflowRunMode(descriptor);
  const split = inputRun?.parser.split, typed = inputRun?.typedInput;
  const fields = [...new Set(inputRun?.parser.rules.map(rule => rule.emit))];
  const requiredDates = typed?.submitsMode === false ? typed.controls.filter(control => "kind" in control && control.kind === "date"
    && control.required && control.requires.length === 0 && control.modes.includes(typed.modes[0].value)) : [];
  const needsDate = requiredDates.some(control => !fields.includes(control.field));
  // Chat reruns send retained ISO dates, which the typed-date ingress cannot accept.
  const rerunUnavailable = mode === "unavailable" || descriptor.workbookReference !== undefined || requiredDates.length > 0;
  return AssistantWorkflowFactSchema.parse({
    id: descriptor.id, label: descriptor.label, summary: descriptor.summary ?? null, category: descriptor.category,
    input: inputRun === undefined ? null : {
      placeholder: inputRun.placeholder,
      entries: split?.kind === "delimited" ? `One entry per item, separated by ${split.delimiters.map(value => JSON.stringify(value)).join(" or ")}` : "The whole text is one entry",
      fields,
      examples: (inputRun.examples ?? []).map(({ label, text, note }) => ({ label, text, note })),
    },
    start: freshStart(descriptor, mode, needsDate),
    steps: descriptor.timeline.map(step => ({ label: step.label, description: step.description ?? null })),
    omittableSteps: descriptor.stepOmissions.map(omission => descriptor.timeline.find(step => step.key === omission.step)?.label ?? omission.step),
    rerun: rerunUnavailable ? "unavailable" : "check-run",
  });
}

/** Facts for the served workflows, generated from their registered definitions (the same source as Explorer). */
export function assistantWorkflowFacts(served: readonly AnyWorkflowDescriptor[]) {
  const facts = served.map(descriptor => {
    try { return fact(descriptor); } catch (error) { throw new AssistantWorkflowFactsError("ASSISTANT_WORKFLOW_FACTS_INVALID", descriptor.id, { cause: error }); }
  }).toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const duplicate = facts.find((entry, index) => facts.findIndex(other => other.id === entry.id) !== index);
  if (duplicate !== undefined) throw new AssistantWorkflowFactsError("ASSISTANT_WORKFLOW_FACTS_DUPLICATE", duplicate.id);
  const bytes = canonicalJsonStringify({ format: 1, workflows: facts });
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw new AssistantWorkflowFactsError("ASSISTANT_WORKFLOW_FACTS_TOO_LARGE");
  return Object.freeze({ facts, bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
}
export type AssistantWorkflowFacts = ReturnType<typeof assistantWorkflowFacts>;

/** Boot pin: the generated file must equal the facts rebuilt from the running definitions. */
export function loadAssistantWorkflowFacts(repoRoot: string, served: readonly AnyWorkflowDescriptor[]): AssistantWorkflowFacts {
  const expected = assistantWorkflowFacts(served);
  const descriptor = openSync(join(repoRoot, ASSISTANT_WORKFLOW_FACTS_PATH), constants.O_RDONLY | constants.O_NOFOLLOW);
  let stored: string;
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 2);
    stored = buffer.subarray(0, readSync(descriptor, buffer, 0, buffer.length, 0)).toString("utf8");
  } finally { closeSync(descriptor); }
  if (stored !== `${expected.bytes}\n`) throw new AssistantWorkflowFactsError("ASSISTANT_WORKFLOW_FACTS_STALE", staleWorkflow(stored, expected.facts));
  return expected;
}

/** The first served workflow whose stored facts differ from its definition's; a row only the file has is never named, since its id is untrusted. */
function staleWorkflow(stored: string, expected: readonly AssistantWorkflowFact[]): string | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(stored); } catch (error) { throw new AssistantWorkflowFactsError("ASSISTANT_WORKFLOW_FACTS_STALE", undefined, { cause: error }); }
  const file = z.object({ workflows: z.array(z.looseObject({ id: z.string() })) }).safeParse(parsed);
  if (!file.success) return undefined;
  const storedById = new Map(file.data.workflows.map(entry => [entry.id, canonicalJsonStringify(entry)]));
  return expected.find(entry => storedById.get(entry.id) !== canonicalJsonStringify(entry))?.id;
}
