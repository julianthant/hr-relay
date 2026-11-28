import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { PlanApprovedEmergencyContact } from "../../../../models/workflows/emergency-contact-member/read-contact-plan.js";
import { REFERENCE_CHECK_STEP, defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { buildContactPlan } from "../contact-plan/step.js";

export const emergencyContactMemberReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP,
  proof: { id: "emergency-contact-member-reference-check", order: 39,
    build: (parent: WorkflowDefinition<typeof EmergencyContactMemberInputSchema>) => ({
      ...inheritStepProof(parent), ...(parent.referenceCheck === undefined ? {} : { referenceCheck: parent.referenceCheck }),
      code: "ecrc", label: REFERENCE_CHECK_STEP.label,
      summary: "Proves the shared comparison against selected reference worksheets.",
      steps: (author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) => {
        const plan = buildContactPlan(author);
        return { steps: plan.steps, result: author.result(PlanApprovedEmergencyContact.output, [plan.plan], ({ outputs }) => outputs["contact-plan"]) };
      },
    }),
  },
});
