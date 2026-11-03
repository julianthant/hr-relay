import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { UcpathSaveEmergencyContact, UcpathStageEmergencyContact } from "../../../../models/systems/ucpath/contact-tasks.js";
import { EmergencyContactMemberResultSchema } from "../../../../models/workflows/emergency-contact/result.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowDefinition, type WorkflowAuthor } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildContactPlan, refuseUnavailableSave } from "../contact-plan/step.js";

export const CONTACT_PREVIEW_STEP = Object.freeze({ ...defineWorkflowStep({ key: "contact-preview", label: "Preview primary contact changes" }), system: "ucpath" as const });
const entry = defineStepEntries(CONTACT_PREVIEW_STEP).transaction("contact-preview", { label: "Prepare ordered primary contact changes",
  prepare: UcpathStageEmergencyContact, commit: UcpathSaveEmergencyContact, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 45_000 });
export function buildContactPreview(author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>, upstream: ReturnType<typeof buildContactPlan>) {
  const preview = author.transaction(entry, [upstream.plan], {
    prepareBind: ({ outputs }) => outputs["contact-plan"].target,
    commitBind: scope => { refuseUnavailableSave(scope.dryRun); return scope.outputs["contact-plan"].target; },
  });
  return { steps: [[CONTACT_PREVIEW_STEP, [preview]]] as const, result: author.result(EmergencyContactMemberResultSchema, [preview], ({ outputs }) =>
    ({ disposition: outputs["contact-preview"].disposition, proof: outputs["contact-preview"].output.proof })) };
}
export const contactPreviewDefinition = defineStep({ group: CONTACT_PREVIEW_STEP, build: buildContactPreview,
  proof: { id: "emergency-contact-member-contact-preview", order: 29,
    build: (parent: WorkflowDefinition<typeof EmergencyContactMemberInputSchema>) => ({ ...inheritStepProof(parent), code: "ecv",
      label: "Emergency Contact preview", summary: "Prepares the approved primary contact changes through the ordinary transaction preview.",
      steps: (author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) => {
        const plan = buildContactPlan(author), preview = buildContactPreview(author, plan);
        return { steps: [...plan.steps, ...preview.steps], result: preview.result };
      },
    }),
  },
});
