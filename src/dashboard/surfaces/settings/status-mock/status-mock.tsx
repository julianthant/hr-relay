import { Check, ChevronDown, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RunList, RunListRow } from "../../run-start/run-list.js";
import { BodySection, Button, ButtonLink, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemCopy, DropdownMenuTrigger, FormGroup, IconButton, PageHeading, ResultRow, SearchInput, Select, StatusDot, dsIcon, useToasts } from "../../../ds/ui.js";
import { CHATGPT_USAGE_URL } from "../general/chatgpt-account-model.js";
import { ActivityRange } from "../../activity/activity-range.js";
import { ACTIVITY_SAMPLE_RANGE } from "../../activity/activity-fixture.js";
import { ACTIVITY_DATE_PRESETS } from "../../activity/activity-model.js";
import { AppLockup } from "../../shell/app-lockup.js";
import "../../shell/onboarding.css";
import { OutcomeBar, OutcomeLegend, RunsPerDayChart, ShareBar } from "./status-mock-charts.js";
import { STATUS_MOCK_ANALYTICS, STATUS_MOCK_BLOCKERS, STATUS_MOCK_REQUIRED_FIELDS, STATUS_MOCK_SPREADSHEETS, STATUS_MOCK_FIRST_RUN, STATUS_MOCK_TOASTS, statusMock, type StatusMockCounts, type StatusMockId } from "./status-mock-model.js";

const noop = () => undefined;


/** A readiness blocker at the top of the dialog: one row, reason on the left, its fix on the right. */
export function StatusMockReadiness({ frame }: { frame: "run-a" | "run-b" }) {
  return <RunList label="Before you start">{STATUS_MOCK_BLOCKERS[frame].map(blocker => <RunListRow key={blocker.id} title={blocker.title} description={blocker.note}><Button variant="secondary">{blocker.action}</Button></RunListRow>)}</RunList>;
}

/** Picked spreadsheet value -> version number. */
export type StatusMockPicks = Readonly<Record<string, number>>;

