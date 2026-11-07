import type { BackfillGapNotifier } from "../../../src/backend/runs/notifications/backfill-gap.js";


export const UNOBSERVED_BACKFILL_GAP_NOTIFIER: Pick<BackfillGapNotifier, "detected"> = Object.freeze({
  detected: () => Promise.reject(new Error("this harness does not permit a dashboard backfill gap")),
});
