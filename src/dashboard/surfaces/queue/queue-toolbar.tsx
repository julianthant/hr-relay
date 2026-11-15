import { useMemo, useRef, type ReactNode } from "react";
import { AlertTriangle, ArrowUpDown, Ban, CheckCircle2, CheckSquare, Pause, Play, RotateCcw, Square } from "lucide-react";
import { cn } from "../../lib/utils.js";
import {
  ActionBar,
  BareButton,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  StatusPill,
  Notice,
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
import { OUTCOME_CHIP, bulkSummary } from "./queue-toolbar-model.js";
import { QUEUE_SORTS, type QueueSortKey } from "./queue-model.js";
import { PAUSE_ALL_EFFECT, PAUSE_ALL_PENDING_STATUS, stepInterruptLabel } from "../shared/status/status-model.js";
import type { QueueSurfaceWire, StepInterruptWire } from "../../../models/dashboard/projection.js";
import {
  bulkClosingAssurance,
  bulkConfirmBody,
  bulkUnavailableSentence,
  type BulkBatchOutcome,
  type BulkVerb,
  type BulkVerbPlan,
} from "../../app/commands/bulk-dispatch.js";

/** the icon per bulk verb — the same two the row's own footer draws */
const BULK_VERB_ICON: Record<BulkVerb, typeof RotateCcw> = { cancel: Ban, retry: RotateCcw, resume: Play };

function OutcomeChip({ outcome }: { outcome: keyof typeof OUTCOME_CHIP }) {
  const chip = OUTCOME_CHIP[outcome];
  return <span className="flex w-[104px] shrink-0"><StatusPill status={chip.status} label={chip.label} size="sm" hideIcon presentation="queue" className={chip.className} /></span>;
}

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
      <BulkCommandFeedback bulkOutcome={bulkOutcome} reviewing={false} onReviewed={onDismissBulkOutcome} onSelectRun={onSelectRun} />
    </ActionBar>
  );
}

function BulkResultRow({ outcome, subject, reason, onOpen }: { outcome: keyof typeof OUTCOME_CHIP; subject: string; reason?: string | undefined; onOpen: () => void }) {
  return <BareButton type="button" onClick={onOpen}
    className={cn("flex min-w-0 cursor-pointer items-center text-left h-[var(--ds-h-md)] gap-[var(--ds-space-snug)] px-[var(--ds-space-tight)]", dsRadius.sm, dsText.meta, dsFocus, dsMotion.fast, "hover:bg-[var(--ds-surface-3)]")}>
    <OutcomeChip outcome={outcome} />
    {/* Unknown subjects display their real ID rather than an invented name. */}
    <span className="w-40 shrink-0 truncate text-[color:var(--ds-fg-secondary)]">{subject}</span>
    <span className="min-w-0 flex-1 truncate text-[color:var(--ds-fg-muted)]">{reason}</span>
  </BareButton>;
}

/** The toast only notifies; its Priority notification item opens the per-run review (`reviewing`), and closing the review clears the result. */
export function BulkCommandFeedback({ bulkOutcome, reviewing: open, onReviewed, onSelectRun }: {
  bulkOutcome: BulkBatchOutcome | null; reviewing: boolean; onReviewed: () => void; onSelectRun: (runId: string) => void;
}) {
  const reviewing = open ? bulkOutcome : null;
  const vector = bulkOutcome?.response.state === "vector" ? bulkOutcome.response : undefined;
  const assurance = useMemo(
    () => vector === undefined ? undefined : bulkClosingAssurance(vector),
    [vector],
  );
  const summary = bulkOutcome === null ? undefined : bulkSummary(bulkOutcome);
  const counts = summary?.counts;
  return <>
    {summary !== undefined && <Notice sticky tone={summary.tone} title={summary.title} description={summary.detail} />}
    <Dialog open={reviewing !== null} onOpenChange={next => { if (!next) onReviewed(); }}>
      {reviewing !== null && <DialogContent size="md" title={`${reviewing.plan.label} result`} description={counts}>
        <div className="px-[var(--ds-space-loose)] pt-[var(--ds-space-tight)]" aria-live="polite" data-queue-bulk-result={reviewing.response.state}>
          {vector === undefined ? (
            /* Whole-request refusal reached no run; the served sentence is the complete answer. */
            <p className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
              {reviewing.response.state === "refused" ? reviewing.response.message : ""}
            </p>
          ) : (
            <div className="flex max-h-40 flex-col overflow-y-auto">
              {vector.results.map((entry) => (
                <BulkResultRow key={entry.runId} outcome={entry.outcome} subject={reviewing.subjects.get(entry.runId) ?? entry.runId}
                  reason={entry.outcome === "conflict" ? `Changed before the ${reviewing.plan.label.toLowerCase()}` : entry.detail.replace(/\.$/u, "")}
                  onOpen={() => { onReviewed(); onSelectRun(entry.runId); }} />
              ))}
              {/* Skipped rows keep a place so missing outcomes reconcile with the original selection. */}
              {reviewing.plan.skipped.map(row => <BulkResultRow key={row.runId} outcome="not-attempted" subject={row.title} reason={reviewing.plan.skippedReason ?? `Not offered ${reviewing.plan.label.toLowerCase()}`}
                onOpen={() => { onReviewed(); onSelectRun(row.runId); }} />)}
            </div>
          )}

          {/* Unavailable rows retain their IDs; no served titles exist to display. */}
          {reviewing.plan.unavailable.length > 0 && (
            <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
              {/* Outcome copy describes row availability when the batch was sent, never the present day. */}
              {bulkUnavailableSentence(reviewing.plan.unavailable.length, "past")}:{" "}
              <span className={dsText.nums}>{reviewing.plan.unavailable.join(", ")}</span>
            </p>
          )}

          {vector !== undefined && assurance !== undefined && (
            <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] flex items-start gap-[var(--ds-space-snug)] leading-snug text-[color:var(--ds-fg-muted)]")}>
              {assurance === "needs-review" ? (
                <>
                  <AlertTriangle aria-hidden className={cn(dsIcon.sm, "mt-px shrink-0 text-[color:var(--ds-status-waiting-fg)]")} />
                  Open each run to check it before trying again.
                </>
              ) : (
                <>
                  <CheckCircle2 aria-hidden className={cn(dsIcon.sm, "mt-px shrink-0 text-[color:var(--ds-success-fg)]")} />
                  Every selected row that offered {reviewing.plan.label.toLowerCase()} accepted it.
                </>
              )}
            </p>
          )}
        </div>
        <DialogFooter><Button variant="secondary" onClick={onReviewed}>Close</Button></DialogFooter>
      </DialogContent>}
    </Dialog>
  </>;
}

