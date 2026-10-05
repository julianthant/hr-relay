import { memo, useMemo } from "react";
import { SearchInput, dsFg, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { WorkflowCatalogEntry } from "./workflow-catalog-model.js";
import { runPickerGroups } from "./run-start-picker-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";

export const RunWorkflowPicker = memo(function RunWorkflowPicker({ catalog, value, onChange, query, onQuery }: {
  catalog: readonly WorkflowCatalogEntry[]; value: string; onChange: (id: string) => void; query: string; onQuery: (query: string) => void;
}) {
  const groups = useMemo(() => runPickerGroups(catalog, query), [catalog, query]);
  const unavailable = useMemo(() => new Map(catalog.flatMap(entry => entry.launch.state === "unavailable" ? [[entry.id, entry.launch] as const] : [])), [catalog]);
  return <aside className="launch-workflow-rail launch-picker flex min-h-0 shrink-0 flex-col border-r border-ui-stroke">
    <div className="launch-picker-search"><SearchInput aria-label="Filter workflows" placeholder="Search" value={query} onClear={() => onQuery("")} onChange={event => onQuery(event.target.value)} /></div>
    {groups.length > 0 ? <WorkflowNavigation label="Workflow" groups={groups} active={value} onSelect={onChange}
      unavailable={id => unavailable.get(id)?.reason} metadata={id => unavailable.has(id) ? <span className="ml-auto shrink-0 text-caption text-ui-muted">{unavailable.get(id)?.label}</span> : undefined} />
      : <p role="status" className={cn("px-4", dsText.meta, dsFg.muted)}>No workflow matches “{query}”.</p>}
  </aside>;
});
