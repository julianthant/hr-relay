import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Check, ChevronDown, ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import { Banner, Button, DsBodyScope, Panel, PanelBody, PanelFooter, PanelHeader, Spinner, Tab, TabList, Tabs, TooltipProvider } from "../../../src/dashboard/ds/ui.js";
import { RunList, RunListRow, RunListSkeleton } from "../../../src/dashboard/ds/primitives/run-list.js";
import { CHECK_COPY } from "../../../src/dashboard/surfaces/settings/preflight/preflight-check-copy.js";

/** Checks-stage summary directions in the real dialog frame; synthetic rows, frames are evidence and never test references. */
export const SUMMARY_VARIANTS = ["line", "banner", "group"] as const;
export const SUMMARY_STATES = ["all-ready", "fail-fix", "fail-no-fix", "warnings", "checking", "unavailable"] as const;
export const SUMMARY_FLOWS = ["start", "rerun"] as const;
export type SummaryVariant = typeof SUMMARY_VARIANTS[number];
export type SummaryState = typeof SUMMARY_STATES[number];
export type SummaryFlow = typeof SUMMARY_FLOWS[number];

type Verdict = "pass" | "warning" | "fail";
interface Row { check: string; verdict: Verdict; description: string; fix?: string }

const CHECKS = ["runtime.compatibility", "browser.assets", "config.valid", "filesystem.health", "authority.health", "ports.available", "secrets.ucpath-sso", "endpoint.ucpath.prod"] as const;

function rowsFor(state: SummaryState): Row[] {
  const base = (check: string): Row => ({ check, verdict: "pass", description: CHECK_COPY[check]!.description });
  const rows = CHECKS.map(base);
  const set = (check: string, patch: Partial<Row>) => { const row = rows.find(r => r.check === check)!; Object.assign(row, patch); };
  if (state === "fail-fix") set("secrets.ucpath-sso", { verdict: "fail", description: "UCPath sign-in has no saved password.", fix: "Open Settings" });
  if (state === "fail-no-fix") set("ports.available", { verdict: "fail", description: "Port 3938 is held by another program. Close that program, then check again." });
  if (state === "warnings") { set("filesystem.health", { verdict: "warning", description: "Free disk space is low: 4.2 GB left." }); set("endpoint.ucpath.prod", { verdict: "warning", description: "UCPath answered slowly (6 s)." }); }
  const rank = { fail: 0, warning: 1, pass: 2 } as const;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => rank[a.row.verdict] - rank[b.row.verdict] || a.index - b.index).map(({ row }) => row);
}

const STATUS = "flex items-center gap-1.5 text-body text-ui-secondary";
const noop = () => undefined;

function RowEnd({ row }: { row: Row }) {
  if (row.verdict === "pass") return <span className={STATUS}><Check aria-hidden className="size-3.5" />Ready</span>;
  if (row.verdict === "warning") return <span className={STATUS}><TriangleAlert aria-hidden className="size-3.5 text-ui-warning" />Warning</span>;
  const failed = <span className={STATUS}><CircleAlert aria-hidden className="size-3.5 text-ui-danger" />Failed</span>;
  return row.fix === undefined ? failed : <>{failed}<Button variant="secondary" size="sm" onClick={noop}>{row.fix}</Button></>;
}
const CheckRow = ({ row }: { row: Row }) => <RunListRow title={CHECK_COPY[row.check]!.name} description={row.description} wrapNote><RowEnd row={row} /></RunListRow>;

function summaryOf(rows: Row[]): { tone: "success" | "warning" | "danger"; text: string } {
  const failed = rows.filter(r => r.verdict === "fail").length;
  const warned = rows.filter(r => r.verdict === "warning").length;
  if (failed > 0) return { tone: "danger", text: `${failed} ${failed === 1 ? "needs" : "need"} fixing${warned ? `, ${warned} to review` : ""}. Start is off.` };
  if (warned > 0) return { tone: "warning", text: `${warned} to review. You can still start.` };
  return { tone: "success", text: `All ${rows.length} checks ready` };
}

function Toggle({ open, onToggle, count, children }: { open: boolean; onToggle: () => void; count: number; children?: ReactNode }) {
  return <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-1.5 bg-transparent py-2 text-left text-body text-ui-secondary">
    {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}{children ?? `${open ? "Hide" : "Show"} ${count} ready ${count === 1 ? "check" : "checks"}`}</button>;
}

function Heading({ aside }: { aside?: ReactNode }) {
  return <div className="flex flex-col gap-1">
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="m-0 text-[length:var(--ds-row-heading)] font-normal leading-[var(--ds-row-heading-lh)] text-[color:var(--ds-fg)]">Checks</h3>{aside}</div>
    <p className="text-body text-ui-secondary">What this run needs. Problems come first.</p></div>;
}

