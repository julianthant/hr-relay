import { z } from "zod";
import { ArtifactIdSchema, CommandIdSchema, EidSchema, FingerprintSchema, RunIdSchema, StableRecordIdSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ReadApprovedOcrRecords } from "../../processing/ocr/read-approved-records.js";
import { ReadWorkbookReference, WorkbookReferenceFactsSchema } from "../../processing/workbooks/read-reference.js";
import { WorkflowWorkbookResultSchema } from "../../processing/workbooks/read-result.js";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { ReadRetentionRow, I9CheckRowsSchema } from "./check.js";
import { I9CheckCanonicalInput, I9CheckPersonSchema } from "./input.js";
import { I9CheckStartCanonicalInput, I9_CHECK_START_EXAMPLE } from "./start.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";

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
const personExample = I9CheckPersonSeedSchema.parse({
  eid: exampleEid, ocrRunId: "00000000-0000-4000-8000-000000000001", recordId: `i9-person:${exampleEid}`,
  person: { name: "Example, Person", firstName: "Person", lastName: "Example", sourcePages: [1], useMatch: false },
  sources: [{ documentId: I9_CHECK_START_EXAMPLE.documents[0].document.id,
    documentSha256: I9_CHECK_START_EXAMPLE.documents[0].document.sha256,
    ocrRunId: "00000000-0000-4000-8000-000000000001", snapshotId: "00000000-0000-4000-8000-000000000002",
    recordId: `${I9_CHECK_START_EXAMPLE.documents[0].document.sha256}#i9#1`, sourcePage: 1 }],
});
const referenceExample = WorkbookReferenceFactsSchema.parse({
  libraryId: "reference-library", version: 1, versionId: "selected-version", versionName: "Selected version",
  typeId: "action-history", keyFieldId: "eid", worksheets: [{ sheetId: "history", name: "Action History" }],
  rows: [{ key: personExample.eid, state: "missing", matches: [] }],
});
const policy = {
  effect: "read", errorCodes: ["I9_CHECK_DATA_INVALID", "WORKBOOK_INVALID"],
  subject: { kind: "none", reason: "Derives source-bound batch facts from approved records and captured reference observations" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
} as const;
export const ReadI9CheckPeople = defineTaskContract({
  ...policy, id: taskId("workflow:i9-check-start/read-people"), title: "Group approved I-9 sections by person",
  input: z.strictObject({ request: I9CheckStartCanonicalInput, selection: ReadApprovedOcrRecords.output }),
  output: I9CheckPeopleSchema, example: { people: [personExample] },
});
export const ReadI9CheckRequests = defineTaskContract({
  ...policy, id: taskId("workflow:i9-check-start/read-requests"), title: "Bind the selected roster rows",
  input: z.strictObject({ request: I9CheckStartCanonicalInput, people: I9CheckPeopleSchema, reference: ReadWorkbookReference.output }),
  output: z.strictObject({ people: I9CheckPeopleSchema.shape.people, children: z.array(I9CheckCanonicalInput).min(1), reference: WorkbookReferenceFactsSchema }),
  example: { people: [personExample], reference: referenceExample, children: [{
    asOf: I9_CHECK_START_EXAMPLE.asOf, reviewerName: I9_CHECK_START_EXAMPLE.reviewerName,
    ocrRunId: personExample.ocrRunId, recordId: personExample.recordId, person: personExample.person, roster: { rows: [] },
  }] },
});
export const I9CheckBatchRowsSchema = z.strictObject({
  batchKey: FingerprintSchema, personCount: z.number().int().positive(), tracker: I9CheckRowsSchema,
  reference: WorkbookReferenceFactsSchema,
  people: z.array(z.strictObject({ eid: EidSchema, sources: z.array(I9CheckSourceSchema).min(1), result: ReadRetentionRow.output })).min(1),
}).refine(value => value.personCount === value.people.length && value.personCount === value.tracker.rows.length
  && new Set(value.people.map(person => person.eid)).size === value.personCount
  && value.tracker.rows.every((row, index) => row.recordId === value.people[index]?.result.row.recordId),
"Every approved person requires one matching result row");
const rowsExample = I9CheckBatchRowsSchema.parse({ batchKey: "a".repeat(64), personCount: 1,
  tracker: { rows: [ReadRetentionRow.example.row] }, reference: referenceExample,
  people: [{ eid: personExample.eid, sources: personExample.sources, result: ReadRetentionRow.example }],
});
export const ReadI9CheckRows = defineTaskContract({
  ...policy, id: taskId("workflow:i9-check-start/read-rows"), title: "Collect one retention row per person",
  input: z.strictObject({ batchKey: FingerprintSchema, prepared: ReadI9CheckRequests.output, outcomes: z.array(childRunOutcomeSchema(ReadRetentionRow.output)).min(1) }),
  output: I9CheckBatchRowsSchema, example: rowsExample,
});
export const I9CheckStartResultSchema = I9CheckBatchRowsSchema.safeExtend({ workbook: WorkflowWorkbookResultSchema.options[0] });
export const ReadI9CheckPublication = defineTaskContract({
  ...policy, id: taskId("workflow:i9-check-start/read-publication"), title: "Verify the results workbook and fill the tracker",
  input: z.strictObject({ rows: I9CheckBatchRowsSchema, workbook: WorkflowWorkbookResultSchema }), output: I9CheckStartResultSchema,
  example: { ...rowsExample, workbook: { state: "saved", operationId: "example-publication", libraryId: "results-workbook", version: 1 } },
});
