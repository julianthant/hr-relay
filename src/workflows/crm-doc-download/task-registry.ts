import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readCrmDocumentRowsTask } from "./tasks/read-document-rows.js";

export const crmDocDownloadStore = defineWorkflowStore("crm-doc-download", { readDocumentRows: readCrmDocumentRowsTask });
