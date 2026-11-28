import { createElement, memo, useLayoutEffect, useMemo, useRef } from "react";
import { SearchInput, dsFg, dsFocus, dsText } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { runPickerGroups } from "./run-start-picker-model.js";
import { categoryIcon } from "../shell/workflow-rail-model.js";
import { WorkflowHarnessTag } from "../shell/workflow-harness-tag.js";

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
    <div className="launch-picker-search"><SearchInput aria-label="Filter workflows" placeholder="Search" value={query} onClear={() => onQuery("")} onChange={event => onQuery(event.target.value)} /></div>
    {groups.length > 0 ? <nav aria-label="Workflow" className="workflow-rail"><div className="workflow-rail-groups">{groups.map(group =>
      <section key={group.label} className="workflow-rail-group">
        {group.label !== "" && <h3>{createElement(categoryIcon(group.label), { "aria-hidden": true, className: "size-3.5 shrink-0" })}{group.label}</h3>}
        <ul className="m-0 list-none p-0">{group.entries.flatMap(node => [node, ...node.members]).map(node => {
          const reason = unavailable.get(node.entry.id);
          return <li key={node.entry.id}>
            <button type="button" aria-current={value === node.entry.id ? "page" : undefined} aria-label={node.entry.label} className={`${dsFocus} disabled:cursor-not-allowed disabled:text-ui-muted`}
              disabled={locked || reason !== undefined} title={reason === undefined ? node.entry.label : `${node.entry.label}: ${reason.reason}`} aria-description={reason?.reason} onClick={() => onChange(node.entry.id)}>
              <span className="truncate">{node.entry.label}</span>{node.harness && <WorkflowHarnessTag harness={node.harness} />}
              {reason !== undefined && <span className="ml-auto shrink-0 text-caption text-ui-muted">{reason.label}</span>}
            </button>
          </li>;
        })}</ul>
      </section>)}</div></nav>
      : <p role="status" className={cn("px-4", dsText.meta, dsFg.muted)}>No workflow matches “{query}”.</p>}
  </aside>;
});
