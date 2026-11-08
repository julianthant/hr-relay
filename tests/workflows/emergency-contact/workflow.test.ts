import { OcrApprovedSnapshotSchema } from "../../../src/models/ocr/review.js";
import { z } from "zod";
import assert from "node:assert/strict";
import { it } from "vitest";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { emergencyContactWorkflow } from "../../../src/workflows/emergency-contact/workflow.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { ReadApprovedOcrSnapshot } from "../../../src/models/processing/ocr/read-approved-snapshot.js";
import { OCR_INPUT_EXAMPLE } from "../../../src/models/workflows/ocr/input.js";
import { ReadOcrResult } from "../../../src/models/workflows/ocr/read-result.js";
import { OcrWorkflowResultSchema } from "../../../src/models/workflows/ocr/result.js";
import { descriptorRuntimeNodes, workflowPlanning } from "../../../src/workflow-kit/workflow.js";
import type { RuntimeScope } from "../../../src/models/workflow/graph.js";
import { TaskError } from "../../../src/workflow-kit/errors.js";
import { ApprovedOcrRecordInputSchema } from "../../../src/models/workflows/ocr/approved-record.js";
import { EmergencyContactInputSchema } from "../../../src/models/workflows/emergency-contact/input.js";

const descriptor = compileWorkflow(emergencyContactWorkflow).descriptor;
const members = descriptorRuntimeNodes(descriptor).find(node => node.id === "members");
assert.ok(members?.kind === "child-run" && members.cardinality === "many");
const first = EMERGENCY_CONTACT_MEMBER_EXAMPLE.record;
function scope(different = false): RuntimeScope {
  const second = { ...first, recordId: `${"b".repeat(64)}#emergency-contact#2`, fields: { ...first.fields,
    answers: first.fields.answers.map(answer => different && answer.path === "contact.name" && answer.state === "read"
      ? { ...answer, raw: "Different Contact", value: "Different Contact" } : answer) } };
  const { sourceRunId: _sourceRunId, formType: _formType, approval: _approval, ...input } = OCR_INPUT_EXAMPLE;
  return { input: EmergencyContactInputSchema.parse(input), outputs: {
    "read-document": { state: "done", runId: EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval.sourceRunId, itemId: OCR_INPUT_EXAMPLE.readingId,
      output: OcrWorkflowResultSchema.parse({ ...ReadOcrResult.example, approvedSnapshot: EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval }) },
    "approved-records": { snapshot: { ...ReadApprovedOcrSnapshot.example.snapshot, records: [first, second], selectedRecordIds: [first.recordId, second.recordId] } },
  } };
}
it("preserves equal primary effects for the same employee as two ordered approved members", () => {
  const inputs = z.array(ApprovedOcrRecordInputSchema).parse(members.bind(scope()));
  assert.equal(inputs.length, 2);
  const records = inputs.map(input => input.record);
  assert.deepEqual(records.map(record => record.recordId), [first.recordId, `${"b".repeat(64)}#emergency-contact#2`]);
  assert.deepEqual(records.map(record => record.fields), [first.fields, first.fields]);
});
it("refuses conflicting primary effects for one employee at the actual parent member binder", () => {
  assert.throws(() => members.bind(scope(true)), (error: unknown) => error instanceof TaskError && error.code === "CONTACT_APPROVED_PLAN_CONFLICT");
});

it("binds a three-record approved subset in selected order through the registered shared graph", () => {
  const records = [0, 1, 2].map(index => ApprovedOcrRecordInputSchema.shape.record.parse({ ...first,
    recordId: `${"b".repeat(64)}#emergency-contact#${String(index + 1)}`, assertedEid: String(10800000 + index) }));
  const selected = [records[2], records[0]];
  const snapshot = OcrApprovedSnapshotSchema.parse({ ...ReadApprovedOcrSnapshot.example.snapshot,
    records: selected, selectedRecordIds: selected.map(record => record?.recordId) });
  const initial = scope();
  const bound = z.array(ApprovedOcrRecordInputSchema).parse(members.bind({ ...initial, outputs: { ...initial.outputs,
    "approved-records": ReadApprovedOcrSnapshot.output.parse({ snapshot }) } }));
  assert.deepEqual(bound.map(member => member.record), selected);
  assert.deepEqual(bound.map(member => member.record.assertedEid), ["10800002", "10800000"]);
  assert.ok(bound.every(member => member.record.recordId !== records[1]?.recordId));
  assert.ok(bound.every(member => JSON.stringify(member.approval) === JSON.stringify(EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval)));
});

it("titles an Emergency Contact run by its PDF name, else the generic PDF title", () => {
  const { title } = workflowPlanning(compileWorkflow(emergencyContactWorkflow).descriptor);
  const { sourceRunId: _sourceRunId, formType: _formType, approval: _approval, ...input } = OCR_INPUT_EXAMPLE;
  assert.equal(title({ ...input, fileName: "Contacts.pdf" }), "Contacts.pdf");
  assert.equal(title(input), "Emergency Contact PDF");
});

it("declares one PDF start door whose fields and fixed values the input schema accepts", () => {
  const pdfInput = emergencyContactWorkflow.surfaces?.uploadRun?.pdfInput;
  assert.deepEqual(pdfInput, { documentField: "document", fileNameField: "fileName", readingIdField: "readingId", fixed: { roster: null, reading: { kind: "subscription" } } });
  assert.deepEqual(descriptor.surfaces.uploadRun?.accepts.map(accept => accept.mediaType), ["application/pdf"]);
});
