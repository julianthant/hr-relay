import { ReadMatchOutcome } from "../../../../models/workflows/i9-check/read-match-outcome.js";
import { ReadEmploymentCandidates } from "../../../../models/workflows/i9-check/read-employment-candidates.js";
import { z } from "zod";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { UsDateFactSchema, type StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../../../models/workflows/person-lookup/input.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { searchPersonOrgTask } from "../../tasks/search-person-org.js";
import { i9CheckPersonMatchDefinition, personMatchEntries } from "../person-match/step.js";

const CandidateFactsSchema = z.strictObject({ emplId: EidSchema.nullable(), name: z.string().min(1).nullable(), hireDate: UsDateFactSchema.nullable() });
const CANDIDATES_MANUAL: StepManualDeclaration = {
  off: "values",
  form: { allOrNone: true, fields: [
    { key: "emplId", label: "UCPath Employee ID", kind: "eid", optional: true, help: "Leave all three fields blank when UCPath shows no person by this name.", replaces: { nodeId: "employment-candidates", path: "candidates.0.emplId" } },
    { key: "name", label: "UCPath name", kind: "text", optional: true, replaces: { nodeId: "employment-candidates", path: "candidates.0.name" } },
    { key: "hireDate", label: "UCPath hire date", kind: "us-date", optional: true, help: "This candidate decides the identity only when Match person in UCPath did not find one person.", replaces: { nodeId: "employment-candidates", path: "candidates.0.hireDate" } },
  ] },
  produces: {
    "employment-candidates": ({ facts }) => {
      const typed = CandidateFactsSchema.parse(facts);
      if (typed.emplId === null && typed.name === null && typed.hireDate === null) return { candidates: [] };
      return { candidates: [typed] };
    },
  },
  skips: ["name-search"],
};

export const personLookup = Object.freeze({
  ...defineWorkflowStep({ key: "person-lookup", label: "Check hire date" }),
  manual: CANDIDATES_MANUAL,
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
        nodeIds: ["name-search", "employment-candidates"],
        lines: [
          { id: "search-hire-date", kind: "action", text: "When the initial match needs a lookup, search the person by name in UCPath.", nodeIds: ["name-search"] },
          { id: "read-candidates", kind: "read", text: "Read the candidate records and employment details used for the hire-date check.", nodeIds: ["name-search", "employment-candidates"] },
          { id: "all-departments", kind: "check", text: "Keep every department; compare candidate start or effective dates with the approved hire date within seven days.", nodeIds: ["name-search", "employment-candidates"] },
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
const lookup = defineStepEntries(personLookup);
export function personLookupEntries({ task }: I9Author, matched: ReturnType<typeof personMatchEntries>) {
  const searchCall = searchPersonOrgTask(personLookup, "name-search", { kind: "is-true", of: { from: "node", nodeId: "match-outcome", path: "shouldLookup" } });
  const search = task(searchCall.identity, [matched.initial], searchCall.bind);
  const candidates = task(lookup.task("employment-candidates", ReadEmploymentCandidates, { replay: "always-rerun", when: searchCall.identity.when }), [matched.initial, search], ({ outputs }) => {
    const search = outputs["name-search"];
    if (search === undefined) throw new Error("employment-candidates ran without the name-search it shares a condition with");
    return { search };
  });
  return { search, candidates };
}
export function buildStep(author: I9Author, matched: ReturnType<typeof personMatchEntries>) {
  const { search, candidates } = personLookupEntries(author, matched);
  return {
    search, candidates, steps: [[personLookup, [search, candidates]]] as const,
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
