import { UcpathStagePayPathWorkStudy } from "../../../../models/systems/ucpath/stage-paypath-work-study.js";
import { UcpathSubmitPayPathWorkStudy } from "../../../../models/systems/ucpath/submit-paypath-work-study.js";
import { WorkStudyInput } from "../../../../models/workflows/work-study/input.js";
import { WorkStudyReadTransactionPlan, type WorkStudyPlan } from "../../../../models/workflows/work-study/read-transaction-plan.js";
import { workStudyTarget } from "../../../../rules/work-study/plan.js";
import { WorkStudyResultSchema } from "../../../../models/workflows/work-study/result.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { PAYPATH_POSITION_NODE } from "../../tasks/read-paypath-position.js";
import { TRANSACTION_PLAN_NODE } from "../../tasks/read-transaction-plan.js";
import { buildUcpathAuth } from "../ucpath-auth/step.js";

const PAGE = "PayPath Actions";
export const SAVE_NODE = "save-transaction";
const planned = (label: string, fieldPath: string, example: string) =>
  ({ label, sources: [{ nodeId: TRANSACTION_PLAN_NODE, kind: "output", fieldPath }], example }) as const;
const plannedField = (id: string, operatorField: string, detail: string) =>
  ({ id, operatorField, source: { origin: "Work Study plan", detail, chain: [], read: { stepKey: "transaction", page: PAGE, field: operatorField } } }) as const;

export const TRANSACTION_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "transaction", label: "Submit work-study transaction" }), system: "ucpath" as const,
  description: "Plan the PayPath work-study transaction on the supplied effective date, fill it in PayPath Actions and, in a live run, Save and Submit it.",
  operatorFields: [
    planned("Effective date", "effectiveDate", "08/03/2026"),
    planned("Position change reason", "positionChangeReason", "JRL"),
    planned("Position pool", "positionPool", "F"),
    planned("Comments", "comments", "Updated pool id to F per work study award 08/03/2026"),
  ] as const,
  review: {
    pages: [{
      id: "paypath-position-data", title: PAGE, mode: "Fill form", nodeIds: [TRANSACTION_PLAN_NODE, SAVE_NODE],
      lines: [
        { id: "plan-values", kind: "check", text: "Plan the effective date, reason JRL, pool F and the matching comments.", nodeIds: [TRANSACTION_PLAN_NODE] },
        { id: "check-existing", kind: "check", text: "Check UCPath for a work-study transaction already filed for this employee on the effective date.", nodeIds: [SAVE_NODE] },
        { id: "fill-paypath", kind: "action", text: "Fill Position Data, the Job Data comments and the Initiator's comments, and read every value back.", nodeIds: [SAVE_NODE] },
        { id: "save-and-submit", kind: "action", text: "In a live run, click Save and Submit once and read the filed transaction back.", nodeIds: [SAVE_NODE] },
      ],
      fields: [
        plannedField("effective-date", "Effective date", "The effective date typed for this run."),
        plannedField("position-change-reason", "Position change reason", "Always JRL for a work-study award."),
        plannedField("position-pool", "Position pool", "Always F for a work-study award."),
        plannedField("comments", "Comments", "Job Data and Initiator's comments naming the award date."),
      ],
    }],
    branchLabels: [],
  } as const,
});

/** What the operator is told per person: filed by this run, or already filed for this date and not filed again. */
const WORK_STUDY_DISPOSITION_STATE = { committed: "saved", "already-present": "already-filed" } as const;

const saveEntry = defineStepEntries(TRANSACTION_STEP).transaction(SAVE_NODE, {
  label: "Save and Submit the work-study transaction", prepare: UcpathStagePayPathWorkStudy, commit: UcpathSubmitPayPathWorkStudy,
  dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000,
});

export function buildTransaction(author: WorkflowAuthor<typeof WorkStudyInput>, upstream: ReturnType<typeof buildUcpathAuth>) {
  const plan = author.task({ id: TRANSACTION_PLAN_NODE, label: "Plan work-study transaction", contract: WorkStudyReadTransactionPlan, replay: "always-rerun", step: TRANSACTION_STEP },
    [upstream.read], ({ input, outputs }) => ({ input, read: outputs[PAYPATH_POSITION_NODE] }));
  const target = ({ outputs }: { outputs: { [TRANSACTION_PLAN_NODE]: WorkStudyPlan } }) => workStudyTarget(outputs[TRANSACTION_PLAN_NODE]);
  const save = author.transaction(saveEntry, [plan], { prepareBind: target, commitBind: target });
  return { plan, steps: [[TRANSACTION_STEP, [plan, save]]] as const,
    result: author.result(WorkStudyResultSchema, [plan, save], ({ outputs }) => ({
      state: WORK_STUDY_DISPOSITION_STATE[outputs[SAVE_NODE].disposition],
      plan: outputs[TRANSACTION_PLAN_NODE], receipt: outputs[SAVE_NODE].output.receipt,
    })) };
}

export const workStudyTransactionDefinition = defineStep({
  group: TRANSACTION_STEP, build: buildTransaction,
  proof: { id: "work-study-transaction", order: 33,
    build: (parent: WorkflowDefinition<typeof WorkStudyInput>) => ({ ...inheritStepProof(parent), code: "wst",
      label: "Work Study transaction", summary: "Reads PayPath for one employee, plans the work-study transaction and files it through Save and Submit.",
      steps: (author: WorkflowAuthor<typeof WorkStudyInput>) => {
        const read = buildUcpathAuth(author), built = buildTransaction(author, read);
        return { steps: [...read.steps, ...built.steps], result: built.result };
      },
    }),
  },
});
