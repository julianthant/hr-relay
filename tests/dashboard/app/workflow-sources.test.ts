import { describe, expect, it } from "vitest";
import { keepsMockRun, productWorkflowComposition } from "../../../src/dashboard/app/workflow-sources.js";
import { initialMockDraft, mockNeedsReview, mockReviewRun, mockRunSubset, mockRunsForDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";

describe("product composition keeps the hidden OCR child of a mock host", () => {
  const draft = { ...initialMockDraft("i9-check-start"), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }] };

  it("resolves the host's review to its pending OCR child", () => {
    const composition = productWorkflowComposition();
    const kept = mockRunSubset(mockRunsForDraft("i9-check-start", draft, 1), run => keepsMockRun(composition, run));
    const host = kept.find(run => run.workflowId === "i9-check-start")!;
    const child = mockReviewRun(host, kept);
    expect(child.workflowId).toBe("ocr");
    expect(host.ocrRunId).toBe(child.id);
    expect(mockNeedsReview(child)).toBe(true);
  });

  it("still drops runs of workflows the composition does not own", () => {
    const composition = productWorkflowComposition();
    expect(keepsMockRun(composition, { ...mockRunsForDraft("i9-check-start", draft, 1)[0], workflowId: "person-lookup" })).toBe(false);
  });
});
