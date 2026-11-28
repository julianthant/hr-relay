import { OnboardingInput, OnboardingCanonicalValueSchema, type OnboardingInputValue } from "../../../../models/workflows/onboarding/input.js";
import { ONBOARDING_ROSTER_GATE_ID, OnboardingRosterChoiceSchema } from "../../../../models/workflows/onboarding/roster.js";
import { CrmReadHireData } from "../../../../models/systems/crm/read-hire-data.js";
import { OnboardingReadHirePlan } from "../../../../models/workflows/onboarding/read-hire-plan.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import type { JsonObject } from "../../../../rules/validation/canonical-json.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof, reuseTask } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";

function enteredCrmData(facts: JsonObject, requestedEmail: string) {
  const recordUrl = typeof facts.recordUrl === "string" ? facts.recordUrl : "";
  const recordId = URL.canParse(recordUrl) ? new URL(recordUrl).searchParams.get("id") : null;
  return {
    recordId, recordUrl, requestedEmail, personalEmail: facts.personalEmail ?? "", workEmail: facts.workEmail ?? "",
    recordFirstName: facts.firstName, recordLastName: facts.lastName, department: facts.department,
    recruitmentNumber: facts.recruitmentNumber ?? "",
    fields: {
      positionNumber: facts.positionNumber, firstName: facts.firstName, lastName: facts.lastName, middleName: facts.middleName ?? "",
      ssn: facts.ssn ?? "", address: facts.address, addressLine2: facts.addressLine2 ?? "", city: facts.city, state: facts.state,
      postalCode: facts.postalCode, wage: facts.wage, dob: facts.dob, phone: facts.phone ?? "", email: facts.email,
      appointment: facts.appointment, effectiveDate: facts.effectiveDate, expectedJobEndDate: facts.expectedJobEndDate ?? "",
    },
  };
}

function hirePlanInput(input: unknown, crm: unknown, rosterChoice: unknown) {
  const { roster, postalCodeOverride, configuredJobEndDate } = OnboardingCanonicalValueSchema.parse(input);
  return {
    crm: CrmReadHireData.output.parse(crm),
    roster: roster.state === "resolved" ? roster.row : OnboardingRosterChoiceSchema.parse(rosterChoice).row,
    ...(postalCodeOverride === undefined ? {} : { postalCodeOverride }),
    ...(configuredJobEndDate === undefined ? {} : { configuredJobEndDate }),
  };
}

export const CRM_DATA_MANUAL: StepManualDeclaration = {
  off: "values",
  keeps: [ONBOARDING_ROSTER_GATE_ID, "hire-plan"],
  form: { fields: [
    { key: "recordUrl", label: "CRM record URL", kind: "text", withheld: true,
      help: "Use the CRM record link in the format https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=…" },
    { key: "firstName", label: "First name", kind: "text" },
    { key: "lastName", label: "Last name", kind: "text" },
    { key: "middleName", label: "Middle name", kind: "text", optional: true },
    { key: "personalEmail", label: "Personal email on CRM record", kind: "text", optional: true, withheld: true },
    { key: "workEmail", label: "Work email on CRM record", kind: "text", optional: true, withheld: true },
    { key: "email", label: "Email on entry sheet", kind: "text", withheld: true,
      help: "The entry-sheet email and the roster email must each match a personal or work email on the CRM record." },
    { key: "dob", label: "Date of birth", kind: "us-date", withheld: true },
    { key: "ssn", label: "SSN (if listed)", kind: "text", optional: true, withheld: true, help: "Use XXX-XX-XXXX." },
    { key: "phone", label: "Phone", kind: "text", optional: true, withheld: true },
    { key: "address", label: "Address", kind: "text", withheld: true },
    { key: "addressLine2", label: "Address line 2", kind: "text", optional: true, withheld: true },
    { key: "city", label: "City", kind: "text" },
    { key: "state", label: "State", kind: "text" },
    { key: "postalCode", label: "Postal code", kind: "text" },
    { key: "positionNumber", label: "Position number", kind: "text" },
    { key: "department", label: "Department including number", kind: "text", help: "Use the entry-sheet format, such as Dining (000412)." },
    { key: "recruitmentNumber", label: "Recruitment number", kind: "text", optional: true },
    { key: "appointment", label: "Appointment including classification", kind: "text", help: "Use the entry-sheet format, such as 5 Student: Casual/Restricted." },
    { key: "wage", label: "Hourly rate", kind: "text", help: "Include the dollar sign, such as $17.75." },
    { key: "effectiveDate", label: "Effective date", kind: "us-date" },
    { key: "expectedJobEndDate", label: "Expected job end date", kind: "us-date", optional: true, help: "Leave blank to use the configured job end date." },
  ] },
  refine: (facts, submission) => {
    const subject = OnboardingInput.safeParse(submission);
    if (!subject.success) return [{ field: "email", message: "A run subject email is required." }];
    const parsed = CrmReadHireData.output.safeParse(enteredCrmData(facts, subject.data.email));
    return parsed.success ? [] : parsed.error.issues.map(issue => ({
      field: issue.path[0] === "recordUrl" || issue.path[0] === "recordId" ? "recordUrl" : "email",
      message: issue.message,
    }));
  },
  produces: {
    "crm-source": ({ facts, scope }) => enteredCrmData(facts, OnboardingCanonicalValueSchema.parse(scope.input).email),
  },
};

