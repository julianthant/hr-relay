import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OCR_DOCUMENT_FIXTURES, documentSourcePages, mockDocumentFixture } from "../../../src/dashboard/surfaces/workflow-document-model.js";
import { approveMockRun, mockDeletionIds, mockRetrySource, mockRunsForDraft, seedMockRuns } from "../../../src/dashboard/surfaces/workflow-mock-model.js";
import { editReviewRecord, reviewRecords, updateMockReview } from "../../../src/dashboard/surfaces/workflow-review-model.js";
import { WorkflowMockReview } from "../../../src/dashboard/surfaces/workflow-review.js";
import { mockQueueSurface } from "../../../src/dashboard/surfaces/workflow-queue-model.js";
import { runDisplayId } from "../../../src/dashboard/surfaces/run-display-model.js";

describe("document-complete OCR previews", () => {
  it("covers the exact six supplied PDFs and their page and record counts", () => {
    expect(OCR_DOCUMENT_FIXTURES.map(doc => [doc.name, doc.pages.length, doc.records.length])).toEqual([
      ["single-oath.pdf", 1, 1], ["multiple-oath.pdf", 4, 4], ["emergency-contacts.pdf", 3, 3],
      ["i9.pdf", 4, 2], ["detect-test.pdf", 7, 7], ["sick-hours.pdf", 3, 1],
    ]);
    const ocr = seedMockRuns().filter(run => run.workflowId === "ocr");
    expect(ocr.map(run => run.subject).sort()).toEqual(OCR_DOCUMENT_FIXTURES.map(doc => doc.name).sort());
    expect(ocr.every(run => run.parentId && run.targetWorkflowId)).toBe(true);
    expect(ocr.reduce((count, run) => count + reviewRecords(run).length, 0)).toBe(18);
  });
  it("renders every document response field, including blank, boolean and unresolved values", () => {
    for (const run of seedMockRuns().filter(run => run.workflowId === "ocr")) for (const record of reviewRecords(run)) {
      const markup = renderToStaticMarkup(createElement(WorkflowMockReview, { run: { ...run, records: [record] }, onChange: () => {}, onApprove: () => {}, onRestore: () => {} }));
      for (const field of record.fields) expect(markup).toContain(field.label.replaceAll("&", "&amp;"));
      expect(record.fields.some(field => field.value === "")).toBe(true);
    }
    const mixed = seedMockRuns().find(run => run.subject === "detect-test.pdf" && run.workflowId === "ocr")!;
    expect(reviewRecords(mixed).map(record => record.kind)).toEqual(["contact", "contact", "oath", "contact", "oath", "contact", "oath"]);
    expect(reviewRecords(mixed)[1]).toMatchObject({ match: "unresolved", selected: false });
  });
  it("retains the original image URLs and reverse-order I-9 page pairing across corrections", () => {
    const run = seedMockRuns().find(run => run.subject === "i9.pdf" && run.workflowId === "ocr")!;
    expect(reviewRecords(run).map(record => documentSourcePages(run.draft, record)!.map(page => page.page))).toEqual([[2, 1], [4, 3]]);
    const original = reviewRecords(run)[0], pages = documentSourcePages(run.draft, original);
    const edited = editReviewRecord(original, "firstName", "Corrected");
    expect(documentSourcePages(run.draft, edited)).toEqual(pages);
    expect(pages!.every(page => /i9-\d\.webp/u.test(page.imageUrl))).toBe(true);
    expect(mockDocumentFixture({ files: [{ ...run.draft.files[0], digest: "user-upload" }] })).toBeUndefined();
    expect(() => documentSourcePages(run.draft, { ...original, page: 90 })).toThrow("MOCK_DOCUMENT_PAGE_MISSING");
  });
  it("copies all corrected mixed-form fields to the appropriate preview and preserves the source history", () => {
    const runs = seedMockRuns(), run = runs.find(run => run.subject === "detect-test.pdf" && run.workflowId === "ocr")!;
    const records = reviewRecords(run).map(record => ({ ...editReviewRecord(record, "employeeId", "0012345"), selected: true }));
    const updated = updateMockReview(runs, run.id, records), approved = approveMockRun(updated, run.id);
    const children = approved.filter(child => child.ocrRunId === run.id && child.role === "person");
    expect(children).toHaveLength(7);
    expect(children.map(child => child.workflowId)).toEqual(["emergency-contact", "emergency-contact", "oath-signature", "emergency-contact", "oath-signature", "emergency-contact", "oath-signature"]);
    children.forEach((child, index) => { expect(child.inputRecord).toEqual(records[index]); expect(child.inputRecord).not.toBe(records[index]); });
    expect(reviewRecords(run)[1].match).toBe("unresolved");
  });
  it("retries a delegated document with its original schema and deletes a complete local tree", () => {
    const runs = seedMockRuns(), parent = runs.find(run => run.workflowId === "separations")!;
    const retried = mockRunsForDraft(parent.workflowId, parent.draft, 100, parent.id);
    expect(retried).toHaveLength(2); expect(retried[1].subject).toBe("sick-hours.pdf");
    expect(reviewRecords(retried[1])[0].kind).toBe("separation");
    const ocr = runs.find(run => run.workflowId === "ocr" && run.parentId === parent.id)!;
    const approved = approveMockRun(runs, ocr.id), ids = mockDeletionIds(approved, ocr.id);
    expect(ids).toContain(parent.id); expect(ids).toContain(ocr.id); expect(ids).toHaveLength(3);
    expect(approved.filter(run => !ids.includes(run.id)).some(run => run.parentId && ids.includes(run.parentId))).toBe(false);
    expect(() => mockDeletionIds(runs, "missing")).toThrow("MOCK_DELETE_TARGET_MISSING");
  });
  it("uses stable uppercase workflow aliases with eight decimal digits without changing command IDs", () => {
    const rows = seedMockRuns().map(run => mockQueueSurface(run, "2026-08-03"));
    const aliases = rows.map(row => runDisplayId(row.runId, row.traceId));
    expect(aliases.every(alias => /^[A-Z0-9]{1,4}\d{8}$/u.test(alias))).toBe(true);
    expect(new Set(aliases).size).toBe(rows.length);
    const row = rows.find(row => row.workflowId === "separations")!;
    expect(runDisplayId(row.runId, row.traceId)).toMatch(/^SP\d{8}$/u);
    expect(row.runId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(runDisplayId(row.runId, row.traceId)).toBe(runDisplayId(row.runId, row.traceId));
  });
  it("retries delegation-only lookups through their exact OCR and runnable parent", () => {
    const runs = seedMockRuns(), lookup = runs.find(run => run.workflowId === "i9-lookup")!;
    const ocr = runs.find(run => run.id === lookup.parentId)!;
    expect(ocr).toMatchObject({ workflowId: "ocr", subject: "detect-test.pdf" });
    const source = mockRetrySource(runs, lookup.id);
    expect(source).toBe(runs.find(run => run.id === ocr.parentId));
    expect(source.workflowId).toBe("onbase");
    expect(mockRetrySource(runs, source.id)).toBe(source);
    expect(mockDeletionIds(runs, ocr.id)).toContain(lookup.id);
    expect(() => mockRetrySource(runs.filter(run => run.id !== source.id), lookup.id)).toThrow("MOCK_RETRY_SOURCE_MISSING");
    expect(() => mockRetrySource([{ ...lookup, parentId: lookup.id }], lookup.id)).toThrow("MOCK_RETRY_PARENT_CYCLE");
  });
});
