import {
  compileWorkflow,
  composeWorkflowModule,
} from "../../../workflow-kit/workflow-definition.js";
import { taskStoreRegistry } from "./task-registry.js";
import { personLookupSearchingWorkflow } from "../../../workflows/person-lookup/steps/searching/step.js";
import { personLookupCrossVerifyWorkflow } from "../../../workflows/person-lookup/steps/cross-verify/step.js";
import { personLookupActiveStatusWorkflow } from "../../../workflows/person-lookup/steps/active-status/step.js";
import { personLookupCrmDatesWorkflow } from "../../../workflows/person-lookup/steps/crm-dates/step.js";
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

export const personLookupSearchingModule = composeWorkflowModule(
  compileWorkflow(personLookupSearchingWorkflow),
  taskStoreRegistry.stores,
);
export const personLookupCrossVerifyModule = composeWorkflowModule(
  compileWorkflow(personLookupCrossVerifyWorkflow),
  taskStoreRegistry.stores,
);
export const personLookupActiveStatusModule = composeWorkflowModule(
  compileWorkflow(personLookupActiveStatusWorkflow),
  taskStoreRegistry.stores,
);
export const personLookupCrmDatesModule = composeWorkflowModule(
  compileWorkflow(personLookupCrmDatesWorkflow),
  taskStoreRegistry.stores,
);

export const STEP_PROOF_MODULES = Object.freeze([
  separationsKronosTimecardModule,
  separationsKualiReadModule,
  separationsIdentityCheckModule,
  separationsUcpathTerminationModule,
  separationsKualiFinalizationModule,
  personLookupSearchingModule,
  personLookupCrossVerifyModule,
  personLookupActiveStatusModule,
  personLookupCrmDatesModule,
]);

export const STEP_PROOF_DESCRIPTORS = Object.freeze(
  STEP_PROOF_MODULES.map((module) => module.descriptor),
);

export function stepProofModuleOf(id: string) {
  return STEP_PROOF_MODULES.find(
    (module) => String(module.descriptor.id) === id,
  );
}

export function stepProofDescriptorOf(id: string) {
  return stepProofModuleOf(id)?.descriptor;
}
