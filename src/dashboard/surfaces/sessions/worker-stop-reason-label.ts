import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { WorkerCardWire } from "./session-panel-model.js";

/** How a settled lease ended, in the operator's words rather than the enum's. */
export const WORKER_STOP_REASON_LABEL: Record<NonNullable<WorkerCardWire["stopReason"]>, string> = {
  operator: "stopped by you",
  shutdown: "shut down",
  crashed: formatErrorCatalogFailure(createErrorCatalogFailure("WORKER_CRASHED", {})).text,
  "not-started": "did not start",
};
