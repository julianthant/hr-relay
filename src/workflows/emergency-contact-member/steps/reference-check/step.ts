import { z } from "zod";
import { REFERENCE_CHECK_REVIEW_GATE, ReferenceCheckReviewSchema } from "../../../../models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK, VerifyWorkbookPerson } from "../../../../models/processing/workbooks/verify-person.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { EmergencyContactMemberReadReferenceStop } from "../../../../models/workflows/emergency-contact-member/read-reference-stop.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { REFERENCE_STOP_NODE } from "../../tasks/read-reference-stop.js";
import { buildContactPlan } from "../contact-plan/step.js";

export const REFERENCE_CHECK_NODE = "reference-check";

export const REFERENCE_CHECK_MANUAL: StepManualDeclaration = {
  off: "values",
  ownStartOnly: true,
  form: { fields: [{ key: "referenceResult", label: "Reference spreadsheet result", kind: "enum", values: ["Confirmed", "Unconfirmed", "Not checked"] }] },
  produces: {
    [REFERENCE_STOP_NODE]: ({ facts, scope }) => ({ ask: scope.dryRun === undefined && facts.referenceResult !== "Confirmed" ? true : null }),
  },
  skips: [REFERENCE_CHECK_NODE],
  keeps: [REFERENCE_CHECK_REVIEW_GATE],
};

export const REFERENCE_CHECK_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "reference-check", label: "Check reference spreadsheets" }), system: "local" as const,
  manual: REFERENCE_CHECK_MANUAL,
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
    decisions: [
      { id: "reference-result", label: "Reference spreadsheet result", reads: { nodeId: REFERENCE_CHECK_NODE, fieldPath: "result" },
        nodeIds: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE], initial: "confirmed", outcomes: [
          { value: "confirmed", label: "Person confirmed" },
          { value: "unconfirmed", label: "Person not confirmed", then: "In a live run, waits for your review before saving. A dry run continues to the preview." },
          { value: "no-person", label: "No person to check", then: "Continues without a reference match." },
        ] },
      { id: "reference-review", label: "Review reference spreadsheets", reads: { nodeId: REFERENCE_CHECK_REVIEW_GATE, fieldPath: "decision" },
        nodeIds: [REFERENCE_CHECK_REVIEW_GATE], when: [{ "dry-run": ["false"], "reference-result": ["unconfirmed"] }], initial: "continue",
        outcomes: [{ value: "continue", label: "Continue anyway", then: "Continues to the contact Save despite the unconfirmed reference spreadsheets." }],
        cancellation: { label: "Cancel run", then: "Cancels this person's run before the contact Save or OnBase filing." } },
    ],
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
