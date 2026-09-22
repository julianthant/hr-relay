/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoBulkBar.tsx (`DemoQueueToolbar`
 * :98 and its select-mode band).
 *
 * ONE BAR, THREE GROUPS, and the grouping is by what a control DOES — ref dashboard-surfaces
 * §Shell's "one composed action bar", and DESIGN.md's "toolbars group by what a
 * control DOES, separated by a hairline, not by uniform gaps":
 *
 *   WHERE YOU ARE and WHAT YOU START, left  — the Workflow Panel toggle, then
 *     the intake route, then the one primary on the surface;
 *   WHAT YOU ARE LOOKING AT, middle         — the status filters, taking the
 *     slack and scrolling sideways at a narrow window rather than folding a
 *     status behind an overflow menu;
 *   HOW YOU ARE LOOKING AT IT, right        — sort, then select.
 *
 * The row never wraps: a fixed `--ds-h-bar` with `flex-wrap` silently CLIPS the
 * second line, so the middle group scrolls instead.
 *
 * IT IS AN ISLAND, not a full-bleed band (D224, operator decision). It carries
 * the same card treatment as every panel beside it — full border,
 * `--ds-radius-lg`, `--ds-surface-card`, `overflow-hidden` so the select-mode
 * band below cannot square off a rounded corner — and the shell supplies its
 * outside edge through `className` exactly as it does for the storage banner.
 * The bar had been the one full-width element in a shell made of cards, held
 * apart only by a bottom hairline. Two things fall out and both are
 * improvements: the inner padding becomes `--ds-space-cozy`, which is the same
 * 12px `--ds-shell-inset` resolves to, so the leading control now aligns with
 * the queue panel's own header text instead of with the window edge; and the
 * bottom hairline goes, because a bordered island already states where it ends.
 *
 * THE BULK STRIP IS PORTED (D235), and the note that used to stand here is
 * struck. It said the projection served no row actions and that drawing bulk
 * buttons would be a fabricated command surface — true when it was written on
 * 2026-08-14, and false since `QueueSurfaceWire.actions` began carrying the
 * server's own per-row descriptors. The verbs are the operator's two:
 * `cancel` and `retry`. `hide` left the vocabulary with D234; `bump` is
 * executed by the same server loop and is deliberately off the strip
 * (`bulk-dispatch.ts` records why).
 *
 * THE STRIP ONLY EVER DRAWS WHAT THE ROWS SERVE. A verb appears when at least
 * one selected row's `actions[]` admits it, and it is SENT only for the rows
 * that do — the strip states how many are being left alone and why, because a
 * batch that silently drops half a selection is the same lie as one that
 * reports "Done" over a partial result.
 */
import { useMemo, type ReactNode } from "react";
import { AlertTriangle, ArrowUpDown, Ban, CheckCircle2, CheckSquare, RotateCcw, Square, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import type { BulkRunCommandOutcome } from "../../domain/commands.js";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  IconButton,
  Select,
  dsBorder,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsSize,
  dsSurface,
  dsText,
} from "../ds/ui.js";
import { toolbarControl } from "./shell-model.js";
import { QUEUE_SORTS, type QueueSortKey } from "./queue-model.js";
import {
  BULK_RESULT_OUTCOMES,
  bulkClosingAssurance,
  bulkConfirmBody,
  bulkResultCounts,
  bulkUnavailableSentence,
  type BulkBatchOutcome,
  type BulkVerb,
  type BulkVerbPlan,
} from "../app/bulk-dispatch.js";

/** D235: the icon per bulk verb — the same two the row's own footer draws. */
const BULK_VERB_ICON: Record<BulkVerb, typeof RotateCcw> = { cancel: Ban, retry: RotateCcw };

/**
 * D235 — what one run's child command settled as, in the operator's words.
 *
 * `conflict` carries the refresh instruction because a stale row version is the
 * ONE outcome the operator fixes by reloading; `refused` and `errored` carry
 * the server's own sentence verbatim, because it is the only party that knows
 * which policy or which failure it was.
 */
