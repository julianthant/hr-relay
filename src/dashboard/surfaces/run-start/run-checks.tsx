import { useState } from "react";
import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import { Button, Spinner } from "../../ds/ui.js";
import { RunList, RunListRow, RunListSkeleton } from "../../ds/primitives/run-list.js";
import type { RunCheckRow, RunChecksState } from "./run-checks-model.js";

/** How many checks a run reads, so the loading list is as tall as the loaded one. */
const CHECK_COUNT = 8;
const STATUS = "flex items-center gap-1.5 text-body text-ui-secondary";

function RowEnd({ item, onFix }: { item: RunCheckRow; onFix: (item: RunCheckRow) => void }) {
  if (item.verdict === "pass") return <span className={STATUS}><Check aria-hidden className="size-3.5" />Ready</span>;
  if (item.verdict === "warning") return <span className={STATUS}><TriangleAlert aria-hidden className="size-3.5 text-ui-warning" />Warning</span>;
  const failed = <span className={STATUS}><CircleAlert aria-hidden className="size-3.5 text-ui-danger" />Failed</span>;
  if (item.fix === undefined) return failed;
  return <>{failed}<Button variant="secondary" size="sm" data-run-check-fix={item.check} onClick={() => onFix(item)}>{item.fix.label}</Button></>;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The Checks stage: what this run needs. Problems are rows first; the passing checks sit behind one summary row that opens them, closed on every visit. */
export function RunChecksStage({ checks, onFix }: { checks: RunChecksState; onFix: (item: RunCheckRow) => void }) {
  const [open, setOpen] = useState(false);
  const rows = checks.state === "ready" ? checks.rows : [];
  const problems = rows.filter(row => row.verdict !== "pass");
  const passing = rows.filter(row => row.verdict === "pass");
  const failed = rows.filter(row => row.verdict === "fail").length;
  const summary = problems.length === 0 ? (passing.length === 1 ? "1 check ready" : `All ${passing.length} checks ready`) : `${passing.length} other ${passing.length === 1 ? "check" : "checks"} ready`;
  const passingRows = passing.map(item =>
    <RunListRow key={item.check} title={<span data-run-check={item.check} tabIndex={-1} className="outline-none">{item.title}</span>} description={item.description} wrapNote><RowEnd item={item} onFix={onFix} /></RunListRow>);
  return <section aria-label="Checks" className="flex flex-col gap-[var(--ds-space-cozy)]">
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[length:var(--ds-row-heading)] font-normal leading-[var(--ds-row-heading-lh)] text-[color:var(--ds-fg)]">Checks</h3>
        {/* One live region across checking and ready, so the result is announced when the checks finish. */}
        <span role="status" className={checks.state === "checking" ? `${STATUS} text-[13px]` : "text-[13px] text-ui-muted"}>
          {checks.state === "checking" && <><Spinner label="Checking" className="size-3.5" />Checking</>}
          {checks.state === "ready" && <>{passing.length} of {rows.length} ready<span className="sr-only">{failed > 0 ? `, ${failed} ${failed === 1 ? "needs" : "need"} fixing` : problems.length > 0 ? `, ${plural(problems.length, "warning")}` : ""}</span></>}
        </span>
      </div>
      <p className="text-body text-ui-secondary">What this run needs. Problems come first.</p>
    </div>
    {checks.state === "checking" && <RunList label="Checking"><RunListSkeleton rows={CHECK_COUNT} /></RunList>}
    {checks.state === "ready" && <RunList label="Check results">
      {problems.map(item =>
        <RunListRow key={item.check} title={<span data-run-check={item.check} tabIndex={-1} className="outline-none">{item.title}</span>} description={item.description} wrapNote><RowEnd item={item} onFix={onFix} /></RunListRow>)}
      {passing.length > 0 && <RunListRow title={summary} lead={<Check aria-hidden className="size-4 text-ui-success" />}>
        <Button variant="ghost" size="sm" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ready checks`} onClick={() => setOpen(value => !value)}>{open ? "Hide" : "Show"}</Button></RunListRow>}
      {open && passingRows}
    </RunList>}
  </section>;
}
