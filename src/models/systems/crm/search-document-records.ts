import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { CrmLocatedPersonSchema, CrmDocumentSubjectSchema, CrmDocumentRecordsSchema } from "./documents.js";

const exampleRecord = CrmLocatedPersonSchema.parse({ subject: { kind: "email", value: "fixture@example.test" }, identity: {
  recordId: "fixture-record", eid: null, workEmail: "fixture@example.test", personalEmail: null,
} });

export const CrmSearchDocumentRecords = defineTaskContract({
  id: taskId("crm/search-document-records"), title: "Find latest CRM document records", effect: "read",
  input: z.strictObject({ subjects: CrmDocumentSubjectSchema.array().min(1).refine(subjects =>
    new Set(subjects.map(subject => `${subject.kind}:${subject.value.toLowerCase()}`)).size === subjects.length, "requested subjects must be unique") }),
  output: CrmDocumentRecordsSchema, errorCodes: ["CRM_DOCUMENT_SOURCE_UNAVAILABLE"],
  subject: { kind: "none", reason: "Each EID or email in this batch is independently verified against displayed CRM identity before returning its record" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["crm-doc-download/worksheet-archives"],
  example: { records: [exampleRecord] },
});
