/**
 * D235 — turning a SELECTION into ONE bulk command envelope, and deciding which
 * of the selected rows that command may name.
 *
 * The single-row composer (`command-dispatch.ts`) exists because a command whose
 * payload cannot be composed from SERVED facts must be refused by name rather
 * than invented. This module is that rule applied to a set, and the served fact
 * it reads is each row's own `actions[]`: a control the server did not describe
 * for THAT row is not a control this surface may press on that row's behalf.
 *
 * Two rules and they are different, which is what the strip has to say out loud:
 *
 *   OFFERED — a verb appears on the strip when at least one selected row serves
 *     it. Requiring every row to serve it would hide the verb the moment one
 *     `done` row joined a selection of four `failed` ones, and the operator's
 *     intent ("retry these") would silently have nowhere to go.
 *   ELIGIBLE — the verb's TARGET SET is the intersection of the selection with
 *     the rows whose own `actions[]` admit it. A row outside that intersection
 *     is SKIPPED, and the strip states how many and why. It is never sent: the
 *     server would refuse it anyway, and a refusal the client could have
 *     predicted is a refusal it should not have spent.
 *
 * Versions are frozen HERE, at composition, from each row's own descriptor
 * (`expectedVersion`) — ref dashboard-surfaces's *"targets and versions are frozen at
 * confirmation"*. Nothing re-reads a version between the confirm dialog and the
 * post, because that is precisely the drift the CAS exists to catch.
 */
import { systemClock } from "../../rules/time/clock.js";
import type { BulkRunCommandOutcome, BulkRunCommandResponse } from "../../rules/commands/commands.js";
import type { ActionDescriptorWire } from "../../models/dashboard/actions.js";

/**
 * The bulk vocabulary the strip offers, in the order it draws them.
 *
 * `bump` is admitted by `BulkRunCommandRequestSchema` and executed by the same
 * loop, and it is deliberately NOT on the strip: the operator's 2026-08-18
 * ruling named cancel and retry as the two batch verbs, and a claim-order
 * change applied to a selection is a re-ordering nobody asked for. It is one
 * entry away if that ruling changes; nothing else moves.
 */
// The destructive command is last, matching both the demo and the context
// menu's irreversible-last rule. D235 chose the two verbs; this is their
// presentation order only.
export const BULK_STRIP_VERBS = ["cancel"] as const;
/** Retain the historical verb only to refuse stale saved selections explicitly. */
export type BulkVerb = "cancel" | "retry";

/** What a surface hands over per selected row: the row's identity and what the server served for it. */
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
  /**
   * Selected ids the current day serves NO row for — a filter changed or the
   * day rolled under an open selection. They are a THIRD bucket on purpose:
   * `skipped` means "the server described this row and it offers no such verb",
   * which is a fact about the row; this means the row is not being described at
   * all, so there is no title to print and nothing may be sent for it. Before
   * this existed they fell out of every plan and every count, and the strip
   * drew `Cancel 3 · 1 skipped` under `6 selected` with no account of the other
   * two — an omission that was neither disclosed nor sent.
   */
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

/**
 * The selected ids the caller could NOT hand over a served row for.
 *
 * It also fails loud on the inverse — a candidate row outside the selection it
 * claims to plan for. That can only mean the caller's filter is wrong, and a
 * plan built from it would freeze a version for a run nobody selected.
 */
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

/**
 * The plan for one verb over one selection. A verb with an EMPTY eligible set
 * still returns a plan — the strip needs the skip count to say why the control
 * is refusing — and `composeBulkRunCommand` is what refuses to post it.
 *
 * `selectedIds` is the WHOLE selection and is required rather than derived from
 * `rows`: the difference between the two is exactly the bucket this plan would
 * otherwise lose, and a parameter defaulted to `rows` would reinstate the drop
 * silently at every call site that forgot it.
 */
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
    // The label the SERVER wrote for this verb, when every eligible row wrote
    // the same one. Rows disagreeing falls back to the strip's own noun rather
    // than to whichever row happened to be first.
    servedLabel = servedLabel === undefined || servedLabel === action.label ? action.label : VERB_LABEL[verb];
    eligible.push({ runId: row.runId, title: row.title, expectedVersion: action.expectedVersion });
  }
  return { verb, label: servedLabel ?? VERB_LABEL[verb], eligible, skipped, unavailable };
}

