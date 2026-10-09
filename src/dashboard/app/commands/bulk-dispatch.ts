// Freeze each target’s served version at confirmation; rereading before posting would bypass CAS drift detection.
import { systemClock } from "../../../rules/time/clock.js";
import type { BulkRunCommandOutcome, BulkRunCommandResponse } from "../../../rules/commands/commands.js";
import type { ActionDescriptorWire } from "../../../models/dashboard/actions.js";

/** The bulk vocabulary the strip offers, in the order it draws them.
 * `bump` runs on the same loop but is deliberately not offered here. */
// The destructive command is last, matching both the demo and the context
// menu's irreversible-last rule. This is the strip's presentation order only.
export const BULK_STRIP_VERBS = ["cancel"] as const;
/** Retain the historical verb only to refuse stale saved selections explicitly. */
export type BulkVerb = "cancel" | "retry";

/** What a surface hands over per selected row */
export interface BulkCandidateRow {
  readonly runId: string;
  /** the row's own name, for the confirm copy and the result band */
  readonly title: string;
  readonly actions: readonly ActionDescriptorWire[];
}

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
  /** Selected ids the current day serves NO row for — a filter changed or the
 * day rolled under an open selection. They are a THIRD bucket on purpose */
  readonly unavailable: readonly string[];
}

const VERB_LABEL: Record<BulkVerb, string> = { cancel: "Cancel", retry: "Retry" };

function commandFor(
  row: BulkCandidateRow,
  verb: BulkVerb,
): Extract<ActionDescriptorWire, { kind: "command" }> | undefined {
  if (verb === "retry") return undefined;
  return row.actions.find(
    (action): action is Extract<ActionDescriptorWire, { kind: "command" }> =>
      action.kind === "command" && action.command === verb,
  );
}

/** The selected ids the caller could NOT hand over a served row for; a
 * candidate row outside the selection it claims to plan for fails loud. */
export function bulkUnavailableIds(
  rows: readonly BulkCandidateRow[],
  selectedIds: readonly string[],
): readonly string[] {
  const selected = new Set(selectedIds);
  for (const row of rows) {
    if (!selected.has(row.runId)) {
      throw new Error(
        `bulk plan received the candidate row ${row.runId}, which is not in the selection it plans for`,
      );
    }
  }
  const served = new Set(rows.map((row) => row.runId));
  return selectedIds.filter((id) => !served.has(id));
}

/** Keep the whole selection to report unavailable rows; empty plans explain refusals. */
export function planBulkVerb(
  rows: readonly BulkCandidateRow[],
  verb: BulkVerb,
  selectedIds: readonly string[],
): BulkVerbPlan {
  const unavailable = bulkUnavailableIds(rows, selectedIds);
  const eligible: BulkTarget[] = [];
  const skipped: { runId: string; title: string }[] = [];
  let servedLabel: string | undefined;
  for (const row of rows) {
    const action = commandFor(row, verb);
    if (action === undefined) {
      skipped.push({ runId: row.runId, title: row.title });
      continue;
    }
    // Conflicting served labels use the shared verb label, never the first row’s wording.
    servedLabel = servedLabel === undefined || servedLabel === action.label ? action.label : VERB_LABEL[verb];
    eligible.push({ runId: row.runId, title: row.title, expectedVersion: action.expectedVersion });
  }
  return { verb, label: servedLabel ?? VERB_LABEL[verb], eligible, skipped, unavailable };
}

/** Unavailable selections need their own count even when no served row offers a verb. */
export function planBulkVerbs(
  rows: readonly BulkCandidateRow[],
  selectedIds: readonly string[],
): readonly BulkVerbPlan[] {
  return BULK_STRIP_VERBS.map((verb) => planBulkVerb(rows, verb, selectedIds))
    .filter((plan) => plan.eligible.length > 0);
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

function emptyPlanReason(plan: BulkVerbPlan): string {
  const unserved = plan.skipped.length === 0
    ? ""
    : `none of the ${String(plan.skipped.length)} selected rows still on this day serves ${plan.verb}; `
      + "the server describes what each row can do and this selection can do none of it";
  // Present tense: this refusal is composed BEFORE anything is sent.
  const gone = plan.unavailable.length === 0 ? "" : bulkUnavailableSentence(plan.unavailable.length, "present");
  if (unserved === "" && gone === "") return `no rows are selected, so there is nothing to ${plan.verb}`;
  return [unserved, gone].filter((part) => part !== "").join(", and ");
}

export type ComposedBulkCommand =
  | { readonly state: "ready"; readonly request: unknown }
  | { readonly state: "refused"; readonly reason: string };

export interface BulkCommandContext {
  readonly actorId: string;
  readonly source: "queue" | "run-detail";
  readonly commandId?: string | undefined;
  readonly requestedAt?: string | undefined;
}

/** Refuse empty batches; best-effort is the only supported atomicity. */
export function composeBulkRunCommand(plan: BulkVerbPlan, context: BulkCommandContext): ComposedBulkCommand {
  if (plan.verb !== "cancel") return { state: "refused", reason: "Open Rerun for one source and review its steps and values." };
  if (plan.eligible.length === 0) {
    return { state: "refused", reason: emptyPlanReason(plan) };
  }
  const commandId = context.commandId ?? crypto.randomUUID();
  return {
    state: "ready",
    request: {
      commandId,
      // Reuse the bulk identity so replay derives the same child command identities.
      bulkCommandId: commandId,
      requestedAt: context.requestedAt ?? systemClock.now().toISOString(),
      requestedBy: context.actorId,
      source: context.source,
      family: "run",
      type: plan.verb,
      targets: plan.eligible.map(({ runId, expectedVersion }) => ({ runId, expectedVersion })),
      mode: "best-effort",
    },
  };
}

/** Confirm each row’s version-bound transition and which selected rows remain untouched. */
export function bulkConfirmBody(plan: BulkVerbPlan): string {
  const count = plan.eligible.length;
  const rows = `${String(count)} ${count === 1 ? "run" : "runs"}`;
  const skipped = plan.skipped.length === 0
    ? ""
    : ` ${String(plan.skipped.length)} selected ${plan.skipped.length === 1 ? "row is" : "rows are"} left alone: `
      + `the server serves no ${plan.verb} for ${plan.skipped.length === 1 ? "it" : "them"}.`;
  // Unavailable rows and rows offering no verb require separate explanations.
  const gone = plan.unavailable.length === 0
    ? ""
    : ` ${String(plan.unavailable.length)} selected `
      + `${plan.unavailable.length === 1 ? "row is" : "rows are"} no longer on this day and cannot be `
      + `included: ${plan.unavailable.join(", ")}.`;
  return `${plan.label} is about to be sent for ${rows}, as ${String(count)} separate commands. Each one is a real `
    + "transition recorded against the row version this screen was drawn at, so a run somebody else has touched "
    + `since will refuse instead of applying.${skipped}${gone} Every run answers for itself and the result is `
    + "reported run by run.";
}
