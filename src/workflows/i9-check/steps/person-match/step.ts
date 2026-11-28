import { ReadMatchOutcome } from "../../../../models/workflows/i9-check/read-match-outcome.js";
import { ReadEmploymentCandidates } from "../../../../models/workflows/i9-check/read-employment-candidates.js";
import { z } from "zod";
import { EidSchema } from "../../../../rules/identity/ids.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../../../models/workflows/person-lookup/input.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import { searchPersonMatchTask } from "../../tasks/search-person-match.js";
import { searchPersonOrgTask } from "../../tasks/search-person-org.js";

const MatchFactsSchema = z.strictObject({ status: z.enum(["found", "not-found"]), eid: EidSchema.nullable(), name: z.string().min(1).nullable() });
const whenFound = { field: "status", equals: "found" };
const MATCH_MANUAL: StepManualDeclaration = {
  off: "values",
  form: { fields: [
    { key: "status", label: "Found in UCPath", kind: "enum", values: ["found", "not-found"], replaces: { nodeId: "match-outcome", path: "identity.status" } },
    { key: "eid", label: "Matched Employee ID", kind: "eid", optional: true, requiredWhen: whenFound, help: "Required when found.", replaces: { nodeId: "match-outcome", path: "identity.eid" } },
    { key: "name", label: "UCPath name", kind: "text", optional: true, requiredWhen: whenFound, help: "Required when found.", replaces: { nodeId: "match-outcome", path: "identity.name" } },
  ] },
  produces: {
    "match-outcome": ({ facts }) => {
      const typed = MatchFactsSchema.parse(facts);
      return { identity: typed.status === "found" ? { status: "found", eid: requireFact(typed.eid, "match-outcome", "identity.eid"), name: requireFact(typed.name, "match-outcome", "identity.name") }
        : { status: "not-found", candidateCount: 0 }, shouldLookup: typed.status === "not-found" };
    },
    "initial-candidates": () => ({ candidates: [] }),
  },
  skips: ["identifier-match", "initial-name-search"],
};

