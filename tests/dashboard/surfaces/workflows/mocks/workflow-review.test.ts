import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it } from "vitest";
import { approveMockRun,initialMockDraft,mockRunsForDraft } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { WorkflowMockReview } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review.js";

const preparation = (id: "emergency-contact" | "onbase" | "oath-upload") => mockRunsForDraft(id, { ...initialMockDraft(id), files: [{ name: "fictional.pdf", size: 1024, digest: "fixture" }] }, 1);
describe("complete workflow presentation mocks", () => {
  it("renders an empty OCR result without an editor or enabled approval", () => {
    const runs = preparation("onbase"), source = { ...runs[1], records: [] };
    expect(() => approveMockRun([runs[0], source], source.id)).toThrow("MOCK_APPROVAL_NO_RECORDS");
    const markup = renderToStaticMarkup(createElement(WorkflowMockReview, { run: source, onChange: () => {}, onApprove: () => {}, onDiscard: () => {}, onRestore: () => {} }));
    expect(markup).toContain("No records extracted"); expect(markup).toContain("disabled"); expect(markup).not.toContain("<input");
  });
});
