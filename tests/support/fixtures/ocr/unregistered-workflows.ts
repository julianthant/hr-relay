import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import type { RegisteredTaskStore } from "../../../../src/workflow-kit/task-registry.js";
import { compileWorkflow, composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { registration as ocrPageReadingWorkflowRegistration } from "../../../../src/workflows/ocr-page/index.js";
import { ocrPageStore } from "../../../../src/workflows/ocr-page/task-registry.js";
import { ocrPageWorkflow } from "../../../../src/workflows/ocr-page/workflow.js";
import { registration as ocrSourcePagesWorkflowRegistration } from "../../../../src/workflows/ocr/index.js";
import { ocrWorkflowStore } from "../../../../src/workflows/ocr/task-registry.js";
import { ocrWorkflow } from "../../../../src/workflows/ocr/workflow.js";
const ocrSourcePagesWorkflow = ocrSourcePagesWorkflowRegistration.proofs[0].definition;
const ocrPageReadingWorkflow = ocrPageReadingWorkflowRegistration.proofs[0].definition;

export const UNREGISTERED_OCR_STORES: readonly RegisteredTaskStore[] = Object.freeze([ocrWorkflowStore, ocrPageStore]);
const stores = [...taskStoreRegistry.stores, ...UNREGISTERED_OCR_STORES];
export const UNREGISTERED_OCR_MODULES = Object.freeze([
  composeWorkflowModule(compileWorkflow(ocrWorkflow), stores),
  composeWorkflowModule(compileWorkflow(ocrPageWorkflow), stores),
  composeWorkflowModule(compileWorkflow(ocrSourcePagesWorkflow), stores),
  composeWorkflowModule(compileWorkflow(ocrPageReadingWorkflow), stores),
]);
