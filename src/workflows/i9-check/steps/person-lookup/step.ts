import { ReadMatchOutcome } from "../../../../models/workflows/i9-check/read-match-outcome.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../../../models/workflows/person-lookup/input.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { searchPersonOrgTask } from "../../tasks/search-person-org.js";
import { i9CheckPersonMatchDefinition, personMatchEntries } from "../person-match/step.js";
export const personLookup = Object.freeze({
  ...defineWorkflowStep({ key: "person-lookup", label: "Check hire date" }),
  review: {
    when: [{ "hire-date-needed": ["true"] }],
    pages: [
      {
        id: "person-org-search",
        title: "Person Organizational Summary search",
        mode: "Fill form",
        nodeIds: ["name-search"],
        lines: [
          { id: "search-hire-date", kind: "action", text: "When the initial match needs a lookup, search the person by name in UCPath.", nodeIds: ["name-search"] },
          { id: "search", kind: "click", target: "Search", nodeIds: ["name-search"] },
        ],
        fields: [
          { id: "name", label: "Name", inputField: "person.name", example: "Morrow, Bea",
            source: { origin: "Approved PDF record", detail: "The approved name used for the additional all-department search.", chain: [] } },
        ]
      },
      {
        id: "person-org-summary",
        title: "Person Organizational Summary detail",
        mode: "Read only",
        nodeIds: ["name-search"],
        lines: [
          { id: "read-candidates", kind: "read", text: "Read the candidate records and employment details used for the hire-date check.", nodeIds: ["name-search"] },
          { id: "all-departments", kind: "check", text: "Keep every department; compare candidate start or effective dates with the approved hire date within seven days.", nodeIds: ["name-search"] },
        ],
        fields: [
          { id: "hire-date", label: "Hire date", taskFields: [{ nodeId: "name-search", kind: "output", fieldPath: "results.startDate" }], example: "2020-06-15",
            source: { origin: "UCPath", detail: "Each candidate's start date, or effective date when start date is absent.", chain: [] } },
          { id: "candidate-id", label: "Employee ID", taskFields: [{ nodeId: "name-search", kind: "output", fieldPath: "results.emplId" }], example: PERSON_LOOKUP_EXAMPLE_EID,
            source: { origin: "UCPath", detail: "The Employee ID on a candidate's Person Organizational Summary record.", chain: [] } },
        ]
      }
    ],
    branchLabels: []
  } as const
});
type I9Author = WorkflowAuthor<typeof I9CheckInput>;
export function personLookupEntries({ task }: I9Author, matched: ReturnType<typeof personMatchEntries>) {
  const searchCall = searchPersonOrgTask(personLookup, "name-search", { kind: "is-true", of: { from: "node", nodeId: "match-outcome", path: "shouldLookup" } });
  return task(searchCall.identity, [matched.initial], searchCall.bind);
}
export function buildStep(author: I9Author, matched: ReturnType<typeof personMatchEntries>) {
  const search = personLookupEntries(author, matched);
  return {
    search, steps: [[personLookup, [search]]] as const,
    result: author.result(ReadMatchOutcome.output, [matched.initial, search], ({ outputs }) => outputs["match-outcome"])
  };
}
export const i9CheckPersonLookupDefinition = defineStep({
  group: personLookup, build: buildStep,
  proof: {
    id: "i9-check-person-lookup", order: 11,
    build: (parent: WorkflowDefinition<typeof I9CheckInput>) => ({
      ...inheritStepProof(parent),
      code: "icl", label: "Check hire date", summary: parent.summary,
      steps: (author: I9Author) => {
        const matched = i9CheckPersonMatchDefinition.build(author), looked = buildStep(author, matched);
        return { steps: [...matched.steps, ...looked.steps], result: looked.result };
      },
    }),
  },
});
