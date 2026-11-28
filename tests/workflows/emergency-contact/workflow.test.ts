import { OcrApprovedSnapshotSchema } from "../../../src/models/ocr/review.js";
import { z } from "zod";
import assert from "node:assert/strict";
import { it } from "vitest";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { emergencyContactWorkflow } from "../../../src/workflows/emergency-contact/workflow.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE, EmergencyContactMemberInputSchema } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { ReadApprovedOcrSnapshot } from "../../../src/models/processing/ocr/read-approved-snapshot.js";
import { OCR_INPUT_EXAMPLE, OcrInputSchema } from "../../../src/models/workflows/ocr/input.js";
import { ReadOcrReviewSeed } from "../../../src/models/workflows/ocr/read-review-seed.js";
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
// The OCR review seed is where a record's source page lives; the members delegate files that page.
const reviewed = (recordIds: readonly string[], pageOf = (index: number) => index + 2) => ({ ...ReadOcrReviewSeed.example, records: recordIds.map((recordId, index) => ({ recordId, sourcePage: pageOf(index),
  extractionId: "c".repeat(64), subjectName: null, assertedEid: null, identitySource: "document" as const, rosterMatch: null,
  lookup: { state: "unavailable" as const, reason: "missing-identity" as const }, issues: ["identity-unverified" as const] })) });
const recordIds = [1, 2, 3].map(index => `${"b".repeat(64)}#emergency-contact#${String(index)}`);
function scope(different = false, pageOf?: (index: number) => number, onbaseFiling: "file" | "skip" = "file"): RuntimeScope {
  const second = { ...first, recordId: `${"b".repeat(64)}#emergency-contact#2`, fields: { ...first.fields,
    answers: first.fields.answers.map(answer => different && answer.path === "contact.name" && answer.state === "read"
      ? { ...answer, raw: "Different Contact", value: "Different Contact" } : answer) } };
  const { sourceRunId: _sourceRunId, formType: _formType, approval: _approval, ...input } = OCR_INPUT_EXAMPLE;
  return { input: EmergencyContactInputSchema.parse({ ...input, onbaseFiling }), outputs: {
    "read-document": { state: "done", runId: EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval.sourceRunId, itemId: OCR_INPUT_EXAMPLE.readingId,
      output: OcrWorkflowResultSchema.parse({ review: reviewed(recordIds, pageOf), identities: [],
        approvedSnapshot: EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval }) },
    "approved-records": { snapshot: { ...ReadApprovedOcrSnapshot.example.snapshot, records: [first, second], selectedRecordIds: [first.recordId, second.recordId] } },
  } };
}
it("preserves equal primary effects for the same employee as two ordered approved members", () => {
  const inputs = z.array(EmergencyContactMemberInputSchema).parse(members.bind(scope()));
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
  const bound = z.array(EmergencyContactMemberInputSchema).parse(members.bind({ ...initial, outputs: { ...initial.outputs,
    "approved-records": ReadApprovedOcrSnapshot.output.parse({ snapshot }) } }));
  assert.deepEqual(bound.map(member => member.record), selected);
  assert.deepEqual(bound.map(member => member.record.assertedEid), ["10800002", "10800000"]);
  assert.ok(bound.every(member => member.record.recordId !== records[1]?.recordId));
  assert.ok(bound.every(member => JSON.stringify(member.approval) === JSON.stringify(EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval)));
});

it("gives each member the run's PDF and its record's first source page to file to OnBase", () => {
  const initial = scope();
  const bound = z.array(EmergencyContactMemberInputSchema).parse(members.bind(initial));
  assert.deepEqual(bound.map(member => member.sourcePage), [2, 3]);
  assert.ok(bound.every(member => JSON.stringify(member.document) === JSON.stringify(EmergencyContactInputSchema.parse(initial.input).document)));
});

it("files a person's page once: a later equal-effect record on the same first page gets no source page", () => {
  const same = z.array(EmergencyContactMemberInputSchema).parse(members.bind(scope(false, () => 2)));
  assert.deepEqual(same.map(member => member.sourcePage), [2, null]);
  const apart = z.array(EmergencyContactMemberInputSchema).parse(members.bind(scope(false, index => index + 2)));
  assert.deepEqual(apart.map(member => member.sourcePage), [2, 3]);
});

it("carries the run's OnBase pick to every member and keeps it out of the OCR child's input", () => {
  for (const pick of ["file", "skip"] as const) {
    const picked = scope(false, undefined, pick);
    assert.deepEqual(z.array(EmergencyContactMemberInputSchema).parse(members.bind(picked)).map(member => member.onbaseFiling), [pick, pick]);
    const ocr = descriptorRuntimeNodes(descriptor).find(node => node.id === "read-document");
    assert.ok(ocr?.kind === "child-run");
    assert.equal("onbaseFiling" in OcrInputSchema.parse(ocr.bind({ input: picked.input, outputs: { "read-roster-choice": { choice: null } } })), false);
  }
});

it("refuses a run input without an OnBase pick: the pick has no default", () => {
  const { sourceRunId: _sourceRunId, formType: _formType, approval: _approval, ...input } = OCR_INPUT_EXAMPLE;
  assert.equal(EmergencyContactInputSchema.safeParse(input).success, false);
  assert.equal(EmergencyContactInputSchema.safeParse({ ...input, onbaseFiling: "file" }).success, true);
  assert.equal(EmergencyContactInputSchema.safeParse({ ...input, onbaseFiling: "maybe" }).success, false);
});

it("declares the required OnBase pick and default-on OCR launch field", () => {
  assert.deepEqual(descriptor.surfaces.uploadRun?.fields, [{ kind: "select", field: "onbaseFiling", label: "File to OnBase", required: true,
    options: [{ value: "file", label: "File" }, { value: "skip", label: "Do not file" }] },
  { kind: "boolean", field: "extractWithOcr", label: "Extract with OCR", description: "Turn off to enter records manually in OCR review.", initial: true }]);
});

it("titles an Emergency Contact run by its PDF name, else the generic PDF title", () => {
  const { title } = workflowPlanning(compileWorkflow(emergencyContactWorkflow).descriptor);
  const { sourceRunId: _sourceRunId, formType: _formType, approval: _approval, ...input } = OCR_INPUT_EXAMPLE;
  assert.equal(title({ ...input, onbaseFiling: "file", fileName: "Contacts.pdf" }), "Contacts.pdf");
  assert.equal(title({ ...input, onbaseFiling: "file" }), "Emergency Contact PDF");
});

it("declares one PDF start door whose fields and fixed values the input schema accepts", () => {
  const pdfInput = emergencyContactWorkflow.surfaces?.uploadRun?.pdfInput;
  assert.deepEqual(pdfInput, { documentField: "document", fileNameField: "fileName", readingIdField: "readingId", fixed: { roster: null, reading: { kind: "subscription" } } });
  assert.deepEqual(descriptor.surfaces.uploadRun?.accepts.map(accept => accept.mediaType), ["application/pdf"]);
});