const group = Object.freeze({
  ...defineWorkflowStep({ key: "crm-data", label: "Read and validate hire data" }),
  manual: CRM_DATA_MANUAL,
  operatorFields: [
    { label: "First name", visibility: "logs", sources: [{ nodeId: "hire-plan", kind: "output", fieldPath: "employee.firstName" }] },
    { label: "Last name", visibility: "logs", sources: [{ nodeId: "hire-plan", kind: "output", fieldPath: "employee.lastName" }] },
    { label: "Position", visibility: "logs", sources: [{ nodeId: "hire-plan", kind: "output", fieldPath: "employee.positionNumber" }] },
  ] as const,
  review: {
    pages: [
      {
        id: "crm-hire-record",
        title: "CRM onboarding record",
        mode: "Read only",
        nodeIds: ["crm-source"],
        lines: [{ id: "read-hire", kind: "read", text: "Read the exact email-bound CRM hire record.", nodeIds: ["crm-source"] }],
        fields: [
          { id: "email", label: "Email", example: "bea.morrow@example.test", inputField: "email",
            source: { origin: "Run input", detail: "The email used to locate the saved roster row and exact CRM record.", chain: [] } },
          ...[
            ["first-name", "First name", "firstName", "Bea"], ["last-name", "Last name", "lastName", "Morrow"],
            ["middle-name", "Middle name", "middleName", "Avery"], ["date-of-birth", "Date of birth", "dob", "01/14/2000"],
            ["ssn", "SSN", "ssn", "Not provided"], ["position", "Position", "positionNumber", "12345678"],
            ["address", "Address", "address", "123 Example St"], ["address-line-2", "Address line 2", "addressLine2", "Unit 2"],
            ["city", "City", "city", "San Diego"], ["state", "State", "state", "CA"], ["postal-code", "Postal code", "postalCode", "92093"],
            ["wage", "Hourly pay", "wage", "$17.75 per hour"], ["phone", "Phone", "phone", "619-555-0100"],
            ["appointment", "Appointment", "appointment", "5 Student: Casual/Restricted"],
            ["effective-date", "Effective date", "effectiveDate", "09/11/2026"], ["end-date", "Expected job end date", "expectedJobEndDate", "06/30/2027"],
          ].map(([id, label, path, example]) => ({ id, label, example,
            taskFields: [{ nodeId: "crm-source", kind: "output" as const, fieldPath: `fields.${path}` }],
            source: { origin: "CRM onboarding record", detail: `${label} read from the exact email-bound CRM record.`, chain: [] } })),
          ...[["department", "Department", "Dining (000412)"], ["recruitmentNumber", "Recruitment number", "R123"]].map(([path, label, example]) => ({
            id: path === "department" ? "department" : "recruitment-number", label, example,
            taskFields: [{ nodeId: "crm-source", kind: "output" as const, fieldPath: path }],
            source: { origin: "CRM onboarding record", detail: `${label} retained with the hire data.`, chain: [] } })),
        ]
      },
      {
        id: "roster-names", title: "Onboarding roster", mode: "Read only", nodeIds: ["hire-plan"],
        lines: [{ id: "validate-names", kind: "check", text: "Split the saved roster's legal and preferred names, and validate the CRM hire values before continuing.", nodeIds: ["hire-plan"] }],
        fields: [
          { id: "legal-name", label: "Legal name", example: "Morrow, Bea Avery",
            taskFields: [{ nodeId: "hire-plan", kind: "input", fieldPath: "roster.references.legalName" }],
            source: { origin: "Saved onboarding roster", detail: "The legal name from the exact roster version captured for the run.", chain: [] } },
          { id: "preferred-name", label: "Preferred name", example: "Morrow, Bea Avery",
            taskFields: [{ nodeId: "hire-plan", kind: "input", fieldPath: "roster.references.livedName" }],
            source: { origin: "Saved onboarding roster", detail: "The lived name from the same saved row; when absent, the validated legal name supplies the preferred name.", chain: [] } },
        ],
      }
    ],
    branchLabels: [],
    picks: [{ nodeId: ONBOARDING_ROSTER_GATE_ID, title: "Saved onboarding roster rows",
      columns: ["Email", "Legal name", "Preferred name"],
      rows: [{ cells: ["bea.morrow@example.test", "Morrow, Bea Avery", "Morrow, Bea Avery"] }],
      question: { title: "Choose roster row", context: "When saved rows for the same email disagree, Logs asks you to choose a row before reading CRM. Agreeing rows proceed as one hire." } }],
  } as const
});
const entries = defineStepEntries(group);

