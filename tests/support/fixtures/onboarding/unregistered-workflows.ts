import { compileWorkflow, composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { registration } from "../../../../src/workflows/onboarding/index.js";

const stores = [...taskStoreRegistry.stores, registration.store];
export const UNREGISTERED_ONBOARDING_MODULES = Object.freeze([
  composeWorkflowModule(compileWorkflow(registration.definition), stores),
  composeWorkflowModule(compileWorkflow(registration.proofs[0].definition), stores),
  composeWorkflowModule(compileWorkflow(registration.proofs[1].definition), stores),
  composeWorkflowModule(compileWorkflow(registration.proofs[2].definition), stores),
  composeWorkflowModule(compileWorkflow(registration.proofs[3].definition), stores),
]);
