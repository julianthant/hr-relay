import { WorkStudyInput } from "../../../../models/workflows/work-study/input.js";
import { UcpathReadPayPathPosition } from "../../../../models/systems/ucpath/read-paypath-position.js";
import { REFERENCE_CHECK_STEP, defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { buildUcpathAuth } from "../ucpath-auth/step.js";

export const workStudyReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP,
  proof: { id: "work-study-reference-check", order: 35,
    build: (parent: WorkflowDefinition<typeof WorkStudyInput>) => ({
      ...inheritStepProof(parent), ...(parent.referenceCheck === undefined ? {} : { referenceCheck: parent.referenceCheck }),
      code: "wsr", label: REFERENCE_CHECK_STEP.label,
      summary: "Proves the shared comparison against selected reference worksheets.",
      steps: (author: WorkflowAuthor<typeof WorkStudyInput>) => {
        const read = buildUcpathAuth(author);
        return { steps: read.steps, result: author.result(UcpathReadPayPathPosition.output, [read.read], ({ outputs }) => outputs["paypath-position"]) };
      },
    }),
  },
});
