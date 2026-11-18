import { z } from "zod";
import { REFERENCE_CHECK_REVIEW_GATE, ReferenceCheckReviewSchema } from "../../../../models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK, VerifyWorkbookPerson } from "../../../../models/processing/workbooks/verify-person.js";
import { WorkStudyInput } from "../../../../models/workflows/work-study/input.js";
import { WorkStudyReadReferenceStop } from "../../../../models/workflows/work-study/read-reference-stop.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { PAYPATH_POSITION_NODE } from "../../tasks/read-paypath-position.js";
import { REFERENCE_STOP_NODE } from "../../tasks/read-reference-stop.js";
import { buildUcpathAuth } from "../ucpath-auth/step.js";

export const REFERENCE_CHECK_NODE = "reference-check";

export const REFERENCE_CHECK_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "reference-check", label: "Check reference spreadsheets" }), system: "local" as const,
  description: "Look the employee's Employee ID up in each picked reference spreadsheet, and ask before filing when one does not confirm them.",
  operatorFields: [
    { label: "Reference spreadsheet", visibility: "logs", sources: [{ nodeId: REFERENCE_CHECK_NODE, kind: "output", fieldPath: "checks.line" }] },
  ] as const,
  review: {
    pages: [{
      id: "reference-spreadsheets", title: "Reference spreadsheets", mode: "Read only", nodeIds: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE],
      lines: [
        { id: "check-person", kind: "check", text: "Confirm the Employee ID, and the name when the sheet has one, in each picked spreadsheet.", nodeIds: [REFERENCE_CHECK_NODE] },
        { id: "ask-before-filing", kind: "check", text: "In a live run, ask before filing when a picked spreadsheet does not hold the employee or names them differently.", nodeIds: [REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE] },
      ],
      fields: [{ id: "reference-line", label: "Reference spreadsheet", example: "Example eligibility · Awards: name differs in row 3",
        taskFields: [{ nodeId: REFERENCE_CHECK_NODE, kind: "output", fieldPath: "checks.line" }],
        source: { origin: "Picked reference spreadsheets", detail: "The Employee ID and name check against the spreadsheet versions picked for this run.", chain: [] } }],
    }],
    branchLabels: [],
    decisions: [
      { id: "reference-result", label: "Reference check", reads: { nodeId: REFERENCE_CHECK_NODE, fieldPath: "result" },
        nodeIds: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE], initial: "confirmed", outcomes: [
          { value: "confirmed", label: "Person confirmed", then: "Continues to the planned PayPath transaction." },
          { value: "unconfirmed", label: "Person not confirmed", then: "In a live run, waits for your review in Logs before filing; a dry run continues without asking." },
          { value: "no-person", label: "No person to check", then: "Continues without a reference match." },
        ] },
      { id: "reference-check-review", label: "Review reference spreadsheets", reads: { nodeId: REFERENCE_CHECK_REVIEW_GATE, fieldPath: "decision" },
        nodeIds: [REFERENCE_CHECK_REVIEW_GATE], initial: "continue", when: [{ "dry-run": ["false"], "reference-result": ["unconfirmed"] }],
        outcomes: [{ value: "continue", label: "Continue anyway", then: "Continues to the planned PayPath transaction after you approve in Logs." }],
        cancellation: { label: "Cancel run", then: "Cancels the run before anything is filed." } },
    ],
  } as const,
});

const entries = defineStepEntries(REFERENCE_CHECK_STEP);
const checkEntry = entries.task(REFERENCE_CHECK_NODE, VerifyWorkbookPerson, {
  label: "Check reference spreadsheets", replay: "checkpoint", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});
const stopEntry = entries.task(REFERENCE_STOP_NODE, WorkStudyReadReferenceStop, {
  label: "Decide whether to ask before filing", replay: "always-rerun", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});
const reviewEntry = entries.operatorGate(REFERENCE_CHECK_REVIEW_GATE, {
  label: "Review the reference spreadsheets", statusKey: "awaitingReferenceCheckReview", result: ReferenceCheckReviewSchema,
  when: { kind: "is-present", of: { from: "node", nodeId: REFERENCE_STOP_NODE, path: "ask" } },
});

/** `check` is null when the run picked no reference spreadsheet and the check was skipped. */
const ReferenceCheckStepResultSchema = z.strictObject({ check: VerifyWorkbookPerson.output.nullable() });

export function buildReferenceCheck(author: WorkflowAuthor<typeof WorkStudyInput>, upstream: ReturnType<typeof buildUcpathAuth>) {
  const check = author.task(checkEntry, [upstream.read], ({ outputs }) => ({
    typeId: REFERENCE_CHECK.id, eid: outputs[PAYPATH_POSITION_NODE].emplId, name: outputs[PAYPATH_POSITION_NODE].displayedName,
  }));
  const stop = author.task(stopEntry, [check], ({ outputs, dryRun }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null, writes: dryRun === undefined }));
  const review = author.gate(reviewEntry, [stop]);
  return { check, review, steps: [[REFERENCE_CHECK_STEP, [check, stop, review]]] as const,
    result: author.result(ReferenceCheckStepResultSchema, [check], ({ outputs }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null })) };
}

export const workStudyReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP, build: buildReferenceCheck,
  proof: { id: "work-study-reference-check", order: 35,
    build: (parent: WorkflowDefinition<typeof WorkStudyInput>) => ({ ...inheritStepProof(parent), code: "wsr",
      label: REFERENCE_CHECK_STEP.label, summary: "Reads PayPath for one employee and checks them against the picked reference spreadsheets.",
      steps: (author: WorkflowAuthor<typeof WorkStudyInput>) => {
        const read = buildUcpathAuth(author), built = buildReferenceCheck(author, read);
        return { steps: [...read.steps, ...built.steps], result: built.result };
      },
    }),
  },
});
