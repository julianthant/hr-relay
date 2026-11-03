import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { EmergencyContactInputSchema } from "../../../../models/workflows/emergency-contact/input.js";
import { ReadEmergencyContactResult } from "../../../../models/workflows/emergency-contact/read-result.js";
import { EmergencyContactResultSchema } from "../../../../models/workflows/emergency-contact/result.js";
import { TaskError } from "../../../../workflow-kit/errors.js";

import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { buildEmergencyContactRecords } from "../read-document/step.js";
export const MEMBERS_STEP = Object.freeze({ key: "members", label: "Preview approved Emergency Contacts", system: "ucpath" as const });
export function buildEmergencyContactMembers(author: WorkflowAuthor<typeof EmergencyContactInputSchema>, upstream: ReturnType<typeof buildEmergencyContactRecords>) {
    const settled = author.task({ id: "read-result", label: "Account for approved members", contract: ReadEmergencyContactResult, replay: "always-rerun" }, [upstream.ocr, upstream.members], ({ outputs }) => {
      const ocr = outputs["read-document"];
      if (ocr.state !== "done" || ocr.output.approvedSnapshot === null) throw new TaskError(ReadEmergencyContactResult.id, "OCR_REVIEW_REFUSED", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
      return { approval: ocr.output.approvedSnapshot, members: [...outputs.members] };
    });
    return { steps: [[MEMBERS_STEP, [upstream.members, settled]]] as const,
      result: author.result(EmergencyContactResultSchema, [settled], ({ outputs }) => outputs["read-result"]) };
}
export const emergencyContactMembersDefinition = defineStep({ group: MEMBERS_STEP, build: buildEmergencyContactMembers,
  proof: { id: "emergency-contact-members", order: 31,
    build: (parent: WorkflowDefinition<typeof EmergencyContactInputSchema>) => ({ ...inheritStepProof(parent), code: "ecb",
      label: "Emergency Contact members", summary: "Proves released-record member admission and exact typed terminal accounting.",
      steps: (author: WorkflowAuthor<typeof EmergencyContactInputSchema>) => {
        const records = buildEmergencyContactRecords(author), members = buildEmergencyContactMembers(author, records);
        return { steps: [...records.steps, ...members.steps], result: members.result };
      },
    }),
  },
});
