import { OnbaseReadSourcePage, type OnbaseInput } from "../../../models/systems/onbase/import-document.js";
import { reuseTask } from "../../../workflow-kit/workflow-definition.js";
import type { WorkflowTimelineGroup } from "../../../workflow-kit/workflow.js";

export const readOnbaseSourcePage = (step: WorkflowTimelineGroup) => reuseTask(step,
  { id: "source-page", contract: OnbaseReadSourcePage, replay: "always-rerun" }, (input: OnbaseInput) => input);
