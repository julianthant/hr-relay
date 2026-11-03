import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { RunWorkbookReferenceSchema, WorkbookCellValuesSchema } from "../../dashboard/workbooks.js";
import { CrmDocumentRecordsSchema, CrmLocatedPersonSchema } from "../../systems/crm/document-tasks.js";
import { FingerprintSchema, taskId } from "../../../rules/identity/ids.js";
import { CrmWorksheetPersonSchema } from "./documents.js";

const snapshot = RunWorkbookReferenceSchema.shape.snapshot;
const retainedRow = snapshot.shape.rows.element;
const retainedMatch = retainedRow.shape.matches.element;
const cell = WorkbookCellValuesSchema.valueType;
export const CrmDocumentRosterReferenceSchema = RunWorkbookReferenceSchema.safeExtend({ snapshot: snapshot.safeExtend({
  rows: retainedRow.safeExtend({ matches: retainedMatch.safeExtend({ values: z.strictObject({
    email: cell, firstName: cell, lastName: cell, middleName: cell,
    "roster.livedFirstName": cell, "roster.livedLastName": cell, "roster.livedMiddleName": cell,
  }) }).array() }).array(),
}) });

export const CrmDocumentRowCandidateSchema = z.strictObject({ key: z.email(), row: CrmWorksheetPersonSchema.shape.reference });
export const CrmDocumentRowResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("resolved"), selected: CrmDocumentRowCandidateSchema }),
  z.strictObject({ state: z.literal("resolve-required"), reason: z.enum(["row-missing", "row-ambiguous"]), candidates: CrmDocumentRowCandidateSchema.array() })
    .refine(value => value.reason === "row-missing" ? value.candidates.length === 0 : value.candidates.length > 1),
]);
export const CrmDocumentRowsSchema = z.strictObject({
  referenceDigest: FingerprintSchema, state: z.enum(["resolved", "resolve-required"]),
  people: CrmLocatedPersonSchema.extend({ resolution: CrmDocumentRowResolutionSchema }).array().min(1),
}).refine(value => (value.state === "resolved") === value.people.every(person => person.resolution.state === "resolved"));

export const CRM_DOCUMENT_ROW_CHOICE_GATE_ID = "document-row-choice";
export const CrmDocumentRowChoiceSchema = CrmDocumentRowsSchema.safeExtend({ state: z.literal("resolved"), decision: z.literal("selected") });

export const ReadCrmDocumentRows = defineTaskContract({
  id: taskId("workflow:crm-doc-download/read-document-rows"), title: "Resolve worksheet rows", effect: "read",
  input: z.strictObject({ records: CrmDocumentRecordsSchema, reference: CrmDocumentRosterReferenceSchema, referenceDigest: FingerprintSchema }),
  output: CrmDocumentRowsSchema, errorCodes: ["CRM_DOCUMENT_REFERENCE_UNAVAILABLE"],
  subject: { kind: "none", reason: "Binds each verified CRM identity to exact retained reference row membership and legal/lived names" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" },
  scenarios: ["crm-doc-download/worksheet-archives"],
  example: { referenceDigest: "a".repeat(64), state: "resolved", people: [{ ...CrmLocatedPersonSchema.parse({
    subject: { kind: "email", value: "fixture@example.test" },
    identity: { recordId: "fixture-record", eid: null, workEmail: "fixture@example.test", personalEmail: null },
  }), resolution: { state: "resolved", selected: { key: "fixture@example.test", row: {
    worksheetId: "fixture-sheet", worksheetName: "July 6", rowId: "fixture-row",
    names: { legalName: { firstName: "Fixture", lastName: "Person", middleName: "" }, livedName: null },
  } } } }] },
});
