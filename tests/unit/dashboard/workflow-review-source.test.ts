import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowMockReview } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review.js";
import { mockOperationValue } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-operation-model.js";
import { approveMockRun, initialMockDraft, mockRunLog, mockRunsForDraft, seedMockRuns } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { editReviewRecord, reviewRecords, reviewValue, seedReviewRecords, updateMockReview } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { reviewFieldBlocks, reviewFieldGroups, reviewSourcePages } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-source-model.js";
import { documentSourcePages, OCR_DOCUMENT_FIXTURES } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-document-model.js";

const preparation = () => mockRunsForDraft("emergency-contact", { ...initialMockDraft("emergency-contact"), files: [{ name: "contact.pdf", size: 1024, digest: "fixture" }] }, 1);
describe("OCR source comparison and corrected handoff", () => {
  it("presents extracted oath dates with four-digit years without changing the source image", () => {
    const run = seedMockRuns().find(run => run.id === "mock:oath-signature:sample:ocr")!;
    const markup = renderToStaticMarkup(createElement(WorkflowMockReview, { run, sourcePages: { "person-1": documentSourcePages(run.draft, reviewRecords(run)[0])! }, onChange: () => {}, onRestore: () => {} }));
    expect(markup).toContain('value="04/27/2026"'); expect(markup).toContain('value="04/23/2026"');
    expect(markup).not.toContain('value="04/27/26"'); expect(markup).not.toContain('value="4-23-26"');
    expect(markup).toContain('single-oath-1.webp');
  });
  it("accepts source image URLs separately from the extracted field response", () => {
    const run = preparation()[1];
    const markup = renderToStaticMarkup(createElement(WorkflowMockReview, { run, sourcePages: { "person-1": [{ page: 1, imageUrl: "/retained/source-page-1.png" }] }, onChange: () => {}, onRestore: () => {} }));
    expect(markup).toContain('src="/retained/source-page-1.png"');
    expect(markup).not.toContain("data:image/svg");
    const missing = renderToStaticMarkup(createElement(WorkflowMockReview, { run, sourcePages: {}, onChange: () => {}, onRestore: () => {} }));
    expect(missing).toContain("No source page for this record"); expect(missing).not.toContain("<img");
  });
  it("preserves every response field exactly once in the editor, including blank and unknown fields", () => {
    const record = reviewRecords(preparation()[1])[0];
    const additional = { ...record, fields: [...record.fields, { key: "newKey", label: "Additional field", value: "", section: "Other" }] };
    expect(reviewFieldGroups(additional).flatMap(group => group.fields)).toEqual(additional.fields);
    expect(reviewFieldGroups(additional).map(group => group.title)).toEqual(["Employee", "Employee address", "Emergency contact", "Other"]);
    for (const response of [...OCR_DOCUMENT_FIXTURES.flatMap(document => document.records), additional]) {
      const displayed = reviewFieldGroups(response).flatMap(group => reviewFieldBlocks(group.fields).flat());
      expect(displayed).toEqual(response.fields);
      expect(displayed.every((field, index) => field === response.fields[index])).toBe(true);
      expect(new Set(displayed.map(field => field.key)).size).toBe(response.fields.length);
    }
  });
  it("preserves raw OCR date spellings and unmatched relationship values for correction", () => {
    const run = preparation()[1], record = reviewRecords(run)[0];
    const corrected = editReviewRecord(record, "relationship", "Cousin");
    const raw = { ...corrected, fields: [...corrected.fields, { key: "rawDate", label: "Date as printed", value: "4-23-26", kind: "date" as const }] };
    const markup = renderToStaticMarkup(createElement(WorkflowMockReview, { run: { ...run, records: [raw] }, onChange: () => {}, onRestore: () => {} }));
    expect(markup).toContain('name="rawDate"'); expect(markup).toContain('value="4-23-26"');
    expect(markup).not.toContain('type="date"'); expect(markup).toContain("Cousin");
    const oathRuns = mockRunsForDraft("oath-signature", { ...initialMockDraft("oath-signature"), method: "pdf", files: [{ name: "oath.pdf", size: 1024, digest: "fixture" }] }, 1);
    const oath = oathRuns[1], original = reviewRecords(oath)[0];
    for (const [date, displayed] of [["4-23-26", "4-23-26"], ["2026-04-23", "04/23/2026"], ["", "—"]]) {
      const updated = updateMockReview(oathRuns, oath.id, [editReviewRecord(original, "dateSigned", date)]);
      const child = approveMockRun(updated, oath.id).find(run => run.role === "person")!;
      expect(mockOperationValue(child, "$signedDate")).toBe(displayed);
    }
  });
  it("keeps the source image fixed across corrections and approval, and copies every corrected field", () => {
    const runs = preparation(), source = runs[1], original = reviewRecords(source)[0];
    const image = reviewSourcePages(original)[0].imageUrl;
    const corrected = original.fields.reduce((record, field) => editReviewRecord(record, field.key, field.key === "employeeId" ? "0012345" : field.kind === "boolean" ? "false" : field.kind === "date" ? "2026-08-04" : `${field.value} corrected`), original);
    const updated = updateMockReview(runs, source.id, [corrected]);
    expect(reviewSourcePages(seedReviewRecords(updated[1])[0])[0].imageUrl).toBe(image);
    const approved = approveMockRun(updated, source.id), child = approved.find(run => run.role === "person")!;
    expect(child.inputRecord).toEqual(corrected); expect(child.inputRecord).not.toBe(corrected);
    expect(child.inputRecord!.fields).not.toBe(corrected.fields);
    expect(reviewValue(child.inputRecord!, "employeeId")).toBe("0012345");
    expect(reviewSourcePages(seedReviewRecords(approved.find(run => run.id === source.id)!)[0])[0].imageUrl).toBe(image);
  });
  it("offers both fixed I-9 source pages independently of corrected page fields", () => {
    const run = preparation()[1], original = seedReviewRecords({ ...run, draft: { ...run.draft, formType: "i9" } })[0];
    const pages = reviewSourcePages(original);
    expect(pages.map(page => page.page)).toEqual([1, 2]);
    expect(decodeURIComponent(pages[0].imageUrl)).toContain("Form I-9 · Section 1");
    expect(decodeURIComponent(pages[1].imageUrl)).toContain("Form I-9 · Section 2");
    expect(pages[0].imageUrl).not.toBe(pages[1].imageUrl);
    expect(() => reviewSourcePages({ ...original, fields: original.fields.filter(field => field.key !== "section1") })).toThrow("MOCK_SOURCE_PAGE_INVALID");
  });
  it("escapes extracted source content before rendering a page image", () => {
    const record = reviewRecords(preparation()[1])[0];
    const image = decodeURIComponent(reviewSourcePages(editReviewRecord(record, "contactName", '<script>alert("x")</script> & more'))[0].imageUrl);
    expect(image).not.toContain("<script>"); expect(image).toContain("&lt;script&gt;"); expect(image).toContain("&amp; more");
  });
  it("does not add a synthetic Result stage or a second log section", () => {
    const runs = preparation(), approved = approveMockRun(runs, runs[1].id);
    for (const run of [...runs, ...approved]) {
      const log = mockRunLog(run);
      expect(log.timeline.map(stage => stage.id)).toEqual(log.steps.map(step => step.id));
      expect(log.timeline.some(stage => stage.label === "Result" || stage.id.endsWith(":result"))).toBe(false);
      expect(log.steps.some(step => step.title === "Result" || step.id.endsWith(":result"))).toBe(false);
    }
  });
});
