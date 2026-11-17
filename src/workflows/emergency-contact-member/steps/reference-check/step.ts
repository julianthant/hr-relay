import { z } from "zod";
import { REFERENCE_CHECK_REVIEW_GATE, ReferenceCheckReviewSchema } from "../../../../models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK, VerifyWorkbookPerson } from "../../../../models/processing/workbooks/verify-person.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { EmergencyContactMemberReadReferenceStop } from "../../../../models/workflows/emergency-contact-member/read-reference-stop.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { REFERENCE_STOP_NODE } from "../../tasks/read-reference-stop.js";
import { buildContactPlan } from "../contact-plan/step.js";

export const REFERENCE_CHECK_NODE = "reference-check";

export const REFERENCE_CHECK_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "reference-check", label: "Check reference spreadsheets" }), system: "local" as const,
  description: "Look the employee's Employee ID up in each picked reference spreadsheet, and ask before saving their contact when one does not confirm them.",
  operatorFields: [
    { label: "Reference spreadsheet", visibility: "logs", sources: [{ nodeId: REFERENCE_CHECK_NODE, kind: "output", fieldPath: "checks.line" }] },
  ] as const,
  review: {
    pages: [{
      id: "reference-spreadsheets", title: "Reference spreadsheets", mode: "Read only", nodeIds: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE],
      lines: [
        { id: "check-person", kind: "check", text: "Confirm the Employee ID, and the name when the sheet has one, in each picked spreadsheet.", nodeIds: [REFERENCE_CHECK_NODE] },
        { id: "ask-before-saving", kind: "check", text: "In a live run, ask before saving when a picked spreadsheet does not hold the employee or names them differently.", nodeIds: [REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE] },
      ],
      fields: [],
    }],
    branchLabels: [],
  } as const,
});

const entries = defineStepEntries(REFERENCE_CHECK_STEP);
const checkEntry = entries.task(REFERENCE_CHECK_NODE, VerifyWorkbookPerson, {
  label: "Check reference spreadsheets", replay: "checkpoint", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});
const stopEntry = entries.task(REFERENCE_STOP_NODE, EmergencyContactMemberReadReferenceStop, {
  label: "Decide whether to ask before saving", replay: "always-rerun", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});
const reviewEntry = entries.operatorGate(REFERENCE_CHECK_REVIEW_GATE, {
  label: "Review the reference spreadsheets", statusKey: "awaitingReferenceCheckReview", result: ReferenceCheckReviewSchema,
  when: { kind: "is-present", of: { from: "node", nodeId: REFERENCE_STOP_NODE, path: "ask" } },
});

/** `check` is null when the run picked no reference spreadsheet and the check was skipped. */
const ReferenceCheckStepResultSchema = z.strictObject({ check: VerifyWorkbookPerson.output.nullable() });

/** Checks the employee the approved record names; the contact Save waits for the review this returns. */
export function buildReferenceCheck(author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>, plan: ReturnType<typeof buildContactPlan>) {
  const check = author.task(checkEntry, [plan.mapped], ({ outputs }) => ({
    typeId: REFERENCE_CHECK.id, eid: outputs["map-contact"].emplId, name: outputs["map-contact"].expectedName,
  }));
  const stop = author.task(stopEntry, [check], ({ outputs, dryRun }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null, writes: dryRun === undefined }));
  const review = author.gate(reviewEntry, [stop]);
  return { check, review, steps: [[REFERENCE_CHECK_STEP, [check, stop, review]]] as const,
    result: author.result(ReferenceCheckStepResultSchema, [check], ({ outputs }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null })) };
}

export const emergencyContactMemberReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP, build: buildReferenceCheck,
  proof: { id: "emergency-contact-member-reference-check", order: 39,
    build: (parent: WorkflowDefinition<typeof EmergencyContactMemberInputSchema>) => ({ ...inheritStepProof(parent), code: "ecrc",
      label: REFERENCE_CHECK_STEP.label, summary: "Authenticates one OCR member and checks its employee against the picked reference spreadsheets.",
      steps: (author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) => {
        const plan = buildContactPlan(author), reference = buildReferenceCheck(author, plan);
        return { steps: [...plan.steps, ...reference.steps], result: reference.result };
      },
    }),
  },
});
