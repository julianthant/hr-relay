import type { z } from "zod";
import { I9LookupInputSchema, I9SignerOutputSchema } from "../../../../models/systems/i9/read-section2-signer.js";
import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { OnboardingReadI9Lookup } from "../../../../models/workflows/onboarding/read-i9-lookup.js";
import type { HirePlanSchema } from "../../../../models/workflows/onboarding/read-hire-plan.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { ItemIdSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { deriveItemId } from "../../../../rules/identity/logical-item.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { i9LookupWorkflow } from "../../../i9-lookup/workflow.js";
import { buildCrmData } from "../crm-data/step.js";
import { buildUcpathSearch } from "../ucpath-search/step.js";
import { hireReviewChoices } from "../../../../rules/onboarding/match-hire-subject.js";

export const I9_SEARCH_MANUAL: StepManualDeclaration = {
  off: "values",
  form: { fields: [
    { key: "i9Status", label: "I-9 lookup result", kind: "enum", values: ["Signed", "Unsigned", "Historical", "Not found", "Unresolved"] },
    { key: "profileId", label: "I-9 profile ID", kind: "text", optional: true, withheld: true },
  ] },
  produces: {},
  skips: ["i9-lookup-child", "i9-lookup"],
};

const group = Object.freeze({
  ...defineWorkflowStep({ key: "i9-search", label: "Search I-9 profiles" }),
  manual: I9_SEARCH_MANUAL,
  operatorFields: [
    { label: "I-9 lookup", visibility: "logs", sources: [{ nodeId: "i9-lookup", kind: "output", fieldPath: "state" }],
      display: { cases: [{ value: "checked", text: "Checked" }, { value: "not-required", text: "Not required" }] } },
    { label: "I-9 status", visibility: "logs", sources: [{ nodeId: "i9-lookup", kind: "output", fieldPath: "result.i9Status" }],
      display: { cases: [{ value: "signed", text: "Signed" }, { value: "unsigned", text: "Unsigned" }, { value: "historical", text: "Historical" },
        { value: "not-found", text: "Not found" }, { value: "unable-to-access", text: "Unable to access" }] } },
  ] as const,
  review: {
    pages: [{ id: "lookup-result", title: "I-9 lookup result", mode: "Read only", nodeIds: ["i9-lookup"],
      lines: [{ id: "retain-result", kind: "read", text: "Retain the exact I-9 Lookup result, or the explicit existing-person path that needs no lookup.", nodeIds: ["i9-lookup"] }],
      fields: [{ id: "status", label: "I-9 status", example: "Not found", when: [{ "i9-lookup-result": ["checked"] }],
        display: { cases: [{ value: "not-found", text: "Not found" }, { value: "signed", text: "Signed" }, { value: "unsigned", text: "Unsigned" },
          { value: "historical", text: "Historical" }, { value: "unable-to-access", text: "Unable to access" }] },
        taskFields: [{ nodeId: "i9-lookup", kind: "output", fieldPath: "result.i9Status" }],
        source: { origin: "I-9 Lookup", detail: "The status retained from the exact successful child lookup; a failed child never proves profile absence.", chain: [] } }],
      when: [{ "i9-lookup-result": ["checked"] }],
    }], branchLabels: [],
    starts: [{ nodeId: "i9-lookup-child", each: "Each person", when: [{ mode: ["new-hire"], "hire-match": ["new-hire", "review-required"], "i9-lookup-result": ["checked"] }] }],
    outcomes: [{ nodeId: "i9-lookup-child", value: "child-failed", then: "The I-9 lookup did not establish a verified result; the run stops before hire approval.", stops: true }],
    decisions: [
      { id: "i9-lookup-result", label: "I-9 lookup", reads: { nodeId: "i9-lookup", fieldPath: "state" },
        nodeIds: ["i9-lookup"], initial: { by: "hire-match", values: { "existing-person": "not-required", "review-required": "not-required" }, otherwise: "checked" }, outcomes: [
          { value: "checked", label: "Lookup completed", then: "Retains the exact child result for the hire review.", when: [{ mode: ["new-hire"], "hire-match": ["new-hire", "review-required"] }] },
          { value: "not-required", label: "Lookup not required", then: "Continues to review the existing person's hire findings.", when: [{ "hire-match": ["existing-person", "review-required"] }] },
        ] },
      { id: "i9-status", label: "I-9 status", reads: { nodeId: "i9-lookup", fieldPath: "result.i9Status" },
        nodeIds: ["i9-lookup"], initial: "not-found", when: [{ "i9-lookup-result": ["checked"] }], outcomes: [
          { value: "not-found", label: "No profile found", then: "Plans a new profile and remote record after hire approval." },
          { value: "signed", label: "Signed", then: "Checks whether the existing profile and record can be reused for the approved hire." },
          { value: "unsigned", label: "Unsigned", then: "Checks the existing profile and record before creating or reusing the remote record." },
          { value: "historical", label: "Historical", then: "Retains the historical profile evidence for the approved hire plan." },
          { value: "unable-to-access", label: "Unable to access", then: "A new hire cannot pass the reviewed hire check; an approved existing-person hire needs no I-9 creation." },
        ] },
    ],
  } as const
});
const entries = defineStepEntries(group);
const target = Object.freeze({ id: WorkflowIdSchema.parse(i9LookupWorkflow.id), input: I9LookupInputSchema, result: I9SignerOutputSchema });

