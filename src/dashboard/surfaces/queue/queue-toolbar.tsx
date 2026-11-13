import { useMemo, useRef } from "react";
import { AlertTriangle, CheckCircle2, Pause, Play } from "lucide-react";
import { cn } from "../../lib/utils.js";
import {
  BareButton,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  StatusPill,
  Notice,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
} from "../../ds/ui.js";
import { OUTCOME_CHIP, bulkSummary } from "./queue-toolbar-model.js";
import { PAUSE_ALL_EFFECT, PAUSE_ALL_PENDING_STATUS, stepInterruptLabel } from "../shared/status/status-model.js";
import type { QueueSurfaceWire, StepInterruptWire } from "../../../models/dashboard/projection.js";
import {
  bulkClosingAssurance,
  type BulkBatchOutcome,
} from "../../app/commands/bulk-dispatch.js";

function OutcomeChip({ outcome }: { outcome: keyof typeof OUTCOME_CHIP }) {
  const chip = OUTCOME_CHIP[outcome];
  return <span className="flex w-[104px] shrink-0"><StatusPill status={chip.status} label={chip.label} size="sm" hideIcon presentation="queue" className={chip.className} /></span>;
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
            </div>
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

    <Button size="sm" variant="secondary" disabled={command === undefined || onAction === undefined} onClick={() => command !== undefined && onAction?.(command)}>{state === "pause-pending" ? "Pausing…" : command === "resume" ? "Resume" : "Pause"}</Button>
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
