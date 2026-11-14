import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { WORK_STUDY_INPUT_PARSER, WORK_STUDY_TYPED_INPUT, WorkStudyCanonicalInput, WorkStudyInput } from "../../models/workflows/work-study/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { workStudyTransactionDefinition } from "./steps/transaction/step.js";
import { workStudyUcpathAuthDefinition } from "./steps/ucpath-auth/step.js";

export const workStudyWorkflow = defineWorkflow({
  id: "work-study", version: 1, code: "ws", label: "Work-Study", icon: "ClipboardCheck", category: "operations",
  summary: "Opens UCPath PayPath Actions for each employee and files the work-study transaction: the supplied effective date, reason JRL and pool F, with matching comments. Dry run fills it and saves nothing.",
  requiredWorkbookFields: [],
  input: WorkStudyInput, canonicalInput: WorkStudyCanonicalInput, inputSubject: "eid",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: { inputRun: { placeholder: "10000001, 10000002", parser: WORK_STUDY_INPUT_PARSER, typedInput: WORK_STUDY_TYPED_INPUT } },
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["work-study/planned-transaction", "work-study/verified-save", "work-study/already-filed", "work-study/unknown"],
  identity: { matchKey: input => `${input.emplId}:${input.effectiveDate}` },
  presentation: { title: input => input.emplId, subtitle: () => "PayPath work-study transaction" },
  details: [
    { key: "employee", label: "Employee", source: { kind: "result", fieldPath: "plan.name" }, display: "text" },
    { key: "effective-date", label: "Effective date", source: { kind: "result", fieldPath: "plan.effectiveDate" }, display: "text" },
  ],
  verdicts: [],
  steps: author => {
    const read = workStudyUcpathAuthDefinition.build(author), transaction = workStudyTransactionDefinition.build(author, read);
    return { steps: [...read.steps, ...transaction.steps], result: transaction.result };
  },
});
