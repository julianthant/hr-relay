import { z } from "zod";
import { REFERENCE_CHECK_REVIEW_GATE, ReferenceCheckReviewSchema } from "../../../../models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK, VerifyWorkbookPerson } from "../../../../models/processing/workbooks/verify-person.js";
import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { OnboardingReadReferenceStop } from "../../../../models/workflows/onboarding/read-reference-stop.js";
import { ONBOARDING_WRITE_REVIEW_GATE } from "../../../../models/workflows/onboarding/read-write-plan.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { REFERENCE_STOP_NODE } from "../../tasks/read-reference-stop.js";
import { buildCrmData } from "../crm-data/step.js";
import { buildHireReview } from "../hire-review/step.js";
import { buildI9Search } from "../i9-search/step.js";
import { buildUcpathSearch } from "../ucpath-search/step.js";

export const REFERENCE_CHECK_NODE = "reference-check";

export const REFERENCE_CHECK_MANUAL: StepManualDeclaration = {
  off: "values",
  form: { fields: [
    { key: "referenceResult", label: "Reference spreadsheet result", kind: "enum", values: ["Confirmed", "Unconfirmed", "Not checked"] },
  ] },
  produces: {},
  skips: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE],
  skipsGatesAndTransactions: true,
};

export const REFERENCE_CHECK_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "reference-check", label: "Check reference spreadsheets" }), system: "local" as const,
  manual: REFERENCE_CHECK_MANUAL,
  description: "Look the reviewed Employee ID up in each picked reference spreadsheet, and ask before the first save when one does not confirm the person.",
  operatorFields: [
    { label: "Reference spreadsheet", visibility: "logs", sources: [{ nodeId: REFERENCE_CHECK_NODE, kind: "output", fieldPath: "checks.line" }] },
  ] as const,
  review: {
    pages: [{
      id: "reference-spreadsheets", title: "Reference spreadsheets", mode: "Read only", nodeIds: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE],
      lines: [
        { id: "check-person", kind: "check", text: "Confirm the reviewed Employee ID, and the name when the sheet has one, in each picked spreadsheet.", nodeIds: [REFERENCE_CHECK_NODE] },
        { id: "ask-before-saving", kind: "check", text: "In a live run, ask before the first save when a picked spreadsheet does not hold the person or names them differently.", nodeIds: [REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE] },
      ],
      fields: [{ id: "reference-line", label: "Reference spreadsheet", example: "Example eligibility · Awards: name differs in row 3",
        taskFields: [{ nodeId: REFERENCE_CHECK_NODE, kind: "output", fieldPath: "checks.line" }],
        source: { origin: "Picked reference spreadsheets", detail: "The reviewed Employee ID and name checked against the versions picked for this run.", chain: [] } }],
    }],
    branchLabels: [],
    decisions: [
      { id: "reference-result", label: "Reference check", reads: { nodeId: REFERENCE_CHECK_NODE, fieldPath: "result" },
        nodeIds: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE], initial: { by: "hire-approval", values: { "new-hire": "no-person" }, otherwise: "confirmed" }, outcomes: [
          { value: "confirmed", label: "Person confirmed", then: "Continues to the approved hire plan." },
          { value: "unconfirmed", label: "Person not confirmed", then: "In a live run, waits for your review in Logs before the first save; a dry run continues without asking." },
          { value: "no-person", label: "No person to check", then: "A new hire has no Employee ID yet, so the run continues without a reference match." },
        ] },
      { id: "reference-check-review", label: "Review reference spreadsheets", reads: { nodeId: REFERENCE_CHECK_REVIEW_GATE, fieldPath: "decision" },
        nodeIds: [REFERENCE_CHECK_REVIEW_GATE], initial: "continue", when: [{ "dry-run": ["false"], "reference-result": ["unconfirmed"] }],
        outcomes: [{ value: "continue", label: "Continue anyway", then: "Continues to the approved hire plan after you approve in Logs." }],
        cancellation: { label: "Cancel run", then: "Cancels the run before any I-9 or UCPath change is saved." } },
    ],
  } as const,
});

