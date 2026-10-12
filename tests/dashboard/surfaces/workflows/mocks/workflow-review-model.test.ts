import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it } from "vitest";
import { approveMockRun,initialMockDraft,mockRunLog,mockRunsForDraft,seedMockRuns } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { addMockReviewRecord,discardMockReview,editReviewRecord,restoreMockReview,reviewApprovalError,reviewCanApprove,reviewIsReadOnly,reviewRecords,reviewValue,updateMockReview } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { WorkflowMockReview } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review.js";

const preparation = (id: "emergency-contact" | "onbase" | "oath-upload") => mockRunsForDraft(id, { ...initialMockDraft(id), files: [{ name: "fictional.pdf", size: 1024, digest: "fixture" }] }, 1);
describe("complete workflow presentation mocks", () => {
  it("keeps manual identity provenance, selection gates and each approved person's edited values", () => {
    const runs = preparation("emergency-contact"), source = runs.find(run => run.workflowId === "ocr")!, original = reviewRecords(source)[0];
    const edited = editReviewRecord(editReviewRecord(original, "employeeId", "10000009"), "contactName", "Sam Lee");
    expect(edited.match).toBe("manual"); expect(edited.warnings).toEqual([]);
    for (const invalid of ["1000000", "12000001", "100000001", "10abcdef"]) {
      const invalidRecord = editReviewRecord(edited, "employeeId", invalid);
      expect(reviewCanApprove(invalidRecord)).toBe(false);
      expect(reviewApprovalError(invalidRecord)).toBe("Employee ID must start with 10 and contain eight digits.");
      expect(reviewApprovalError(editReviewRecord(invalidRecord, "employeeId", "10000009"))).toBeUndefined();
    }
    expect(reviewCanApprove({ ...edited, unknown: true })).toBe(false);
    expect(reviewCanApprove(editReviewRecord(edited, "employeeId", "x"))).toBe(false);
    const updated = updateMockReview(runs, source.id, [edited, { ...edited, id: "person-2", selected: false }]);
    const approved = approveMockRun(updated, source.id), children = approved.filter(run => run.role === "person");
    expect(children).toHaveLength(1); expect(children[0].workflowId).toBe("emergency-contact");
    expect(reviewValue(children[0].inputRecord!, "contactName")).toBe("Sam Lee");
    expect(reviewRecords(children[0])).toEqual([]); expect(children[0].records).toBeUndefined();
    expect(mockRunLog(children[0]).steps.flatMap(step => step.entries).some(entry => entry.kind === "fields" && entry.fields.some(field => field.value === "Sam Lee"))).toBe(true);
    expect(original.match).toBe("matched"); expect(reviewValue(original, "employeeId")).toBe("10000001");
    expect(() => approveMockRun(runs, "missing")).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    expect(() => approveMockRun(runs, runs[0].id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    expect(() => approveMockRun([source], source.id)).toThrow("MOCK_APPROVAL_PARENT_MISSING");
    expect(() => approveMockRun(approved, source.id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
  });
  it("adds unresolved records and refuses zero valid selections or discarded preparations", () => {
    const runs = preparation("onbase"), source = runs.find(run => run.workflowId === "ocr")!, records = addMockReviewRecord(reviewRecords(source));
    expect(records).toHaveLength(2); expect(records[1].selected).toBe(false); expect(records[1].match).toBe("unresolved");
    const empty = updateMockReview(runs, source.id, records.map(record => ({ ...record, selected: false })));
    expect(() => approveMockRun(empty, source.id)).toThrow("MOCK_APPROVAL_NO_RECORDS");
    const discarded = discardMockReview(empty, source.id);
    expect(() => approveMockRun(discarded, source.id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    expect(discarded).toHaveLength(2); expect(discarded.every(run => run.discarded)).toBe(true);
    const restored = restoreMockReview(discarded, source.id), ocr = restored.find(run => run.id === source.id)!;
    expect(reviewRecords(ocr)).toEqual(records.map(record => ({ ...record, selected: false })));
    expect(reviewIsReadOnly(ocr)).toBe(false);
    expect(() => restoreMockReview(runs, source.id)).toThrow("MOCK_REVIEW_RESTORE_UNAVAILABLE");
    expect(() => restoreMockReview([{ ...discarded[1], approved: true }], source.id)).toThrow("MOCK_REVIEW_RESTORE_UNAVAILABLE");
    expect(mockRunLog(discarded[1]).timeline.every(step => step.state === "cancelled")).toBe(true);
  });
  it("keeps records and approval exclusively in delegated OCR, including I-9 intake", () => {
    const runs = mockRunsForDraft("i9-check", { ...initialMockDraft("i9-check"), files: [{ name: "i9.pdf", size: 1024, digest: "fixture" }] }, 2);
    const ocr = runs[1]; expect(runs).toHaveLength(2); expect(ocr.workflowId).toBe("ocr"); expect(ocr.parentId).toBe(runs[0].id);
    const corrected = editReviewRecord(reviewRecords(ocr)[0], "firstName", "Sam");
    const updated = updateMockReview(runs, ocr.id, [corrected]);
    expect(reviewIsReadOnly(ocr)).toBe(false); expect(reviewIsReadOnly(runs[0])).toBe(true); expect(reviewRecords(runs[0])).toEqual([]);
    const approved = approveMockRun(updated, ocr.id), child = approved.find(run => run.role === "person")!;
    expect(reviewValue(child.inputRecord!, "firstName")).toBe("Sam"); expect(child.records).toBeUndefined();
    expect(mockRunLog(child).steps.at(-1)!.entries.some(entry => entry.kind === "fields" && entry.fields.some(field => field.label === "Employee" && field.value === "Sam Lee"))).toBe(true);
    expect(reviewIsReadOnly(approved.find(run => run.id === ocr.id)!)).toBe(true);
    expect(() => updateMockReview(runs, runs[0].id, reviewRecords(ocr))).toThrow("MOCK_REVIEW_READ_ONLY");
  });
  it("renders every extracted field, including blanks and extra response fields, as editable before approval", () => {
    const run = seedMockRuns().find(run => run.workflowId === "ocr")!;
    for (const formType of ["oath", "emergency-contact", "onbase-emergency-contact", "verify", "i9"]) {
      const source = { ...run, records: undefined, draft: { ...run.draft, formType } };
      const record = reviewRecords(source)[0];
      expect(record.fields.some(field => field.readOnly)).toBe(false);
      const markup = renderToStaticMarkup(createElement(WorkflowMockReview, { run: source, onChange: () => {}, onApprove: () => {}, onRestore: () => {} }));
      for (const field of record.fields) {
        expect(markup).toContain(field.label);
        expect(editReviewRecord(record, field.key, field.kind === "boolean" ? "false" : "changed").fields).toContainEqual(expect.objectContaining({ key: field.key, value: field.kind === "boolean" ? "false" : "changed" }));
      }
      if (record.kind === "contact") for (const key of ["employeeName", "employeeHomePhone", "employeeStreet", "personalEmail", "street", "homePhone", "workPhone"]) expect(markup).toContain(`name="${key}"`);
      if (record.kind === "verify") for (const key of ["serviceDate", "oathDate", "i9Status", "i9Signer"]) expect(record.fields.map(field => field.key)).not.toContain(key);
      if (record.kind === "i9") for (const key of ["middleInitial", "dateOfBirth", "ssn", "hireDate"]) expect(markup).toContain(`name="${key}"`);
    }
    const record = reviewRecords(run)[0];
    const extra = { ...record, fields: [...record.fields, { key: "providerExtra", label: "Additional extracted field", value: "", section: "Other" }] };
    const markup = renderToStaticMarkup(createElement(WorkflowMockReview, { run: { ...run, records: [extra] }, onChange: () => {}, onRestore: () => {} }));
    expect(markup).toContain('name="providerExtra"');
    expect(() => editReviewRecord(record, "missing", "changed")).toThrow("MOCK_REVIEW_FIELD_UNKNOWN");
    const proof = { ...record, fields: [{ key: "proof", label: "System proof", value: "Original", readOnly: true }] };
    expect(() => editReviewRecord(proof, "proof", "changed")).toThrow("MOCK_REVIEW_FIELD_READ_ONLY");
  });
});
