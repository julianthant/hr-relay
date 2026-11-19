import { memo, type ReactNode } from "react";
import { Tooltip, dsFocus } from "../../ds/ui.js";
import type { WorkflowCategoryGroup, WorkflowGroupEntry } from "../workflows/workflow-category.js";
import type { WorkflowNavigationEntry } from "./workflow-rail-model.js";
import { workflowIcon } from "../workflows/workflow-icons.js";
import { WorkflowHarnessTag } from "./workflow-harness-tag.js";

const WorkflowNavigationRow = memo(function WorkflowNavigationRow({ node, selected, onSelect, metadata, unavailable, description }: {
  node: WorkflowGroupEntry<WorkflowNavigationEntry>; selected: boolean; onSelect: (id: string) => void; metadata?: ReactNode; unavailable?: string; description?: string;
}) {
  const Icon = workflowIcon(node.entry.id);
  return <button type="button" aria-current={selected ? "page" : undefined} aria-label={node.entry.label} className={`${dsFocus} disabled:cursor-not-allowed disabled:text-ui-muted`} disabled={unavailable !== undefined} title={unavailable} aria-description={unavailable ?? description} onClick={() => onSelect(node.entry.id)}>
    <Icon aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{node.entry.label}</span>{node.harness && <WorkflowHarnessTag harness={node.harness} />}{metadata}
  </button>;
});

const WorkflowTile = memo(function WorkflowTile({ node, selected, onSelect, metadata, description }: {
  initials: string; node: WorkflowGroupEntry<WorkflowNavigationEntry>; selected: boolean; onSelect: (id: string) => void; metadata?: ReactNode; description?: string;
}) {
  const Icon = workflowIcon(node.entry.id);
  return <Tooltip side="right" content={description ? `${node.entry.label} · ${description}` : node.entry.label}>
    <button type="button" aria-current={selected ? "page" : undefined} aria-label={node.entry.label} className={dsFocus} aria-description={description} onClick={() => onSelect(node.entry.id)}>
      <Icon aria-hidden className="size-4 shrink-0" />{metadata}
    </button>
  </Tooltip>;
});

function WorkflowNavigationEntries({ nodes, active, onSelect, metadata, unavailable, description, collapsed }: {
  nodes: readonly WorkflowGroupEntry<WorkflowNavigationEntry>[]; active: string; onSelect: (id: string) => void; metadata?: (id: string) => ReactNode; unavailable?: (id: string) => string | undefined; description?: (id: string) => string | undefined; collapsed?: boolean;
}) {
  if (collapsed) return <ul className="m-0 list-none p-0">{nodes.flatMap(node => [node, ...node.members]).map(node => <li key={node.entry.id}>
    <WorkflowTile node={node} selected={active === node.entry.id} onSelect={onSelect} metadata={metadata?.(node.entry.id)} description={description?.(node.entry.id)} /></li>)}</ul>;
  return <ul className="m-0 list-none p-0">{nodes.map(node => <li key={node.entry.id}>
    <WorkflowNavigationRow node={node} selected={active === node.entry.id} onSelect={onSelect} metadata={metadata?.(node.entry.id)} unavailable={unavailable?.(node.entry.id)} description={description?.(node.entry.id)} />
    {node.members.length > 0 && <div className="pl-[var(--ds-space-cozy)]"><ul aria-label={`Proving harnesses of ${node.entry.label}`} className="m-0 list-none p-0">
      {node.members.map(member => <li key={member.entry.id}><WorkflowNavigationRow node={member} selected={active === member.entry.id} onSelect={onSelect} metadata={metadata?.(member.entry.id)} unavailable={unavailable?.(member.entry.id)} description={description?.(member.entry.id)} /></li>)}
    </ul></div>}
  </li>)}</ul>;
}

export const WorkflowNavigation = memo(function WorkflowNavigation({ groups, active, onSelect, label, metadata, unavailable, description, collapsed }: {
  collapsed?: boolean;
  description?: (id: string) => string | undefined;
  groups: readonly WorkflowCategoryGroup<WorkflowNavigationEntry>[]; active: string; onSelect: (id: string) => void; label: string; metadata?: (id: string) => ReactNode; unavailable?: (id: string) => string | undefined;
}) {
  return <nav aria-label={label} className="workflow-rail" data-collapsed={collapsed || undefined}><div className="workflow-rail-groups">{groups.map(group =>
    <section key={group.label} className="workflow-rail-group">{!collapsed && group.label !== "" && <h3>{group.label}</h3>}
      <WorkflowNavigationEntries nodes={group.entries} active={active} onSelect={onSelect} metadata={metadata} unavailable={unavailable} description={description} collapsed={collapsed} />
    </section>)}</div></nav>;
});
