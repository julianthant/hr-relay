import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { contactEffectIdentity } from "../../../../models/systems/ucpath/emergency-contacts.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { EmergencyContactInputSchema } from "../../../../models/workflows/emergency-contact/input.js";
import { ReadEmergencyContactResult } from "../../../../models/workflows/emergency-contact/read-result.js";
import { EmergencyContactMemberResultSchema } from "../../../../models/workflows/emergency-contact/result.js";
import { WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { approvedEmergencyContact,contactEffect } from "../../../../rules/ucpath/emergency-contact.js";
import { TaskError } from "../../../../workflow-kit/errors.js";
import { approvedRecordHasEid,buildApprovedOcrRecords } from "../../../ocr/steps/source-pages/step.js";

import { ReadApprovedOcrSnapshot } from "../../../../models/processing/ocr/read-approved-snapshot.js";
import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
export const READ_DOCUMENT_STEP = Object.freeze({ key: "read-document", label: "Read and approve PDF", system: "local" as const,
  review: { pages: [], branchLabels: [] } as const,
});
export function buildEmergencyContactRecords(author: WorkflowAuthor<typeof EmergencyContactInputSchema>) {
  const graph = buildApprovedOcrRecords(author, { ocrInput: input => ({ ...input, formType: "emergency-contact" }),
      target: { id: WorkflowIdSchema.parse("emergency-contact-member"), input: EmergencyContactMemberInputSchema, result: EmergencyContactMemberResultSchema },
      memberSystem: "ucpath", memberLabel: "Preview approved Emergency Contacts", filter: approvedRecordHasEid,
      validate: records => {
        const employees = new Map<string, string>();
        for (const record of records) {
          let desired: string;
          try { desired = contactEffectIdentity(contactEffect(approvedEmergencyContact(record))); }
          catch { throw new TaskError(ReadEmergencyContactResult.id, "CONTACT_APPROVED_FIELDS_INVALID", ERROR_CATALOG.CONTACT_APPROVED_FIELDS_INVALID.text); }
          const employee = record.assertedEid;
          if (employee === null) throw new TaskError(ReadEmergencyContactResult.id, "CONTACT_APPROVED_FIELDS_INVALID", ERROR_CATALOG.CONTACT_APPROVED_FIELDS_INVALID.text);
          const previous = employees.get(employee);
          if (previous !== undefined && previous !== desired) throw new TaskError(ReadEmergencyContactResult.id,
            "CONTACT_APPROVED_PLAN_CONFLICT", ERROR_CATALOG.CONTACT_APPROVED_PLAN_CONFLICT.text);
          employees.set(employee, desired);
        }
      },
      memberInput: (_input, approved) => approved });
  return { ...graph, steps: [[READ_DOCUMENT_STEP, graph.steps[0][1]]] as const,
    result: author.result(ReadApprovedOcrSnapshot.output, [graph.approved], ({ outputs }) => outputs["approved-records"]) };
}
export const emergencyContactReadDocumentDefinition = defineStep({ group: READ_DOCUMENT_STEP, build: buildEmergencyContactRecords,
  proof: { id: "emergency-contact-read-document", order: 30,
    build: (parent: WorkflowDefinition<typeof EmergencyContactInputSchema>) => ({ ...inheritStepProof(parent), code: "ecr",
      label: "Emergency Contact approved PDF", summary: "Awaits OCR release and reads its authenticated immutable snapshot without contact members.",
      steps: (author: WorkflowAuthor<typeof EmergencyContactInputSchema>) => buildEmergencyContactRecords(author),
    }),
  },
});
