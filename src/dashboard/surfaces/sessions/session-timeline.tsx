import { cn } from "../../lib/utils.js";
import { sessionTimelineSummary, type SessionNode } from "./sessions-view-model.js";

export function SessionTimeline({ nodes, label, action }: { nodes: readonly SessionNode[]; label: string; action: string }) {
  const summary = sessionTimelineSummary(nodes);
  return <div>
    <div className="mb-2 flex items-baseline justify-between gap-2"><p className="m-0 text-body">{action}</p><span className="shrink-0 text-caption tabular-nums text-ui-muted">{summary.completed} / {summary.total} nodes</span></div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.completed} aria-valuetext={`${summary.completed} of ${summary.total} nodes complete`} className="flex h-1.5 gap-0.5">
      {nodes.map(node => <span key={node.id} data-session-node={node.id} title={`${node.label} · ${node.state}`} aria-hidden className={cn("min-w-0 flex-1 rounded-sm", node.state === "completed" ? "bg-ui-info" : node.state === "active" ? "bg-ui-info outline outline-offset-1 outline-ui-info" : node.state === "failed" ? "bg-ui-danger" : node.state === "waiting" ? "bg-ui-warning" : node.state === "paused" ? "border border-ui-info bg-ui-table" : "bg-ui-stroke-control")} />)}
    </div>
  </div>;
}
