import { z } from "zod";
import { I9LookupInputSchema, I9ReadSection2Signer, I9SignerOutputSchema } from "../../models/systems/i9/read-section2-signer.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { ReadI9LookupResult } from "../../models/workflows/i9-lookup/read-result.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { defineStepEntries, defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../workflow-kit/workflow.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";

const canonicalName = z.string().min(1).refine(value => value.trim() === value);
export const I9LookupCanonicalInput = defineCanonicalInput(I9LookupInputSchema, z.strictObject({
  lastName: canonicalName, firstName: canonicalName, ssn: z.string().regex(/^\d{9}$/u).optional(),
}), [{ lastName: "Example", firstName: "Person" }]);

export const I9_LOOKUP_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "lookup", label: "Look up Section 2 signer" }),
  description: "Search I-9 Complete by name and read the electronic Section 2 audit signer.",
  system: "i9",
  operatorFields: [
    { label: "Authorized official signer", sources: [
      { nodeId: "lookup-source", kind: "output", fieldPath: "signerName" },
      { nodeId: "lookup", kind: "output", fieldPath: "signerName" },
    ] },
    { label: "I-9 status", sources: [
      { nodeId: "lookup-source", kind: "output", fieldPath: "i9Status" },
      { nodeId: "lookup", kind: "output", fieldPath: "i9Status" },
    ] },
  ],
} as const);
const entries = defineStepEntries(I9_LOOKUP_STEP);
const signer = entries.task("lookup-source", I9ReadSection2Signer, { label: "Read Section 2 signer", replay: "checkpoint" });
const lookup = entries.task("lookup", ReadI9LookupResult, { replay: "always-rerun" });

export const i9LookupWorkflow = defineWorkflow({
  id: "i9-lookup", version: 1, code: "il", label: "I-9 Lookup",
  summary: "Finds the Section 2 authorized representative for a delegated person in I-9 Complete.",
  icon: "ShieldCheck", category: "search", input: I9LookupInputSchema, canonicalInput: I9LookupCanonicalInput,
  inputSubject: "name", surface: { shape: "single" }, enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: input => ["i9", sha256Hex(JSON.stringify([input.lastName.toLowerCase(), input.firstName.toLowerCase(), input.ssn]))].join(":") },
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
  steps: ({ task, result }) => {
    const source = task(signer, [], ({ input }) => input);
    const read = task(lookup, [source], ({ outputs }) => ({ signer: outputs["lookup-source"] }));
    return { steps: [[I9_LOOKUP_STEP, [source, read]]], result: result(I9SignerOutputSchema, [read], ({ outputs }) => outputs.lookup) };
  },
});
