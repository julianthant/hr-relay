import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import { Button, Spinner } from "../../ds/ui.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { checkRows, runChecksCounts, runChecksFrame, type RunCheckRow, type RunChecksCounts } from "./run-checks-mock-model.js";

const STATUS = "flex items-center gap-1.5 text-body text-ui-secondary";

function RowEnd({ item }: { item: RunCheckRow }) {
  if (item.verdict === "checking") return <span className={STATUS}><Spinner label="Checking" className="size-4" />Checking</span>;
  if (item.verdict === "pass") return <span className={STATUS}><Check aria-hidden className="size-3.5" />Ready</span>;
  if (item.verdict === "warning") return <span className={STATUS}><TriangleAlert aria-hidden className="size-3.5 text-ui-warning" />Warning</span>;
  if (item.fixLabel !== undefined) return <Button variant="danger" size="sm" icon={<CircleAlert aria-hidden className="size-3.5" />}>{item.fixLabel}</Button>;
  return <span className={STATUS}><CircleAlert aria-hidden className="size-3.5 text-ui-danger" />Failed</span>;
}

const RANK = { fail: 0, warning: 1, checking: 2, pass: 3 } as const;

/** The Checks stage of the approved Run dialog: the last stage, where Start lives. Every check is a row, problems first. */
export function RunChecksStage() {
  const scenario = runChecksFrame();
  if (scenario === undefined) return null;
  const rows = checkRows(scenario);
  const { ready, total, checking } = runChecksCounts(rows);
  return <section aria-label="Checks" className="flex flex-col gap-[var(--ds-space-cozy)]">
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[length:var(--ds-row-heading)] font-normal leading-[var(--ds-row-heading-lh)] text-[color:var(--ds-fg)]">Checks</h3>
        <span className="text-[13px] text-ui-muted">{checking > 0 ? "Checking…" : `${ready} of ${total} ready`}</span>
      </div>
      <p className="text-body text-ui-secondary">What this run needs. Problems come first.</p>
    </div>
    <RunList label="Check results">{rows.toSorted((a, b) => RANK[a.verdict] - RANK[b.verdict]).map(item => <RunListRow key={item.title} title={item.title} description={item.description}><RowEnd item={item} /></RunListRow>)}</RunList>
  </section>;
}

/** Verdict counts the dialog reads to block Start and to badge the stage. */
export function runChecksState(): RunChecksCounts | undefined {
  const scenario = runChecksFrame();
  return scenario === undefined ? undefined : runChecksCounts(checkRows(scenario));
}
