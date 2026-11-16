import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { keepsMockRun, productWorkflowComposition } from "../../../src/dashboard/app/workflow-sources.js";
import { initialMockDraft, mockNeedsReview, mockReviewRun, mockRunSubset, mockRunsForDraft, seedMockRuns } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";

describe("product composition keeps the hidden OCR child of a mock host", () => {
  const draft = { ...initialMockDraft("oath-upload"), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }] };

  it("resolves the host's review to its pending OCR child", () => {
    const composition = productWorkflowComposition();
    const kept = mockRunSubset(mockRunsForDraft("oath-upload", draft, 1), run => keepsMockRun(composition, run));
    const host = kept.find(run => run.workflowId === "oath-upload")!;
    const child = mockReviewRun(host, kept);
    expect(child.workflowId).toBe("ocr");
    expect(host.ocrRunId).toBe(child.id);
    expect(mockNeedsReview(child)).toBe(true);
  });

  it("still drops runs of workflows the composition does not own", () => {
    const composition = productWorkflowComposition();
    expect(keepsMockRun(composition, { ...mockRunsForDraft("oath-upload", draft, 1)[0], workflowId: "person-lookup" })).toBe(false);
  });

  it("keeps a hidden run only under a kept mock host and rejects the served parent's mock runs", () => {
    const composition = productWorkflowComposition();
    const runs = seedMockRuns();
    const lookup = runs.find(run => run.workflowId === "i9-lookup");
    const parent = runs.find(run => run.workflowId === "i9-check-start");
    assert.ok(lookup); assert.ok(parent);
    expect(lookup.parentWorkflowId).toBe("onbase");
    expect(composition.sourceForRoute("onbase", true)).toBe("hidden");
    expect(keepsMockRun(composition, lookup)).toBe(false);
    expect(keepsMockRun(composition, { ...lookup, parentWorkflowId: "oath-upload" })).toBe(true);
    expect(keepsMockRun(composition, { ...lookup, parentId: undefined, parentWorkflowId: undefined })).toBe(false);
    expect(keepsMockRun(composition, parent)).toBe(false);
    const kept = mockRunSubset(runs, run => keepsMockRun(composition, run));
    expect(kept.some(run => run.workflowId === "i9-lookup" || run.workflowId === "onbase" || run.workflowId === "i9-check-start")).toBe(false);
    const hidden = kept.filter(run => composition.sourceForRoute(run.workflowId, true) === "hidden");
    expect(hidden.length).toBeGreaterThan(0);
    for (const run of hidden) expect(kept.find(host => host.id === run.parentId)?.workflowId).toBe(run.parentWorkflowId);
    for (const preview of [false, true]) {
      expect(composition.sourceForRoute("i9-check-start", preview)).toBe("served");
      expect(composition.sourceForRoute("i9-lookup", preview)).toBe("hidden");
    }
  });
});
