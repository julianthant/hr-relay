import type { RecordReviewProps } from "../../../../../src/dashboard/surfaces/run-detail/review/review-record-model.js";
import { mockReviewProps } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it } from "vitest";
import { approveMockRun,initialMockDraft,mockRunsForDraft } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { RecordReview } from "../../../../../src/dashboard/surfaces/run-detail/review/review.js";

const preparation = (id: "emergency-contact" | "onbase" | "oath-upload") => mockRunsForDraft(id, { ...initialMockDraft(id), files: [{ name: "fictional.pdf", size: 1024, digest: "fixture" }] }, 1);
describe("complete workflow presentation mocks", () => {
  it("renders an empty OCR result without an editor or enabled approval", () => {
    const runs = preparation("onbase"), source = { ...runs[1], records: [] };
    expect(() => approveMockRun([runs[0], source], source.id)).toThrow("MOCK_APPROVAL_NO_RECORDS");
    const markup = renderToStaticMarkup(createElement(RecordReview, mockReviewProps({ run: source, onChange: () => {}, onApprove: () => {}, onDiscard: () => {}, onRestore: () => {} })));
    expect(markup).toContain("No records extracted"); expect(markup).toContain("disabled"); expect(markup).not.toContain("<input");
    expect(markup).not.toContain("Add record");
  });
});

it("offers native creation on an empty review only when the producer supplies that authority", () => {
  const props: RecordReviewProps = { runId: "synthetic-empty", subject: "Synthetic document", cards: [],
    selectedCount: 0, readOnly: false, discarded: false, onApprove: () => {}, onAdd: () => "created-record" };
  const editable = renderToStaticMarkup(createElement(RecordReview, props));
  expect(editable).toContain("No records extracted"); expect(editable).toContain("Add record");
  const absent = renderToStaticMarkup(createElement(RecordReview, { ...props, onAdd: undefined }));
  expect(absent).not.toContain("Add record");
  const readOnly = renderToStaticMarkup(createElement(RecordReview, { ...props, readOnly: true }));
  expect(readOnly).not.toContain("Add record");
});

it("keeps an unknown boolean distinct from an observed No in editable and read-only records", () => {
  const view: RecordReviewProps = { runId: "synthetic-run", subject: "Synthetic document", readOnly: false, discarded: false, selectedCount: 0,
    cards: [{ name: "Example, Avery", pages: [], record: { id: "synthetic-record", page: 1, kind: "oath", selected: false, warnings: [],
      fields: [{ key: "employeeSigned", label: "Employee signed", kind: "boolean", value: "" }] } }] };
  const editable = renderToStaticMarkup(createElement(RecordReview, view));
  expect(editable).toContain('aria-checked="mixed"');
  const readOnly = renderToStaticMarkup(createElement(RecordReview, { ...view, readOnly: true }));
  expect(readOnly).not.toContain('>No<');
  expect(readOnly).toContain('—');
});
