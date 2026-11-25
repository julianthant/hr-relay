import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { SearchInput, dsFg, dsText } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { runPickerGroups } from "./run-start-picker-model.js";
import { Briefcase, FileText, GraduationCap, Search, UserMinus, UserPlus, type LucideIcon } from "lucide-react";
import { dsFocus } from "../../ds/ui.js";
import { WorkflowHarnessTag } from "../shell/workflow-harness-tag.js";

/** One icon per category heading; a workflow row under it carries none. */
const CATEGORY_ICON: Readonly<Record<string, LucideIcon>> = {
  Lookup: Search, Separations: UserMinus, Onboarding: UserPlus, "Work-Study": GraduationCap, Documents: FileText,
};
const categoryIcon = (label: string): LucideIcon => CATEGORY_ICON[label] ?? Briefcase;

export const RunWorkflowPicker = memo(function RunWorkflowPicker({ catalog, value, locked = false, onChange, query, onQuery }: {
  catalog: readonly WorkflowCatalogEntry[]; value: string; locked?: boolean; onChange: (id: string) => void; query: string; onQuery: (query: string) => void;
}) {
  const groups = useMemo(() => runPickerGroups(catalog, query), [catalog, query]);
  const unavailable = useMemo(() => new Map(catalog.flatMap(entry => entry.launch.state === "unavailable" ? [[entry.id, entry.launch] as const] : [])), [catalog]);
  const rail = useRef<HTMLElement>(null);
  /** A pick keeps the list at the top so the first heading is never clipped, scrolling only as far as the selected row needs. */
  useLayoutEffect(() => {
    const scroller = rail.current?.querySelector<HTMLElement>(".workflow-rail-groups");
    if (scroller === null || scroller === undefined) return;
    scroller.scrollTop = 0;
    const selected = scroller.querySelector<HTMLElement>('button[aria-current="page"]');
    if (selected === null) return;
    const overflow = selected.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    if (overflow > 0) scroller.scrollTop = overflow;
  }, [value]);
  return <aside ref={rail} className="launch-workflow-rail launch-picker flex min-h-0 shrink-0 flex-col border-r border-ui-stroke">
    <div className="launch-picker-search"><SearchInput variant="sidebar" aria-label="Filter workflows" placeholder="Search" value={query} onClear={() => onQuery("")} onChange={event => onQuery(event.target.value)} /></div>
    {groups.length > 0 ? <nav aria-label="Workflow" className="workflow-rail"><div className="workflow-rail-groups">{groups.map(group => {
      const Icon = categoryIcon(group.label);
      return <section key={group.label} className="workflow-rail-group">
        {group.label !== "" && <h3><Icon aria-hidden className="size-3.5 shrink-0" />{group.label}</h3>}
        <ul className="m-0 list-none p-0">{group.entries.flatMap(node => [node, ...node.members]).map(node => {
          const reason = unavailable.get(node.entry.id);
          return <li key={node.entry.id}>
            <button type="button" aria-current={value === node.entry.id ? "page" : undefined} aria-label={node.entry.label} className={`${dsFocus} disabled:cursor-not-allowed disabled:text-ui-muted`}
              disabled={locked || reason !== undefined} title={reason?.reason} aria-description={reason?.reason} onClick={() => onChange(node.entry.id)}>
              <span className="truncate">{node.entry.label}</span>{node.harness && <WorkflowHarnessTag harness={node.harness} />}
              {reason !== undefined && <span className="ml-auto shrink-0 text-caption text-ui-muted">{reason.label}</span>}
            </button>
          </li>;
        })}</ul>
      </section>;
    })}</div></nav>
      : <p role="status" className={cn("px-4", dsText.meta, dsFg.muted)}>No workflow matches “{query}”.</p>}
  </aside>;
});
