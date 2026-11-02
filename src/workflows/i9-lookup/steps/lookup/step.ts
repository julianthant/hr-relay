import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { I9SignerOutputSchema } from "../../../../models/systems/i9/read-section2-signer.js";
import { i9LookupWorkflow, I9_LOOKUP_STEP } from "../../workflow.js";

const lookupStep = i9LookupWorkflow.steps.find(([step]) => step.key === I9_LOOKUP_STEP.key);
const lookup = lookupStep?.[1].find(entry => entry.id === "lookup");
if (lookupStep === undefined || lookup === undefined) throw new Error("I-9 lookup proof requires its authored lookup group.");

export const i9LookupStepWorkflow = defineWorkflow({
  id: "i9-lookup-lookup", version: 1, code: "ilk", label: I9_LOOKUP_STEP.label,
  summary: "Proves the I-9 signer task and its workflow result in one lookup checkpoint.",
  icon: "ShieldCheck", category: "search", input: i9LookupWorkflow.input,
  canonicalInput: i9LookupWorkflow.canonicalInput, inputSubject: i9LookupWorkflow.inputSubject,
  surface: i9LookupWorkflow.surface, enqueue: i9LookupWorkflow.enqueue, actions: i9LookupWorkflow.actions,
  surfaces: {}, verdicts: [], details: i9LookupWorkflow.details,
  identity: i9LookupWorkflow.identity, presentation: i9LookupWorkflow.presentation,
  scenarios: i9LookupWorkflow.scenarios,
  role: defineWorkflowRole({ kind: "chunk-harness", of: "i9-lookup", step: I9_LOOKUP_STEP.key }),
  steps: ({ result }) => ({ steps: [lookupStep], result: result(I9SignerOutputSchema, [lookup],
    ({ outputs }) => I9SignerOutputSchema.parse(outputs.lookup)) }),
});
