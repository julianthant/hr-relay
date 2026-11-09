import { Check, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { Banner, BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, Disclosure, DsBodyScope, FormGroup, MetaLine, PageHeading, ResultRow, Select, StatusDot, useToasts } from "../../../ds/ui.js";
import { ActivityRange } from "../../activity/activity-range.js";
import { ACTIVITY_SAMPLE_RANGE } from "../../activity/activity-fixture.js";
import { ACTIVITY_DATE_PRESETS } from "../../activity/activity-model.js";
import { AppLockup } from "../../shell/app-lockup.js";
import "../../shell/onboarding.css";
import { STATUS_MOCK_ANALYTICS, STATUS_MOCK_BLOCKERS, STATUS_MOCK_FIRST_RUN, STATUS_MOCK_TOASTS, statusMock, type StatusMockId } from "./status-mock-model.js";

const noop = () => undefined;


/** Run dialog frames: the reason a workflow cannot start, with its fix next to it. */
function RunDialogMock({ variant }: { variant: "a" | "b" }) {
  const confirm = variant === "b";
  return <Dialog open onOpenChange={noop}>
    <DialogContent size="md" title="Start Emergency Contact" description={confirm ? "Confirm the run." : "Choose the scans to read."}>
      <DialogBody>
        {confirm ? <DsBodyScope className="flex flex-col gap-[var(--ds-space-cozy)]">
          <FormGroup label="Run summary">
            <ResultRow label="Workflow" value="Emergency Contact" />
            <ResultRow label="Scan" value="Scan_0412.pdf" />
            <ResultRow label="People in scan" value="12" />
            <ResultRow label="Dry run" value="On" />
          </FormGroup>
          <BodySection title="Before you start"><FormGroup label="Before you start">
            {STATUS_MOCK_BLOCKERS.map(blocker => <ResultRow key={blocker.id} label={blocker.title} description={blocker.note} value={<Button variant="secondary">{blocker.action}</Button>} />)}
          </FormGroup></BodySection>
        </DsBodyScope> : <DsBodyScope className="flex flex-col gap-[var(--ds-space-cozy)]">
          <Banner tone="warning" title={STATUS_MOCK_BLOCKERS[0].title} action={<Button variant="secondary">{STATUS_MOCK_BLOCKERS[0].action}</Button>}>
            Import the roster, then choose the scans.
          </Banner>
          <FormGroup label="Scan">
            <ResultRow label="Scan PDFs" description="Scan_0412.pdf" value={<Button variant="secondary">Choose files</Button>} />
          </FormGroup>
        </DsBodyScope>}
      </DialogBody>
      <DialogFooter meta={<MetaLine tone="faint" items={confirm ? ["1 run", "Emergency Contact", "2 to fix"] : ["1 run", "Emergency Contact", "Import the roster first"]} />}>
        {confirm && <Button variant="ghost">Back</Button>}
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary" disabled>{confirm ? "Start dry run" : "Continue"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Live problems arrive as sticky toasts: a title and one line that names where to act. */
function ToastsMock() {
  const { toast, dismiss } = useToasts();
  useEffect(() => {
    // After first paint, so the app's own mount-time notices cannot clear these.
    const ids: string[] = [];
    const timer = window.setTimeout(() => { ids.push(...STATUS_MOCK_TOASTS.map(item => toast({ ...item, sticky: true }))); }, 600);
    return () => { window.clearTimeout(timer); ids.forEach(dismiss); };
  }, [toast, dismiss]);
  return null;
}

/** General's Status section: two rows that only show status, checked automatically. No buttons; a storage problem is the sticky toast. */
export function StatusMockStatusBlock({ problem, limit }: { problem: boolean; limit: boolean }) {
  return <BodySection title="Status"><FormGroup label="Status">
    <ResultRow label="Storage" description={problem ? "Needs attention · run 0412 could not be saved · last backup 12 min ago" : "Saved on this computer · last backup 12 min ago"} value={<StatusDot status={problem ? "failed" : "verifiedDone"} />} />
    <ResultRow label="ChatGPT" description={limit ? "Usage limit reached · resets 9:40 PM" : "Connected as Jordan Lee · checked 2 min ago"} value={<StatusDot status={limit ? "parked" : "verifiedDone"} />} />
  </FormGroup></BodySection>;
}

function Tile({ tile }: { tile: (typeof STATUS_MOCK_ANALYTICS.tiles)[number] }) {
  const tone = "tone" in tile ? tile.tone === "danger" ? "text-ui-danger" : "text-ui-warning" : "text-ui-primary";
  return <div className="min-w-0 rounded-xl border border-ui-stroke bg-ui-panel px-3 py-4"><dt className="text-body text-ui-secondary">{tile.label}</dt><dd className={`mb-1 ml-0 mt-2 text-page font-normal tabular-nums ${tone}`}>{tile.value}</dd><p className="m-0 text-caption text-ui-muted">{tile.note}</p></div>;
}

/** Analytics for an HR operator: outcomes per workflow, plain failure reasons, time taken, date range. Variant B keeps the engineering facts behind a disclosure. */
export function StatusMockAnalytics({ variant }: { variant: "a" | "b" }) {
  const data = STATUS_MOCK_ANALYTICS;
  return <section aria-label="Analytics report" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    <PageHeading title="Analytics" description="How your workflows are going." />
    <div className="activity-header-filters"><div className="activity-period-controls">
      <Select aria-label="Report period" variant="toolbar" value="this-week" onChange={noop}>{ACTIVITY_DATE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</Select>
      <ActivityRange range={ACTIVITY_SAMPLE_RANGE} onApply={noop} onEdit={noop} />
    </div><Button variant="secondary">Export CSV</Button></div>
    <dl aria-label="Analytics summary" className="activity-summary m-0 mt-4 grid grid-cols-4 gap-2">{data.tiles.map(tile => <Tile key={tile.label} tile={tile} />)}</dl>
    <div className="mt-6 flex min-w-0 flex-col gap-6">
      <section aria-labelledby="mock-outcomes"><h2 id="mock-outcomes" className="mb-3 mt-0 text-section">Workflows</h2>
        <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-table"><table aria-label="Workflow outcomes" className="w-full table-fixed border-collapse text-body"><colgroup><col className="w-[30%]" /><col /><col /><col /><col /></colgroup>
          <thead className="text-caption text-ui-secondary"><tr className="border-b border-ui-stroke"><th scope="col" className="px-4 py-3 text-left font-normal">Workflow</th>{["Done", "Failed", "Outstanding", "Typical time"].map(label => <th key={label} scope="col" className="px-2 py-3 text-right font-normal last:pr-4">{label}</th>)}</tr></thead>
          <tbody>{data.workflows.map(row => <tr key={row.label} className="border-b border-ui-stroke last:border-b-0 odd:bg-ui-panel even:bg-ui-table"><th scope="row" className="px-4 py-3 text-left font-normal">{row.label}</th>
            <td className="px-2 py-3 text-right tabular-nums">{row.done}</td><td className={`px-2 py-3 text-right tabular-nums ${row.failed ? "text-ui-danger" : ""}`}>{row.failed}</td><td className="px-2 py-3 text-right tabular-nums">{row.outstanding}</td><td className="py-3 pl-2 pr-4 text-right tabular-nums">{row.time}</td></tr>)}</tbody>
        </table></div>
      </section>
      <section aria-labelledby="mock-reasons"><h2 id="mock-reasons" className="mb-3 mt-0 text-section">Why runs failed</h2>
        <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-panel"><table aria-label="Why runs failed" className="w-full border-collapse text-body"><tbody>
          {data.reasons.map(reason => <tr key={reason.label} className="border-b border-ui-stroke last:border-b-0"><th scope="row" className="px-4 py-3.5 text-left font-normal"><span className="block text-control">{reason.label}</span><span className="mt-1 block text-caption font-normal text-ui-muted">{reason.workflow}</span></th><td className="px-4 py-3.5 text-right tabular-nums">{reason.runs} {reason.runs === 1 ? "run" : "runs"}</td></tr>)}
        </tbody></table></div>
      </section>
      {variant === "b" && <Disclosure summary="Checks and receipts" description="For engineers: what Relay verified after saving.">
        <div className="flex flex-col gap-1 text-body text-ui-secondary"><span>{data.details.verified}</span><span>{data.details.unchecked}</span><span>{data.details.receipts}</span></div>
      </Disclosure>}
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
  if (id === "run-a" || id === "run-b") return <RunDialogMock variant={id === "run-a" ? "a" : "b"} />;
  if (id === "toasts") return <ToastsMock />;
  if (id === "signup-a" || id === "signup-b") return <div className="fixed inset-0 z-50 bg-[color:var(--ds-surface-page)]"><SignupCheckMock variant={id === "signup-a" ? "a" : "b"} /></div>;
  return null;
}
