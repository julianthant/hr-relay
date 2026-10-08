import { memo, type ReactNode } from "react";
import { BriefcaseBusiness, Clock3, FileSearch, Folder, GraduationCap, LogOut, Search, UserPlus, Wrench } from "lucide-react";
import { dsFocus } from "../../ds/ui.js";
import type { WorkflowCategoryGroup, WorkflowGroupEntry } from "../workflows/workflow-category.js";
import type { WorkflowNavigationEntry } from "./workflow-rail-model.js";
import { WorkflowHarnessTag } from "../workflows/mocks/workflow-harness-tag.js";

const categoryIcons = { Search, Separations: LogOut, Onboarding: UserPlus, "Work Study": GraduationCap, Payroll: BriefcaseBusiness, Utils: Wrench, OnBase: FileSearch, Timekeeping: Clock3 };

const WorkflowNavigationRow = memo(function WorkflowNavigationRow({ node, selected, onSelect, metadata, unavailable }: {
  node: WorkflowGroupEntry<WorkflowNavigationEntry>; selected: boolean; onSelect: (id: string) => void; metadata?: ReactNode; unavailable?: string;
}) {
  return <button type="button" aria-current={selected ? "page" : undefined} aria-label={node.entry.label} className={`${dsFocus} disabled:cursor-not-allowed disabled:text-ui-muted`} disabled={unavailable !== undefined} title={unavailable} aria-description={unavailable} onClick={() => onSelect(node.entry.id)}>
    <span className="truncate">{node.entry.label}</span>{node.harness && <WorkflowHarnessTag harness={node.harness} />}{metadata}
  </button>;
});

function WorkflowNavigationEntries({ nodes, active, onSelect, metadata, unavailable }: {
  nodes: readonly WorkflowGroupEntry<WorkflowNavigationEntry>[]; active: string; onSelect: (id: string) => void; metadata?: (id: string) => ReactNode; unavailable?: (id: string) => string | undefined;
}) {
  return <ul className="m-0 list-none p-0">{nodes.map(node => <li key={node.entry.id}>
    <WorkflowNavigationRow node={node} selected={active === node.entry.id} onSelect={onSelect} metadata={metadata?.(node.entry.id)} unavailable={unavailable?.(node.entry.id)} />
    {node.members.length > 0 && <div className="pl-[var(--ds-space-cozy)]"><ul aria-label={`Proving harnesses of ${node.entry.label}`} className="m-0 list-none p-0">
      {node.members.map(member => <li key={member.entry.id}><WorkflowNavigationRow node={member} selected={active === member.entry.id} onSelect={onSelect} metadata={metadata?.(member.entry.id)} unavailable={unavailable?.(member.entry.id)} /></li>)}
    </ul></div>}
  </li>)}</ul>;
}

export const WorkflowNavigation = memo(function WorkflowNavigation({ groups, active, onSelect, label, metadata, unavailable }: {
  groups: readonly WorkflowCategoryGroup<WorkflowNavigationEntry>[]; active: string; onSelect: (id: string) => void; label: string; metadata?: (id: string) => ReactNode; unavailable?: (id: string) => string | undefined;
}) {
  return <nav aria-label={label} className="workflow-rail"><div className="workflow-rail-groups">{groups.map(group => {
    const Icon = categoryIcons[group.label as keyof typeof categoryIcons] ?? Folder;
    return <section key={group.label} className="workflow-rail-group"><h3><Icon aria-hidden className="size-3.5 shrink-0" />{group.label}</h3>
      <WorkflowNavigationEntries nodes={group.entries} active={active} onSelect={onSelect} metadata={metadata} unavailable={unavailable} />
    </section>;
  })}</div></nav>;
});
