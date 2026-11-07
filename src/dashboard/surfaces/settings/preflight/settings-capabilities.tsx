import { useViewState } from "../../../app/navigation/view-route-model.js";
import "../reference-settings.css";
import "./settings-capabilities.css";
import { Check, Info, Minus, TriangleAlert } from "lucide-react";
import { SearchInput, Disclosure, IconButton, PageHeading, Popover, PopoverContent, PopoverTrigger, Skeleton, dsIcon, dsText } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { CAPABILITY_SPECS, capabilityMatrix, type CapabilityCell, type CapabilityRow } from "./settings-capabilities-model.js";
import { useSettingsFacts } from "../editor/settings-facts-model.js";
import { FactsPane } from "../editor/settings-facts.js";
import { LoadingRegion, SkeletonText } from "../../shared/loading/loading.js";

function CapabilitiesSkeleton({ labels }: { labels: readonly string[] }) {
  return <LoadingRegion label="Loading workflow operations" className="workflow-operations-list"><div className="workflow-operations-heading"><h3>Supported operations</h3></div>
    {labels.map((label, index) => <div key={label} className="workflow-operations-card overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel">
      <div className="ds-disclosure-body"><div className="ds-disclosure-trigger flex items-center justify-between"><span className="ds-disclosure-body-title">{label}</span><Skeleton className="size-3" /></div></div>
      {index === 0 && <div className="workflow-operations-content"><dl className="workflow-operations-grid">{CAPABILITY_SPECS.map(spec => <div key={spec.key} className="workflow-operation"><dt className="workflow-operation-label">{spec.label}</dt><dd className="workflow-operation-status"><SkeletonText className="w-20" /></dd><dd className="workflow-operation-detail"><SkeletonText className="w-4/5" /></dd></div>)}</dl><div className="workflow-operations-boundary"><SkeletonText className="w-3/4" /></div></div>}
    </div>)}
  </LoadingRegion>;
}

function CapabilityValue({ cell }: { cell: CapabilityCell }) {
  const Icon = cell.state === "available" ? Check : cell.state === "not-built" ? TriangleAlert : Minus;
  return <span className="workflow-operation-state" data-state={cell.state}>
    <Icon aria-hidden className={dsIcon.sm} />
    {cell.state === "available" ? "Available" : cell.state === "not-built" ? "Not built" : "Not applicable"}
  </span>;
}

function WorkflowName({ label, served }: { label: string; served: boolean }) {
  if (served) return <span>{label}</span>;
  return <span className="flex min-w-0 flex-col"><span className={cn(dsText.nums, "workflow-operations-id")}>{label}</span>
    <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>not in the served workflow list — this is its id</span></span>;
}

function WorkflowOperations({ row, defaultOpen }: { row: CapabilityRow; defaultOpen: boolean }) {
  const available = CAPABILITY_SPECS.filter(spec => row.cells[spec.key].state === "available").length;
  const missing = CAPABILITY_SPECS.filter(spec => row.cells[spec.key].state === "not-built").length;
  return <Disclosure variant="body" defaultOpen={defaultOpen}
    summary={<WorkflowName label={row.label} served={row.labelServed} />}
    meta={<span className="workflow-operations-count">{available} available{missing > 0 && <span className="workflow-operations-gap"> · {missing} not built</span>}</span>}
    className="settings-reference-disclosure workflow-operations-card" contentClassName="workflow-operations-content">
    <dl className="workflow-operations-grid">
      {CAPABILITY_SPECS.map(spec => {
        const cell = row.cells[spec.key];
        return <div key={spec.key} className="workflow-operation" data-capability={spec.key}>
          <dt className="workflow-operation-label">{spec.label}
            <Popover><PopoverTrigger asChild><IconButton size="xs" label={`What ${spec.label} means`} icon={<Info aria-hidden className={dsIcon.sm} />} /></PopoverTrigger>
              <PopoverContent title={spec.label}><p className={dsText.body}>{spec.meaning}</p></PopoverContent></Popover>
          </dt>
          <dd className="workflow-operation-status"><CapabilityValue cell={cell} /></dd>
          <dd className="workflow-operation-detail">{cell.state === "available" ? cell.detail : cell.reason}</dd>
        </div>;
      })}
    </dl>
    <div className="workflow-operations-boundary">
      <span>Where a dry run stops</span>
      <p>{row.dryRunPosture}</p>
    </div>
  </Disclosure>;
}

export function CapabilitiesSection({ workflowLabels, integrated = false, workflowId }: { workflowLabels: ReadonlyMap<string, string>; integrated?: boolean; workflowId?: string }) {
  const facts = useSettingsFacts();
  const [query, setQuery] = useViewState("capabilitiesQuery", "", "replace");
  return <div className={integrated ? "preflight-workflow-operations" : "settings-reference-page"} aria-label={integrated ? "Workflow operations" : undefined}>
    {!integrated && <PageHeading as="h2" title="Workflow capabilities" description="Available workflow operations and dry-run boundaries." />}
    {!integrated && <SearchInput aria-label="Find workflow capabilities" placeholder="Find a workflow…" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} />}
    <FactsPane facts={facts} loading={<CapabilitiesSkeleton labels={workflowId ? [workflowLabels.get(workflowId) ?? workflowId] : [...workflowLabels.values()]} />}>{loaded => {
      const matrix = capabilityMatrix(loaded.workflowCapabilities, workflowLabels);
      if (matrix.length === 0) return <p className={dsText.body}>This build registers no workflows. The served descriptor registry is empty.</p>;
      const matching = matrix.filter(row => workflowId ? row.workflowId === workflowId : row.label.toLowerCase().includes(query.trim().toLowerCase()));
      return <div className="workflow-operations-list">
        <div className="workflow-operations-heading"><h3>Supported operations</h3>
          <Popover><PopoverTrigger asChild><IconButton size="xs" label="About workflow operations" icon={<Info aria-hidden className={dsIcon.sm} />} /></PopoverTrigger>
            <PopoverContent title="Workflow operations"><p className={dsText.body}>Source: served workflow descriptors.</p></PopoverContent></Popover>
        </div>
        {matching.map((row, index) => <WorkflowOperations key={row.workflowId} row={row} defaultOpen={index === 0} />)}
        {matching.length === 0 && <p role="status" className={dsText.body}>{workflowId ? "No operations were returned for this workflow." : "No workflows match your search."}</p>}
      </div>;
    }}</FactsPane>
  </div>;
}