export function buildCrmData(author: WorkflowAuthor<typeof OnboardingInput>) {
  const choice = author.gate({ id: ONBOARDING_ROSTER_GATE_ID, label: "Choose roster row", statusKey: "awaitingRosterRowChoice",
    result: OnboardingRosterChoiceSchema,
    when: { kind: "equals", of: { from: "input", path: "roster.state" }, value: "resolve-required" },
  }, []);
  const call = reuseTask(group, { id: "crm-source", contract: CrmReadHireData, replay: "always-rerun" },
    (input: OnboardingInputValue) => ({ email: input.email }));
  const source = author.task(call.identity, [choice], call.bind);
  const plan = author.task(entries.task("hire-plan", OnboardingReadHirePlan, { replay: "always-rerun" }), [source, choice],
    ({ input, outputs }) => hirePlanInput(input, outputs["crm-source"], outputs[ONBOARDING_ROSTER_GATE_ID]));
  return { choice, source, plan, steps: [[group, [choice, source, plan]]] as const,
    result: author.result(OnboardingReadHirePlan.output, [plan], ({ outputs }) => OnboardingReadHirePlan.output.parse(outputs["hire-plan"])) };
}

export const onboardingCrmDataDefinition = defineStep({
  group, build: buildCrmData,
  nodePurposes: [
    { nodeId: ONBOARDING_ROSTER_GATE_ID, purpose: "Hold missing or conflicting exact-key roster matches for a revalidated worksheet and row choice." },
    { nodeId: "crm-source", purpose: "Read the exact email-bound CRM hire record through the existing driver task." },
    { nodeId: "hire-plan", purpose: "Validate hire values and split the roster legal and lived names against the CRM record." },
  ],
  proof: {
    id: "onboarding-crm-data", order: 15,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), code: "onc", label: group.label, summary: parent.summary,
      steps: buildCrmData,
    }),
  },
});
