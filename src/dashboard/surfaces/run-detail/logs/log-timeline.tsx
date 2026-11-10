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
    <p className="log-step-card-title">{stage.label}</p>
    <p className="log-step-card-meta">{when === undefined ? label : `${label} · ${when}`}</p>
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

export function LogTimeline({ stages, onJump }: { stages: readonly LogTimelineStage[]; onJump: (stepId: string) => void }) {
  return <TooltipProvider delayDuration={200} disableHoverableContent><nav aria-label="Run timeline" className="shrink-0 border-b border-ui-stroke bg-ui-panel px-4 py-2">
    <ol className="m-0 flex list-none gap-1 p-0">
      {stages.map(stage => {
        const style = LOG_TIMELINE_STYLES[stage.state];
        const label = stage.statusLabel ?? style.label;
        return <li key={stage.id} className="min-w-0 flex-1">
          <Tooltip side="bottom" content={<StepCard stage={stage} label={label} />}><button type="button" aria-label={`${stage.label} · ${label}${stage.time ? ` · ${stage.time}` : ""}${stage.durationLabel ? ` · ${stage.durationLabel}` : ""}`} aria-disabled={!stage.stepId || undefined}
            onClick={() => { if (stage.stepId) onJump(stage.stepId); }}
            className="group flex w-full flex-col gap-1 rounded-sm bg-transparent px-0.5 py-1 text-left cursor-pointer aria-disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-info">
            <span className={cn("flex min-w-0 items-center gap-1.5 text-caption", style.color)}><span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", stage.state === "pending" ? "border border-ui-stroke-control" : "bg-current")} /><span className="truncate">{stage.label}</span></span>
            <span aria-hidden className={cn("block h-2.5 w-full rounded-sm", style.bar, stage.state === "completed" && "group-hover:brightness-90 group-focus-visible:brightness-90")} />
            {stage.state !== "pending" && (stage.state !== "completed" || stage.durationLabel !== undefined) && <span className={cn("text-caption tabular-nums", stage.state === "completed" ? "text-ui-muted" : style.color)}>{stage.state === "completed" ? stage.durationLabel : label}</span>}
          </button></Tooltip>
        </li>;
      })}
    </ol>
  </nav></TooltipProvider>;
}
