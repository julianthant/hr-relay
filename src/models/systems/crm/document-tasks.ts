import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { ArtifactRefSchema, NamedArtifactFileNameSchema } from "../../artifacts/artifacts.js";
import { CrmDocumentIdentitySchema, CrmDocumentSubjectSchema } from "./read-idocs.js";

export const CrmLocatedPersonSchema = z.strictObject({ subject: CrmDocumentSubjectSchema, identity: CrmDocumentIdentitySchema });
export const CrmDocumentRecordsSchema = z.strictObject({ records: CrmLocatedPersonSchema.array().min(1) });
export const CrmRetainedDocumentSchema = z.strictObject({ index: z.number().int().nonnegative(), fileName: NamedArtifactFileNameSchema, artifact: ArtifactRefSchema });
export const CrmDownloadedPeopleSchema = z.strictObject({ people: z.array(CrmLocatedPersonSchema.extend({
  totalDocuments: z.number().int().positive(), documents: CrmRetainedDocumentSchema.array().min(1),
})).min(1) });

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

export const CrmReadIdocs = defineTaskContract({
  id: taskId("crm/read-idocs"), title: "Download verified CRM PDFs", effect: "read",
  input: CrmDocumentRecordsSchema.extend({ docIndices: z.number().int().nonnegative().array().min(1).optional() }),
  output: CrmDownloadedPeopleSchema, errorCodes: ["CRM_DOCUMENT_DOWNLOAD_FAILED"], artifacts: "content-addressed",
  subject: { kind: "none", reason: "Each selected record is reopened and its displayed EID or email is verified before downloading that person's PDFs" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["crm-doc-download/worksheet-archives"],
  example: { people: [{ ...exampleRecord, totalDocuments: 1,
    documents: [{ index: 0, fileName: "Signed Offer Letter.pdf", artifact: ArtifactRefSchema.parse({
      id: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64), bytes: 10, mediaType: "application/pdf",
    }) }] }] },
});
