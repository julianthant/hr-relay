import { CrmSearchDocumentRecords } from "../../../models/systems/crm/document-tasks.js";
import type { CrmDocDownloadInputValue } from "../../../models/workflows/crm-doc-download/input.js";
import { reuseTask, type WorkflowTimelineGroup } from "../../../workflow-kit/workflow-definition.js";

export const searchCrmDocumentRecords = (step: WorkflowTimelineGroup) => reuseTask(step,
  { id: "document-records", contract: CrmSearchDocumentRecords, replay: "checkpoint" },
  (input: CrmDocDownloadInputValue) => ({ subjects: input.people }));
