import { defineStepEntries, defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../workflow-kit/workflow.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { OnboardingInput, OnboardingCanonicalInput } from "../../models/workflows/onboarding/input.js";
import { OnboardingReadHirePlan } from "../../models/workflows/onboarding/read-hire-plan.js";
import { OnboardingMatchHireSubject } from "../../models/workflows/onboarding/match-hire-subject.js";
import { OnboardingReadI9Lookup, OnboardingReadI9ProfilePlan } from "../../models/workflows/onboarding/i9-profile.js";
import { OnboardingResultSchema } from "../../models/workflows/onboarding/result.js";
import { readCrmDataTask, crmDataInput } from "./tasks/read-crm-data.js";
import { searchPersonMatchTask, personMatchInput } from "./tasks/search-person-match.js";
import { onboardingI9Target, i9LookupInput, i9LookupItemId } from "./tasks/lookup-i9.js";

export const CRM_DATA_STEP = defineWorkflowStep({ key: "crm-data", label: "Read and validate hire data" });
export const UCPATH_SEARCH_STEP = defineWorkflowStep({ key: "ucpath-search", label: "Check UCPath duplicates" });
export const I9_SEARCH_STEP = defineWorkflowStep({ key: "i9-search", label: "Search I-9 profiles" });
export const I9_CREATE_STEP = defineWorkflowStep({ key: "i9-profile-creation", label: "Plan I-9 profile creation" });
export const ONBOARDING_STEPS = Object.freeze([CRM_DATA_STEP, UCPATH_SEARCH_STEP, I9_SEARCH_STEP, I9_CREATE_STEP]);
const crm = defineStepEntries(CRM_DATA_STEP), ucpath = defineStepEntries(UCPATH_SEARCH_STEP);
const i9 = defineStepEntries(I9_SEARCH_STEP), create = defineStepEntries(I9_CREATE_STEP);
export const ONBOARDING_NODE_PURPOSES = [
  { nodeId: "crm-source", purpose: "Read the exact email-bound CRM hire record through the existing driver task." },
  { nodeId: "hire-plan", purpose: "Validate hire values using legal and lived names from the supplied run-start roster snapshot." },
  { nodeId: "ucpath-source", purpose: "Read UCPath duplicate candidates using the validated legal name and identifiers." },
  { nodeId: "hire-subject", purpose: "Keep unresolved UCPath identities separate from a new hire." },
  { nodeId: "i9-lookup-child", purpose: "Delegate the new hire's lookup to the registered I-9 Lookup child workflow." },
  { nodeId: "i9-lookup", purpose: "Retain only the exact successful child result; failure never proves profile absence." },
  { nodeId: "i9-profile-plan", purpose: "Reuse a proven profile ID or declare the unimplemented creation write without submitting." },
] as const;

export const onboardingWorkflow = defineWorkflow({
  id: "onboarding", version: 1, code: "on", label: "Onboarding", icon: "UserPlus", category: "onboarding",
  summary: "Validates hire inputs and delegates I-9 lookup; profile creation, hire writes and roster access remain unimplemented.",
  input: OnboardingInput, canonicalInput: OnboardingCanonicalInput, inputSubject: "email",
  surface: { shape: "single" }, surfaces: {}, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["onboarding/crm-extraction"],
  identity: { matchKey: input => input.email.toLowerCase() },
  presentation: { title: input => input.email }, details: [], verdicts: [],
  nodePurposes: ONBOARDING_NODE_PURPOSES,
  steps: ({ task, delegate, result }) => {
    const source = task(readCrmDataTask(CRM_DATA_STEP), [], ({ input }) => crmDataInput(input));
    const plan = task(crm.task("hire-plan", OnboardingReadHirePlan, { replay: "checkpoint" }), [source], ({ input, outputs }) => ({
      crm: outputs["crm-source"], roster: input.roster,
      ...(input.postalCodeOverride === undefined ? {} : { postalCodeOverride: input.postalCodeOverride }),
      ...(input.configuredJobEndDate === undefined ? {} : { configuredJobEndDate: input.configuredJobEndDate }),
    }));
    const matches = task(searchPersonMatchTask(UCPATH_SEARCH_STEP), [plan], ({ outputs }) => personMatchInput(outputs["hire-plan"].employee));
    const subject = task(ucpath.task("hire-subject", OnboardingMatchHireSubject, { replay: "always-rerun" }), [plan, matches], ({ input, outputs }) => ({
      mode: input.mode, firstName: outputs["hire-plan"].employee.firstName, lastName: outputs["hire-plan"].employee.lastName,
      match: outputs["ucpath-source"],
    }));
    const child = delegate({
      step: I9_SEARCH_STEP, id: "i9-lookup-child", target: onboardingI9Target, edgeId: "onboarding-i9-lookup",
      cardinality: "many", await: "terminal", join: "all-settled",
      policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
    }, [plan, subject], {
      bind: ({ outputs }) => outputs["hire-subject"].state === "new-hire" ? [i9LookupInput(outputs["hire-plan"])] : [],
      deriveChildItemId: input => i9LookupItemId(input),
    });
    const lookup = task(i9.task("i9-lookup", OnboardingReadI9Lookup, { replay: "checkpoint" }), [plan, subject, child], ({ outputs }) => ({
      subject: outputs["hire-subject"], expectedItemId: i9LookupItemId(i9LookupInput(outputs["hire-plan"])),
      outcomes: [...outputs["i9-lookup-child"]],
    }));
    const profile = task(create.task("i9-profile-plan", OnboardingReadI9ProfilePlan, { replay: "checkpoint" }), [plan, lookup], ({ outputs }) => ({
      plan: outputs["hire-plan"], lookup: outputs["i9-lookup"],
    }));
    return { steps: [[CRM_DATA_STEP, [source, plan]], [UCPATH_SEARCH_STEP, [matches, subject]],
      [I9_SEARCH_STEP, [child, lookup]], [I9_CREATE_STEP, [profile]]],
    result: result(OnboardingResultSchema, [plan, subject, profile], ({ outputs }) => ({
      state: "implementation-incomplete", plan: outputs["hire-plan"], subject: outputs["hire-subject"], i9: outputs["i9-profile-plan"],
      hireWrite: { state: "unimplemented", owner: "write-safety" }, rosterAccess: { state: "unimplemented", owner: "spreadsheets" },
    } as const)) };
  },
});
