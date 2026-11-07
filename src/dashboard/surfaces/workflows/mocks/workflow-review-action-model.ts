import { approveMockRun, type MockRun } from "./workflow-mock-model.js";
import { discardMockReview, restoreMockReview, reviewCanApprove, reviewRecords } from "./workflow-review-model.js";

export type MockReviewAction = "approve" | "discard" | "restore";
export function completeMockReviewAction(runs: readonly MockRun[], id: string, action: MockReviewAction): {
  runs: readonly MockRun[]; notice: { title: string; description?: string };
} {
  const run = runs.find(item => item.id === id);
  if (!run) throw new Error("MOCK_REVIEW_ACTION_SOURCE_MISSING");
  const next = action === "approve" ? approveMockRun(runs, id) : action === "discard" ? discardMockReview(runs, id) : restoreMockReview(runs, id);
  const count = reviewRecords(run).filter(reviewCanApprove).length;
  return { runs: next, notice: action === "approve"
    ? { title: "Records approved", description: `${count} ${count === 1 ? "record" : "records"} released to the parent workflow.` }
    : { title: action === "discard" ? "Review discarded" : "Review restored" } };
}
