import { z } from "zod";
import { ARTIFACT_COLLECTION_MEDIA_TYPE } from "../../artifacts/artifacts.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { CrmDocumentArchivesSchema, CrmWorksheetArchiveSchema, CrmWorksheetPersonSchema } from "./documents.js";

const worksheet = CrmWorksheetArchiveSchema.parse({ relativePath: "July 6/July 6.zip", referenceDigest: "a".repeat(64), worksheetId: "fixture-sheet", worksheetName: "July 6",
  artifact: { id: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64), bytes: 100, mediaType: "application/zip" },
  people: [{ identity: { recordId: "fixture-record", eid: null, workEmail: "fixture@example.test", personalEmail: null },
    rowId: "fixture-row", folderName: "Person, Fixture EID", documentCount: 1 }] });

export const ReadCrmWorksheetArchives = defineTaskContract({
  id: taskId("workflow:crm-doc-download/read-worksheet-archives"), title: "Package worksheet archives", effect: "read",
  input: z.strictObject({ people: CrmWorksheetPersonSchema.array().min(1) }), output: CrmDocumentArchivesSchema,
  artifacts: "content-addressed", errorCodes: ["CRM_DOCUMENT_PACKAGE_FAILED"],
  subject: { kind: "none", reason: "Packages verified PDF artifacts using each person's retained reference row and legal/lived name values" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" },
  scenarios: ["crm-doc-download/worksheet-archives"],
  example: CrmDocumentArchivesSchema.parse({ collection: { files: [{ relativePath: worksheet.relativePath, artifact: worksheet.artifact }],
    artifact: { id: "22222222-2222-4222-8222-222222222222", sha256: "b".repeat(64), bytes: 300, mediaType: ARTIFACT_COLLECTION_MEDIA_TYPE } },
    worksheets: [worksheet], worksheetCount: 1, personCount: 1, documentCount: 1 }),
});
