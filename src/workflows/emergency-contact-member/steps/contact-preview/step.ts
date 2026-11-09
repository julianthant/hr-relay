import { UcpathSaveEmergencyContact } from "../../../../models/systems/ucpath/save-emergency-contact.js";
import { UcpathStageEmergencyContact } from "../../../../models/systems/ucpath/stage-emergency-contact.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { EmergencyContactMemberResultSchema } from "../../../../models/workflows/emergency-contact/result.js";
import { defineStep,defineStepEntries,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildContactPlan } from "../contact-plan/step.js";

export const CONTACT_PREVIEW_STEP = Object.freeze({ ...defineWorkflowStep({ key: "contact-preview", label: "Preview primary contact changes" }), system: "ucpath" as const,
  review: {
    pages: [
      {
        id: "emergency-contacts",
        title: "Emergency Contacts",
        mode: "Fill form",
        nodeIds: ["contact-preview"],
        lines: [
          { id: "verify-contact-set", kind: "check", text: "Confirm the saved contact set still matches the approved plan.", nodeIds: ["contact-preview"] },
          { id: "stage-primary-changes", kind: "action", text: "Fill the ordered primary contact changes in the editor.", nodeIds: ["contact-preview"] },
          { id: "inspect-staged-contact", kind: "check", text: "Read the contact set back and verify the prepared changes.", nodeIds: ["contact-preview"] },
          { id: "save-contact", kind: "action", text: "In a live run, save the reviewed contact changes.", nodeIds: ["contact-preview"] }
        ],
        fields: []
      }
    ],
    branchLabels: []
  } as const,
});
const entry = defineStepEntries(CONTACT_PREVIEW_STEP).transaction("contact-preview", { label: "Prepare ordered primary contact changes",
  prepare: UcpathStageEmergencyContact, commit: UcpathSaveEmergencyContact, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 45_000 });
export function buildContactPreview(author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>, upstream: ReturnType<typeof buildContactPlan>) {
  const preview = author.transaction(entry, [upstream.plan], {
    prepareBind: ({ outputs }) => outputs["contact-plan"].target,
    commitBind: ({ outputs }) => outputs["contact-plan"].target,
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
