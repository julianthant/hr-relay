import { PersonLookupInput } from "../../../../models/workflows/person-lookup/input.js";
import { REFERENCE_CHECK_STEP, defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { buildSearching } from "../searching/step.js";
import { buildCrossVerify } from "../cross-verify/step.js";
import { buildActiveStatus } from "../active-status/step.js";
import { buildCrmDates } from "../crm-dates/step.js";

export const personLookupReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP,
  proof: { id: "person-lookup-reference-check", order: 34,
    build: (parent: WorkflowDefinition<typeof PersonLookupInput>) => ({
      ...inheritStepProof(parent), ...(parent.referenceCheck === undefined ? {} : { referenceCheck: parent.referenceCheck }),
      code: "plr", label: REFERENCE_CHECK_STEP.label,
      summary: "Proves the shared comparison against selected reference worksheets.",
      steps: (author: WorkflowAuthor<typeof PersonLookupInput>) => {
        const searching = buildSearching(author), crossverify = buildCrossVerify(author, searching);
        const activestatus = buildActiveStatus(author, searching, crossverify), crmdates = buildCrmDates(author, searching, crossverify, activestatus);
        return { steps: [...searching.steps, ...crossverify.steps, ...activestatus.steps, ...crmdates.steps], result: crmdates.result };
      },
    }),
  },
});
