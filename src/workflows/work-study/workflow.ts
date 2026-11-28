import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { WORK_STUDY_INPUT_PARSER, WORK_STUDY_INPUT_PLACEHOLDER, WORK_STUDY_TYPED_INPUT, WorkStudyCanonicalInput, WorkStudyInput } from "../../models/workflows/work-study/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { defineReferenceCheck } from "../../workflow-kit/reference-check.js";
import { workStudyTransactionDefinition } from "./steps/transaction/step.js";
import { workStudyUcpathAuthDefinition } from "./steps/ucpath-auth/step.js";

export const workStudyWorkflow = defineWorkflow({
  id: "work-study", version: 1, code: "ws", label: "Work-Study", icon: "ClipboardCheck", category: "operations",
  summary: "Opens UCPath PayPath Actions for each employee and files the work-study transaction: the supplied effective date, reason JRL and pool F, with matching comments. Dry run fills it and saves nothing.",
  requiredWorkbookFields: [], referenceCheck: defineReferenceCheck({ key: "eid", input: { eid: "emplId" }, outputs: {
    "paypath-position": { eid: "emplId", fullName: "displayedName" },
  } }),
  input: WorkStudyInput, canonicalInput: WorkStudyCanonicalInput, inputSubject: "eid",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: { inputRun: { placeholder: WORK_STUDY_INPUT_PLACEHOLDER, parser: WORK_STUDY_INPUT_PARSER, typedInput: WORK_STUDY_TYPED_INPUT } },
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["work-study/planned-transaction", "work-study/verified-save", "work-study/already-filed", "work-study/unknown", "work-study/reference-check"],
  identity: { matchKey: input => `${input.emplId}:${input.effectiveDate}` },
  presentation: { title: input => input.emplId, subtitle: () => "PayPath work-study transaction" },
  details: [
    { key: "employee", label: "Employee", source: { kind: "result", fieldPath: "plan.name" }, display: "text" },
    { key: "effective-date", label: "Effective date", source: { kind: "result", fieldPath: "plan.effectiveDate" }, display: "text" },
  ],
  verdicts: [],
  rows: [
    { key: "ucpath-auth", label: "Sign in to UCPath", members: [{ step: "ucpath-auth" }, { step: "reference-check" }], target: { step: "ucpath-auth" } },
    { key: "transaction", label: "Submit work-study transaction", members: [{ step: "transaction" }], target: { step: "transaction" } },
  ],
  steps: author => {
    const read = workStudyUcpathAuthDefinition.build(author);
    const transaction = workStudyTransactionDefinition.build(author, read);
    return { steps: [...read.steps, ...transaction.steps], result: transaction.result };
  },
});
