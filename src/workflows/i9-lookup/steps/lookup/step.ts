import { I9LookupInputSchema, I9ReadSection2Signer, I9SignerOutputSchema } from "../../../../models/systems/i9/read-section2-signer.js";
import { ReadI9LookupResult } from "../../../../models/workflows/i9-lookup/read-result.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
export const I9_LOOKUP_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "lookup", label: "Look up Section 2 signer" }),
  description: "Search I-9 Complete by name and read the electronic Section 2 audit signer.",
  system: "i9",
  operatorFields: [
    {
      label: "Authorized official signer", sources: [
        { nodeId: "lookup-source", kind: "output", fieldPath: "signerName" },
        { nodeId: "lookup", kind: "output", fieldPath: "signerName" },
      ]
    },
    {
      label: "I-9 status", sources: [
        { nodeId: "lookup-source", kind: "output", fieldPath: "i9Status" },
        { nodeId: "lookup", kind: "output", fieldPath: "i9Status" },
      ]
    },
  ],
} as const);
const entries = defineStepEntries(I9_LOOKUP_STEP);
const signer = entries.task("lookup-source", I9ReadSection2Signer, { label: "Read Section 2 signer", replay: "checkpoint" });
const lookup = entries.task("lookup", ReadI9LookupResult, { replay: "always-rerun" });

export function buildStep(author: WorkflowAuthor<typeof I9LookupInputSchema>) {
  const { task, result } = author;
  const source = task(signer, [], ({ input }) => input);
  const read = task(lookup, [source], ({ outputs }) => ({ signer: outputs["lookup-source"] }));
  return { steps: [[I9_LOOKUP_STEP, [source, read]]] as const, result: result(I9SignerOutputSchema, [read], ({ outputs }) => outputs.lookup) };
}

export const i9LookupStepDefinition = defineStep({
  group: I9_LOOKUP_STEP, build: buildStep,
  proof: {
    id: "i9-lookup-lookup", order: 9,
    build: (parent: WorkflowDefinition<typeof I9LookupInputSchema>) => ({
      ...inheritStepProof(parent), code: "ilk", label: I9_LOOKUP_STEP.label, summary: "Proves the I-9 signer task and its workflow result in one lookup checkpoint.", details: parent.details,
      steps: buildStep,
    }),
  },
});
