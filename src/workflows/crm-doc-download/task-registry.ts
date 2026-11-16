import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readCrmDocumentRowsTask } from "./tasks/read-document-rows.js";
import { readCrmWorksheetArchivesTask } from "./tasks/read-worksheet-archives.js";

export const crmDocDownloadStore = defineWorkflowStore("crm-doc-download", { readDocumentRows: readCrmDocumentRowsTask, readWorksheetArchives: readCrmWorksheetArchivesTask });
