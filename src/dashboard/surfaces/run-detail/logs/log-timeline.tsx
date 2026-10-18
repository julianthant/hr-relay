import { Tooltip, TooltipProvider } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { LOG_TIMELINE_STYLES, type LogTimelineStage } from "./log-timeline-model.js";

export function LogTimeline({ stages, onJump }: { stages: readonly LogTimelineStage[]; onJump: (stepId: string) => void }) {
  return <TooltipProvider delayDuration={200} disableHoverableContent><nav aria-label="Run timeline" className="shrink-0 overflow-x-auto border-b border-ui-stroke bg-ui-panel px-4 py-2">
    <ol className="m-0 flex min-w-[32rem] list-none gap-1 p-0">
      {stages.map(stage => {
        const style = LOG_TIMELINE_STYLES[stage.state];
        return <li key={stage.id} className="min-w-0 flex-1">
          <Tooltip side="bottom" content={<div className="ui-theme-scope w-64 max-w-full font-ui text-body text-ui-primary">
            <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-ui-stroke pb-2"><span className="font-semibold">{stage.label}</span>{stage.state !== "pending" && <span className="shrink-0 tabular-nums text-ui-secondary">{stage.durationLabel ?? style.label}</span>}</div>
            <ol aria-label={`${stage.label} substeps`} className={cn("m-0 list-none p-0", stage.substeps.length > 12 ? "space-y-1.5" : "space-y-2")}>{stage.substeps.map(substep => <li key={substep.id} className="flex items-baseline justify-between gap-3"><span className={cn("min-w-0", substep.state === "pending" ? "text-ui-muted" : "text-ui-secondary")}>{substep.label}</span>{substep.state !== "pending" && <span className={cn("shrink-0 text-caption tabular-nums", LOG_TIMELINE_STYLES[substep.state].color)}>{substep.durationLabel ?? LOG_TIMELINE_STYLES[substep.state].label}</span>}</li>)}</ol>
          </div>}><button type="button" title={stage.label} aria-label={`${stage.label} · ${style.label}${stage.time ? ` · ${stage.time}` : ""}${stage.durationLabel ? ` · ${stage.durationLabel}` : ""}`} disabled={!stage.stepId}
            onClick={() => { if (stage.stepId) onJump(stage.stepId); }}
            className="group flex w-full flex-col gap-1 rounded-sm bg-transparent px-0.5 py-1 text-left enabled:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-info">
            <span className={cn("flex min-w-0 items-center gap-1.5 text-caption", style.color)}><span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", stage.state === "pending" ? "border border-ui-stroke-control" : "bg-current")} /><span className="truncate">{stage.label}</span></span>
            <span aria-hidden className={cn("block h-2.5 w-full rounded-sm", style.bar, stage.state === "completed" && "group-hover:brightness-90 group-focus-visible:brightness-90")} />
            {stage.state !== "pending" && (stage.state !== "completed" || stage.durationLabel !== undefined) && <span className={cn("text-caption tabular-nums", stage.state === "completed" ? "font-data text-ui-muted" : style.color)}>{stage.state === "completed" ? stage.durationLabel : style.label}</span>}
          </button></Tooltip>
        </li>;
      })}
    </ol>
  </nav></TooltipProvider>;
}
