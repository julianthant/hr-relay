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
  start: z.enum(["dry-run", "live-read", "unavailable"]),
  steps: z.array(z.strictObject({ label: z.string(), description: z.string().nullable() })),
  omittableSteps: z.array(z.string()),
  rerun: z.boolean(),
});
export type AssistantWorkflowFact = z.infer<typeof AssistantWorkflowFactSchema>;

function fact(descriptor: AnyWorkflowDescriptor): AssistantWorkflowFact {
  const inputRun = descriptor.surfaces.inputRun, support = workflowDryRunSupport(descriptor);
  const split = inputRun?.parser.split;
  return AssistantWorkflowFactSchema.parse({
    id: descriptor.id, label: descriptor.label, summary: descriptor.summary ?? null, category: descriptor.category,
    input: inputRun === undefined ? null : {
      placeholder: inputRun.placeholder,
      entries: split?.kind === "delimited" ? `One entry per item, separated by ${split.delimiters.map(value => JSON.stringify(value)).join(" or ")}` : "The whole text is one entry",
      fields: [...new Set(inputRun.parser.rules.map(rule => rule.emit))],
      examples: (inputRun.examples ?? []).map(({ label, text, note }) => ({ label, text, note })),
    },
    start: support.state === "supported" ? "dry-run" : "reason" in support && support.reason === "no-transaction-node" ? "live-read" : "unavailable",
    steps: descriptor.timeline.map(step => ({ label: step.label, description: step.description ?? null })),
    omittableSteps: descriptor.stepOmissions.map(omission => descriptor.timeline.find(step => step.key === omission.step)?.label ?? omission.step),
    rerun: (descriptor.rerunValues?.length ?? 0) > 0,
  });
}

/** Facts for the served workflows, generated from their registered definitions (the same source as Explorer). */
export function assistantWorkflowFacts(served: readonly AnyWorkflowDescriptor[]) {
  const facts = served.map(fact).toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(facts.map(entry => entry.id)).size !== facts.length) throw new Error("assistant-workflow-facts-duplicate");
  const bytes = canonicalJsonStringify({ format: 1, workflows: facts });
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error("assistant-workflow-facts-too-large");
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
  if (stored !== `${expected.bytes}\n`) throw new Error("assistant-workflow-facts-stale");
  return expected;
}
