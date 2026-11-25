import { Check, Circle, Clock, LoaderCircle, Minus, X } from "lucide-react";
import { Tooltip, TooltipProvider } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { LOG_TIMELINE_STYLES, type LogTimelineStage, type LogTimelineState } from "./log-timeline-model.js";
import "./log-presentation.css";

const GLYPHS: Readonly<Record<LogTimelineState, typeof Check>> = { completed: Check, active: LoaderCircle, waiting: Clock, failed: X, pending: Circle, skipped: Minus, cancelled: Minus };
const GLYPH_COLOR: Readonly<Record<LogTimelineState, string>> = { completed: "text-ui-positive", active: "text-ui-info", waiting: "text-ui-warning", failed: "text-ui-danger", pending: "text-ui-muted", skipped: "text-ui-muted", cancelled: "text-ui-muted" };

function StepCard({ stage, label }: { stage: LogTimelineStage; label: string }) {
  const when = stage.state === "pending" ? undefined : stage.durationLabel ?? stage.time;
  return <div className="log-step-card" data-dense={stage.substeps.length > 12 || undefined}>
    <p className="log-step-card-head"><span className="log-step-card-title">{stage.label}</span><span className="log-step-card-meta">{when === undefined ? label : `${label} · ${when}`}</span></p>
    {stage.substeps.length > 0 && <ol aria-label={`${stage.label} substeps`} className="log-step-card-rows">{stage.substeps.map(substep => {
      const Glyph = GLYPHS[substep.state];
      return <li key={substep.id}>
        <Glyph aria-hidden className={cn("size-3.5 shrink-0", GLYPH_COLOR[substep.state])} />
        <span className={cn("min-w-0 flex-1 truncate", substep.state === "pending" ? "text-ui-muted" : "text-ui-primary")}>{substep.label}</span>
        {substep.durationLabel !== undefined && <span className="shrink-0 tabular-nums text-ui-muted">{substep.durationLabel}</span>}
      </li>;
    })}</ol>}
  </div>;
}

/** The run's steps as chips in the header row; the dot carries the step's state. */
export function LogTimeline({ stages, onJump }: { stages: readonly LogTimelineStage[]; onJump: (stepId: string) => void }) {
  if (stages.length === 0) return null;
  return <TooltipProvider delayDuration={200} disableHoverableContent><nav aria-label="Run timeline" tabIndex={0} className="min-w-0 flex-1 overflow-x-auto rounded-full [scrollbar-width:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info">
    <ol className="m-0 flex list-none items-center gap-2 p-0">
      {stages.map(stage => {
        const style = LOG_TIMELINE_STYLES[stage.state];
        const label = stage.statusLabel ?? style.label;
        const detail = stage.state === "pending" ? undefined : stage.durationLabel ?? (stage.state === "completed" ? undefined : label);
        return <li key={stage.id} className="shrink-0">
          <Tooltip side="bottom" variant="card" content={<StepCard stage={stage} label={label} />}><button type="button" aria-label={`${stage.label} · ${label}${stage.time ? ` · ${stage.time}` : ""}${stage.durationLabel ? ` · ${stage.durationLabel}` : ""}`} aria-disabled={!stage.stepId || undefined}
            onClick={() => { if (stage.stepId) onJump(stage.stepId); }}
            className="flex items-center gap-1.5 rounded-full border border-ui-stroke bg-transparent px-2.5 py-0.5 text-caption text-ui-secondary cursor-pointer hover:bg-ui-hover aria-disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-info">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", style.color, stage.state === "pending" ? "border border-ui-stroke-control" : "bg-current")} />
            <span data-one-line className="whitespace-nowrap">{stage.label}{detail === undefined ? "" : ` · ${detail}`}</span>
          </button></Tooltip>
        </li>;
      })}
    </ol>
  </nav></TooltipProvider>;
}
