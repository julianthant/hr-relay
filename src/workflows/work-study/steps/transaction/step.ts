import { WorkStudyInput } from "../../../../models/workflows/work-study/input.js";
import { WorkStudyPlanTransaction } from "../../../../models/workflows/work-study/plan-transaction.js";
import { WorkStudyResultSchema } from "../../../../models/workflows/work-study/result.js";
import { defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { PAYPATH_POSITION_NODE } from "../../tasks/read-paypath-position.js";
import { PLAN_TRANSACTION_NODE } from "../../tasks/plan-transaction.js";
import { buildUcpathAuth } from "../ucpath-auth/step.js";

const PAGE = "PayPath Actions";
const planned = (label: string, fieldPath: string, example: string) =>
  ({ label, sources: [{ nodeId: PLAN_TRANSACTION_NODE, kind: "output", fieldPath }], example }) as const;
const plannedField = (id: string, operatorField: string, detail: string) =>
  ({ id, operatorField, source: { origin: "Work Study plan", detail, chain: [], read: { stepKey: "transaction", page: PAGE, field: operatorField } } }) as const;

export const TRANSACTION_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "transaction", label: "Submit work-study transaction" }), system: "ucpath" as const,
  description: "Plan the PayPath work-study transaction on the supplied effective date.",
  operatorFields: [
    planned("Effective date", "effectiveDate", "08/03/2026"),
    planned("Position change reason", "positionChangeReason", "JRL"),
    planned("Position pool", "positionPool", "F"),
    planned("Comments", "comments", "Updated pool id to F per work study award 08/03/2026"),
  ] as const,
  review: {
    pages: [{
      id: "paypath-position-data", title: PAGE, mode: "Read only", nodeIds: [PLAN_TRANSACTION_NODE],
      lines: [{ id: "plan-values", kind: "check", text: "Plan the effective date, reason JRL, pool F and the matching comments.", nodeIds: [PLAN_TRANSACTION_NODE] }],
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

/** The Save of work-study-workflow-02 joins this step as a transaction bound to `outputs["plan-transaction"]`. */
export function buildTransaction(author: WorkflowAuthor<typeof WorkStudyInput>, upstream: ReturnType<typeof buildUcpathAuth>) {
  const plan = author.task({ id: PLAN_TRANSACTION_NODE, label: "Plan work-study transaction", contract: WorkStudyPlanTransaction, replay: "always-rerun", step: TRANSACTION_STEP },
    [upstream.read], ({ input, outputs }) => ({ input, read: outputs[PAYPATH_POSITION_NODE] }));
  return { plan, steps: [[TRANSACTION_STEP, [plan]]] as const,
    result: author.result(WorkStudyResultSchema, [plan], ({ outputs }) => ({ state: "planned" as const, plan: outputs[PLAN_TRANSACTION_NODE] })) };
}

export const workStudyTransactionDefinition = defineStep({
  group: TRANSACTION_STEP, build: buildTransaction,
  proof: { id: "work-study-transaction", order: 33,
    build: (parent: WorkflowDefinition<typeof WorkStudyInput>) => ({ ...inheritStepProof(parent), code: "wst",
      label: "Work Study transaction plan", summary: "Reads PayPath for one employee and plans the work-study transaction without filing it.",
      steps: (author: WorkflowAuthor<typeof WorkStudyInput>) => {
        const read = buildUcpathAuth(author), built = buildTransaction(author, read);
        return { steps: [...read.steps, ...built.steps], result: built.result };
      },
    }),
  },
});