const entries = defineStepEntries(REFERENCE_CHECK_STEP);
const checkEntry = entries.task(REFERENCE_CHECK_NODE, VerifyWorkbookPerson, {
  label: "Check reference spreadsheets", replay: "checkpoint", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});
const stopEntry = entries.task(REFERENCE_STOP_NODE, OnboardingReadReferenceStop, {
  label: "Decide whether to ask before saving", replay: "always-rerun", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});
const reviewEntry = entries.operatorGate(REFERENCE_CHECK_REVIEW_GATE, {
  label: "Review the reference spreadsheets", statusKey: "awaitingReferenceCheckReview", result: ReferenceCheckReviewSchema,
  when: { kind: "is-present", of: { from: "node", nodeId: REFERENCE_STOP_NODE, path: "ask" } },
});

/** `check` is null when the run picked no reference spreadsheet and the check was skipped. */
const ReferenceCheckStepResultSchema = z.strictObject({ check: VerifyWorkbookPerson.output.nullable() });

/** Checks the Employee ID the hire review settled on; a new hire has none yet, so its check finds no person and never asks. */
export function buildReferenceCheck(author: WorkflowAuthor<typeof OnboardingInput>, crm: ReturnType<typeof buildCrmData>,
  ucpath: ReturnType<typeof buildUcpathSearch>, reviewed: ReturnType<typeof buildHireReview>) {
  const check = author.task(checkEntry, [crm.plan, ucpath.subject, reviewed.approval], ({ outputs }) => {
    const approval = outputs[ONBOARDING_WRITE_REVIEW_GATE], subject = outputs["hire-subject"], employee = outputs["hire-plan"].employee;
    // With no review the hire-subject settled the person by name, DOB and SSN.
    const eid = approval === undefined ? subject.state === "existing-person" ? subject.person.emplId : null
      : approval.decision === "existing-person" ? approval.emplId : null;
    return { typeId: REFERENCE_CHECK.id, eid, name: `${employee.firstName} ${employee.lastName}` };
  });
  const stop = author.task(stopEntry, [check], ({ outputs, dryRun }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null, writes: dryRun === undefined }));
  const review = author.gate(reviewEntry, [stop]);
  return { check, review, steps: [[REFERENCE_CHECK_STEP, [check, stop, review]]] as const,
    result: author.result(ReferenceCheckStepResultSchema, [check], ({ outputs }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null })) };
}

export const onboardingReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP, build: buildReferenceCheck,
  nodePurposes: [
    { nodeId: REFERENCE_CHECK_NODE, purpose: "Look the reviewed Employee ID up in each picked reference spreadsheet without reading a row value back." },
    { nodeId: REFERENCE_STOP_NODE, purpose: "Ask before the first save only in a live run whose picked spreadsheets do not confirm the person." },
    { nodeId: REFERENCE_CHECK_REVIEW_GATE, purpose: "Have the operator continue anyway, or cancel the run, before anything is saved." },
  ],
  proof: { id: "onboarding-reference-check", order: 38,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({ ...inheritStepProof(parent), code: "onrc",
      label: REFERENCE_CHECK_STEP.label, summary: "Reviews one hire and checks the reviewed Employee ID against the picked reference spreadsheets.",
      steps: (author: WorkflowAuthor<typeof OnboardingInput>) => {
        const crm = buildCrmData(author), ucpath = buildUcpathSearch(author, crm), i9 = buildI9Search(author, crm, ucpath);
        const reviewed = buildHireReview(author, crm, ucpath, i9), reference = buildReferenceCheck(author, crm, ucpath, reviewed);
        return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps, ...reviewed.steps, ...reference.steps], result: reference.result };
      },
    }),
  },
});
