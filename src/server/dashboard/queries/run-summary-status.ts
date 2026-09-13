import type { RunQueueStatus } from "../run-status.js";
import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
export type SummaryRow = ReturnType<AuthorityDatabase["queryRunSummaries"]>["items"][number];
export function statusOf(row:SummaryRow):RunQueueStatus {
  if(row.lifecycle.state === "terminal") {
    switch(row.lifecycle.outcome) {
      case "done":return "done";
      case "failed":return "failed";
      case "interrupted":return "blocked";
      case "cancelled":case "discarded":case "superseded":return "cancelled";
    }
  }
  if(row.lifecycle.state === "parked-write")return "blocked";
  if(row.lifecycle.state === "parked-gate")return "awaiting-approval";
  if(row.lifecycle.state === "queued")return "queued";
  return row.cancelRequested ? "cancelling" : "running";
}
