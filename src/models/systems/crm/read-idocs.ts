import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { CrmLocatedPersonSchema, CrmDocumentRecordsSchema, CrmDownloadedPeopleSchema } from "./documents.js";

const exampleRecord = CrmLocatedPersonSchema.parse({ subject: { kind: "email", value: "fixture@example.test" }, identity: {
  recordId: "fixture-record", eid: null, workEmail: "fixture@example.test", personalEmail: null,
} });

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
