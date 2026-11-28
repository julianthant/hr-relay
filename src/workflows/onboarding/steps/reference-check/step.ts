import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { REFERENCE_CHECK_STEP, defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { buildCrmData } from "../crm-data/step.js";
import { buildUcpathSearch } from "../ucpath-search/step.js";
import { buildI9Search } from "../i9-search/step.js";
import { buildHireReview } from "../hire-review/step.js";

export const onboardingReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP,
  proof: { id: "onboarding-reference-check", order: 38,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), ...(parent.referenceCheck === undefined ? {} : { referenceCheck: parent.referenceCheck }),
      code: "onrc", label: REFERENCE_CHECK_STEP.label,
      summary: "Proves the shared comparison against selected reference worksheets.",
      steps: (author: WorkflowAuthor<typeof OnboardingInput>) => {
        const crm = buildCrmData(author), ucpath = buildUcpathSearch(author, crm), i9 = buildI9Search(author, crm, ucpath);
        const reviewed = buildHireReview(author, crm, ucpath, i9);
        return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps, ...reviewed.steps], result: ucpath.result };
      },
    }),
  },
});
