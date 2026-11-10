import { z } from "zod";
import { ArtifactIdSchema, CommandIdSchema, EidSchema, FingerprintSchema, RunIdSchema, StableRecordIdSchema } from "../../../rules/identity/ids.js";
import { WorkbookReferenceReadSchema } from "../../processing/workbooks/read-reference.js";
import { WorkflowWorkbookResultSchema } from "../../processing/workbooks/read-result.js";
import { I9CheckRowsSchema } from "./check.js";
import { ReadRetentionRow } from "./read-retention-row.js";
import { I9CheckPersonSchema } from "./input.js";
import { I9_CHECK_REFERENCE, I9_CHECK_START_EXAMPLE } from "./start.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { deriveStableUuid } from "../../../rules/identity/stable-uuid.js";

export const I9CheckSourceSchema = z.strictObject({
  documentId: ArtifactIdSchema, documentSha256: FingerprintSchema, ocrRunId: RunIdSchema,
  snapshotId: CommandIdSchema, recordId: StableRecordIdSchema, sourcePage: z.number().int().positive(),
});
export const I9CheckPersonSeedSchema = z.strictObject({
  eid: EidSchema, ocrRunId: RunIdSchema, recordId: z.string().min(1),
  person: I9CheckPersonSchema, sources: z.array(I9CheckSourceSchema).min(1),
});
export const I9CheckPeopleSchema = z.strictObject({ people: z.array(I9CheckPersonSeedSchema).min(1) })
  .refine(value => new Set(value.people.map(person => person.eid)).size === value.people.length, "An approved person appears once per batch");
const exampleEid = CANONICAL_FIELDS.eid.schema.parse(CANONICAL_FIELDS.eid.examples[0]);
export const I9_CHECK_PERSON_EXAMPLE = I9CheckPersonSeedSchema.parse({
  eid: exampleEid, ocrRunId: "00000000-0000-4000-8000-000000000001", recordId: deriveStableUuid("i9-check-person", exampleEid),
  person: { name: "Example, Person", firstName: "Person", lastName: "Example", sourcePages: [1], useMatch: false },
  sources: [{ documentId: I9_CHECK_START_EXAMPLE.documents[0].document.id,
    documentSha256: I9_CHECK_START_EXAMPLE.documents[0].document.sha256,
    ocrRunId: "00000000-0000-4000-8000-000000000001", snapshotId: "00000000-0000-4000-8000-000000000002",
    recordId: `${I9_CHECK_START_EXAMPLE.documents[0].document.sha256}#i9#1`, sourcePage: 1 }],
});
export const I9_CHECK_REFERENCE_EXAMPLE = WorkbookReferenceReadSchema.shape.reference.parse({
  request: { typeId: "action-history", libraryId: "reference-library", versionId: "selected-version", keys: [I9_CHECK_PERSON_EXAMPLE.eid], fields: [...I9_CHECK_REFERENCE.fields] },
  snapshot: { libraryId: "reference-library", version: 1, versionId: "selected-version", versionName: "Selected version",
    type: { id: "action-history", name: "Action History", keyFieldId: "eid", fields: [...I9_CHECK_REFERENCE.fields], defaultWorkbookId: "reference-library" },
    worksheets: [{ sheetId: "history", name: "Action History" }], rows: [{ key: I9_CHECK_PERSON_EXAMPLE.eid, state: "missing", matches: [] }],
  },
});

export const I9_CHECK_BATCH_TASK_POLICY = {
  effect: "read", errorCodes: ["I9_CHECK_DATA_INVALID", "WORKBOOK_INVALID"],
  subject: { kind: "none", reason: "Derives source-bound batch facts from approved records and captured reference observations" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
} as const;

export const I9CheckBatchRowsSchema = z.strictObject({
  batchKey: FingerprintSchema, personCount: z.number().int().positive(), tracker: I9CheckRowsSchema,
  reference: WorkbookReferenceReadSchema.shape.reference,
  people: z.array(z.strictObject({ eid: EidSchema, sources: z.array(I9CheckSourceSchema).min(1), result: ReadRetentionRow.output })).min(1),
}).refine(value => value.personCount === value.people.length && value.personCount === value.tracker.rows.length
  && new Set(value.people.map(person => person.eid)).size === value.personCount
  && value.tracker.rows.every((row, index) => row.recordId === value.people[index]?.result.row.recordId),
"Every approved person requires one matching result row");
export const I9_CHECK_BATCH_ROWS_EXAMPLE = I9CheckBatchRowsSchema.parse({ batchKey: "a".repeat(64), personCount: 1,
  tracker: { rows: [ReadRetentionRow.example.row] }, reference: I9_CHECK_REFERENCE_EXAMPLE,
  people: [{ eid: I9_CHECK_PERSON_EXAMPLE.eid, sources: I9_CHECK_PERSON_EXAMPLE.sources, result: ReadRetentionRow.example }],
});

export const I9CheckStartResultSchema = I9CheckBatchRowsSchema.safeExtend({ workbook: WorkflowWorkbookResultSchema.options[0] });
