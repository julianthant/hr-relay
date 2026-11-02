import { ReadMatchOutcome } from "../../../../models/workflows/i9-check/check.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { personOrgInput, searchPersonOrgTask } from "../../tasks/search-person-org.js";
import { i9CheckPersonMatchDefinition, personMatchEntries } from "../person-match/step.js";
export const personLookup = defineWorkflowStep({ key: "person-lookup", label: "Check hire date" });
type I9Author = WorkflowAuthor<typeof I9CheckInput>;
export function personLookupEntries({ task }: I9Author, matched: ReturnType<typeof personMatchEntries>) {
  return task(searchPersonOrgTask(personLookup, "name-search", { kind: "is-true", of: { from: "node", nodeId: "match-outcome", path: "shouldLookup" } }), [matched.initial], ({ input }) => personOrgInput(input));
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
