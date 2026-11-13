import { ReadMatchOutcome } from "../../../../models/workflows/i9-check/read-match-outcome.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { searchPersonMatchTask } from "../../tasks/search-person-match.js";
import { searchPersonOrgTask } from "../../tasks/search-person-org.js";
export const personMatch = Object.freeze({
  ...defineWorkflowStep({ key: "person-match", label: "Match person" }),
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
        nodeIds: ["initial-name-search"],
        lines: [{ id: "search", kind: "action", text: "Otherwise search by the person’s name.", nodeIds: ["initial-name-search"] }],
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
  return { matching, initialSearch, initial };
}
export function buildStep(author: I9Author) {
  const matched = personMatchEntries(author);
  return {
    ...matched, steps: [[personMatch, [matched.matching, matched.initialSearch, matched.initial]]] as const,
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
