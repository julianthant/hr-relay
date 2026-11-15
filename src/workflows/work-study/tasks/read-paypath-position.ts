import { UcpathReadPayPathPosition } from "../../../models/systems/ucpath/read-paypath-position.js";
import type { WorkStudyInputValue } from "../../../models/workflows/work-study/input.js";
import { reuseTask } from "../../../workflow-kit/workflow-definition.js";

export const PAYPATH_POSITION_NODE = "paypath-position";

export function readPayPathPositionCall(step: Readonly<{ key: string; label: string }>) {
  return reuseTask(step, { id: PAYPATH_POSITION_NODE, label: "Open PayPath Actions for the employee", contract: UcpathReadPayPathPosition, replay: "always-rerun" },
    (input: WorkStudyInputValue) => ({ emplId: input.emplId }));
}
