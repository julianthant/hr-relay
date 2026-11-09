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
        fields: [
          {
            id: "emergency-contacts-contact-name",
            label: "Contact name",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.name" }],
            source: { origin: "Approved contact plan", detail: "The contact name from the approved PDF reading.", chain: [] }
          },
          {
            id: "emergency-contacts-relationship",
            label: "Relationship",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.relationship" }],
            source: { origin: "Approved contact plan", detail: "The approved relationship mapped to a supported UCPath option.", chain: [] }
          },
          {
            id: "emergency-contacts-phone",
            label: "Phone",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.phone" }],
            source: { origin: "Approved contact plan", detail: "The phone selected and validated from the approved contact fields.", chain: [] }
          },
          {
            id: "emergency-contacts-primary-contact",
            label: "Primary contact",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.primary" }],
            source: { origin: "Approved contact plan", detail: "The primary flag in the reviewed contact change.", chain: [] }
          },
          {
            id: "emergency-contacts-address-choice",
            label: "Address choice",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.address.kind" }],
            source: { origin: "Approved contact plan", detail: "The approved explicit, employee or unspecified address choice.", chain: [] }
          },
          {
            id: "emergency-contacts-address",
            label: "Address",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.address.fields.address1" }],
            source: { origin: "Approved contact plan", detail: "The approved contact address when an address is supplied.", chain: [] }
          },
          {
            id: "emergency-contacts-address-line-2",
            label: "Address line 2",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.address.fields.address2" }],
            source: { origin: "Approved contact plan", detail: "The approved second address line when supplied.", chain: [] }
          },
          {
            id: "emergency-contacts-city",
            label: "City",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.address.fields.city" }],
            source: { origin: "Approved contact plan", detail: "The approved contact city when supplied.", chain: [] }
          },
          {
            id: "emergency-contacts-state",
            label: "State",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.address.fields.state" }],
            source: { origin: "Approved contact plan", detail: "The approved contact state when supplied.", chain: [] }
          },
          {
            id: "emergency-contacts-postal-code",
            label: "Postal code",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.address.fields.postalCode" }],
            source: { origin: "Approved contact plan", detail: "The approved contact postal code when supplied.", chain: [] }
          },
          {
            id: "emergency-contacts-country",
            label: "Country",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.effect.address.fields.country" }],
            source: { origin: "Approved contact plan", detail: "The approved contact country when supplied.", chain: [] }
          },
          {
            id: "emergency-contacts-existing-primary-contact",
            label: "Existing primary contact",
            transactionFields: [{ nodeId: "contact-preview", kind: "input", fieldPath: "plan.demotion.effect.name" }],
            source: { origin: "Complete saved contact set", detail: "When needed, change only the existing primary contact identified by the reviewed plan.", chain: [] }
          }
        ]
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
