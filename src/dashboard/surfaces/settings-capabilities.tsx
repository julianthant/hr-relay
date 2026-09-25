import { Info, Table2 } from "lucide-react";
import { Badge, Banner, Chip, IconButton, Panel, PanelBody, PanelHeader, Popover, PopoverContent, PopoverTrigger, dsClip, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { CAPABILITY_SPECS, capabilityAvailableCount, capabilityMatrix, type CapabilityCell } from "./settings-capabilities-model.js";
import { useSettingsFacts } from "./settings-facts-model.js";
import { FactsPane } from "./settings-facts.js";

function CapabilityCellView({ cell }: { cell: CapabilityCell }) {
  const available = cell.state === "available";
  return <span className="settings-capability-result">
    <Chip tone={available ? "info" : cell.state === "not-built" ? "warning" : "neutral"}>
      {available ? "Yes" : cell.state === "not-built" ? "Not built" : "N/A"}
    </Chip>
    <span className={cn(dsText.body, "min-w-0 break-words", available ? "text-[color:var(--ds-fg)]" : "text-[color:var(--ds-fg-muted)]")}>
      {available ? cell.detail : cell.reason}
    </span>
  </span>;
}

function WorkflowName({ label, served }: { label: string; served: boolean }) {
  if (served) return <span className={cn(dsText.ui, "font-medium")}>{label}</span>;
  return <span className="flex min-w-0 flex-col"><span className={cn(dsText.ui, dsText.nums, dsClip.text)}>{label}</span>
    <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>not in the served workflow list — this is its id</span></span>;
}

export function CapabilitiesSection({ workflowLabels }: { workflowLabels: ReadonlyMap<string, string> }) {
  const facts = useSettingsFacts();
  return <Panel className="settings-page-panel">
    <PanelHeader title="Workflow capabilities" headingLevel={2} icon={<Table2 aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <FactsPane facts={facts}>{loaded => {
        const matrix = capabilityMatrix(loaded.workflowCapabilities, workflowLabels);
        if (matrix.length === 0) return <Banner tone="warning" title="This build registers no workflows">The served descriptor registry is empty.</Banner>;
        return <div className="settings-section-stack">
          {CAPABILITY_SPECS.map(spec => <section key={spec.key} className="settings-group">
            <div className="settings-group-heading">
              <div className="settings-capability-heading">
                <h3 className={cn(dsText.title, "font-medium")}>{spec.label}</h3>
                <Popover><PopoverTrigger asChild><IconButton size="xs" label={`What ${spec.label} means`} icon={<Info aria-hidden className={dsIcon.sm} />} /></PopoverTrigger>
                  <PopoverContent title={spec.label}><p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{spec.meaning}</p></PopoverContent></Popover>
              </div>
              <Badge tone="neutral" className={dsText.nums}>{capabilityAvailableCount(matrix, spec.key)} of {matrix.length}</Badge>
            </div>
            <div className="settings-group-rows">
              {matrix.map(row => <div key={row.workflowId} className="settings-capability-row">
                <WorkflowName label={row.label} served={row.labelServed} />
                <CapabilityCellView cell={row.cells[spec.key]} />
              </div>)}
            </div>
          </section>)}
          <section className="settings-group">
            <h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-medium")}>Where a dry run stops</h3>
            <div className="settings-group-rows">{matrix.map(row => <div key={row.workflowId} className="settings-capability-row">
              <WorkflowName label={row.label} served={row.labelServed} />
              <span className={cn(dsText.body, "min-w-0 break-words")}>{row.dryRunPosture}</span>
            </div>)}</div>
          </section>
          <p className={cn(dsText.meta, "settings-group-note")}>Source: served workflow descriptors.</p>
        </div>;
      }}</FactsPane>
    </PanelBody>
  </Panel>;
}
