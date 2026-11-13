import type { BulkRunCommandOutcome, BulkRunCommandResponse } from "../../../rules/commands/commands.js";

export type BulkVerb = "cancel" | "retry" | "resume";

export interface BulkTarget {
  readonly runId: string;
  readonly title: string;
  readonly expectedVersion: number;
}

export interface BulkVerbPlan {
  readonly verb: BulkVerb;
  readonly label: string;
  /** the frozen target set sent with the command */
  readonly eligible: readonly BulkTarget[];
}

/** Keep sent subjects with results; current-day lookups lose names after navigation. */
export interface BulkBatchOutcome {
  readonly plan: BulkVerbPlan;
  /** runId → the row's own name, frozen from the plan that was sent */
  readonly subjects: ReadonlyMap<string, string>;
  readonly response: BulkRunCommandResponse;
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