const OUTCOME_TONE: Record<
  BulkRunCommandOutcome["outcome"],
  { readonly word: string; readonly text: string; readonly dot: string }
> = {
  applied: {
    word: "applied",
    text: "text-[color:var(--ds-success-fg)]",
    dot: "bg-[var(--ds-success-fg)]",
  },
  conflict: {
    word: "conflict",
    text: "text-[color:var(--ds-status-waiting-fg)]",
    dot: "bg-[var(--ds-status-waiting-fg)]",
  },
  refused: { word: "refused", text: "text-[color:var(--ds-danger)]", dot: "bg-[var(--ds-danger)]" },
  errored: { word: "errored", text: "text-[color:var(--ds-danger)]", dot: "bg-[var(--ds-danger)]" },
};

/** The pending batch a confirm dialog is asking about, held by the shell. */
export interface PendingBulkCommand {
  readonly plan: BulkVerbPlan;
  readonly commandId?: string | undefined;
  readonly requestedAt?: string | undefined;
}

/**
 * D235 — WARN FIRST. A bulk press is N durable transitions against N real HR
 * runs, so it asks before it fires, and the sentence it asks with is composed
 * from the plan (`bulkConfirmBody`) rather than served: the server authors a
 * single row's blast radius because only it knows that row's dependency tree,
 * and a BATCH's radius is a fact about the selection, which only this client
 * holds.
 */
