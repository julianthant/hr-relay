import { ReadApprovedOcrRecord } from "../../../../models/processing/ocr/read-approved-record.js";
import { UcpathReadEmergencyContacts } from "../../../../models/systems/ucpath/read-emergency-contacts.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { MapApprovedEmergencyContact } from "../../../../models/workflows/emergency-contact-member/read-approved-contact.js";
import { PlanApprovedEmergencyContact } from "../../../../models/workflows/emergency-contact-member/read-contact-plan.js";
import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";

export const CONTACT_PLAN_STEP = Object.freeze({ ...defineWorkflowStep({ key: "contact-plan", label: "Review approved contact plan" }), operatorFields: [
  { label: "Existing primary change", sources: [{ nodeId: "contact-plan", kind: "output", fieldPath: "demotionLine" }] },
  { label: "Approved contact", sources: [{ nodeId: "contact-plan", kind: "output", fieldPath: "contactLine" }] },
] as const, system: "ucpath" as const,
  review: {
    pages: [
      {
        id: "emergency-contacts",
        title: "Emergency Contacts",
        mode: "Read only",
        nodeIds: ["approved-record", "map-contact", "read-contacts", "contact-plan"],
        lines: [
          { id: "authenticate-approval", kind: "check", text: "Check that this contact comes from the approved PDF reading.", nodeIds: ["approved-record"] },
          { id: "map-contact-fields", kind: "read", text: "Read the approved name, relationship, phone and address for UCPath.", nodeIds: ["map-contact"] },
          { id: "read-saved-contacts", kind: "read", text: "Read the complete saved contact set and identify the current primary contact.", nodeIds: ["read-contacts"] },
          {
            id: "plan-primary-changes",
            kind: "check",
            text: "Compare the approved contact with saved contacts and plan the primary contact changes.",
            nodeIds: ["contact-plan"]
          }
        ],
        fields: [
          {
            id: "existing-primary-change",
            operatorField: "Existing primary change",
            source: {
              origin: "UCPath",
              detail: "The planned demotion of the existing primary contact, or the explicit statement that none is needed.",
              read: { stepKey: "contact-plan", page: "Emergency Contacts", field: "Existing primary change" },
              chain: [
                { label: "Saved contact set", detail: "Read every saved emergency contact and its primary flag." },
                { label: "Contact plan", detail: "Describe the change to the existing primary contact after comparing all saved contacts." }
              ]
            }
          },
          {
            id: "approved-contact",
            operatorField: "Approved contact",
            source: {
              origin: "Approved OCR record",
              detail: "The approved contact line selected for the primary contact plan.",
              read: { stepKey: "contact-plan", page: "Emergency Contacts", field: "Approved contact" },
              chain: [
                { label: "OCR approval", detail: "Use the contact selected in the approved PDF reading." },
                { label: "Mapped contact", detail: "Map the approved name, relationship, phone and address for UCPath." },
                { label: "Contact plan", detail: "Describe the new primary contact after comparing it with the saved contacts." }
              ]
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
});
export function buildContactPlan(author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) {
  const approved = author.task({ id: "approved-record", label: "Authenticate OCR release", contract: ReadApprovedOcrRecord, replay: "always-rerun" }, [], ({ input }) => input);
  const mapped = author.task({ id: "map-contact", label: "Map approved contact fields", contract: MapApprovedEmergencyContact, replay: "always-rerun" }, [approved], ({ input, outputs }) =>
    ({ ...input, record: outputs["approved-record"].record }));
  const contacts = author.task({ id: "read-contacts", label: "Read complete saved contact set", contract: UcpathReadEmergencyContacts, replay: "always-rerun" }, [mapped, approved], ({ outputs }) => ({ emplId: outputs["map-contact"].emplId, expectedName: outputs["map-contact"].expectedName }));
  const plan = author.task({ id: "contact-plan", label: "Declare ordered primary changes", contract: PlanApprovedEmergencyContact, replay: "always-rerun" }, [mapped, contacts], ({ outputs }) => ({ contact: outputs["map-contact"], contacts: outputs["read-contacts"].contacts }));
  return { plan, steps: [[CONTACT_PLAN_STEP, [approved, mapped, contacts, plan]]] as const };
}
export const contactPlanDefinition = defineStep({ group: CONTACT_PLAN_STEP, build: buildContactPlan,
  proof: { id: "emergency-contact-member-contact-plan", order: 28,
    build: (parent: WorkflowDefinition<typeof EmergencyContactMemberInputSchema>) => ({ ...inheritStepProof(parent), code: "ecp",
      label: "Emergency Contact plan", summary: "Authenticates one OCR member and declares ordered contact changes without preparation.",
      steps: (author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) => {
        const plan = buildContactPlan(author);
        return { steps: plan.steps, result: author.result(PlanApprovedEmergencyContact.output, [plan.plan], ({ outputs }) => outputs["contact-plan"]) };
      },
    }),
  },
});
