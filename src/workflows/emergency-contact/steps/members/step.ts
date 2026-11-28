import { z } from "zod";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { EmergencyContactInputSchema } from "../../../../models/workflows/emergency-contact/input.js";
import { ReadEmergencyContactResult } from "../../../../models/workflows/emergency-contact/read-result.js";
import { EmergencyContactResultSchema } from "../../../../models/workflows/emergency-contact/result.js";
import { TaskError } from "../../../../workflow-kit/errors.js";

import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { buildEmergencyContactRecords } from "../read-document/step.js";

const resultSchema = z.union([EmergencyContactResultSchema, z.strictObject({ state: z.literal("stopped"), reason: z.literal("existing-contacts-not-read") })]);

export const MEMBERS_STEP = Object.freeze({ key: "members", label: "Preview approved Emergency Contacts", system: "ucpath" as const,
  manual: { off: "values", stop: "Stops without reading the existing contacts.", form: { fields: [] }, produces: {}, skips: ["members", "read-result"] } satisfies StepManualDeclaration,
  review: { pages: [{ id: "approved-people", title: "Approved people", mode: "Read only", nodeIds: ["members", "read-result"],
    lines: [
      { id: "start-members", kind: "action", text: "Start a separate contact run for each approved person with an Employee ID.", nodeIds: ["members"] },
      { id: "account-for-members", kind: "check", text: "Retain each person's result, including failed contacts, without saving a completed contact again.", nodeIds: ["read-result"] },
    ], fields: [],
  }], branchLabels: [], starts: [{ nodeId: "members", each: "Each approved person" }],
    outcomes: [{ nodeId: "members", value: "child-failed", then: "Retains each failed person's result for review in Logs alongside completed contacts. Retry only the failed person when retry is allowed; completed contacts are not saved again." }],
  } as const,
});
export function buildEmergencyContactMembers(author: WorkflowAuthor<typeof EmergencyContactInputSchema>, upstream: ReturnType<typeof buildEmergencyContactRecords>) {
    const settled = author.task({ id: "read-result", label: "Account for approved members", contract: ReadEmergencyContactResult, replay: "always-rerun" }, [upstream.ocr, upstream.members], ({ outputs }) => {
      const ocr = outputs["read-document"];
      if (ocr.state !== "done" || ocr.output.approvedSnapshot === null) throw new TaskError(ReadEmergencyContactResult.id, "OCR_REVIEW_REFUSED", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
      return { approval: ocr.output.approvedSnapshot, members: [...outputs.members] };
    });
    return { steps: [[MEMBERS_STEP, [upstream.members, settled]]] as const,
      result: author.result(resultSchema, [settled], ({ outputs }): z.input<typeof resultSchema> =>
        outputs["read-result"] ?? { state: "stopped", reason: "existing-contacts-not-read" }) };
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
