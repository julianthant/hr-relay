import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { crmDocDownloadWorkflow } from "./workflow.js";
import { crmDocDownloadStore } from "./task-registry.js";
import { crmDocumentSearchRecordsDefinition } from "./steps/search-records/step.js";
import { crmDocumentReferenceDefinition } from "./steps/reference/step.js";
import { crmDocumentReadIdocsDefinition } from "./steps/read-idocs/step.js";
import { crmDocumentPackageWorksheetsDefinition } from "./steps/package-worksheets/step.js";

export const registration = deepFreeze({
  definition: crmDocDownloadWorkflow, store: crmDocDownloadStore,
  proofs: [defineStepProof(crmDocDownloadWorkflow, crmDocumentSearchRecordsDefinition), defineStepProof(crmDocDownloadWorkflow, crmDocumentReferenceDefinition),
    defineStepProof(crmDocDownloadWorkflow, crmDocumentReadIdocsDefinition), defineStepProof(crmDocDownloadWorkflow, crmDocumentPackageWorksheetsDefinition)],
} as const);
