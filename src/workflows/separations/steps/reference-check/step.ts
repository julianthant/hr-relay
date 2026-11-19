import { z } from "zod";
import { REFERENCE_CHECK_REVIEW_GATE, ReferenceCheckReviewSchema } from "../../../../models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK, VerifyWorkbookPerson } from "../../../../models/processing/workbooks/verify-person.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import { SeparationsReadReferenceStop } from "../../../../models/workflows/separations/read-reference-stop.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import type { StepProofSpec, WorkflowAuthor } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { REFERENCE_STOP_NODE } from "../../tasks/read-reference-stop.js";
import type { SeparationsInput } from "../../workflow.js";
import type { buildIdentity } from "../identity-check/step.js";

export const REFERENCE_CHECK_NODE = "reference-check";

export const REFERENCE_CHECK_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "reference-check", label: "Check reference spreadsheets" }), system: "local" as const,
  description: "Look the approved Employee ID up in each picked reference spreadsheet, and ask before anything is filed when one does not confirm the person.",
  operatorFields: [
    { label: "Reference spreadsheet", visibility: "logs", sources: [{ nodeId: REFERENCE_CHECK_NODE, kind: "output", fieldPath: "checks.line" }] },
  ] as const,
  review: {
    pages: [{
      id: "reference-spreadsheets", title: "Reference spreadsheets", mode: "Read only", nodeIds: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE],
      lines: [
        { id: "check-person", kind: "check", text: "Confirm the approved Employee ID, and the name when the sheet has one, in each picked spreadsheet.", nodeIds: [REFERENCE_CHECK_NODE] },
        { id: "ask-before-filing", kind: "check", text: "In a live run, ask before filing when a picked spreadsheet does not hold the person or names them differently.", nodeIds: [REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE], when: [{ "reference-result": ["true"] }] },
      ],
      fields: [],
    }],
    branchLabels: [],
    decisions: [{
      id: "reference-result", label: "Reference check", reads: { nodeId: REFERENCE_STOP_NODE, fieldPath: "ask" },
      nodeIds: [REFERENCE_CHECK_NODE, REFERENCE_STOP_NODE, REFERENCE_CHECK_REVIEW_GATE], initial: "null",
      outcomes: [
        { value: "null", label: "No review needed", then: "Continues when the spreadsheets confirm the person, none were picked, or this is a dry run." },
        { value: "true", label: "Reference needs review", then: "Waits for you to review the reference spreadsheets in Logs before anything is filed.", stops: true, when: [{ "dry-run": ["false"] }] },
      ],
    }],
  } as const,
});

const entries = defineStepEntries(REFERENCE_CHECK_STEP);
const checkEntry = entries.task(REFERENCE_CHECK_NODE, VerifyWorkbookPerson, {
  label: "Check reference spreadsheets", replay: "checkpoint", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});
const stopEntry = entries.task(REFERENCE_STOP_NODE, SeparationsReadReferenceStop, {
  label: "Decide whether to ask before filing", replay: "always-rerun", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});
const reviewEntry = entries.operatorGate(REFERENCE_CHECK_REVIEW_GATE, {
  label: "Review the reference spreadsheets", statusKey: "awaitingReferenceCheckReview", result: ReferenceCheckReviewSchema,
  when: { kind: "is-present", of: { from: "node", nodeId: REFERENCE_STOP_NODE, path: "ask" } },
});

/** Checks the approved person; the termination's first write waits for the review this returns. */
export function buildReferenceCheck(author: WorkflowAuthor<typeof SeparationsInput>, identity: ReturnType<typeof buildIdentity>) {
  const check = author.task(checkEntry, [identity.approval], ({ outputs }) => ({
    typeId: REFERENCE_CHECK.id, eid: outputs["approval"].approved.emplId, name: outputs["approval"].approved.ucpathName,
  }));
  const stop = author.task(stopEntry, [check], ({ outputs, dryRun }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null, writes: dryRun === undefined }));
  const review = author.gate(reviewEntry, [stop]);
  return { check, review, steps: [[REFERENCE_CHECK_STEP, [check, stop, review]]] as const };
}

const ProofInputShape = { emplId: EidSchema, employeeName: z.string().min(1) } as const;
const SeparationsReferenceCheckInput = z.strictObject(ProofInputShape);
const SeparationsReferenceCheckCanonicalInput = defineCanonicalInput(SeparationsReferenceCheckInput, z.strictObject(ProofInputShape),
  [{ emplId: "10000001", employeeName: "Lee, Jordan" }]);
/** `check` is null when the run picked no reference spreadsheet and the check was skipped. */
const SeparationsReferenceCheckResultSchema = z.strictObject({ check: VerifyWorkbookPerson.output.nullable() });

export const separationsReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP, build: buildReferenceCheck,
  proof: {
    id: "separations-reference-check", order: 36, build: (): StepProofSpec<typeof SeparationsReferenceCheckInput, typeof SeparationsReferenceCheckResultSchema> => ({
      version: 1, code: "sr", label: REFERENCE_CHECK_STEP.label,
      summary: "Checks one approved separation subject against the picked reference spreadsheets and asks before any write when one does not confirm them.",
      icon: "ShieldCheck", category: "separation", requiredWorkbookFields: [], workbookCheck: REFERENCE_CHECK,
      canonicalInput: SeparationsReferenceCheckCanonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, verdicts: [], details: [],
      identity: { matchKey: input => `separations-reference-check:${input.emplId}` },
      presentation: { title: input => `${input.employeeName} (${input.emplId})`, subtitle: () => "Reference spreadsheet check" },
      scenarios: ["separations-reference-check/reference-check"],
      input: SeparationsReferenceCheckInput,
      steps: (author: WorkflowAuthor<typeof SeparationsReferenceCheckInput>) => {
        const check = author.task(checkEntry, [], ({ input }) => ({ typeId: REFERENCE_CHECK.id, eid: input.emplId, name: input.employeeName }));
        const stop = author.task(stopEntry, [check], ({ outputs, dryRun }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null, writes: dryRun === undefined }));
        const review = author.gate(reviewEntry, [stop]);
        return { steps: [[REFERENCE_CHECK_STEP, [check, stop, review]]],
          result: author.result(SeparationsReferenceCheckResultSchema, [check, review], ({ outputs }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null })) };
      },
    }),
  },
});
