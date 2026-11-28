import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import { REFERENCE_CHECK_STEP, defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { i9CheckPersonMatchDefinition } from "../person-match/step.js";
import { i9CheckPersonLookupDefinition } from "../person-lookup/step.js";
import { i9CheckRosterMatchDefinition } from "../roster-match/step.js";

export const i9CheckReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP,
  proof: { id: "i9-check-reference-check", order: 37,
    build: (parent: WorkflowDefinition<typeof I9CheckInput>) => ({
      ...inheritStepProof(parent), ...(parent.referenceCheck === undefined ? {} : { referenceCheck: parent.referenceCheck }),
      code: "icrc", label: REFERENCE_CHECK_STEP.label,
      summary: "Proves the shared comparison against selected reference worksheets.",
      steps: (author: WorkflowAuthor<typeof I9CheckInput>) => {
        const matched = i9CheckPersonMatchDefinition.build(author), looked = i9CheckPersonLookupDefinition.build(author, matched);
        const roster = i9CheckRosterMatchDefinition.build(author, matched, looked);
        return { steps: [...matched.steps, ...looked.steps, ...roster.steps], result: roster.result };
      },
    }),
  },
});