/** The dialog's spreadsheet picker: picked ones are rows with a version picker and a remove ×; an Add dropdown with search lists the rest (Pinned first, then A-Z). One lacking a needed column is greyed out with the reason. */
export function StatusMockRosterPicker({ picks, onPicks }: { picks: StatusMockPicks; onPicks: (next: StatusMockPicks) => void }) {
  const [query, setQuery] = useState("");
  const picked = STATUS_MOCK_SPREADSHEETS.filter(sheet => picks[sheet.value] !== undefined);
  const needle = query.trim().toLowerCase();
  const available = STATUS_MOCK_SPREADSHEETS.filter(sheet => picks[sheet.value] === undefined && sheet.label.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.label.localeCompare(b.label));
  return <div className="flex min-w-0 flex-col gap-3">
    <RunList title="Reference spreadsheets" description={`Spreadsheets this run looks people up in. Needs ${STATUS_MOCK_REQUIRED_FIELDS.replace(", ", " and ")}.`}>
      {picked.map(sheet => <RunListRow key={sheet.value} title={sheet.label} description={sheet.description}>
        <Select aria-label={`${sheet.label} version`} variant="toolbar" className="w-[76px]" value={String(picks[sheet.value])} onChange={event => onPicks({ ...picks, [sheet.value]: Number(event.target.value) })}>
          {Array.from({ length: sheet.current }, (_, index) => sheet.current - index).map(number => <option key={number} value={number}>v{number}</option>)}
        </Select>
        <IconButton size="xs" label={`Remove ${sheet.label}`} icon={<X aria-hidden className={dsIcon.md} />} onClick={() => onPicks(Object.fromEntries(Object.entries(picks).filter(([key]) => key !== sheet.value)))} />
      </RunListRow>)}
    </RunList>
    <div><DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
      <DropdownMenuTrigger asChild><Button variant="outline" className="ds-menu-trigger" iconAfter={<ChevronDown aria-hidden />}>Add spreadsheet</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px]">
        <div className="px-0.5 pb-1" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}><SearchInput variant="menu" aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} /></div>
        {available.length === 0 && <p className="m-0 px-2 py-2 text-[13px] text-ui-muted">{picked.length === STATUS_MOCK_SPREADSHEETS.length ? "Every spreadsheet is added." : "No spreadsheets match."}</p>}
        {available.map(sheet => <DropdownMenuItem key={sheet.value} disabled={"disabled" in sheet} onClick={() => onPicks({ ...picks, [sheet.value]: sheet.current })} >
          <DropdownMenuItemCopy title={sheet.label} description={sheet.description} />
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu></div>
  </div>;
}

/** Live problems arrive as sticky toasts: a title and one line that names where to act. */
function ToastsMock({ set }: { set: keyof typeof STATUS_MOCK_TOASTS }) {
  const { toast, dismiss } = useToasts();
  useEffect(() => {
    // After first paint, so the app's own mount-time notices cannot clear these.
    const ids: string[] = [];
    const timer = window.setTimeout(() => { ids.push(...STATUS_MOCK_TOASTS[set].map(item => toast({ ...item, sticky: true }))); }, 600);
    return () => { window.clearTimeout(timer); ids.forEach(dismiss); };
  }, [toast, dismiss, set]);
  return null;
}

/** Hands the live toast function to the page so a browser session can fire real toasts one after another. */
function ToastsLiveMock() {
  const { toast } = useToasts();
  useEffect(() => { Reflect.set(window, "relayFireToast", toast); return () => { Reflect.deleteProperty(window, "relayFireToast"); }; }, [toast]);
  return null;
}

/** General's ChatGPT section carries its own state, checked automatically. */
export function StatusMockChatGpt({ state }: { state: "working" | "limit" | "disconnected" }) {
  const dot = state === "working" ? "verifiedDone" : state === "limit" ? "parked" : "failed";
  const head = (label: string) => <span className="inline-flex items-center gap-2"><StatusDot status={dot} />{label}</span>;
  return <BodySection title="ChatGPT"><FormGroup label="ChatGPT">
    {state === "disconnected"
      ? <ResultRow label={head("Disconnected")} description="Connect your ChatGPT account to Relay." value={<Button variant="primary">Connect ChatGPT</Button>} />
      : <ResultRow label={head("Jordan Lee · jordan.lee@example.com")} description={state === "limit" ? "Usage limit reached · resets 9:40 PM" : "Working · checked 2 min ago"}
        value={<span className="inline-flex items-center gap-2"><ButtonLink variant={state === "limit" ? "primary" : "secondary"} href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" iconAfter={<ExternalLink aria-hidden className={dsIcon.sm} />}>Manage usage</ButtonLink><Button variant="ghost">Disconnect</Button></span>} />}
  </FormGroup></BodySection>;
}

function Tile({ tile }: { tile: (typeof STATUS_MOCK_ANALYTICS.tiles)[number] }) {
  const tone = "tone" in tile ? tile.tone === "danger" ? "text-ui-danger" : "text-ui-warning" : "text-ui-primary";
  return <div className="min-w-0 rounded-xl border border-ui-stroke bg-ui-panel px-3 py-4"><dt className="text-body text-ui-secondary">{tile.label}</dt><dd className={`mb-1 ml-0 mt-2 text-page font-normal tabular-nums ${tone}`}>{tile.value}</dd><p className="m-0 text-caption text-ui-muted">{tile.note}</p></div>;
}

const sumCounts = (rows: readonly StatusMockCounts[]): StatusMockCounts => ({ done: rows.reduce((n, r) => n + r.done, 0), failed: rows.reduce((n, r) => n + r.failed, 0), attention: rows.reduce((n, r) => n + r.attention, 0) });

/** Analytics for an HR operator: runs per day, outcomes per workflow, plain failure reasons, time taken, date range. A keeps the four tiles; B drops them and puts the totals in the chart legend. */
export function StatusMockAnalytics({ variant }: { variant: "a" | "b" }) {
  const data = STATUS_MOCK_ANALYTICS;
  const failures = data.reasons.reduce((n, reason) => n + reason.runs, 0);
  return <section aria-label="Analytics report" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    <PageHeading title="Analytics" description="How your workflows are going." />
    <div className="activity-header-filters"><div className="activity-period-controls">
      <Select aria-label="Report period" variant="toolbar" value="this-week" onChange={noop}>{ACTIVITY_DATE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</Select>
      <ActivityRange range={ACTIVITY_SAMPLE_RANGE} onApply={noop} onEdit={noop} />
    </div><Button variant="secondary">Export CSV</Button></div>
    {variant === "a" && <dl aria-label="Analytics summary" className="activity-summary m-0 mt-4 grid grid-cols-4 gap-2">{data.tiles.map(tile => <Tile key={tile.label} tile={tile} />)}</dl>}
    <div className="mt-6 flex min-w-0 flex-col gap-6">
      <section aria-labelledby="mock-per-day"><h2 id="mock-per-day" className="mb-3 mt-0 text-section">Runs per day</h2>
        <div className="mb-2"><OutcomeLegend totals={variant === "b" ? sumCounts(data.days) : undefined} /></div>
        <RunsPerDayChart days={data.days} height={variant === "b" ? 200 : 150} />
      </section>
      <section aria-labelledby="mock-outcomes"><h2 id="mock-outcomes" className="mb-3 mt-0 text-section">Workflows</h2>
        <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-table"><table aria-label="Workflow outcomes" className="w-full table-fixed border-collapse text-body"><colgroup><col className="w-[24%]" /><col className="w-[26%]" /><col /><col /><col /><col /></colgroup>
          <thead className="text-caption text-ui-secondary"><tr className="border-b border-ui-stroke"><th scope="col" className="px-4 py-3 text-left font-normal">Workflow</th><th scope="col" className="px-2 py-3 text-left font-normal">Outcomes</th>{["Done", "Failed", "Needs attention", "Typical time"].map(label => <th key={label} scope="col" className="px-2 py-3 text-right font-normal last:pr-4">{label}</th>)}</tr></thead>
          <tbody>{data.workflows.map(row => <tr key={row.label} className="border-b border-ui-stroke last:border-b-0 odd:bg-ui-panel even:bg-ui-table"><th scope="row" className="px-4 py-3 text-left font-normal">{row.label}</th>
            <td className="px-2 py-3"><OutcomeBar counts={row} label={row.label} /></td>
            <td className="px-2 py-3 text-right tabular-nums">{row.done}</td><td className={`px-2 py-3 text-right tabular-nums ${row.failed ? "text-ui-danger" : ""}`}>{row.failed}</td><td className={`px-2 py-3 text-right tabular-nums ${row.attention ? "text-ui-warning" : ""}`}>{row.attention}</td><td className="py-3 pl-2 pr-4 text-right tabular-nums">{row.time}</td></tr>)}</tbody>
        </table></div>
      </section>
      <section aria-labelledby="mock-reasons"><h2 id="mock-reasons" className="mb-3 mt-0 text-section">Why runs failed</h2>
        <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-panel"><table aria-label="Why runs failed" className="w-full border-collapse text-body"><tbody>
          {data.reasons.map(reason => <tr key={reason.label} className="border-b border-ui-stroke last:border-b-0"><th scope="row" className="px-4 py-3.5 text-left font-normal"><span className="block text-control">{reason.label}</span><span className="mt-1 block text-caption font-normal text-ui-muted">{reason.workflow}</span></th>
            <td className="px-4 py-3.5"><span className="flex items-center justify-end gap-4"><ShareBar share={reason.runs / failures} label={`${reason.label}: ${reason.runs} of ${failures} failed runs`} /><span className="w-14 text-right tabular-nums">{reason.runs} {reason.runs === 1 ? "run" : "runs"}</span></span></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  </section>;
}

/** Sign-up frames: the first-run check, as the Ready step (A) or its own step before Ready (B). */
function SignupCheckMock({ variant }: { variant: "a" | "b" }) {
  const steps = variant === "b" ? ["Your details", "Duo setup", "Check", "Ready"] : ["Your details", "Duo setup", "Ready"];
  const current = 2;
  return <div className="hub-onboarding"><div className="brand"><AppLockup /></div><main><div className="auth-layout">
    <ol className="progress" aria-label="Profile setup progress">{steps.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined} data-complete={index < current}><span className="step-link"><span className="progress-marker" aria-hidden="true">{index < current ? <Check className="icon" /> : index + 1}</span>{label}</span></li>)}</ol>
    <div className="stack"><header className="heading"><h1>{variant === "b" ? "Checking your computer" : "You’re all set"}</h1><p>{variant === "b" ? "Relay is making sure everything is ready." : "Your profile and sign-in methods are ready. One last check is running."}</p></header>
      <ul className="ready-list">{STATUS_MOCK_FIRST_RUN.map(item => <li key={item.id}>{item.state === "ok" ? <Check className="icon" /> : <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{item.label}</li>)}</ul>
      <button className="btn primary" type="button" disabled>{variant === "b" ? "Continue" : "Go to dashboard"}</button>
    </div></div></main></div>;
}

/** Mounted once under the toast provider; draws the dialog, toast and sign-up frames. */
export function StatusMockHost() {
  const id: StatusMockId | undefined = statusMock();
  if (id === "toasts" || id === "toasts-open" || id === "toasts-storage" || id === "toasts-restored") return <ToastsMock set={id} />;
  if (id === "toasts-live") return <ToastsLiveMock />;
  if (id === "signup-a" || id === "signup-b") return <div className="fixed inset-0 z-50 bg-[color:var(--ds-surface-page)]"><SignupCheckMock variant={id === "signup-a" ? "a" : "b"} /></div>;
  return null;
}
