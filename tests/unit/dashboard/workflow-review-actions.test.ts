import { describe, expect, it } from "vitest";
import { completeMockReviewAction } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-action-model.js";
import { initialMockDraft, mockDeletionIds, mockRetrySource, mockRunsForDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { reviewRecords } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";

const draft = { ...initialMockDraft("emergency-contact"), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }] };
describe("completed review action notifications", () => {
  it("confirms approval only after the guarded transition and preserves the source records", () => {
    const runs = mockRunsForDraft("emergency-contact", draft, 1), id = runs[1].id;
    const result = completeMockReviewAction(runs, id, "approve");
    expect(result.notice).toEqual({ title: "Records approved", description: "1 record released to the parent workflow." });
    expect(result.runs.find(run => run.role === "person")?.inputRecord).toEqual(reviewRecords(runs[1])[0]);
    expect(runs.every(run => !run.approved)).toBe(true);
    expect(() => completeMockReviewAction(result.runs, id, "approve")).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    expect(() => completeMockReviewAction(mockRunsForDraft("emergency-contact", { ...draft, ocrMode: "manual" }, 2), "mock:emergency-contact:2:0:ocr", "approve")).toThrow("MOCK_APPROVAL_NO_RECORDS");
    expect(() => completeMockReviewAction(runs, "missing", "approve")).toThrow("MOCK_REVIEW_ACTION_SOURCE_MISSING");
  });
  it("confirms discard and restore while retaining the parent gate and refusing replay", () => {
    const runs = mockRunsForDraft("emergency-contact", draft, 1), id = runs[1].id;
    const discarded = completeMockReviewAction(runs, id, "discard");
    expect(discarded.notice.title).toBe("Review discarded");
    expect(discarded.runs.every(run => run.discarded)).toBe(true);
    expect(() => completeMockReviewAction(discarded.runs, id, "discard")).toThrow("MOCK_REVIEW_READ_ONLY");
    const restored = completeMockReviewAction(discarded.runs, id, "restore");
    expect(restored.notice.title).toBe("Review restored");
    expect(restored.runs.every(run => !run.discarded && !run.approved)).toBe(true);
    expect(() => completeMockReviewAction(restored.runs, id, "restore")).toThrow("MOCK_REVIEW_RESTORE_UNAVAILABLE");
  });
  it("keeps standalone OCR retries and deletion independent while delegated retries retain their parent", () => {
    const standalone = mockRunsForDraft("ocr", { ...initialMockDraft("ocr"), files: draft.files }, 1);
    expect(mockRetrySource(standalone, standalone[0].id)).toBe(standalone[0]);
    expect(mockDeletionIds(standalone, standalone[0].id)).toEqual([standalone[0].id]);
    expect(() => completeMockReviewAction(standalone, standalone[0].id, "approve")).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    const delegated = mockRunsForDraft("emergency-contact", draft, 2);
    expect(mockRetrySource(delegated, delegated[1].id)).toBe(delegated[0]);
  });
  it("uses the parent's predefined document fields when an uploaded fixture has another shape", () => {
    const runs = mockRunsForDraft("emergency-contact", { ...draft, formType: "oath", files: [{ name: "single-oath.pdf", size: 4096, digest: "fixture:document:single-oath.pdf" }] }, 1);
    expect(runs[1].draft.formType).toBe("emergency-contact");
    expect(() => mockRunsForDraft("ocr", { ...initialMockDraft("ocr"), formType: "verify", files: draft.files }, 3)).toThrow("Choose a supported form type.");
    const record = reviewRecords(runs[1])[0];
    expect(record.kind).toBe("contact");
    expect(record.fields.some(field => field.key === "contactName")).toBe(true);
    expect(record.fields.some(field => field.key === "dateSigned")).toBe(false);
    expect(record.match).toBe("unresolved");
    expect(record.fields.every(field => field.value === "" || field.value === "false")).toBe(true);
  });
});
