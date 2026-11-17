import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import { Button, Spinner } from "../../ds/ui.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import type { RunCheckRow, RunChecksState } from "./run-checks-model.js";

const STATUS = "flex items-center gap-1.5 text-body text-ui-secondary";

function RowEnd({ item, onFix }: { item: RunCheckRow; onFix: (item: RunCheckRow) => void }) {
  if (item.verdict === "pass") return <span className={STATUS}><Check aria-hidden className="size-3.5" />Ready</span>;
  if (item.verdict === "warning") return <span className={STATUS}><TriangleAlert aria-hidden className="size-3.5 text-ui-warning" />Warning</span>;
  if (item.fix !== undefined) return <Button variant="danger" size="sm" data-run-check-fix={item.check} icon={<CircleAlert aria-hidden className="size-3.5" />} onClick={() => onFix(item)}>{item.fix.label}</Button>;
  return <span className={STATUS}><CircleAlert aria-hidden className="size-3.5 text-ui-danger" />Failed</span>;
}

/** The Checks stage: what this run needs, every check a row with problems first. */
export function RunChecksStage({ checks, onFix }: { checks: RunChecksState; onFix: (item: RunCheckRow) => void }) {
  const rows = checks.state === "ready" ? checks.rows : [];
  const ready = rows.filter(row => row.verdict === "pass").length;
  return <section aria-label="Checks" className="flex flex-col gap-[var(--ds-space-cozy)]">
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[length:var(--ds-row-heading)] font-normal leading-[var(--ds-row-heading-lh)] text-[color:var(--ds-fg)]">Checks</h3>
        <span className="text-[13px] text-ui-muted">{checks.state === "checking" ? "Checking…" : checks.state === "ready" ? `${ready} of ${rows.length} ready` : ""}</span>
      </div>
      <p className="text-body text-ui-secondary">What this run needs. Problems come first.</p>
    </div>
    {checks.state === "checking" && <p role="status" className={STATUS}><Spinner label="Checking" className="size-4" />Checking</p>}
    {checks.state === "ready" && <RunList label="Check results">{rows.map(item =>
      <RunListRow key={item.check} title={<span data-run-check={item.check} tabIndex={-1} className="outline-none">{item.title}</span>} description={item.description}><RowEnd item={item} onFix={onFix} /></RunListRow>)}</RunList>}
  </section>;
}
