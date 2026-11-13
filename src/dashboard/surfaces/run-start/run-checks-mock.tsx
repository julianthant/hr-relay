import { ArrowLeft, Check, CircleAlert, TriangleAlert } from "lucide-react";
import { Button, Spinner } from "../../ds/ui.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { checkRows, runChecksCounts, runChecksFrame, type RunCheckRow, type RunChecksCounts } from "./run-checks-mock-model.js";

/** Fix opens Settings at the failed section; the mock reloads the page on the Settings frame, whose Back to run returns. */
function openSettings(section: string) {
  const next = new URLSearchParams(window.location.search);
  next.set("settings", section);
  next.set("runChecks", "settings");
  window.location.assign(`?${next.toString()}`);
}

function RowEnd({ item }: { item: RunCheckRow }) {
  if (item.verdict === "checking") return <span className="flex items-center gap-2 text-body text-ui-secondary"><Spinner label="Checking" className="size-4" />Checking</span>;
  if (item.verdict === "pass") return <span className="flex items-center gap-1.5 text-body text-ui-secondary"><Check aria-hidden className="size-3.5" />Ready</span>;
  const section = item.fixSection;
  if (section !== undefined) return <Button variant="secondary" aria-label={`Fix ${item.title}`} onClick={() => openSettings(section)}>Fix</Button>;
  return <span className="text-body text-ui-secondary">{item.verdict === "fail" ? "Failed" : "Warning"}</span>;
}

const lead = (item: RunCheckRow) => item.verdict === "fail" ? <CircleAlert role="img" aria-label="Failed" className="size-4 shrink-0 text-ui-danger" />
  : item.verdict === "warning" ? <TriangleAlert role="img" aria-label="Warning" className="size-4 shrink-0 text-ui-warning" /> : <span aria-hidden className="size-4 shrink-0" />;

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
    <RunList label="Check results">{rows.toSorted((a, b) => RANK[a.verdict] - RANK[b.verdict]).map(item => <RunListRow key={item.title} title={item.title} description={item.description} lead={lead(item)}><RowEnd item={item} /></RunListRow>)}</RunList>
  </section>;
}

/** Verdict counts the dialog reads to block Start and to badge the stage. */
export function runChecksState(): RunChecksCounts | undefined {
  const scenario = runChecksFrame();
  return scenario === undefined ? undefined : runChecksCounts(checkRows(scenario));
}

/** Settings opened from a Fix button: the approved Settings page with a Back to run way out above it. */
export function RunChecksMockHost() {
  if (runChecksFrame() !== "settings") return null;
  return <div className="fixed left-0 top-0 z-[60] flex h-[54px] items-center bg-[color:var(--ds-surface-page)] px-3">
    <Button variant="ghost" icon={<ArrowLeft aria-hidden className="size-3" />} onClick={() => window.history.back()}>Back to run</Button>
  </div>;
}
