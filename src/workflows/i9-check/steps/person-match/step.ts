import { ReadMatchOutcome } from "../../../../models/workflows/i9-check/read-match-outcome.js";
import { ReadEmploymentCandidates } from "../../../../models/workflows/i9-check/read-employment-candidates.js";
import { z } from "zod";
import { EidSchema } from "../../../../rules/identity/ids.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import { searchPersonMatchTask } from "../../tasks/search-person-match.js";
import { searchPersonOrgTask } from "../../tasks/search-person-org.js";

const MatchFactsSchema = z.strictObject({ status: z.enum(["found", "not-found"]), eid: EidSchema.nullable(), name: z.string().min(1).nullable() });
const MATCH_MANUAL: StepManualDeclaration = {
  form: { fields: [
    { key: "status", label: "Found in UCPath", kind: "enum", values: ["found", "not-found"], replaces: { nodeId: "match-outcome", path: "identity.status" } },
    { key: "eid", label: "Matched Employee ID", kind: "eid", optional: true, help: "Required when found.", replaces: { nodeId: "match-outcome", path: "identity.eid" } },
    { key: "name", label: "UCPath name", kind: "text", optional: true, help: "Required when found.", replaces: { nodeId: "match-outcome", path: "identity.name" } },
  ] },
  refine: facts => facts.status === "found" ? ["eid", "name"].filter(field => facts[field] === null).map(field => ({ field, message: "Required when found." })) : [],
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
            text: "When identifier matching is requested, search by name with the supplied date of birth or SSN.",
            nodeIds: ["identifier-match"]
          }
        ],
        fields: []
      },
      {
        id: "person-search",
        title: "Person Organizational Summary search",
        mode: "Fill form",
        nodeIds: ["initial-name-search", "initial-candidates"],
        lines: [{ id: "search", kind: "action", text: "Otherwise search by the person’s name.", nodeIds: ["initial-name-search"] },
          { id: "candidates", kind: "read", text: "Retain every candidate and the hire date used for corroboration.", nodeIds: ["initial-candidates"] }],
        fields: []
      },
      {
        id: "person-details",
        title: "Person Organizational Summary detail",
        mode: "Read only",
        nodeIds: ["identifier-match", "match-outcome"],
        lines: [
          {
            id: "confirm",
            kind: "check",
            text: "Confirm candidate identities and retain whether another lookup is needed.",
            nodeIds: ["identifier-match", "match-outcome"]
          }
        ],
        fields: []
      }
    ],
    branchLabels: []
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
