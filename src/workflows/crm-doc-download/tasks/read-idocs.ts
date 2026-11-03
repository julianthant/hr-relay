import type { z } from "zod";
import { CrmDocumentRecordsSchema, CrmReadIdocs } from "../../../models/systems/crm/document-tasks.js";
import { reuseTask, type WorkflowTimelineGroup } from "../../../workflow-kit/workflow-definition.js";

export const readCrmDocumentPdfs = (step: WorkflowTimelineGroup) => reuseTask(step,
  { id: "document-pdfs", contract: CrmReadIdocs, replay: "checkpoint" },
  (input: z.output<typeof CrmDocumentRecordsSchema>) => input);
