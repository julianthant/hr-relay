import { useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowUpDown, Ban, CheckCircle2, CheckSquare, RotateCcw, Square, X } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type { BulkRunCommandOutcome } from "../../../rules/commands/commands.js";
import {
  DialogBody,
  ActionBar,
  BareButton,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Disclosure,
  IconButton,
  Select,
  dsBorder,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsSurface,
  dsText,
} from "../../ds/ui.js";
import { toolbarControl } from "../shell/shell-model.js";
import { OperationsToolbarRow } from '../shell/operations-toolbar.js';
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
} from "../../app/commands/bulk-dispatch.js";

/** the icon per bulk verb — the same two the row's own footer draws */
const BULK_VERB_ICON: Record<BulkVerb, typeof RotateCcw> = { cancel: Ban, retry: RotateCcw };

/** what one run's child command settled as, in the operator's words: a `conflict` carries the refresh instruction */
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

/** WARN FIRST. A bulk press is N durable transitions against N real HR
 * runs, so it asks before it fires, and the sentence it asks with is composed */
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
          {/** THE ROWS IT LANDS ON, named. A count is not a subject line */}
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
  /** one plan per OFFERED verb — a verb at least one selected row serves carrying its frozen eligible target set and the rows it will skip.
 * The */
  bulkPlans: readonly BulkVerbPlan[];
  /** Selected ids the day serves no row for. Read here rather than off a plan
 * because the case that matters most — every selected row gone — leaves no */
  bulkUnavailable: readonly string[];
  onBulk: (plan: BulkVerbPlan) => void;
  /** the last batch's answer with the subjects it was sent for, kept until dismissed */
  bulkOutcome: BulkBatchOutcome | null;
  onDismissBulkOutcome: () => void;
  /** open a run from the result band */
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

  return (
    <ActionBar className={className}>
      <OperationsToolbarRow label="Queue actions">
        {leading}
        {runStart}
        {(leading !== undefined || runStart !== undefined) && (
          <span aria-hidden className={cn("h-4 w-px shrink-0", "bg-[var(--ds-border)]")} />
        )}

        <div className="flex min-w-0 flex-1 items-center">{filters}</div>

        <span aria-hidden className={cn("h-4 w-px shrink-0", "bg-[var(--ds-border)]")} />

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

        <BareButton
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
        </BareButton>
      </OperationsToolbarRow>

      {/** SELECT MODE IS A MODE, so it gets its own band rather than six more
 * controls shoved into a bar already carrying three groups. It exists */}
      {selectMode && (
        <div
          className={cn(
            "flex items-center border-t bg-[var(--ds-recess-bg)]",
                  // `min-h`, not the fixed `dsSize.hBar`: the refusal sentence below is the one
      // thing in this band that can outgrow a line, so it must WRAP rather than clip.
            "min-h-[var(--ds-h-bar)] py-[var(--ds-space-tight)]",
            dsBorder.subtle,
            "gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)]",
          )}
        >
          {/** NOT disabled at zero, which is the demo's own call
 * (`DemoBulkBar.tsx:236`) and : the uncited */}
          <Button size="sm" variant="secondary" onClick={allSelected ? onClearSelection : onSelectAll}>
            {allSelected ? "Clear" : `Select all ${visibleIds.length} in view`}
          </Button>
          <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
            {selectedCount} selected
          </span>
          {/* Explain ineligible selections; empty selection alone needs no refusal caption. */}
          {selectedCount > 0 && bulkPlans.length === 0 && (
            /* Wrap the only refusal reason; this toolbar offers no disclosure route for clipped text. */
            <span className={cn(dsText.meta, "ml-auto min-w-0 leading-snug text-[color:var(--ds-fg-muted)]")}>
              {selectedCount === bulkUnavailable.length
                ? /* Missing rows reveal no action vocabulary; say unavailable rather than claiming neither verb is served. */
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
                    /* Reserve danger for destructive cancellation; retry creates work rather than destroying it. */
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
                      /* Show skipped counts before confirmation so selected and eligible counts cannot appear contradictory. */
                      <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
                        {" "}· {plan.skipped.length} skipped
                      </span>
                    )}
                    {plan.unavailable.length > 0 && (
                      /* Unavailable and skipped counts stay separate because they require different operator checks. */
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

      {/* Keep every per-run batch outcome until dismissal; summaries cannot replace the vector. */}
      <BulkCommandFeedback bulkOutcome={bulkOutcome} onDismissBulkOutcome={onDismissBulkOutcome} onSelectRun={onSelectRun} />
    </ActionBar>
  );
}

export function BulkCommandFeedback({ bulkOutcome, onDismissBulkOutcome, onSelectRun }: {
  bulkOutcome: BulkBatchOutcome | null; onDismissBulkOutcome: () => void; onSelectRun: (runId: string) => void;
}) {
  const vector = bulkOutcome?.response.state === "vector" ? bulkOutcome.response : undefined;
  const buckets = useMemo(() => vector === undefined ? undefined : bulkResultCounts(vector), [vector]);
  const assurance = useMemo(
    () => vector === undefined ? undefined : bulkClosingAssurance(vector),
    [vector],
  );
  return <>
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
            /* Whole-request refusal reached no run; the served sentence is the complete answer. */
            <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] text-[color:var(--ds-danger)]")}>
              {bulkOutcome.response.state === "refused" ? bulkOutcome.response.message : ""}
            </p>
          ) : (
            <div className="mt-[var(--ds-space-snug)] flex max-h-40 flex-col overflow-y-auto">
              {vector.results.map((entry) => {
                const tone = OUTCOME_TONE[entry.outcome];
                return (
                  <BareButton
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
                    {/* Keep sent subjects with results; unknown subjects display their real ID rather than an invented name. */}
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
                  </BareButton>
                );
              })}
            </div>
          )}

          {/* Name skipped rows after dispatch so missing outcomes can be reconciled with the original selection. */}
          {bulkOutcome.plan.skipped.length > 0 && (
            <Disclosure className="mt-[var(--ds-space-snug)]" summaryClassName={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")} summary={<>
                <span className={dsText.nums}>{bulkOutcome.plan.skipped.length}</span> selected{" "}
                {bulkOutcome.plan.skipped.length === 1 ? "row" : "rows"} never offered {bulkOutcome.plan.label.toLowerCase()} —
                nothing was attempted for {bulkOutcome.plan.skipped.length === 1 ? "it" : "them"}
              </>}>
              <div className="mt-[var(--ds-space-tight)] flex max-h-28 flex-col gap-[var(--ds-space-hair)] overflow-y-auto pl-[var(--ds-space-cozy)]">
                {bulkOutcome.plan.skipped.map((row) => (
                  <span key={row.runId} className={cn(dsText.meta, "flex min-w-0 items-center gap-[var(--ds-space-base)]")}>
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--ds-fg-muted)]" />
                    <span className="min-w-0 truncate text-[color:var(--ds-fg-muted)]">{row.title}</span>
                  </span>
                ))}
              </div>
            </Disclosure>
          )}

          {/* Unavailable rows retain their IDs; no served titles exist to display. */}
          {bulkOutcome.plan.unavailable.length > 0 && (
            <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
              {/* Outcome copy describes row availability when the batch was sent, never the present day. */}
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
  </>;
}

export function RunPauseControl({ runLabel, state, onAction }: {
  runLabel: string;
  state: "running" | "pause-pending" | "paused" | "resume-pending" | "unavailable";
  onAction?: (action: "pause" | "resume") => void;
}) {
  const resumable = state === "paused";
  const pending = state === "pause-pending" || state === "resume-pending";
  return <div className="flex items-center gap-2" aria-label={`${runLabel} pause controls`}>

    <Button size="sm" variant="secondary" disabled={pending || state === "unavailable" || onAction === undefined} onClick={() => onAction?.(resumable ? "resume" : "pause")}>{state === "pause-pending" ? "Pausing…" : state === "resume-pending" ? "Resuming…" : resumable ? "Resume" : "Pause"}</Button>
    {(pending || resumable || state === "unavailable") && <span className="sr-only" role="status">{state === "pause-pending" ? "Finishing the current step; a submit is never interrupted. Pause is not yet recorded." : resumable ? "Pause recorded. Resume explicitly after restart." : state === "resume-pending" ? "Validating finished work. Resume is not yet confirmed." : "Run pause authority is unavailable."}</span>}
  </div>;
}

export function PauseAllQuitControls({ state, activeCount, runs, onPauseAll, onPauseAndQuit }: {
  state: "ready" | "pausing" | "paused" | "blocked" | "unavailable";
  activeCount: number;
  runs?: readonly { label: string; detail: string; id: string }[];
  onPauseAll?: () => void;
  onPauseAndQuit?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const quit = useRef<HTMLButtonElement>(null);
  const enabled = state === "ready" && activeCount > 0;
  return <div className="flex flex-col gap-[var(--ds-space-cozy)]">
    <div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={!enabled || !onPauseAll} onClick={onPauseAll}>Pause all</Button><Button size="sm" ref={quit} variant="muted" disabled={!enabled || !onPauseAndQuit} onClick={() => setConfirming(true)}>Quit Relay</Button></div>
    {state !== "ready" && <p role="status" className={dsText.meta}>{state === "pausing" ? "Finishing current steps; pauses and shutdown are not yet confirmed." : state === "paused" ? "All runs paused. Resume them next time." : state === "blocked" ? "Closure is unknown. Keep Relay open and check active runs." : "Pause all is unavailable. Check the connection."}</p>}
    <Dialog open={confirming && enabled} onOpenChange={setConfirming}><DialogContent size="sm" title="Pause all and quit?" description="Each run finishes its current step, then pauses. Resume them next time." onCloseAutoFocus={event => { event.preventDefault(); quit.current?.focus(); }}>
      <DialogBody>{runs ? <div className="divide-y divide-ui-stroke">{runs.map(run => <div key={run.id} className="flex items-center justify-between gap-4 py-[var(--ds-space-cozy)]"><div><strong className={dsText.ui}>{run.label}</strong><p className={`${dsText.meta} text-ui-muted`}>{run.detail}</p></div><span className={`${dsText.meta} font-mono text-ui-muted`}>{run.id}</span></div>)}</div> : <p>{activeCount} active {activeCount === 1 ? "run" : "runs"} will pause before Relay quits.</p>}</DialogBody>
      <DialogFooter><Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>Keep working</Button><Button disabled={!onPauseAndQuit} onClick={() => { setConfirming(false); onPauseAndQuit?.(); }}>Pause all and quit</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
