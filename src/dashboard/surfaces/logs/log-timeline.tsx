import { cn } from "../../lib/utils.js";
import { LOG_TIMELINE_STYLES, type LogTimelineStage } from "./log-timeline-model.js";

export function LogTimeline({ stages, onJump }: { stages: readonly LogTimelineStage[]; onJump: (stepId: string) => void }) {
  return <nav aria-label="Run timeline" className="shrink-0 overflow-x-auto border-b border-ui-stroke bg-ui-panel px-4 py-2">
    <ol className="m-0 flex min-w-[32rem] list-none gap-1 p-0">
      {stages.map(stage => {
        const style = LOG_TIMELINE_STYLES[stage.state];
        return <li key={stage.id} className="min-w-0 flex-1">
          <button type="button" aria-label={`${stage.label} · ${style.label}${stage.time ? ` · ${stage.time}` : ""}${stage.durationLabel ? ` · ${stage.durationLabel}` : ""}`} disabled={!stage.stepId}
            onClick={() => { if (stage.stepId) onJump(stage.stepId); }}
            className="flex w-full flex-col gap-1 rounded-sm bg-transparent px-0.5 py-1 text-left enabled:cursor-pointer enabled:hover:bg-ui-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-info">
            <span className={cn("flex min-w-0 items-center gap-1.5 text-caption", style.color)}><span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", stage.state === "pending" ? "border border-ui-stroke-control" : "bg-current")} /><span className="truncate">{stage.label}</span></span>
            <span aria-hidden className={cn("block h-2.5 w-full rounded-sm", style.bar)} />
            <span className={cn("text-caption tabular-nums", stage.state === "completed" ? "font-data text-ui-muted" : style.color)}>{stage.state === "completed" ? stage.durationLabel ?? "Not measured" : style.label}</span>
          </button>
        </li>;
      })}
    </ol>
  </nav>;
}