export function ConfirmBulkCommandDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingBulkCommand | null;
  onCancel: () => void;
  onConfirm: (pending: PendingBulkCommand) => void;
}) {
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      {pending !== null && (
        <DialogContent
          size="sm"
          title={
            <span className="flex items-center gap-[var(--ds-space-base)]">
              <AlertTriangle aria-hidden className={cn(dsIcon.lg, "shrink-0 text-[color:var(--ds-danger)]")} />
              {pending.plan.label} {pending.plan.eligible.length}{" "}
              {pending.plan.eligible.length === 1 ? "run" : "runs"}?
            </span>
          }
          description={bulkConfirmBody(pending.plan)}
        >
          {/*
            THE ROWS IT LANDS ON, named. A count is not a subject line: the
            single-row confirm shows the run it is about (`actions.tsx`), and a
            batch owes the same — the whole list, scrolling, never truncated to
            "and 12 more".
          */}
          <div
            className={cn(
              dsText.meta,
              "flex max-h-40 flex-col overflow-y-auto px-[var(--ds-space-loose)] pt-[var(--ds-space-cozy)]",
              "text-[color:var(--ds-fg-muted)]",
            )}
          >
            {pending.plan.eligible.map((target) => (
              <span key={target.runId} className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
                <span className="min-w-0 flex-1 truncate text-[color:var(--ds-fg-secondary)]">{target.title}</span>
                <span className={cn(dsText.nums, "shrink-0")}>row rev {target.expectedVersion}</span>
              </span>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              Keep them as they are
            </Button>
            <Button variant="danger" onClick={() => onConfirm(pending)}>
              {pending.plan.label} {pending.plan.eligible.length}{" "}
              {pending.plan.eligible.length === 1 ? "run" : "runs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
export function QueueToolbar({
  sort,
  onSort,
  selectMode,
  onSelectMode,
  selectedCount,
  visibleIds,
  onSelectAll,
  onClearSelection,
  bulkPlans,
  bulkUnavailable,
  onBulk,
  bulkOutcome,
  onDismissBulkOutcome,
  onSelectRun,
  leading,
  runStart,
  filters,
  className,
}: {
  sort: QueueSortKey;
  onSort: (key: QueueSortKey) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  selectedCount: number;
  /** the top-level rows currently on screen — the only things Select all may take */
  visibleIds: readonly string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  /**
   * D235: one plan per OFFERED verb — a verb at least one selected row serves,
   * carrying its frozen eligible target set and the rows it will skip. The
   * strip renders exactly these and derives no availability of its own.
   */
  bulkPlans: readonly BulkVerbPlan[];
  /**
   * Selected ids the day serves no row for. Read here rather than off a plan
   * because the case that matters most — every selected row gone — leaves no
   * plan at all, and the band must not then blame `actions[]` nobody read.
   */
  bulkUnavailable: readonly string[];
  onBulk: (plan: BulkVerbPlan) => void;
  /** the last batch's answer with the subjects it was sent for, kept until dismissed */
  bulkOutcome: BulkBatchOutcome | null;
  onDismissBulkOutcome: () => void;
  /** open a run from the result band — the row a batch touched is a row you go to */
  onSelectRun: (runId: string) => void;
  /** shell-owned, far left: the Workflow Panel toggle, where its column began */
  leading?: ReactNode;
  /** shell-owned: the intake route and the one Run Modal's primary control */
  runStart?: ReactNode;
  /** shell-owned: the status filter group, folded in from its own band */
  filters?: ReactNode;
  /** the shell's own edge — the island does not know where it is mounted */
  className?: string;
}) {
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  const vector = bulkOutcome?.response.state === "vector" ? bulkOutcome.response : undefined;
  const buckets = useMemo(() => vector === undefined ? undefined : bulkResultCounts(vector), [vector]);
  const assurance = useMemo(
    () => vector === undefined ? undefined : bulkClosingAssurance(vector),
    [vector],
  );

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border",
        dsRadius.lg,
        dsBorder.base,
        dsSurface.card,
        className,
      )}
    >
      <div className={cn("flex items-center", dsSize.hBar, "gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)]")}>
        {leading}
        {runStart}
        {(leading !== undefined || runStart !== undefined) && (
          <span aria-hidden className={cn("h-4 w-px shrink-0", "bg-[var(--ds-border)]")} />
        )}

        <div className="flex min-w-0 flex-1 items-center">{filters}</div>

        <span aria-hidden className={cn("h-4 w-px shrink-0", "bg-[var(--ds-border)]")} />

        {/* Sort is ONE control. The `⇅` is this select's ICON, never a glyph a
            gap away from the control it belongs to. It is the `Select`
            PRIMITIVE at `variant="toolbar"`, not a local copy: a bare
            `<select>` is `inline-block` on a line box's baseline and sits
            ~1.25px low however the height token is spelled, and the primitive's
            flex wrapper is where that is fixed once for every consumer. */}
        <Select
          variant="toolbar"
          aria-label="Sort the queue"
          value={sort}
          onChange={(event) => onSort(event.target.value as QueueSortKey)}
          title={QUEUE_SORTS.find((entry) => entry.key === sort)?.note}
          icon={<ArrowUpDown className={dsIcon.sm} />}
        >
          {QUEUE_SORTS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </Select>

        <button
          type="button"
          aria-pressed={selectMode}
          title="Act on several rows at once"
          onClick={() => onSelectMode(!selectMode)}
          className={cn(
            toolbarControl(),
            selectMode
              ? cn(dsBorder.loud, "bg-[var(--ds-surface-selected)] font-semibold text-[color:var(--ds-fg)]")
              : cn(
                dsBorder.base,
                dsSurface.card,
                "text-[color:var(--ds-fg-muted)] hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]",
              ),
          )}
        >
          {selectMode ? (
            <CheckSquare aria-hidden className={dsIcon.sm} />
          ) : (
            <Square aria-hidden className={dsIcon.sm} />
          )}
          Select
        </button>
      </div>

      {/* SELECT MODE IS A MODE, so it gets its own band rather than six more
          controls shoved into a bar already carrying three groups. It exists
          only while the mode is on, so it costs nothing at rest.

          THE ACTION STRIP IS THE DEMO'S (`DemoBulkBar.tsx:236-260`), carrying
          the two verbs D234 left standing. Which verbs appear is `actions[]`
          and nothing else — the shell plans them (`bulk-dispatch.ts`) and this
          band draws exactly what it is handed, so a control here can never be
          one the server did not describe for a row in this selection. */}
      {selectMode && (
        <div
          className={cn(
            "flex items-center border-t bg-[var(--ds-recess-bg)]",
            // `min-h`, not the fixed `dsSize.hBar`: the refusal sentence below
            // is the one thing in this band that can outgrow a line, and it has
            // to WRAP rather than clip — a truncated refusal is a reason the
            // operator cannot finish reading and has no other route to. At rest
            // (a plan's buttons, or a sentence that fits) the band measures
            // exactly `--ds-h-bar` and nothing moves.
            "min-h-[var(--ds-h-bar)] py-[var(--ds-space-tight)]",
            dsBorder.subtle,
            "gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)]",
          )}
        >
          {/* NOT disabled at zero, which is the demo's own call
              (`DemoBulkBar.tsx:236`) and R8 finding 22: the uncited
              `disabled={visibleIds.length === 0}` this used to carry was a
              rebuild addition with no argument behind it. `Select all 0 in
              view` is a control that reads its own count out loud and does
              nothing when pressed, and that is strictly more legible than a
              greyed button giving no reason — the band is only mounted in
              select mode anyway, so the zero case is a day with no rows, not a
              malfunction. */}
          <Button size="sm" variant="secondary" onClick={allSelected ? onClearSelection : onSelectAll}>
            {allSelected ? "Clear" : `Select all ${visibleIds.length} in view`}
          </Button>
          <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
            {selectedCount} selected
          </span>
          {/*
            THE STRIP'S OWN REFUSAL, and it is now about the SELECTION rather
            than about the build. A selection whose rows serve neither verb says
            so — that sentence is a refusal (what cannot be done and why), which
            is one of DESIGN.md's two exemptions from "the product does not
            explain itself". An empty selection says nothing at all, because
            "select something first" is a caption on an absence.
          */}
          {selectedCount > 0 && bulkPlans.length === 0 && (
            /* NOT `truncate`. This is the band's only statement of WHY nothing
               can be applied, and the ⓘ-and-popover route the rows use for a
               clipped value does not exist on a toolbar — so a clipped sentence
               here is a reason with no route to it at all, on any pointer. It
               wraps instead, and the band's `min-h` lets it. */
            <span className={cn(dsText.meta, "ml-auto min-w-0 leading-snug text-[color:var(--ds-fg-muted)]")}>
              {selectedCount === bulkUnavailable.length
                ? /* Every selected row has left the day. Saying they "serve
                     neither verb" would be a claim about `actions[]` this
                     screen never received — the honest sentence is that there
                     are no rows here to act on. */
                  `${bulkUnavailableSentence(bulkUnavailable.length, "present")}.`
                : `None of the ${selectedCount - bulkUnavailable.length} selected `
                  + `${selectedCount - bulkUnavailable.length === 1 ? "row still on this day serves" : "rows still on this day serve"} `
                  + `Cancel, so there is nothing to apply to this selection.`
                  + (bulkUnavailable.length === 0
                    ? ""
                    : ` A further ${bulkUnavailableSentence(bulkUnavailable.length, "present")}.`)}
            </span>
          )}

          {bulkPlans.length > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-[var(--ds-space-snug)]">
              {bulkPlans.map((plan) => {
                const Icon = BULK_VERB_ICON[plan.verb];
                return (
                  <Button
                    key={plan.verb}
                    size="sm"
                    /*
                      `cancel` takes the surface's single danger slot — it is
                      the irreversible one, and two danger buttons on one
                      surface is exactly what that ban exists to stop. Retry
                      creates work rather than destroying it, so it is an
                      `outline` peer.
                    */
                    variant={plan.verb === "cancel" ? "dangerGhost" : "outline"}
                    onClick={() => onBulk(plan)}
                    title={[
                      plan.skipped.length === 0 && plan.unavailable.length === 0
                        ? `${plan.label} all ${plan.eligible.length} selected rows`
                        : `${plan.label} ${plan.eligible.length} of ${selectedCount} selected rows`,
                      plan.skipped.length === 0 ? "" : `${plan.skipped.length} do not serve it`,
                      plan.unavailable.length === 0
                        ? ""
                        : `${plan.unavailable.length} are no longer on this day`,
                    ].filter((part) => part !== "").join(" — ")}
                    icon={<Icon aria-hidden className={dsIcon.sm} />}
                  >
                    {plan.label} {plan.eligible.length}
                    {plan.skipped.length > 0 && (
                      /*
                        THE SKIP IS ON THE CONTROL, not only in the confirm.
                        `Cancel 3` beside `4 selected` is a discrepancy the
                        operator has to notice and explain; `Cancel 3 · 1
                        skipped` explains it before the press, and the dialog
                        then says WHY.
                      */
                      <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
                        {" "}· {plan.skipped.length} skipped
                      </span>
                    )}
                    {plan.unavailable.length > 0 && (
                      /*
                        And the same argument for the third bucket, kept as its
                        own count rather than added to the skip: `3 + 1` under
                        `6 selected` is the arithmetic the operator was left to
                        do, and the two numbers have different explanations.
                      */
                      <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
                        {" "}· {plan.unavailable.length} not on this day
                      </span>
                    )}
                  </Button>
                );
              })}
            </span>
          )}
        </div>
      )}

      {/*
        THE RESULT VECTOR (D235, ref dashboard-surfaces §2.4). A batch of four can come back
        "2 applied · 1 conflict · 1 refused" and the UI may NEVER collapse that
        into "Done" — so this band renders every run's own outcome, keeps it
        until it is dismissed, and never summarises without the rows underneath.
        It is a BAND rather than a toast for that reason: a toast that
        auto-dismisses would take a partial result off the screen before it was
        read.
      */}
      {bulkOutcome !== null && (
        <div
          className={cn(
            "border-t bg-[var(--ds-recess-bg)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
            dsBorder.subtle,
          )}
          aria-live="polite"
          data-queue-bulk-result={bulkOutcome.response.state}
        >
          <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
            <span className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>
              {vector === undefined ? "Nothing was sent" : `${bulkOutcome.plan.label} — partial result`}
            </span>
            {vector !== undefined && buckets !== undefined && (
              <span className={cn(dsText.meta, dsText.nums, "flex flex-wrap items-center gap-[var(--ds-space-base)]")}>
                {BULK_RESULT_OUTCOMES.map((outcome, index) => (
                    <span key={outcome} className="flex items-center gap-[var(--ds-space-base)]">
                      {index > 0 && <span aria-hidden className="text-[color:var(--ds-fg-faint)]">·</span>}
                      <span className={OUTCOME_TONE[outcome].text}>
                        {buckets[outcome]} {OUTCOME_TONE[outcome].word}
                      </span>
                    </span>
                  ))}
                {vector.results.length < vector.requestedCount && (
                  <>
                    <span aria-hidden className="text-[color:var(--ds-fg-faint)]">·</span>
                    <span className="text-[color:var(--ds-fg-muted)]">
                      {vector.requestedCount - vector.results.length} not attempted
                    </span>
                  </>
                )}
              </span>
            )}
            <IconButton
              size="sm"
              label="Dismiss the bulk result"
              onClick={onDismissBulkOutcome}
              icon={<X aria-hidden className={dsIcon.sm} />}
              className="ml-auto"
            />
          </div>

          {vector === undefined ? (
            /* A whole-request refusal reached no run at all, so it has no
               vector — the server's sentence is the whole answer and is printed
               verbatim. */
            <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] text-[color:var(--ds-danger)]")}>
              {bulkOutcome.response.state === "refused" ? bulkOutcome.response.message : ""}
            </p>
          ) : (
            <div className="mt-[var(--ds-space-snug)] flex max-h-40 flex-col overflow-y-auto">
              {vector.results.map((entry) => {
                const tone = OUTCOME_TONE[entry.outcome];
                return (
                  <button
                    key={entry.runId}
                    type="button"
                    onClick={() => onSelectRun(entry.runId)}
                    className={cn(
                      "flex min-w-0 cursor-pointer items-center text-left",
                      "h-[var(--ds-h-sm)] gap-[var(--ds-space-base)] px-[var(--ds-space-tight)]",
                      dsRadius.sm,
                      dsText.meta,
                      dsFocus,
                      dsMotion.fast,
                      "hover:bg-[var(--ds-surface-3)]",
                    )}
                  >
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
                    <span className={cn(dsText.caps, "w-16 shrink-0", tone.text)}>{tone.word}</span>
                    {/* The row's own name, frozen from the plan that was sent
                        — the vector names runs by id, and a report of uuids is
                        a report nobody reads. A run the map does not hold shows
                        its id, which is still the run's own identity rather
                        than a plausible substitute for one. */}
                    <span className="w-40 shrink-0 truncate text-[color:var(--ds-fg-secondary)]">
                      {bulkOutcome.subjects.get(entry.runId) ?? entry.runId}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[color:var(--ds-fg-muted)]">{entry.detail}</span>
                    {entry.outcome === "conflict" && (
                      <span
                        className={cn(dsText.micro, dsText.nums, "shrink-0 text-[color:var(--ds-status-waiting-fg)]")}
                      >
                        now rev {entry.currentVersion} — refresh
                      </span>
                    )}
                    {entry.outcome === "refused" && (
                      <span className={cn(dsText.micro, dsText.nums, "shrink-0 text-[color:var(--ds-danger)]")}>
                        {entry.code}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* THE SKIPPED ROWS SURVIVE THE SEND. They are named before the press
              and named again after it, because a selection of four answering
              with three outcomes is a discrepancy the operator would otherwise
              have to reconstruct from memory. */}
          {bulkOutcome.plan.skipped.length > 0 && (
            <details className="mt-[var(--ds-space-snug)]">
              <summary className={cn(dsText.meta, dsFocus, "cursor-pointer text-[color:var(--ds-fg-muted)]")}>
                <span className={dsText.nums}>{bulkOutcome.plan.skipped.length}</span> selected{" "}
                {bulkOutcome.plan.skipped.length === 1 ? "row" : "rows"} never offered {bulkOutcome.plan.label.toLowerCase()} —
                nothing was attempted for {bulkOutcome.plan.skipped.length === 1 ? "it" : "them"}
              </summary>
              <div className="mt-[var(--ds-space-tight)] flex max-h-28 flex-col gap-[var(--ds-space-hair)] overflow-y-auto pl-[var(--ds-space-cozy)]">
                {bulkOutcome.plan.skipped.map((row) => (
                  <span key={row.runId} className={cn(dsText.meta, "flex min-w-0 items-center gap-[var(--ds-space-base)]")}>
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--ds-fg-muted)]" />
                    <span className="min-w-0 truncate text-[color:var(--ds-fg-muted)]">{row.title}</span>
                  </span>
                ))}
              </div>
            </details>
          )}

          {/* AND THE THIRD BUCKET SURVIVES THE SEND TOO. It has no titles to
              list — the day served no row for these ids — so it names them by
              the only identity it holds, which is still the run's own rather
              than a plausible substitute for one. */}
          {bulkOutcome.plan.unavailable.length > 0 && (
            <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
              {/* PAST tense: this is the batch's outcome, and the rows it names
                  were already gone at the instant it was sent. The sentence
                  carries "when this batch was sent" itself, so the two halves
                  can no longer disagree about which moment they describe. */}
              {bulkUnavailableSentence(bulkOutcome.plan.unavailable.length, "past")}:{" "}
              <span className={dsText.nums}>{bulkOutcome.plan.unavailable.join(", ")}</span>
            </p>
          )}

          {vector !== undefined && assurance !== undefined && (
            <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] flex items-start gap-[var(--ds-space-snug)] leading-snug text-[color:var(--ds-fg-muted)]")}>
              {assurance === "needs-review" ? (
                <>
                  <AlertTriangle aria-hidden className={cn(dsIcon.sm, "mt-px shrink-0 text-[color:var(--ds-status-waiting-fg)]")} />
                  Nothing was applied for conflicted, refused, errored, or unattempted rows. Open each one and look before you decide again — a conflict means the row changed under you.
                </>
              ) : (
                <>
                  <CheckCircle2 aria-hidden className={cn(dsIcon.sm, "mt-px shrink-0 text-[color:var(--ds-success-fg)]")} />
                  Every selected row that offered {bulkOutcome.plan.label.toLowerCase()} accepted it.
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
