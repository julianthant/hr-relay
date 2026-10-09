import {
  compileWorkflow,
  composeWorkflowModule,
} from "../../../workflow-kit/workflow-definition.js";
import { taskStoreRegistry } from "./task-registry.js";
import { separationsIdentityCheckWorkflow } from "../../../workflows/separations/steps/identity-check/step.js";
import { separationsKronosTimecardWorkflow } from "../../../workflows/separations/steps/kronos-timecard/step.js";
import { separationsKualiFinalizationWorkflow } from "../../../workflows/separations/steps/kuali-finalization/step.js";
import { separationsKualiReadWorkflow } from "../../../workflows/separations/steps/kuali-extraction/step.js";
import { separationsUcpathTerminationWorkflow } from "../../../workflows/separations/steps/ucpath-transaction/step.js";


export const separationsKronosTimecardModule = composeWorkflowModule(
  compileWorkflow(separationsKronosTimecardWorkflow),
  taskStoreRegistry.stores,
);
export const separationsKualiReadModule = composeWorkflowModule(
  compileWorkflow(separationsKualiReadWorkflow),
  taskStoreRegistry.stores,
);
export const separationsIdentityCheckModule = composeWorkflowModule(
  compileWorkflow(separationsIdentityCheckWorkflow),
  taskStoreRegistry.stores,
);
export const separationsUcpathTerminationModule = composeWorkflowModule(
  compileWorkflow(separationsUcpathTerminationWorkflow),
  taskStoreRegistry.stores,
);
export const separationsKualiFinalizationModule = composeWorkflowModule(
  compileWorkflow(separationsKualiFinalizationWorkflow),
  taskStoreRegistry.stores,
);

export const STEP_PROOF_MODULES = Object.freeze([
  separationsKronosTimecardModule,
  separationsKualiReadModule,
  separationsIdentityCheckModule,
  separationsUcpathTerminationModule,
  separationsKualiFinalizationModule,
]);

export const HISTORICAL_STEP_PROOF_DESCRIPTORS = Object.freeze(
  STEP_PROOF_MODULES.map((module) => module.descriptor),
);

export function historicalStepProofModuleOf(id: string) {
  return STEP_PROOF_MODULES.find(
    (module) => String(module.descriptor.id) === id,
  );
}

export function historicalStepProofDescriptorOf(id: string) {
  return historicalStepProofModuleOf(id)?.descriptor;
}
