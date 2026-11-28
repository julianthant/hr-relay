import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { ocrRecordSourcePages } from "../../../../models/ocr/review-record.js";
import { contactEffectIdentity } from "../../../../models/systems/ucpath/emergency-contacts.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { EmergencyContactInputSchema } from "../../../../models/workflows/emergency-contact/input.js";
import { ReadEmergencyContactResult } from "../../../../models/workflows/emergency-contact/read-result.js";
import { EmergencyContactMemberResultSchema } from "../../../../models/workflows/emergency-contact/result.js";
import { WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { approvedEmergencyContact,contactEffect } from "../../../../rules/ucpath/emergency-contact.js";
import { chooseOcrRoster } from "../../../../rules/spreadsheets/ocr-roster.js";
import { WORKSHEET_ROW_CHOICE_GATE } from "../../../../models/processing/workbooks/reference-choice.js";
import { TaskError } from "../../../../workflow-kit/errors.js";
import { approvedRecordHasEid,buildApprovedOcrRecords } from "../../../ocr/steps/source-pages/step.js";

import { ReadApprovedOcrSnapshot } from "../../../../models/processing/ocr/read-approved-snapshot.js";
import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
export const READ_DOCUMENT_STEP = Object.freeze({ key: "read-document", label: "Read and approve PDF", system: "local" as const,
  review: { pages: [{ id: "approved-pdf", title: "Emergency Contact PDF", mode: "Read only", nodeIds: [WORKSHEET_ROW_CHOICE_GATE, "read-roster-choice", "read-document", "approved-records"],
    lines: [
      { id: "read-and-approve", kind: "read", text: "Read the uploaded PDF and wait for you to review and approve its records in Logs.", nodeIds: ["read-document"] },
      { id: "approved-selection", kind: "check", text: "Use only the current approved records and their original PDF pages.", nodeIds: ["approved-records"] },
    ], fields: [{ id: "pdf", label: "PDF", inputField: "fileName", example: "Fictional emergency-contact.pdf",
      source: { origin: "PDF upload", detail: "The PDF attached when this run starts.", chain: [] } }],
  }], branchLabels: [], starts: [{ nodeId: "read-document", each: "This PDF" }] } as const,
});
export function buildEmergencyContactRecords(author: WorkflowAuthor<typeof EmergencyContactInputSchema>) {
  const graph = buildApprovedOcrRecords(author, { ocrInput: ({ onbaseFiling: _onbaseFiling, rosterChoice, ...input }, choice) => ({
      ...input, roster: chooseOcrRoster({ ...input, rosterChoice }, choice), formType: "emergency-contact" }),
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
      // An earlier record of the same person on the same first page already files it: OnBase admits one filing per employee, PDF and page.
      memberInput: (input, approved, ocr, records) => {
        const filing = (record: typeof approved.record) => ({ emplId: approvedEmergencyContact(record).emplId, page: ocrRecordSourcePages(ocr.review.records, record)[0] });
        const own = filing(approved.record), index = records.findIndex(record => record.recordId === approved.record.recordId);
        const filed = records.slice(0, index).some(record => { const other = filing(record); return other.emplId === own.emplId && other.page === own.page; });
        return { ...approved, document: input.document, sourcePage: filed ? null : own.page, onbaseFiling: input.onbaseFiling };
      } });
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
