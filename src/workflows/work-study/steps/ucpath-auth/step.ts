import { WorkStudyInput } from "../../../../models/workflows/work-study/input.js";
import { UcpathReadPayPathPosition } from "../../../../models/systems/ucpath/read-paypath-position.js";
import { defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { PAYPATH_POSITION_NODE, readPayPathPositionCall } from "../../tasks/read-paypath-position.js";

const PAGE = "PayPath Actions";
export const UCPATH_AUTH_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "ucpath-auth", label: "Sign in to UCPath" }), system: "ucpath" as const,
  description: "Open UCPath PayPath Actions for the employee and read who they are and their current position data.",
  operatorFields: [
    { label: "Employee", sources: [{ nodeId: PAYPATH_POSITION_NODE, kind: "output", fieldPath: "displayedName" }], example: "Lee, Jordan" },
    { label: "Employee ID", sources: [{ nodeId: PAYPATH_POSITION_NODE, kind: "output", fieldPath: "emplId" }], example: "10000001" },
    { label: "Current position pool", sources: [{ nodeId: PAYPATH_POSITION_NODE, kind: "output", fieldPath: "position.positionPool" }], example: "A" },
  ] as const,
  review: {
    pages: [{
      id: "paypath-actions", title: PAGE, mode: "Read only", nodeIds: [PAYPATH_POSITION_NODE],
      lines: [
        { id: "open-paypath", kind: "action", text: "Open HR Tasks, PayPath/Additional Pay, PayPath Actions and search the Employee ID.", nodeIds: [PAYPATH_POSITION_NODE] },
        { id: "read-employee", kind: "read", text: "Read the employee's name and current Position Data.", nodeIds: [PAYPATH_POSITION_NODE] },
      ],
      fields: [
        { id: "employee", operatorField: "Employee", source: { origin: "UCPath", detail: "The name PayPath shows in the employee header.", chain: [], read: { stepKey: "ucpath-auth", page: PAGE, field: "Employee" } } },
        { id: "employee-id", operatorField: "Employee ID", source: { origin: "UCPath", detail: "The Empl ID PayPath opened, which must equal the one typed.", chain: [], read: { stepKey: "ucpath-auth", page: PAGE, field: "Employee ID" } } },
        { id: "current-position-pool", operatorField: "Current position pool", source: { origin: "UCPath", detail: "The Position Pool PayPath shows before any change.", chain: [], read: { stepKey: "ucpath-auth", page: PAGE, field: "Current position pool" } } },
      ],
    }],
    branchLabels: [],
  } as const,
});

export function buildUcpathAuth(author: WorkflowAuthor<typeof WorkStudyInput>) {
  const call = readPayPathPositionCall(UCPATH_AUTH_STEP);
  const read = author.task(call.identity, [], call.bind);
  return { read, steps: [[UCPATH_AUTH_STEP, [read]]] as const };
}

export const workStudyUcpathAuthDefinition = defineStep({
  group: UCPATH_AUTH_STEP, build: buildUcpathAuth,
  proof: { id: "work-study-ucpath-auth", order: 32,
    build: (parent: WorkflowDefinition<typeof WorkStudyInput>) => ({ ...inheritStepProof(parent), code: "wsa",
      label: "Work Study PayPath read", summary: "Opens PayPath Actions for one employee and reads the header and current Position Data.",
      steps: (author: WorkflowAuthor<typeof WorkStudyInput>) => {
        const built = buildUcpathAuth(author);
        return { steps: built.steps, result: author.result(UcpathReadPayPathPosition.output, [built.read], ({ outputs }) => outputs[PAYPATH_POSITION_NODE]) };
      },
    }),
  },
});
