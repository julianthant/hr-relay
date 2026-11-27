import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import { Button, Spinner, dsIcon } from "../../ds/ui.js";
import { FailureNotice } from "../../ds/primitives/failure-notice.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { failedCheckSentence, type RunCheckRow, type RunChecksState } from "./run-checks-model.js";

const STATUS = "flex items-center gap-2 text-body text-ui-secondary";

function RowEnd({ item, onFix }: { item: RunCheckRow; onFix: (item: RunCheckRow) => void }) {
  if (item.verdict === "warning") return <span className={STATUS}><TriangleAlert aria-hidden className={`${dsIcon.md} text-ui-warning`} />Warning</span>;
  if (item.fix === undefined) return <span className={STATUS}><CircleAlert aria-hidden className={`${dsIcon.md} text-ui-danger`} />Failed</span>;
  return <Button variant="danger" size="sm" data-run-check-fix={item.check} onClick={() => onFix(item)}>{item.fix.label}</Button>;
}

/** The Checks stage: only what is not ready, problems first. When nothing needs attention, or the checks cannot be read, it says so in one line. */
export function RunChecksStage({ checks, onFix, onRecheck }: { checks: RunChecksState; onFix: (item: RunCheckRow) => void; onRecheck: () => void }) {
  const rows = checks.state === "ready" ? checks.rows : [];
  const problems = rows.filter(row => row.verdict !== "pass");
  return <section aria-label="Checks" className="launch-section">
    <div className="launch-section-head">
      <div>
        <h3>Checks</h3>
        {/* One live region across checking and ready, so the result is announced when the checks finish. */}
        <span role="status" className={checks.state === "checking" ? STATUS : "sr-only"}>
          {checks.state === "checking" && <><span aria-hidden><Spinner label="Checking" className={dsIcon.md} /></span><span className="sr-only">Checking</span></>}
          {checks.state === "ready" && (failedCheckSentence(checks) ?? (problems.length === 0 ? "" : `${problems.length} ${problems.length === 1 ? "warning" : "warnings"}`))}
        </span>
      </div>
    </div>
    {checks.state === "unavailable" && <FailureNotice sentence={checks.message} action={{ label: "Check again", onClick: onRecheck }} />}
    {checks.state === "ready" && problems.length === 0 && <RunList label="Check results"><RunListRow title={<span role="status">Ready to start</span>} lead={<Check aria-hidden className={`${dsIcon.lg} text-ui-positive`} />} /></RunList>}
    {checks.state === "ready" && problems.length > 0 && <RunList label="Check results">
      {problems.map(item =>
        <RunListRow key={item.check} title={<span data-run-check={item.check} tabIndex={-1} className="outline-none">{item.title}</span>} description={item.description} wrapNote><RowEnd item={item} onFix={onFix} /></RunListRow>)}
    </RunList>}
  </section>;
}
