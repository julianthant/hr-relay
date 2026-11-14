import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { keepsMockRun, productWorkflowComposition } from "../../../src/dashboard/app/workflow-sources.js";
import { initialMockDraft, mockNeedsReview, mockReviewRun, mockRunSubset, mockRunsForDraft, seedMockRuns } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";

describe("product composition keeps the hidden OCR child of a mock host", () => {
  const draft = { ...initialMockDraft("emergency-contact"), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }] };

  it("resolves the host's review to its pending OCR child", () => {
    const composition = productWorkflowComposition();
    const kept = mockRunSubset(mockRunsForDraft("emergency-contact", draft, 1), run => keepsMockRun(composition, run));
    const host = kept.find(run => run.workflowId === "emergency-contact")!;
    const child = mockReviewRun(host, kept);
    expect(child.workflowId).toBe("ocr");
    expect(host.ocrRunId).toBe(child.id);
    expect(mockNeedsReview(child)).toBe(true);
  });

  it("still drops runs of workflows the composition does not own", () => {
    const composition = productWorkflowComposition();
    expect(keepsMockRun(composition, { ...mockRunsForDraft("emergency-contact", draft, 1)[0], workflowId: "person-lookup" })).toBe(false);
  });

  it("keeps I-9 Lookup only as a hidden child and rejects the served parent's mock runs", () => {
    const composition = productWorkflowComposition();
    const runs = seedMockRuns();
    const lookup = runs.find(run => run.workflowId === "i9-lookup");
    const parent = runs.find(run => run.workflowId === "i9-check-start");
    assert.ok(lookup); assert.ok(parent);
    expect(keepsMockRun(composition, lookup)).toBe(true);
    expect(keepsMockRun(composition, { ...lookup, parentId: undefined })).toBe(false);
    expect(keepsMockRun(composition, parent)).toBe(false);
    const kept = mockRunSubset(runs, run => keepsMockRun(composition, run));
    expect(kept.find(run => run.id === lookup.id)?.parentId).toBe(lookup.parentId);
    expect(kept.some(run => run.workflowId === "i9-check-start")).toBe(false);
    for (const preview of [false, true]) {
      expect(composition.sourceForRoute("i9-check-start", preview)).toBe("served");
      expect(composition.sourceForRoute("i9-lookup", preview)).toBe("hidden");
    }
  });
});
