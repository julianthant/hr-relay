import type { NotificationItem } from "../notifications/notifications-view-model.js";
import type { BulkRunCommandOutcome } from "../../../rules/commands/commands.js";
import type { ProposedStatus } from "../shared/status/status-model.js";
import { BULK_RESULT_OUTCOMES, bulkResultCounts, type BulkBatchOutcome } from "../../app/commands/bulk-dispatch.js";

/** What one run's child command settled as, as the standard status chip and its plain count word. */
export const OUTCOME_CHIP: Record<BulkRunCommandOutcome["outcome"] | "not-attempted", { readonly status: ProposedStatus; readonly label: string; readonly className?: string; readonly count: (n: number) => string }> = {
  applied: { status: "verifiedDone", label: "Applied", className: "bg-[var(--ds-success-bg)] border-[color:var(--ds-success-border)] text-[color:var(--ds-success-fg)] font-normal", count: n => `${n} applied` },
  conflict: { status: "doneWarnings", label: "Conflict", count: n => `${n} ${n === 1 ? "conflict" : "conflicts"}` },
  refused: { status: "failed", label: "Refused", count: n => `${n} refused` },
  errored: { status: "failed", label: "Failed", count: n => `${n} failed` },
  "not-attempted": { status: "queued", label: "Not attempted", count: n => `${n} not attempted` },
};

export function bulkSummary(outcome: BulkBatchOutcome) {
  const vector = outcome.response.state === "vector" ? outcome.response : undefined;
  if (vector === undefined) return { title: `${outcome.plan.label}: nothing was sent`, tone: "danger" as const, counts: undefined,
    detail: outcome.response.state === "refused" ? outcome.response.message : undefined };
  const buckets = bulkResultCounts(vector);
  const counts = [
    ...BULK_RESULT_OUTCOMES.filter(item => buckets[item] > 0).map(item => OUTCOME_CHIP[item].count(buckets[item])),
    ...(vector.results.length < vector.requestedCount ? [OUTCOME_CHIP["not-attempted"].count(vector.requestedCount - vector.results.length)] : []),
  ].join(" · ");
  return { title: `${outcome.plan.label}: partial result`, tone: "warning" as const, counts, detail: counts };
}

/** The Priority notification item that opens the per-run review. */
export function bulkResultNotice(outcome: BulkBatchOutcome): NotificationItem {
  const { title, tone, detail } = bulkSummary(outcome);
  return { id: "bulk-result", kind: "command", priority: true, title, subject: "", workflow: "", detail: detail ?? "", tone, age: "Just now", read: false, action: "Review", destination: { kind: "bulk-result" } };
}