/**
 * Every verb the strip may draw, with its plan — offered when at least one row
 * serves it.
 *
 * A selection whose rows have ALL left the day offers no verb and so returns
 * nothing here; the unavailable count is therefore also read straight off
 * `bulkUnavailableIds` by the strip, which is the only party that can say why a
 * selection with a count has no controls.
 */
export function planBulkVerbs(
  rows: readonly BulkCandidateRow[],
  selectedIds: readonly string[],
): readonly BulkVerbPlan[] {
  return BULK_STRIP_VERBS.map((verb) => planBulkVerb(rows, verb, selectedIds))
    .filter((plan) => plan.eligible.length > 0);
}

/**
 * D235 — one batch's whole story: what was asked for, what was left alone, and
 * what came back. The server's vector names runs by id and nothing else (it is
 * authority, not presentation), so the SUBJECTS travel with it — a result band
 * that printed uuids would be a report nobody can read, and re-deriving titles
 * from the current day would go blank the moment a batch outlives its page.
 */
export interface BulkBatchOutcome {
  readonly plan: BulkVerbPlan;
  /** runId → the row's own name, frozen from the plan that was sent */
  readonly subjects: ReadonlyMap<string, string>;
  readonly response: BulkRunCommandResponse;
}

/** Every outcome bucket stays visible, including a zero. A clean batch must
 * still say which refusal arms it did not observe rather than implying one
 * aggregate success number is its whole answer. */
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

/**
 * One sentence per REASON there is nothing to send, never one blended count.
 * "None of the 4 serves retry" said about rows the day stopped serving would be
 * a claim about `actions[]` nobody ever read.
 *
 * IT HAS TWO TENSES because it is read at two moments, and the outcome band's
 * copy read `…rows are no longer on this day … when this batch was sent`, which
 * is a present-tense claim about a past instant. The tense is REQUIRED rather
 * than defaulted: a default puts the wrong one on the next call site that
 * forgets, and the whole sentence exists to be precise about which rows the
 * screen is talking about and when.
 */
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

/**
 * The ONE place a bulk plan becomes an envelope.
 *
 * A plan with nothing eligible REFUSES rather than posting an empty batch: the
 * server's `targets` is `.min(1)` and would refuse it too, but a client that
 * spends a round trip to be told what it already knew is a client that has
 * chosen not to know. The refusal names the verb and the count, so "nothing
 * happened" can never be mistaken for "it worked".
 *
 * `mode` is always `best-effort` and is written here rather than taken from a
 * caller: the runtime executes no other mode (ref dashboard-surfaces's bulk section), and a
 * surface that could ask for `all-or-none` would be offering an atomicity this
 * kernel does not have.
 */
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
      // The bulk identity is the CHILD identities' seed: the server derives one
      // command id per run from it, so re-sending this exact envelope replays
      // the same N children instead of filing N more.
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

/**
 * The confirm copy, composed from the plan the operator is about to send.
 *
 * The server authors a single row's confirm body because only it knows that
 * row's blast radius; a BATCH's blast radius is a fact about the selection,
 * which only the client holds. So this sentence is written here, and it states
 * the two things the operator cannot see from a count: that each row is its own
 * durable transition against the version this screen was drawn at, and how many
 * selected rows are being left alone.
 */
export function bulkConfirmBody(plan: BulkVerbPlan): string {
  const count = plan.eligible.length;
  const rows = `${String(count)} ${count === 1 ? "run" : "runs"}`;
  const skipped = plan.skipped.length === 0
    ? ""
    : ` ${String(plan.skipped.length)} selected ${plan.skipped.length === 1 ? "row is" : "rows are"} left alone: `
      + `the server serves no ${plan.verb} for ${plan.skipped.length === 1 ? "it" : "them"}.`;
  // The third bucket is stated separately and never folded into the skip count:
  // "left alone because the server offers no verb" and "left alone because the
  // row is not on this screen any more" are different things to go and check.
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
