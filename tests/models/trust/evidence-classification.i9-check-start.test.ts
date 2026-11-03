import assert from "node:assert/strict";
import { it } from "vitest";
import { ReadApprovedOcrRecords } from "../../../src/models/processing/ocr/read-approved-records.js";
import { ReadWorkbookReference } from "../../../src/models/processing/workbooks/read-reference.js";
import { ReadI9CheckPeople, ReadI9CheckRequests, ReadI9CheckRows, ReadI9CheckPublication } from "../../../src/models/workflows/i9-check/batch.js";
import { I9_CHECK_START_EXAMPLE } from "../../../src/models/workflows/i9-check/start.js";
import { evidenceLeaves, classifyEvidenceLeaf, redactEvidenceLeaf, type EvidenceValueScope } from "../../../src/models/trust/evidence-classification.js";
import { WorkflowIdSchema } from "../../../src/rules/identity/ids.js";

const values: readonly { scope: EvidenceValueScope; value: unknown }[] = [
  ...[ReadApprovedOcrRecords, ReadWorkbookReference, ReadI9CheckPeople, ReadI9CheckRequests, ReadI9CheckRows, ReadI9CheckPublication]
    .map(contract => ({ scope: { kind: "task-output" as const, taskId: contract.id }, value: contract.example })),
  { scope: { kind: "task-output", taskId: ReadWorkbookReference.id }, value: { state: "read", reference: ReadI9CheckRequests.example.reference } },
  ...["i9-check-start", "i9-check-start-documents", "i9-check-start-roster-reference", "i9-check-start-retention"].map(id => ({
    scope: { kind: "workflow-input" as const, workflowId: WorkflowIdSchema.parse(id) }, value: I9_CHECK_START_EXAMPLE,
  })),
  ...[["i9-check-start", ReadI9CheckPublication.example], ["i9-check-start-documents", ReadI9CheckPeople.example],
    ["i9-check-start-roster-reference", ReadI9CheckRequests.example], ["i9-check-start-retention", ReadI9CheckPublication.example]]
    .map(([id, value]) => ({ scope: { kind: "workflow-result" as const, workflowId: WorkflowIdSchema.parse(id) }, value })),
];
for (const { scope, value } of values) it(`classifies every I-9 parent evidence leaf for ${JSON.stringify(scope)}`, () => {
  for (const leaf of evidenceLeaves(value)) {
    classifyEvidenceLeaf(scope, leaf.path);
    redactEvidenceLeaf(scope, leaf);
  }
  assert.throws(() => classifyEvidenceLeaf(scope, "unexpected"));
});
