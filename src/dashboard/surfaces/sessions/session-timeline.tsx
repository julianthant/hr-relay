import { cn } from "../../lib/utils.js";
import { sessionTimelineSummary, type SessionNode } from "./sessions-view-model.js";

/** One step title, its node bar and count; without nodes the bar is an empty track, so every card keeps the same layout. */
export function SessionTimeline({ nodes, label, action, emptyLabel = "No steps recorded" }: { nodes?: readonly SessionNode[]; label: string; action: string; emptyLabel?: string }) {
  const summary = nodes && sessionTimelineSummary(nodes);
  return <div>
    <div className="mb-2 flex items-baseline justify-between gap-2"><p className="m-0 min-w-0 truncate text-body" title={action}>{action || "\u00a0"}</p>{summary && <span className="shrink-0 text-caption tabular-nums text-ui-muted">{summary.completed} / {summary.total} steps</span>}</div>
    {nodes && summary ? <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.completed} aria-valuetext={`${summary.completed} of ${summary.total} steps complete`} className="flex h-1.5 gap-0.5">
      {nodes.map(node => <span key={node.id} data-session-node={node.id} title={`${node.label} · ${node.state}`} aria-hidden className={cn("min-w-0 flex-1 rounded-sm", node.state === "completed" ? "bg-ui-info" : node.state === "active" ? "bg-ui-info outline outline-offset-1 outline-ui-info" : node.state === "failed" ? "bg-ui-danger" : node.state === "waiting" ? "bg-ui-warning" : node.state === "paused" ? "border border-ui-info bg-ui-table" : "bg-ui-stroke-control")} />)}
    </div> : <div role="img" aria-label={emptyLabel} className="h-1.5 w-full rounded-sm bg-ui-stroke-control" />}
  </div>;
}
