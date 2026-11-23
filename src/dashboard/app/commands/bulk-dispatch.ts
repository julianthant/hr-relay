// Freeze each target’s served version at confirmation; rereading before posting would bypass CAS drift detection.
import type { BulkRunCommandOutcome, BulkRunCommandResponse } from "../../../rules/commands/commands.js";

/** Retain the historical verb only to refuse stale saved selections explicitly. */
export type BulkVerb = "cancel" | "retry" | "resume";

export interface BulkTarget {
  readonly runId: string;
  readonly title: string;
  readonly expectedVersion: number;
}

export interface BulkVerbPlan {
  readonly verb: BulkVerb;
  /** the row's own served label, when every eligible row agrees on one */
  readonly label: string;
  /** the frozen target set — the intersection of the selection with the rows serving this verb */
  readonly eligible: readonly BulkTarget[];
  /** selected rows this verb will NOT be sent for, named rather than dropped */
  readonly skipped: readonly { readonly runId: string; readonly title: string }[];
  /** Why `skipped` rows were left out, when it is not "not offered" (a stored result's unattempted rows were offered). */
  readonly skippedReason?: string;
  /** Selected ids the current day serves NO row for — a filter changed or the
 * day rolled under an open selection. They are a THIRD bucket on purpose */
  readonly unavailable: readonly string[];
}

export const BULK_VERB_LABEL: Record<BulkVerb, string> = { cancel: "Cancel", retry: "Retry", resume: "Resume" };

/** Keep sent subjects with results; current-day lookups lose names after navigation. */
export interface BulkBatchOutcome {
  readonly plan: BulkVerbPlan;
  /** runId → the row's own name, frozen from the plan that was sent */
  readonly subjects: ReadonlyMap<string, string>;
  readonly response: BulkRunCommandResponse;
  /** runId → partition day, for a stored result opened from another day */
  readonly days?: ReadonlyMap<string, string>;
}

/** Show zero outcome buckets too; aggregate success cannot describe every refusal arm. */
export const BULK_RESULT_OUTCOMES = ["applied", "conflict", "refused", "errored"] as const;

export type BulkResultCounts = Readonly<Record<BulkRunCommandOutcome["outcome"], number>>;

export function bulkResultCounts(response: Extract<BulkRunCommandResponse, { state: "vector" }>): BulkResultCounts {
  const counts: Record<BulkRunCommandOutcome["outcome"], number> = {
    applied: 0,
    conflict: 0,
    refused: 0,
    errored: 0,
  };
  for (const result of response.results) counts[result.outcome] += 1;
  return counts;
}

/** The two closing assurances are mutually exclusive and derive only from the
 * vector that answered. `errored` is deliberately an unsettled result too. */
export function bulkClosingAssurance(response: Extract<BulkRunCommandResponse, { state: "vector" }>): "clean" | "needs-review" {
  return response.results.every((result) => result.outcome === "applied")
    && response.results.length === response.requestedCount
    ? "clean"
    : "needs-review";
}

/** The subject map for a plan about to be sent — one entry per eligible target. */
export function bulkSubjectsOf(plan: BulkVerbPlan): ReadonlyMap<string, string> {
  return new Map(plan.eligible.map((target) => [target.runId, target.title]));
}

/** Distinguish skipped from unavailable rows, using the tense of the described event. */
export function bulkUnavailableSentence(count: number, tense: "present" | "past"): string {
  const subject = `${String(count)} selected ${count === 1 ? "row" : "rows"}`;
  const object = count === 1 ? "it" : "them";
  if (tense === "past") {
    return `${subject} ${count === 1 ? "was" : "were"} no longer on this day when this batch was sent, `
      + `so nothing was sent for ${object}`;
  }
  return `${subject} ${count === 1 ? "is" : "are"} no longer on this day, `
    + `so nothing can be sent for ${object} from this screen`;
}