export function i9LookupInput(plan: z.output<typeof HirePlanSchema>): z.input<typeof I9LookupInputSchema> {
  return { firstName: plan.employee.firstName, lastName: plan.employee.lastName,
    ...(plan.employee.ssn === null ? {} : { ssn: plan.employee.ssn }) };
}
export function i9LookupItemId(input: z.output<typeof I9LookupInputSchema>) {
  return ItemIdSchema.parse(deriveItemId(i9LookupWorkflow.id, i9LookupWorkflow.identity.matchKey(input)));
}

export function buildI9Search(author: WorkflowAuthor<typeof OnboardingInput>, crm: ReturnType<typeof buildCrmData>, ucpath: ReturnType<typeof buildUcpathSearch>) {
  const child = author.delegate({
    step: group, id: "i9-lookup-child", target, edgeId: "onboarding-i9-lookup",
    cardinality: "many", await: "terminal", join: "all-settled",
    policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
  }, [crm.plan, ucpath.matches, ucpath.subject], {
    // Look up the I-9 profile whenever the operator may still choose a new hire.
    bind: ({ input, outputs }) => hireReviewChoices(input.mode, outputs["ucpath-source"], outputs["hire-plan"].employee).newHire ? [i9LookupInput(outputs["hire-plan"])] : [],
    deriveChildItemId: input => i9LookupItemId(input),
  });
  const lookup = author.task(entries.task("i9-lookup", OnboardingReadI9Lookup, { replay: "checkpoint" }), [crm.plan, ucpath.subject, child], ({ outputs }) => ({
    subject: outputs["hire-subject"], expectedItemId: i9LookupItemId(i9LookupInput(outputs["hire-plan"])),
    outcomes: [...outputs["i9-lookup-child"]],
  }));
  return { child, lookup, steps: [[group, [child, lookup]]] as const,
    result: author.result(OnboardingReadI9Lookup.output, [lookup], ({ outputs }) => OnboardingReadI9Lookup.output.parse(outputs["i9-lookup"])) };
}

export const onboardingI9SearchDefinition = defineStep({
  group, build: buildI9Search,
  nodePurposes: [
    { nodeId: "i9-lookup-child", purpose: "Delegate the new hire's lookup to the registered I-9 Lookup child workflow." },
    { nodeId: "i9-lookup", purpose: "Retain only the exact successful child result; failure never proves profile absence." },
  ],
  proof: {
    id: "onboarding-i9-search", order: 17,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), code: "onis", label: group.label, summary: parent.summary,
      steps: (author: WorkflowAuthor<typeof OnboardingInput>) => {
        const crm = buildCrmData(author);
        const ucpath = buildUcpathSearch(author, crm);
        const i9 = buildI9Search(author, crm, ucpath);
        return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps], result: i9.result };
      },
    }),
  },
});
