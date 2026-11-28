import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { OnboardingMatchHireSubject } from "../../../../models/workflows/onboarding/match-hire-subject.js";
import { SearchPersonMatch } from "../../../../models/systems/ucpath/search-person-match.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import type { HireEmployee } from "../../../../models/people/hire-employee.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof, reuseTask } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildCrmData } from "../crm-data/step.js";

export const UCPATH_SEARCH_MANUAL: StepManualDeclaration = {
  off: "values",
  form: { fields: [
    { key: "match", label: "UCPath match result", kind: "enum", values: ["Found", "No match", "Unresolved"] },
    { key: "emplId", label: "Matched employee ID", kind: "eid", optional: true, withheld: true, requiredWhen: { field: "match", equals: "Found" } },
  ] },
  produces: {},
  skips: ["ucpath-source", "hire-subject"],
};

const group = Object.freeze({
  ...defineWorkflowStep({ key: "ucpath-search", label: "Check UCPath duplicates" }),
  manual: UCPATH_SEARCH_MANUAL,
  operatorFields: [
    { label: "Hire match", visibility: "logs", sources: [{ nodeId: "hire-subject", kind: "output", fieldPath: "state" }],
      display: { cases: [{ value: "new-hire", text: "New hire" }, { value: "existing-person", text: "Existing person" }, { value: "review-required", text: "Review required" }] } },
    { label: "Employee ID", visibility: "logs", sources: [{ nodeId: "hire-subject", kind: "output", fieldPath: "person.emplId" }] },
    { label: "Matched by", visibility: "logs", sources: [{ nodeId: "hire-subject", kind: "output", fieldPath: "matchedBy" }],
      display: { cases: [{ value: "name-dob-ssn", text: "Name, date of birth and SSN; no review needed" }] } },
  ] as const,
  review: {
    pages: [
      {
        id: "person-match",
        title: "Smart HR person search",
        mode: "Fill form",
        nodeIds: ["ucpath-source"],
        lines: [
          { id: "search-duplicates", kind: "action", text: "Search UCPath for a matching person using the validated hire identity.", nodeIds: ["ucpath-source"] },
          { id: "search", kind: "click", target: "Search", nodeIds: ["ucpath-source"] },
        ],
        fields: [
          ...[["first-name", "First name", "firstName", "Bea"], ["last-name", "Last name", "lastName", "Morrow"]].map(([id, label, path, example]) => ({ id, label, example,
            taskFields: [{ nodeId: "ucpath-source", kind: "input" as const, fieldPath: path }],
            source: { origin: "Validated hire identity", detail: `${label} split from the captured roster Legal name with CRM names as anchors, formatted for UCPath.`,
              read: { stepKey: "crm-data", page: "Onboarding roster", field: "Legal name" },
              chain: ["First name", "Middle name", "Last name"].map(field => ({ label: `${field} split anchor`,
                detail: "CRM name anchor used to split the captured Legal name.",
                read: { stepKey: "crm-data", page: "CRM onboarding record", field } })) } })),
          { id: "date-of-birth", label: "Date of birth", example: "01/14/2000",
            taskFields: [{ nodeId: "ucpath-source", kind: "input", fieldPath: "dob" }],
            source: { origin: "Validated hire identity", detail: "Date of birth from the hire plan, formatted for UCPath.",
              read: { stepKey: "crm-data", page: "CRM onboarding record", field: "Date of birth" }, chain: [] } },
        ],
      },
      {
        id: "person-results", title: "Smart HR person search results", mode: "Read only", nodeIds: ["ucpath-source", "hire-subject"],
        when: [{ "hire-match": ["existing-person", "review-required"] }],
        lines: [{ id: "classify-match", kind: "check", text: "Resolve a new hire or an existing person from the returned candidates.", nodeIds: ["hire-subject"] }],
        fields: [
          { id: "candidate-name", label: "Candidate name", example: "Morrow, Bea",
            taskFields: [{ nodeId: "ucpath-source", kind: "output", fieldPath: "hits.name" }], when: [{ "hire-match": ["existing-person", "review-required"] }],
            source: { origin: "UCPath", detail: "A possible match returned by Smart HR and checked independently in Person Organizational Summary.", chain: [] } },
          { id: "candidate-employee-id", label: "Candidate Employee ID", example: "10000001",
            taskFields: [{ nodeId: "ucpath-source", kind: "output", fieldPath: "hits.emplId" }], when: [{ "hire-match": ["existing-person", "review-required"] }],
            source: { origin: "UCPath", detail: "The Employee ID retained with a possible match for the operator's hire review.", chain: [] } },
        ]
      }
    ],
    branchLabels: [],
    decisions: [{ id: "hire-match", label: "UCPath identity", reads: { nodeId: "hire-subject", fieldPath: "state" },
      nodeIds: ["ucpath-source", "hire-subject"], initial: { by: "mode", values: { rehire: "review-required" }, otherwise: "new-hire" },
      outcomes: [
        { value: "new-hire", label: "No existing person", then: "Looks up the I-9 profile before asking you to approve a new hire.", when: [{ mode: ["new-hire"] }] },
        { value: "existing-person", label: "Existing person confirmed", then: "Skips I-9 lookup and asks you to approve the existing person's hire.", when: [{ mode: ["new-hire"] }] },
        { value: "review-required", label: "Identity needs review", then: "Keeps the candidates for your hire review; only a new-hire run with no confirmed person looks up I-9." },
      ] }],
  } as const
});
const entries = defineStepEntries(group);

export function buildUcpathSearch(author: WorkflowAuthor<typeof OnboardingInput>, crm: ReturnType<typeof buildCrmData>) {
  const call = reuseTask(group, { id: "ucpath-source", contract: SearchPersonMatch, replay: "always-rerun" },
    (employee: HireEmployee) => ({ firstName: employee.firstName, lastName: employee.lastName,
      dob: `${employee.dob.slice(5, 7)}/${employee.dob.slice(8, 10)}/${employee.dob.slice(0, 4)}`,
      ...(employee.ssn === null ? {} : { ssn: employee.ssn }) }));
  const matches = author.task(call.identity, [crm.plan], ({ outputs }) => call.bind({ input: outputs["hire-plan"].employee }));
  const subject = author.task(entries.task("hire-subject", OnboardingMatchHireSubject, { replay: "always-rerun" }), [crm.plan, matches], ({ input, outputs }) => ({
    mode: input.mode, firstName: outputs["hire-plan"].employee.firstName, lastName: outputs["hire-plan"].employee.lastName,
    ssnSearched: outputs["hire-plan"].employee.ssn !== null, match: outputs["ucpath-source"],
  }));
  return { matches, subject, steps: [[group, [matches, subject]]] as const,
    result: author.result(OnboardingMatchHireSubject.output, [subject], ({ outputs }) => OnboardingMatchHireSubject.output.parse(outputs["hire-subject"])) };
}

export const onboardingUcpathSearchDefinition = defineStep({
  group, build: buildUcpathSearch,
  nodePurposes: [
    { nodeId: "ucpath-source", purpose: "Read UCPath duplicate candidates using the validated legal name and identifiers." },
    { nodeId: "hire-subject", purpose: "Keep unresolved UCPath identities separate from a new hire." },
  ],
  proof: {
    id: "onboarding-ucpath-search", order: 16,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), code: "onu", label: group.label, summary: parent.summary,
      steps: (author: WorkflowAuthor<typeof OnboardingInput>) => {
        const crm = buildCrmData(author);
        const ucpath = buildUcpathSearch(author, crm);
        return { steps: [...crm.steps, ...ucpath.steps], result: ucpath.result };
      },
    }),
  },
});
