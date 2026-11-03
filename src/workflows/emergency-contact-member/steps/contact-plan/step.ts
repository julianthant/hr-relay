import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { ReadApprovedOcrRecord } from "../../../../models/processing/ocr/read-approved-record.js";
import { UcpathReadEmergencyContacts } from "../../../../models/systems/ucpath/read-emergency-contacts.js";
import type { RuntimeScope } from "../../../../models/workflow/graph.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { MapApprovedEmergencyContact } from "../../../../models/workflows/emergency-contact-member/read-approved-contact.js";
import { PlanApprovedEmergencyContact } from "../../../../models/workflows/emergency-contact-member/read-contact-plan.js";
import { TaskError } from "../../../../workflow-kit/errors.js";
import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";

export const CONTACT_PLAN_STEP = Object.freeze({ ...defineWorkflowStep({ key: "contact-plan", label: "Review approved contact plan" }), operatorFields: [
  { label: "Existing primary change", sources: [{ nodeId: "contact-plan", kind: "output", fieldPath: "demotionLine" }] },
  { label: "Approved contact", sources: [{ nodeId: "contact-plan", kind: "output", fieldPath: "contactLine" }] },
] as const, system: "ucpath" as const });
export function refuseUnavailableSave(dryRun: RuntimeScope["dryRun"]): void {
  if (dryRun === undefined) throw new TaskError(MapApprovedEmergencyContact.id, "CONTACT_SAVE_UNAVAILABLE", ERROR_CATALOG.CONTACT_SAVE_UNAVAILABLE.text);
}
export function buildContactPlan(author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) {
  const approved = author.task({ id: "approved-record", label: "Authenticate OCR release", contract: ReadApprovedOcrRecord, replay: "always-rerun" }, [], scope => {
    refuseUnavailableSave(scope.dryRun);
    return scope.input;
  });
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