function Stage({ variant, state, open: initial }: { variant: SummaryVariant; state: SummaryState; open: boolean }) {
  const [open, setOpen] = useState(initial);
  if (state === "checking") return <section aria-label="Checks" className="flex flex-col gap-[var(--ds-space-cozy)]">
    <Heading aside={<span role="status" className={`${STATUS} text-[13px]`}><Spinner label="Checking" className="size-3.5" />Checking</span>} />
    <RunList label="Checking"><RunListSkeleton rows={CHECKS.length} /></RunList></section>;
  if (state === "unavailable") return <section aria-label="Checks" className="flex flex-col gap-[var(--ds-space-cozy)]"><Heading />
    <Banner tone="danger" title="Checks are unavailable."><span>Relay could not read this workflow's readiness checks, so Start stays off.</span><div className="mt-3"><Button variant="primary" onClick={noop}>Retry</Button></div></Banner></section>;
  const rows = rowsFor(state);
  const problems = rows.filter(r => r.verdict !== "pass");
  const passing = rows.filter(r => r.verdict === "pass");
  const sum = summaryOf(rows);
  const SumIcon = sum.tone === "success" ? Check : sum.tone === "warning" ? TriangleAlert : CircleAlert;
  const iconTone = sum.tone === "success" ? "text-ui-success" : sum.tone === "warning" ? "text-ui-warning" : "text-ui-danger";
  const passingRows = passing.map(row => <CheckRow key={row.check} row={row} />);

  if (variant === "line") return <section aria-label="Checks" className="flex flex-col gap-[var(--ds-space-cozy)]">
    <Heading />
    <div role="status" className="flex items-center gap-2 text-[length:var(--ds-row-heading)] leading-[var(--ds-row-heading-lh)] text-[color:var(--ds-fg)]"><SumIcon aria-hidden className={`size-4 ${iconTone}`} />{sum.text}</div>
    {problems.length > 0 && <RunList label="Needs attention">{problems.map(row => <CheckRow key={row.check} row={row} />)}</RunList>}
    {passing.length > 0 && <div><Toggle open={open} onToggle={() => setOpen(!open)} count={passing.length} />{open && <RunList label="Ready checks">{passingRows}</RunList>}</div>}
  </section>;

  if (variant === "banner") return <section aria-label="Checks" className="flex flex-col gap-[var(--ds-space-cozy)]">
    <Heading />
    <Banner tone={sum.tone} title={sum.text}>{passing.length > 0 && problems.length > 0 ? <span>{passing.length} other checks ready.</span> : null}</Banner>
    {problems.length > 0 && <RunList label="Needs attention">{problems.map(row => <CheckRow key={row.check} row={row} />)}</RunList>}
    {passing.length > 0 && <div><Toggle open={open} onToggle={() => setOpen(!open)} count={passing.length} />{open && <RunList label="Ready checks">{passingRows}</RunList>}</div>}
  </section>;

  return <section aria-label="Checks" className="flex flex-col gap-[var(--ds-space-cozy)]">
    <Heading aside={<span className="text-[13px] text-ui-muted">{passing.length} of {rows.length} ready</span>} />
    <RunList label="Check results">
      {problems.map(row => <CheckRow key={row.check} row={row} />)}
      {passing.length > 0 && <RunListRow title={sum.tone === "success" ? `All ${rows.length} checks ready` : `${passing.length} other checks ready`} lead={<Check aria-hidden className="size-4 text-ui-success" />}>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</Button></RunListRow>}
      {open && passingRows}
    </RunList>
  </section>;
}

const SCENE_CSS = `
.cs-root.ds-body-scope{max-width:none;margin:0}
.cs-root{box-sizing:border-box;width:100vw;height:100vh;background:var(--ds-surface-0, var(--background));color:var(--ds-fg)}
.cs-root *{box-sizing:border-box}
.cs-backdrop{display:flex;align-items:center;justify-content:center;height:100%;padding:12px;background:color-mix(in srgb,var(--ds-surface-0, #000) 70%,transparent)}
.cs-dialog{width:min(720px,100%);height:100%}
.cs-pad{padding:16px}.cs-footer{display:flex;align-items:center;gap:12px;padding:8px 12px;width:100%}.cs-hint{flex:1;min-width:0;font-size:12px;color:var(--ds-fg-muted)}
`;

export function SummaryScenePage({ variant, state, flow, open }: { variant: SummaryVariant; state: SummaryState; flow: SummaryFlow; open: boolean }) {
  const blocked = state !== "all-ready" && state !== "warnings";
  const hint = state === "checking" ? "Checking…" : state === "unavailable" ? "Checks are unavailable" : state === "fail-fix" || state === "fail-no-fix" ? "Fix the failed check to start" : "";
  const title = flow === "start" ? "Start run" : "Rerun";
  return <TooltipProvider><style>{SCENE_CSS}</style><DsBodyScope className="cs-root"><div className="cs-backdrop">
    <Panel className="cs-dialog" role="dialog" aria-label={title}>
      <PanelHeader title={title} headingLevel={2} subtitle={flow === "start" ? "Separations" : "Separations · Dana Whitfield · Failed 09:33"} />
      <Tabs value="checks" onValueChange={noop}><TabList label="Stages"><Tab value="input">Input</Tab><Tab value="options">Options</Tab><Tab value="checks">Checks</Tab></TabList></Tabs>
      <PanelBody><div className="cs-pad"><Stage key={`${variant}-${state}`} variant={variant} state={state} open={open} /></div></PanelBody>
      <PanelFooter><div className="cs-footer"><span className="cs-hint">{hint}</span><Button variant="secondary" onClick={noop}>Cancel</Button><Button variant="primary" disabled={blocked}>{flow === "start" ? "Start" : "Rerun"}</Button></div></PanelFooter>
    </Panel></div></DsBodyScope></TooltipProvider>;
}

function parseOption<T extends string>(value: string | null, options: readonly T[], name: string): T {
  const match = options.find(option => option === value);
  if (match === undefined) throw new Error(`run-checks-summary-${name}-invalid:${String(value)}`);
  return match;
}

/** Browser entry: variant, state, flow, theme and whether the passing list starts open come from the URL. */
export function mountSummaryScene(): void {
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-demo-theme", theme);
  document.body.setAttribute("data-demo-theme", theme);
  const root = document.getElementById("root");
  if (root === null) throw new Error("run-checks-summary-root-missing");
  createRoot(root).render(<SummaryScenePage variant={parseOption(query.get("variant"), SUMMARY_VARIANTS, "variant")} state={parseOption(query.get("state"), SUMMARY_STATES, "state")} flow={parseOption(query.get("flow"), SUMMARY_FLOWS, "flow")} open={query.get("open") === "1"} />);
}
