import { z } from "zod";
import { I9LookupInputSchema, I9ReadSection2Signer, i9LookupMatchKey } from "../../models/systems/i9/read-section2-signer.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { i9LookupStepDefinition } from "./steps/lookup/step.js";
const canonicalName = z.string().min(1).refine(value => value.trim() === value);
export const I9LookupCanonicalInput = defineCanonicalInput(I9LookupInputSchema, z.strictObject({
  lastName: canonicalName, firstName: canonicalName, ssn: z.string().regex(/^\d{9}$/u).optional(),
}), [{ lastName: "Example", firstName: "Person" }]);
export const i9LookupWorkflow = defineWorkflow({
  id: "i9-lookup",
  requiredWorkbookTypeIds: [],
  version: 1,
  code: "il",
  label: "I-9 Lookup",
  summary: "Finds the Section 2 authorized representative for a delegated person in I-9 Complete.",
  icon: "ShieldCheck",
  category: "search",
  input: I9LookupInputSchema,
  canonicalInput: I9LookupCanonicalInput,
  inputSubject: "name",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: i9LookupMatchKey },
  presentation: { title: input => `${input.lastName}, ${input.firstName}` },
  details: [
    { key: "signer-name", label: "Authorized Official Signer", source: { kind: "result", fieldPath: "signerName" }, display: "text" },
    { key: "i9-status", label: "I-9 Status", source: { kind: "result", fieldPath: "i9Status" }, display: "text" },
  ],
  scenarios: I9ReadSection2Signer.scenarios,
  nodePurposes: [
    { nodeId: "lookup-source", purpose: "Read the Section 2 signer from one exact-name employee profile and distinguish missing, restricted and historical records." },
    { nodeId: "lookup", purpose: "Retain the typed result of the I-9 signer task for this workflow." },
  ],
  steps: i9LookupStepDefinition.build,
});
