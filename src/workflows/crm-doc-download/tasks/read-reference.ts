import { ReadWorkbookReference } from "../../../models/processing/workbooks/read-reference.js";
import type { CrmDocumentRecordsSchema } from "../../../models/systems/crm/document-tasks.js";
import type { z } from "zod";
import { ONBOARDING_ROSTER_TYPE_ID } from "../../../models/workflows/onboarding/roster.js";
import { crmDocumentReferenceKeys } from "../../../rules/crm-doc-download/reference.js";
import { reuseTask, type WorkflowTimelineGroup } from "../../../workflow-kit/workflow-definition.js";

export const readCrmWorkbookReference = (step: WorkflowTimelineGroup) => reuseTask(step,
  { id: "workbook-reference", contract: ReadWorkbookReference, replay: "checkpoint" },
  (input: z.output<typeof CrmDocumentRecordsSchema>) => ({ typeId: ONBOARDING_ROSTER_TYPE_ID, keys: crmDocumentReferenceKeys(input) }));
