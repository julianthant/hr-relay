import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import { Button, Spinner, dsIcon } from "../../ds/ui.js";
import { RunList, RunListRow, RunListSkeleton } from "../../ds/primitives/run-list.js";
import type { RunCheckRow, RunChecksState } from "./run-checks-model.js";

/** How many checks a run reads, so the loading list is as tall as the loaded one. */
const CHECK_COUNT = 8;
const STATUS = "flex items-center gap-2 text-body text-ui-secondary";

function RowEnd({ item, onFix }: { item: RunCheckRow; onFix: (item: RunCheckRow) => void }) {
  if (item.verdict === "warning") return <span className={STATUS}><TriangleAlert aria-hidden className={`${dsIcon.md} text-ui-warning`} />Warning</span>;
  const failed = <span className={STATUS}><CircleAlert aria-hidden className={`${dsIcon.md} text-ui-danger`} />Failed</span>;
  if (item.fix === undefined) return failed;
  return <>{failed}<Button variant="secondary" size="sm" data-run-check-fix={item.check} onClick={() => onFix(item)}>{item.fix.label}</Button></>;
}

/** The Checks stage: only what is not ready, problems first. When nothing needs attention it says so in one line. */
export function RunChecksStage({ checks, onFix }: { checks: RunChecksState; onFix: (item: RunCheckRow) => void }) {
  const rows = checks.state === "ready" ? checks.rows : [];
  const problems = rows.filter(row => row.verdict !== "pass");
  const failed = problems.filter(row => row.verdict === "fail").length;
  return <section aria-label="Checks" className="flex flex-col gap-3">
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-control font-medium text-ui-primary">Checks</h3>
        {/* One live region across checking and ready, so the result is announced when the checks finish. */}
        <span role="status" className={checks.state === "checking" ? STATUS : "sr-only"}>
          {checks.state === "checking" && <><Spinner label="Checking" className={dsIcon.md} />Checking</>}
          {checks.state === "ready" && (problems.length === 0 ? "" : failed > 0 ? `${failed} ${failed === 1 ? "check needs" : "checks need"} fixing` : `${problems.length} ${problems.length === 1 ? "warning" : "warnings"}`)}
        </span>
      </div>
      <p className="m-0 text-body text-ui-secondary">What this run needs. Problems come first.</p>
    </div>
    {checks.state === "checking" && <RunList label="Checking"><RunListSkeleton rows={CHECK_COUNT} /></RunList>}
    {checks.state === "ready" && problems.length === 0 && <RunList label="Check results"><RunListRow title={<span role="status">Ready to start</span>} lead={<Check aria-hidden className={`${dsIcon.lg} text-ui-positive`} />} /></RunList>}
    {checks.state === "ready" && problems.length > 0 && <RunList label="Check results">
      {problems.map(item =>
        <RunListRow key={item.check} title={<span data-run-check={item.check} tabIndex={-1} className="outline-none">{item.title}</span>} description={item.description} wrapNote><RowEnd item={item} onFix={onFix} /></RunListRow>)}
    </RunList>}
  </section>;
}
