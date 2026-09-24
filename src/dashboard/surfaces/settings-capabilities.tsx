import {
Info,
Table2
} from "lucide-react";
import { Badge,Banner,Chip,IconButton,Panel,PanelBody,PanelHeader,Popover,PopoverContent,PopoverTrigger,SectionLabel,TBody,TD,TH,THead,TR,Table,dsClip,dsIcon,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { CAPABILITY_SPECS,capabilityAvailableCount,capabilityMatrix,type CapabilityCell } from "./settings-capabilities-model.js";
import { useSettingsFacts } from "./settings-facts-model.js";
import { FactsPane } from "./settings-facts.js";


/**
 * ONE capability cell. Three states, told apart by SHAPE and by WORD, never by
 * colour, and nothing here is pressable: this is a page that STATES, and a
 * toggle would be a second control for a decision that belongs to a start.
 *
 * All three arms take the SAME shape — a short state token, then the sentence —
 * and the reason it is not the demo's "filled chip carrying the value" is
 * `Chip`'s own docstring: *if a fact cannot survive truncation it is not a
 * chip*. A chip is `dsClip.token` outside and `dsClip.text` inside, so a
 * `break-words` on its child is dead CSS and a three-system list would cut with
 * nothing to recover it — on any pointer, which DESIGN.md bans outright and
 * D272 items 8–9 ratified against twice already. The detail wraps beside the
 * token instead, where it has somewhere to wrap TO, and it is not `nums`:
 * "3 correctable fields" is prose, and a fact declares its kind (F2d).
 */
function CapabilityCellView({ cell }: { cell: CapabilityCell }) {
  const available = cell.state === "available";
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">
      <Chip tone={available ? "info" : cell.state === "not-built" ? "warning" : "neutral"}>
        {available ? "Yes" : cell.state === "not-built" ? "Not built" : "N/A"}
      </Chip>
      <span
        className={cn(
          dsText.meta,
          "min-w-0 break-words",
          // The answer is the page's content; a reason is its explanation.
          available ? "text-[color:var(--ds-fg)]" : "text-[color:var(--ds-fg-muted)]",
        )}
      >
        {available ? cell.detail : cell.reason}
      </span>
    </span>
  );
}


/**
 * SE41/SE42 — what each workflow can do, read down one capability at a time.
 *
 * CAPABILITY-MAJOR rather than a grid of six columns by seven rows, and that is
 * the whole design decision. A true matrix is a horizontal scroll with a header
 * the eye loses, and its cells can hold only a tick — which throws away the half
 * of the answer that matters, namely WHICH systems, WHICH gates, and WHY not.
 * Read down a capability and "which ones have a dry run?" is one glance, with
 * the reason attached to every no.
 */
export function CapabilitiesSection({ workflowLabels }: { workflowLabels: ReadonlyMap<string, string> }) {
  const facts = useSettingsFacts();
  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader
        title="Workflow capabilities"
        headingLevel={2}
        icon={<Table2 aria-hidden className={dsIcon.lg} />}
      />
      <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
        <FactsPane facts={facts}>
          {(loaded) => {
            const matrix = capabilityMatrix(loaded.workflowCapabilities, workflowLabels);
            // A build that registers no workflow is unusual and real, and the
            // six header-only tables it would otherwise draw say nothing at all
            // — six `0 of 0` badges over empty grids read as a page that failed
            // to load rather than as a build with nothing to describe.
            if (matrix.length === 0) {
              return (
                <Banner tone="warning" title="This build registers no workflows">
                  There is nothing to describe: the capability rows are derived from the descriptor
                  registry, and it is empty in this process.
                </Banner>
              );
            }
            return (
              <>
                <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Source: served workflow descriptors.</p>
                {CAPABILITY_SPECS.map((spec) => (
                  <div key={spec.key} className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
                    <div className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
                      <SectionLabel className="min-w-0 truncate">{spec.label}</SectionLabel>
                      {/* compared down the page, so the digits must not shift */}
                      <Badge tone="neutral" className={dsText.nums}>
                        {capabilityAvailableCount(matrix, spec.key)} of {matrix.length}
                      </Badge>
                      <Popover>
                        <PopoverTrigger asChild>
                          <IconButton
                            size="xs"
                            label={`What ${spec.label} means`}
                            icon={<Info aria-hidden className={dsIcon.sm} />}
                          />
                        </PopoverTrigger>
                        <PopoverContent title={spec.label}>
                          <p className={cn(dsText.meta, "text-[color:var(--ds-fg-secondary)]")}>
                            {spec.meaning}
                          </p>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Table label={`${spec.label} by workflow`}>
                      <THead>
                        <TR>
                          <TH>Workflow</TH>
                          <TH>{spec.label}</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {matrix.map((row) => (
                          <TR key={row.workflowId}>
                            <TD className="w-[190px]">
                              <WorkflowName label={row.label} served={row.labelServed} />
                            </TD>
                            <TD>
                              <CapabilityCellView cell={row.cells[spec.key]} />
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                ))}

                {/* The one fact that is not a yes/no, so it is not a capability
                    row: a workflow can honour a rehearsal, have nothing to
                    rehearse, or write and refuse one — and the third is the
                    answer worth reading before a real HR transaction. */}
                <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
                  <SectionLabel>Where a dry run stops</SectionLabel>
                  <Table label="Dry-run posture by workflow">
                    <THead>
                      <TR>
                        <TH>Workflow</TH>
                        <TH>Posture</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {matrix.map((row) => (
                        <TR key={row.workflowId}>
                          <TD className="w-[190px]">
                            <WorkflowName label={row.label} served={row.labelServed} />
                          </TD>
                          <TD>{row.dryRunPosture}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </>
            );
          }}
        </FactsPane>
      </PanelBody>
    </Panel>
  );
}


/**
 * A workflow's name in the first column. The capability wire carries no label —
 * the bootstrap already serves one, and one page may not hold two names for one
 * workflow — so a row this document does not list falls back to the workflow's
 * own id and SAYS it is the id, rather than reading as a badly-cased label.
 */
function WorkflowName({ label, served }: { label: string; served: boolean }) {
  if (served) return <>{label}</>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn(dsText.nums, dsClip.text)}>{label}</span>
      <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
        not in the served workflow list — this is its id
      </span>
    </span>
  );
}