export function RunPauseControl({ runLabel, state, command, interrupt, onAction }: {
  runLabel: string;
  state: NonNullable<QueueSurfaceWire["pauseControl"]>["state"];
  command?: "pause" | "resume";
  interrupt?: StepInterruptWire;
  onAction?: (action: "pause" | "resume") => void;
}) {
  const pendingStatus = stepInterruptLabel(interrupt) ?? "Pause is not yet recorded.";
  return <div className="flex items-center gap-2" aria-label={`${runLabel} pause controls`}>

    <Button size="sm" variant="secondary" disabled={command === undefined || onAction === undefined} onClick={() => command !== undefined && onAction?.(command)}>{command === "resume" ? "Resume" : state === "pause-pending" ? "Pausing…" : "Pause"}</Button>
    {state !== "running" && <span className="sr-only" role="status">{state === "pause-pending" ? pendingStatus : state === "paused" ? "Pause recorded. Resume explicitly after restart." : "Run pause authority is unavailable."}</span>}
  </div>;
}

export function PauseAllQuitControls({ state, activeCount, onPauseAll, onResumeAll, onPauseAndQuit, quitRequested = false, onQuitDismiss }: {
  state: "ready" | "pausing" | "paused" | "unavailable";
  activeCount: number;
  quitRequested?: boolean;
  onQuitDismiss?: () => void;
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  onPauseAndQuit?: () => void;
}) {
  const pauseAll = useRef<HTMLButtonElement>(null);
  const enabled = state === "ready" || state === "paused";
  const resume = state === "paused";
  return <>
    <Button ref={pauseAll} size="sm" variant="secondary" className="size-7 p-0" aria-label={resume ? "Resume all runs" : "Pause all runs"} title={resume ? "Resume all paused runs" : PAUSE_ALL_EFFECT} icon={resume ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />} disabled={!enabled || activeCount === 0 || (resume ? !onResumeAll : !onPauseAll)} onClick={resume ? onResumeAll : onPauseAll} />
    {state !== "ready" && <p role="status" className="sr-only">{state === "pausing" ? PAUSE_ALL_PENDING_STATUS : state === "paused" ? "All runs paused. Resume them next time." : "Pause all is unavailable. Check the connection."}</p>}
    <Dialog open={quitRequested} onOpenChange={open => { if (!open) onQuitDismiss?.(); }}><DialogContent size="sm" title="Pause all and quit?" description={PAUSE_ALL_EFFECT} onCloseAutoFocus={event => { event.preventDefault(); if (pauseAll.current?.disabled === false) pauseAll.current.focus(); else document.getElementById("dashboard-main-region")?.focus(); }}>
      <DialogFooter><Button variant="secondary" autoFocus onClick={onQuitDismiss}>Keep working</Button><Button disabled={!enabled || !onPauseAndQuit} onClick={() => { onQuitDismiss?.(); onPauseAndQuit?.(); }}>Pause all and quit</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
