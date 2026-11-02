import { compileWorkflow, composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ocrWorkflow } from "../../../../src/workflows/ocr/workflow.js";
import { ocrPageWorkflow } from "../../../../src/workflows/ocr-page/workflow.js";
import { ocrWorkflowStore } from "../../../../src/workflows/ocr/task-registry.js";
import { ocrPageStore } from "../../../../src/workflows/ocr-page/task-registry.js";

export const UNREGISTERED_OCR_STORES = Object.freeze([ocrWorkflowStore, ocrPageStore]);
const stores = [...taskStoreRegistry.stores, ...UNREGISTERED_OCR_STORES];
export const UNREGISTERED_OCR_MODULES = Object.freeze([
  composeWorkflowModule(compileWorkflow(ocrWorkflow), stores),
  composeWorkflowModule(compileWorkflow(ocrPageWorkflow), stores),
]);
