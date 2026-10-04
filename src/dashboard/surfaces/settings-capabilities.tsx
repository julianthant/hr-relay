import "./reference-settings.css";
import { useState } from "react";
import { Info } from "lucide-react";
import { Badge, SearchInput, Disclosure, FormGroup, IconButton, PageHeading, Popover, PopoverContent, PopoverTrigger, ResultRow, dsClip, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { CAPABILITY_SPECS, capabilityMatrix, type CapabilityCell } from "./settings-capabilities-model.js";
import { useSettingsFacts } from "./settings-facts-model.js";
import { FactsPane } from "./settings-facts.js";

function CapabilityValue({ cell }: { cell: CapabilityCell }) {
  return <Badge tone={cell.state === "available" ? "info" : cell.state === "not-built" ? "warning" : "neutral"}>
    {cell.state === "available" ? "Available" : cell.state === "not-built" ? "Not built" : "Not applicable"}
  </Badge>;
}

function WorkflowName({ label, served }: { label: string; served: boolean }) {
  if (served) return <span>{label}</span>;
  return <span className="flex min-w-0 flex-col"><span className={cn(dsText.nums, dsClip.text)}>{label}</span>
    <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>not in the served workflow list — this is its id</span></span>;
}

export function CapabilitiesSection({ workflowLabels, integrated = false, workflowId }: { workflowLabels: ReadonlyMap<string, string>; integrated?: boolean; workflowId?: string }) {
  const facts = useSettingsFacts();
  const [query, setQuery] = useState("");
  return <div className={integrated ? "preflight-workflow-operations" : "settings-reference-page"} aria-label={integrated ? "Workflow operations" : undefined}>
    {!integrated && <PageHeading as="h2" title="Workflow capabilities" description="Available workflow operations and dry-run boundaries." />}
    {!integrated && <SearchInput aria-label="Find workflow capabilities" placeholder="Find a workflow…" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} />}
    <FactsPane facts={facts}>{loaded => {
      const matrix = capabilityMatrix(loaded.workflowCapabilities, workflowLabels);
      if (matrix.length === 0) return <p className={dsText.body}>This build registers no workflows. The served descriptor registry is empty.</p>;
      const matching = matrix.filter(row => workflowId ? row.workflowId === workflowId : row.label.toLowerCase().includes(query.trim().toLowerCase()));
      const content = <>
          <div className="capabilities-table-head"><span>Workflow</span><span>Operations and boundaries</span></div>
          {matching.map((row, index) => <Disclosure key={row.workflowId} variant="body" defaultOpen={index === 0}
            summary={<div className="capabilities-summary"><WorkflowName label={row.label} served={row.labelServed} /><div className="flex gap-2"><CapabilityValue cell={row.cells["typed-start"]} /><span className="text-caption font-normal text-ui-muted">Typed start</span></div></div>}
            className="settings-reference-disclosure" contentClassName="settings-reference-capability-content">
            {CAPABILITY_SPECS.map(spec => {
              const cell = row.cells[spec.key];
              return <ResultRow key={spec.key} label={<span className="settings-reference-capability-label">{spec.label}
                  <Popover><PopoverTrigger asChild><IconButton size="xs" label={`What ${spec.label} means`} icon={<Info aria-hidden className={dsIcon.sm} />} /></PopoverTrigger>
                    <PopoverContent title={spec.label}><p className={dsText.body}>{spec.meaning}</p></PopoverContent></Popover>
                </span>}
                value={<CapabilityValue cell={cell} />}
                evidence={cell.state === "available" ? cell.detail : cell.reason} />;
            })}
            <div className="settings-reference-posture">
              <span className="ds-field-label">Where a dry run stops</span>
              <p className="ds-field-description">{row.dryRunPosture}</p>
            </div>
          </Disclosure>)}
      </>;
      return <div className="capabilities-table">
        {integrated ? content : <FormGroup label="Workflow capabilities">{content}</FormGroup>}
        {matching.length === 0 && <p role="status" className={dsText.body}>{workflowId ? "No operations were returned for this workflow." : "No workflows match your search."}</p>}
        <p className={cn(dsText.meta, "settings-reference-source")}>Source: served workflow descriptors.</p>
      </div>;
    }}</FactsPane>
  </div>;
}
