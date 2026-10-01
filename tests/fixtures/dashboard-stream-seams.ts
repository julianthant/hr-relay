import type { BackfillGapNotifier } from "../../src/backend/runs/notifications/backfill-gap.js";

/**
 * A harness that never exercises cursor recovery owes an explicit refusing
 * seam. If that assumption changes, the test fails instead of silently losing
 * the durable safety record production requires.
 */
export const UNOBSERVED_BACKFILL_GAP_NOTIFIER: Pick<BackfillGapNotifier, "detected"> = Object.freeze({
  detected: () => Promise.reject(new Error("this harness does not permit a dashboard backfill gap")),
});
