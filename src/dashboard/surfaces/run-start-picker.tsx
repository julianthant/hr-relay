import { memo, useMemo, useState } from "react";
import { Button, SearchInput, dsFg, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { RunStartWorkflow } from "./run-start.js";
import { runPickerEntries, runPickerGroups } from "./run-start-picker-model.js";
import { workflowNavigationGroups, workflowRailCategory, type WorkflowNavigationEntry } from "./workflow-rail-model.js";
import type { WorkflowGroupEntry } from "./workflow-category.js";
import { WorkflowHarnessTag } from "./workflow-harness-tag.js";
import { WorkflowNavigation } from "./workflow-navigation.js";

type BlockedWorkflow = RunStartWorkflow & WorkflowNavigationEntry;
function BlockedEntries({ nodes }: { nodes: readonly WorkflowGroupEntry<BlockedWorkflow>[] }) {
  return <ul className="m-0 list-none space-y-2 p-0">{nodes.map(node => <li key={node.entry.id}>
    <span className="flex items-center gap-2">{node.entry.label}{node.harness && <WorkflowHarnessTag harness={node.harness} />}</span>
    {node.entry.inputRun.state === "absent" && <span className="block text-ui-muted">{node.entry.inputRun.reason}</span>}
    {node.members.length > 0 && <div className="mt-2 pl-[var(--ds-space-cozy)]"><BlockedEntries nodes={node.members} /></div>}
  </li>)}</ul>;
}

export const RunWorkflowPicker = memo(function RunWorkflowPicker({ workflows, includePreviews, value, onChange, query, onQuery }: {
  workflows: readonly RunStartWorkflow[]; includePreviews: boolean; value: string; onChange: (id: string) => void; query: string; onQuery: (query: string) => void;
}) {
  const [showBlocked, setShowBlocked] = useState(false);
  const entries = useMemo(() => runPickerEntries(workflows, includePreviews), [workflows, includePreviews]);
  const groups = useMemo(() => runPickerGroups(entries, query), [entries, query]);
  const blocked = useMemo(() => workflows.filter(flow => flow.inputRun.state === "absent"), [workflows]);
  const blockedGroups = useMemo(() => workflowNavigationGroups(blocked.map(flow => ({ ...flow, id: flow.workflowId, categoryId: workflowRailCategory(flow.workflowId, flow.categoryId) }))), [blocked]);
  return <aside className="launch-workflow-rail launch-picker flex min-h-0 shrink-0 flex-col border-r border-ui-stroke">
    <div className="launch-picker-search"><SearchInput aria-label="Filter workflows" placeholder="Search" value={query} onClear={() => onQuery("")} onChange={event => onQuery(event.target.value)} /></div>
    {groups.length > 0 ? <WorkflowNavigation label="Workflow" groups={groups} active={value} onSelect={onChange} /> : <p role="status" className={cn("px-4", dsText.meta, dsFg.muted)}>No workflow matches “{query}”.</p>}
    {blocked.length > 0 && <div className="mt-auto shrink-0 border-t border-ui-stroke p-[var(--ds-space-base)]">
      {showBlocked && <div className="max-h-44 space-y-3 overflow-auto text-caption">{blockedGroups.map(group => <section key={group.label}><h3 className="mb-1 text-caption text-ui-muted">{group.label}</h3><BlockedEntries nodes={group.entries} /></section>)}</div>}
      <Button size="sm" variant="ghost" aria-expanded={showBlocked} onClick={() => setShowBlocked(value => !value)}>{blocked.length} not startable</Button>
    </div>}
  </aside>;
});
