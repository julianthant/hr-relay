import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { RunWorkbookNamedReferenceSchema, WorkbookCellValuesSchema } from "../../dashboard/workbooks.js";
import { CrmDocumentRecordsSchema, CrmLocatedPersonSchema } from "../../systems/crm/documents.js";
import { FingerprintSchema, taskId } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { CrmWorksheetPersonSchema } from "./documents.js";

const snapshot = RunWorkbookNamedReferenceSchema.shape.snapshot;
const retainedRow = snapshot.shape.rows.element;
const retainedMatch = retainedRow.shape.matches.element;
const cell = WorkbookCellValuesSchema.valueType;
export const CrmDocumentRosterReferenceSchema = RunWorkbookNamedReferenceSchema.safeExtend({ snapshot: snapshot.safeExtend({
  rows: retainedRow.safeExtend({ matches: retainedMatch.safeExtend({ values: z.strictObject({
    email: cell, firstName: cell, lastName: cell, middleName: cell,
    "roster.livedFirstName": cell, "roster.livedLastName": cell, "roster.livedMiddleName": cell,
  }) }).array() }).array(),
}) });

export const CrmDocumentRowCandidateSchema = z.strictObject({
  key: z.email(), referenceDigest: FingerprintSchema, row: CrmWorksheetPersonSchema.shape.reference,
});
export const CrmDocumentRowResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("resolved"), selected: CrmDocumentRowCandidateSchema }),
  z.strictObject({ state: z.literal("resolve-required"), reason: z.enum(["row-missing", "row-ambiguous"]), candidates: CrmDocumentRowCandidateSchema.array() })
    .refine(value => value.reason === "row-missing" ? value.candidates.length === 0 : value.candidates.length > 1),
]);
export const CrmDocumentRowsSchema = z.strictObject({
  referenceDigest: FingerprintSchema, sourceDigests: FingerprintSchema.array().min(1),
  state: z.enum(["resolved", "resolve-required"]),
  people: CrmLocatedPersonSchema.extend({ resolution: CrmDocumentRowResolutionSchema }).array().min(1),
}).refine(value => {
  const [only] = value.sourceDigests;
  const digest = value.sourceDigests.length === 1 ? only : sha256Hex(canonicalJsonStringify(value.sourceDigests));
  return digest === value.referenceDigest && new Set(value.sourceDigests).size === value.sourceDigests.length
    && (value.state === "resolved") === value.people.every(person => person.resolution.state === "resolved");
});

export const CRM_DOCUMENT_ROW_CHOICE_GATE_ID = "document-row-choice";
export const CrmDocumentRowChoiceSchema = CrmDocumentRowsSchema.safeExtend({ state: z.literal("resolved"), decision: z.literal("selected") });

export const CrmDocumentReferenceSourceSchema = z.strictObject({
  referenceDigest: FingerprintSchema, reference: CrmDocumentRosterReferenceSchema,
});
export const ReadCrmDocumentRows = defineTaskContract({
  id: taskId("workflow:crm-doc-download/read-document-rows"), title: "Resolve worksheet rows", effect: "read",
  input: z.strictObject({ records: CrmDocumentRecordsSchema, sources: CrmDocumentReferenceSourceSchema.array().min(1) }),
  output: CrmDocumentRowsSchema, errorCodes: ["CRM_DOCUMENT_REFERENCE_UNAVAILABLE"],
  subject: { kind: "none", reason: "Binds each verified CRM identity to exact retained reference row membership and legal/lived names" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" },
  scenarios: ["crm-doc-download/worksheet-archives"],
  example: { referenceDigest: "a".repeat(64), sourceDigests: ["a".repeat(64)], state: "resolved", people: [{ ...CrmLocatedPersonSchema.parse({
    subject: { kind: "email", value: "fixture@example.test" },
    identity: { recordId: "fixture-record", eid: null, workEmail: "fixture@example.test", personalEmail: null },
  }), resolution: { state: "resolved", selected: { key: "fixture@example.test", referenceDigest: "a".repeat(64), row: {
    referenceDigest: "a".repeat(64), worksheetId: "fixture-sheet", worksheetName: "July 6", rowId: "fixture-row",
    names: { legalName: { firstName: "Fixture", lastName: "Person", middleName: "" }, livedName: null },
  } } } }] },
});
