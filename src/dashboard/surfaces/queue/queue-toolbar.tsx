import { useMemo, useRef } from "react";
import { AlertTriangle, CheckCircle2, Pause, Play } from "lucide-react";
import { cn } from "../../lib/utils.js";
import {
  BareButton,
  Button,
  Dialog,
  DialogBody,
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
import { PAUSE_ALL_EFFECT, PAUSE_ALL_PENDING_STATUS } from "../shared/status/status-model.js";
import {
  bulkClosingAssurance,
  bulkUnavailableSentence,
  type BulkBatchOutcome,
} from "../../app/commands/bulk-dispatch.js";

function OutcomeChip({ outcome }: { outcome: keyof typeof OUTCOME_CHIP }) {
  const chip = OUTCOME_CHIP[outcome];
  return <span className="flex shrink-0"><StatusPill status={chip.status} label={chip.label} size="sm" hideIcon presentation="queue" className={chip.className} /></span>;
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
    {summary !== undefined && <Notice tone={summary.tone} title={summary.counts === undefined ? summary.title : `${bulkOutcome?.plan.label ?? ""}: ${summary.counts}`} />}
    <Dialog open={reviewing !== null} onOpenChange={next => { if (!next) onReviewed(); }}>
      {reviewing !== null && <DialogContent size="md" title={`${reviewing.plan.label} result`} description={counts}>
        <DialogBody><div aria-live="polite" data-queue-bulk-result={reviewing.response.state}>
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
        </div></DialogBody>
        <DialogFooter><Button variant="secondary" onClick={onReviewed}>Close</Button></DialogFooter>
      </DialogContent>}
    </Dialog>
  </>;
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
  const idle = !resume && activeCount === 0;
  return <>
    <Button ref={pauseAll} size="sm" variant="secondary" className={cn("size-7 p-0", (!enabled || activeCount === 0) && "opacity-50")} aria-label={resume ? "Resume all runs" : "Pause all runs"} title={resume ? "Resume all paused runs" : idle ? "No runs to pause" : PAUSE_ALL_EFFECT} icon={resume ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />} disabled={!enabled || activeCount === 0 || (resume ? !onResumeAll : !onPauseAll)} onClick={resume ? onResumeAll : onPauseAll} />
    {state !== "ready" && <p role="status" className="sr-only">{state === "pausing" ? PAUSE_ALL_PENDING_STATUS : state === "paused" ? "All runs paused. Resume them next time." : "Pause all is unavailable. Check the connection."}</p>}
    <Dialog open={quitRequested} onOpenChange={open => { if (!open) onQuitDismiss?.(); }}><DialogContent size="sm" title="Pause all and quit?" description={PAUSE_ALL_EFFECT} onCloseAutoFocus={event => { event.preventDefault(); if (pauseAll.current?.disabled === false) pauseAll.current.focus(); else document.getElementById("dashboard-main-region")?.focus(); }}>
      <DialogFooter><Button variant="secondary" autoFocus onClick={onQuitDismiss}>Keep working</Button><Button disabled={!enabled || !onPauseAndQuit} onClick={() => { onQuitDismiss?.(); onPauseAndQuit?.(); }}>Pause all and quit</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