export const personMatch = Object.freeze({
  ...defineWorkflowStep({ key: "person-match", label: "Match person" }),
  manual: MATCH_MANUAL,
  review: {
    pages: [
      {
        id: "smart-person-search",
        title: "Smart HR person search",
        mode: "Fill form",
        nodeIds: ["identifier-match"],
        lines: [
          {
            id: "match",
            kind: "action",
            text: "When the approved record has matching identifiers, search Smart HR by first and last name with the supplied identity details.",
            nodeIds: ["identifier-match"]
          },
          { id: "search", kind: "click", target: "Search", nodeIds: ["identifier-match"] },
        ],
        fields: [
          { id: "last-name", label: "Last name", inputField: "person.lastName", example: "Morrow",
            source: { origin: "Approved PDF record", detail: "The last name approved with this person's I-9 sections; this form is used only when matching identifiers are available.", chain: [] } },
          { id: "first-name", label: "First name", inputField: "person.firstName", example: "Bea",
            source: { origin: "Approved PDF record", detail: "The first name approved with this person's I-9 sections.", chain: [] } },
          { id: "dob", label: "Date of birth", inputField: "person.dob", example: "03/14/1990",
            source: { origin: "Approved PDF record", detail: "The approved date of birth, formatted for the matching search when supplied.", chain: [] } },
        ]
      },
      {
        id: "person-search",
        title: "Person Organizational Summary search",
        mode: "Fill form",
        nodeIds: ["initial-name-search"],
        lines: [
          { id: "search", kind: "action", text: "Without matching identifiers, search by the approved name and keep every department for the retention check.", nodeIds: ["initial-name-search"] },
          { id: "all-departments", kind: "check", text: "Keep non-HDH departments as well as HDH departments.", nodeIds: ["initial-name-search"] },
          { id: "click-search", kind: "click", target: "Search", nodeIds: ["initial-name-search"] },
        ],
        fields: [{ id: "name", label: "Name", inputField: "person.name", example: "Morrow, Bea",
          source: { origin: "Approved PDF record", detail: "The approved full name used when no matching identifiers are available.", chain: [] } }]
      },
      {
        id: "name-results",
        title: "Person Organizational Summary results",
        mode: "Read only",
        nodeIds: ["initial-name-search", "initial-candidates"],
        when: [{ "identifier-result": ["not-found"], "hire-date-needed": ["false"] }],
        lines: [
          { id: "read-candidates", kind: "read", text: "Read every candidate's Employee ID and hire date; the retention check compares them with the approved hire date.", nodeIds: ["initial-name-search", "initial-candidates"] },
        ],
        fields: [
          { id: "hire-date", label: "Hire date", taskFields: [{ nodeId: "initial-name-search", kind: "output", fieldPath: "results.startDate" }], example: "2020-06-15",
            source: { origin: "UCPath", detail: "Each candidate's start date, or effective date when start date is absent.", chain: [] } },
          { id: "candidate-id", label: "Employee ID", taskFields: [{ nodeId: "initial-name-search", kind: "output", fieldPath: "results.emplId" }], example: PERSON_LOOKUP_EXAMPLE_EID,
            source: { origin: "UCPath", detail: "The Employee ID on a candidate's Person Organizational Summary record; not yet confirmed as this person.", chain: [] } },
        ]
      },
      {
        id: "person-details",
        title: "Person Organizational Summary detail",
        mode: "Read only",
        nodeIds: ["identifier-match", "match-outcome"],
        when: [{ "identifier-result": ["found"] }],
        lines: [
          {
            id: "confirm",
            kind: "check",
            text: "Confirm candidate identities and retain whether another lookup is needed.",
            nodeIds: ["identifier-match", "match-outcome"]
          }
        ],
        fields: [
          { id: "employee-id", label: "Employee ID", taskFields: [{ nodeId: "match-outcome", kind: "output", fieldPath: "identity.eid" }], example: PERSON_LOOKUP_EXAMPLE_EID,
            source: { origin: "UCPath", detail: "The unique identity confirmed by the identifier search, when one is found.", chain: [] } },
          { id: "confirmed-name", label: "Confirmed name", taskFields: [{ nodeId: "match-outcome", kind: "output", fieldPath: "identity.name" }], example: "Morrow, Bea",
            source: { origin: "UCPath", detail: "The name confirmed in Person Organizational Summary for the identifier match.", chain: [] } },
        ]
      }
    ],
    branchLabels: [],
    decisions: [
      { id: "identifier-result", label: "Identifier match", reads: { nodeId: "match-outcome", fieldPath: "identity.status" },
        nodeIds: ["identifier-match", "initial-name-search", "match-outcome"], initial: "found", outcomes: [
          { value: "found", label: "One person confirmed", then: "Continues with the confirmed Employee ID." },
          { value: "ambiguous", label: "Several people match", then: "Searches all departments by name to pick the person whose hire date matches." },
          { value: "not-found", label: "No confirmed match", then: "Continues with a name search: the one already read when no matching identifiers were supplied, otherwise a further search." },
        ] },
      { id: "hire-date-needed", label: "Further hire-date lookup", reads: { nodeId: "match-outcome", fieldPath: "shouldLookup" },
        nodeIds: ["match-outcome"], initial: { by: "identifier-result", values: { ambiguous: "true" }, otherwise: "false" }, outcomes: [
          { value: "false", label: "No further name search", then: "Continues with the confirmed match, or with the name search already read.",
            when: [{ "identifier-result": ["found", "not-found"] }] },
          { value: "true", label: "Identifier match unresolved", then: "Searches all departments by name to corroborate the approved hire date.",
            when: [{ "identifier-result": ["ambiguous", "not-found"] }] },
        ] },
    ],
  } as const
});
type I9Author = WorkflowAuthor<typeof I9CheckInput>;
const match = defineStepEntries(personMatch);
export function personMatchEntries({ task }: I9Author) {
  const matchCall = searchPersonMatchTask(personMatch);
  const matching = task(matchCall.identity, [], matchCall.bind);
  const searchCall = searchPersonOrgTask(personMatch, "initial-name-search", { kind: "is-false", of: { from: "input", path: "person.useMatch" } });
  const initialSearch = task(searchCall.identity, [], searchCall.bind);
  const initial = task(match.task("match-outcome", ReadMatchOutcome, { replay: "always-rerun" }), [matching, initialSearch], ({ outputs }) => ({ match: outputs["identifier-match"] }));
  const candidates = task(match.task("initial-candidates", ReadEmploymentCandidates, { replay: "always-rerun", when: searchCall.identity.when }), [initialSearch], ({ outputs }) => {
    const search = outputs["initial-name-search"];
    if (search === undefined) throw new Error("initial-candidates ran without the initial-name-search it shares a condition with");
    return { search };
  });
  return { matching, initialSearch, initial, candidates };
}
export function buildStep(author: I9Author) {
  const matched = personMatchEntries(author);
  return {
    ...matched, steps: [[personMatch, [matched.matching, matched.initialSearch, matched.initial, matched.candidates]]] as const,
    result: author.result(ReadMatchOutcome.output, [matched.initial], ({ outputs }) => outputs["match-outcome"])
  };
}
export const i9CheckPersonMatchDefinition = defineStep({
  group: personMatch, build: buildStep,
  proof: {
    id: "i9-check-person-match", order: 10,
    build: (parent: WorkflowDefinition<typeof I9CheckInput>) => ({
      ...inheritStepProof(parent),
      code: "icm", label: "Match person", summary: parent.summary,
      steps: buildStep,
    }),
  },
});
