import { Badge, Banner, BodySection, Button, Disclosure, FormGroup, PageHeading, ResultRow, Select, StatusDot, dsText, Field } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { usePreflightActions } from "../state/preflight-actions.js";
import { usePreflightScope } from "../state/preflight-client.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { preflightRemedy, preflightVerdict } from "./preflight-popover-model.js";
import type { PreflightRerunState } from "./settings-preflight-model.js";
import { fmtClock } from "./format.js";
import type { PreflightCheckWire } from "./preflight-popover-model.js";
import "./diagnostic-presentation.css";

const CHECK_COPY: Record<string, { name: string; description: string }> = {
  "runtime.compatibility": { name: "Runtime compatibility", description: "Node.js and installed dependencies match this release." },
  "browser.assets": { name: "Browser tools", description: "Required browser and extension files are available." },
  "config.valid": { name: "Runtime settings", description: "The current configuration passes validation." },
  "filesystem.health": { name: "Files and disk space", description: "Required directories are usable and have enough free space." },
  "authority.health": { name: "Data store readiness", description: "The data store and run records are ready for this scope." },
  "ports.available": { name: "Network ports", description: "The dashboard's reserved ports are available." },
  "fiscal.current": { name: "Current fiscal year", description: "A current fiscal year is configured for the workflow." },
  "secrets.ucpath-sso": { name: "UCPath sign-in", description: "UCPath credentials are configured." },
  "secrets.timekeeper": { name: "Timekeeper name", description: "A timekeeper name is configured." },
  "secrets.sharepoint-roster": { name: "SharePoint roster", description: "The onboarding roster location is configured." },
  "process.orphans": { name: "Unfinished processes", description: "No stale process or worker lease needs review." },
};

function checkCopy(id: string): { name: string; description: string } {
  return CHECK_COPY[id] ?? {
    name: id.replace(/[.-]/gu, " ").replace(/^\w/u, (letter) => letter.toUpperCase()),
    description: "Check readiness for the selected workflow and its provider.",
  };
}

export function PreflightScopeSelect() {
  const scope = usePreflightScope();
  return <Field label="Check readiness for" error={scope.state === "unavailable" ? "Workflow scopes could not be read." : undefined}>
    <Select value={scope.selected} onChange={event => { scope.select(event.target.value); }}>
      <option value="dashboard">Dashboard</option>
      {scope.workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.label}</option>)}
    </Select>
  </Field>;
}

function targetedRemedy(id: string): "settings" | "storage" | "sessions" | undefined {
  if (id === "authority.health") return "storage";
  if (id === "process.orphans") return "sessions";
  if (id === "fiscal.current") return "settings";
  return undefined;
}

function SettingsPreflightCheck({ check }: { check: PreflightCheckWire }) {
  const actions = usePreflightActions();
  const remedy = check.verdict === "pass" ? undefined : targetedRemedy(check.id);
  const action = remedy === undefined ? undefined : () => {
    if (remedy === "sessions") actions.showSessions();
    else actions.showSettings(remedy === "storage" ? "storage" : undefined);
  };
  const detail = check.verdict === "pass" ? undefined : <div className="diagnostic-check-detail">
    <span>{check.detail}</span>
    {check.blocks.length > 0 && <span>Blocks: {check.blocks.join(" · ")}</span>}
    {check.remediation !== undefined && <span>Remedy: {check.remediation}</span>}
  </div>;
  return <div className="diagnostic-check-entry" role="listitem">
    <ResultRow label={checkCopy(check.id).name} description={checkCopy(check.id).description}
      value={<Badge tone={check.verdict === "fail" ? "danger" : check.verdict === "warning" ? "warning" : "success"}>
        {check.verdict === "pass" ? "Passed" : check.verdict === "warning" ? "Needs attention" : "Blocked"}
      </Badge>}
      evidence={check.verdict === "pass"
        ? <Disclosure summary="Technical details">{check.label}: {check.detail}</Disclosure>
        : action === undefined ? undefined : <Button size="sm" variant="ghost" onClick={action}>
          {remedy === "sessions" ? "Open Sessions" : remedy === "storage" ? "Open Storage" : "Open Settings"}
        </Button>} />
    {detail}
  </div>;
}

function SettingsPreflightGroup({ title, subtitle, checks }: { title: string; subtitle: string; checks: readonly PreflightCheckWire[] }) {
  return <BodySection title={title}>
    <p className="diagnostic-section-description">{subtitle}</p>
    <FormGroup label={title}><div role="list">
      {checks.length === 0
        ? <div className="diagnostic-empty-group">No checks were returned for this group.</div>
        : checks.map(check => <SettingsPreflightCheck key={check.id} check={check} />)}
    </div></FormGroup>
  </BodySection>;
}

function SettingsPreflightReport({ preflight, onRerun }: { preflight: PreflightRerunState; onRerun: () => void }) {
  const scope = usePreflightScope();
  const completed = preflight.state === "completed" ? preflight : undefined;
  const verdict = completed === undefined ? undefined : preflightVerdict(completed.checks);
  const workflowChecks = completed?.checks.filter(check => check.id === "fiscal.current" || check.id.startsWith("secrets.")) ?? [];
  const runtimeChecks = completed?.checks.filter(check => check.id !== "fiscal.current" && !check.id.startsWith("secrets.")) ?? [];
  const attentionCount = completed?.checks.filter(check => check.verdict !== "pass").length ?? 0;
  return <section className="diagnostics-page ds-body-stack settings-preflight" aria-label="Preflight" aria-live="polite">
    <PageHeading as="h2" title="Preflight" description="Readiness for the dashboard and its workflows." />
    <div className="diagnostic-toolbar">
      <div className="diagnostic-toolbar-meta">
        <label className="sr-only" htmlFor="settings-preflight-scope">Check readiness for</label>
        <Select id="settings-preflight-scope" value={scope.selected} onChange={event => scope.select(event.target.value)}
          aria-invalid={scope.state === "unavailable" || undefined}>
          <option value="dashboard">Dashboard</option>
          {scope.workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.label}</option>)}
        </Select>
        {scope.state === "unavailable" && <span>Workflow scopes could not be read.</span>}
        {completed !== undefined && <>
          <span>Checked <time dateTime={completed.report.checkedAt}>{fmtClock(completed.report.checkedAt)}</time></span>
          <Disclosure summary="Scope details">{completed.report.requestedCapabilities.join(" · ")}</Disclosure>
        </>}
        {completed === undefined && <span>{preflight.state === "running" ? "Checking readiness…" : "No current check"}</span>}
      </div>
      <Button variant="secondary" onClick={onRerun} disabled={preflight.state === "running" || preflight.state === "idle"}>
        {preflight.state === "running" ? "Running checks…" : "Run checks again"}
      </Button>
    </div>
    {preflight.state === "refused" && <Banner tone="warning" title="Readiness unavailable">{preflight.message}</Banner>}
    {preflight.state !== "refused" && <FormGroup label="Readiness summary" className="diagnostic-summary">
      <ResultRow label={<span className="diagnostic-summary-label">
        <StatusDot status={completed === undefined ? preflight.state === "running" ? "running" : "queued"
          : verdict === "fail" ? "failed" : verdict === "warning" ? "doneWarnings" : "verifiedDone"} />
        {completed === undefined ? preflight.state === "running" ? "Checking readiness" : "Loading readiness"
          : attentionCount === 0 ? "Ready to run" : `${attentionCount} ${attentionCount === 1 ? "check needs" : "checks need"} attention`}
      </span>}
        description={completed === undefined ? preflight.state === "running" ? "The current scope is being checked." : "No current preflight report. Loading readiness…"
          : attentionCount === 0 ? "All returned checks passed for this scope." : "Review the failed or warning checks before starting the affected workflow."}
        value={<span className="diagnostic-summary-meta">{completed === undefined ? "No current result" : `${completed.checks.length} returned checks`}</span>} />
    </FormGroup>}
    {completed !== undefined && <>
      <SettingsPreflightGroup title="Workflow readiness" subtitle="Required settings and credentials for the selected scope." checks={workflowChecks} />
      <SettingsPreflightGroup title="Runtime" subtitle="Compatibility, browser tools, storage, and local resources." checks={runtimeChecks} />
    </>}
  </section>;
}

/** Setup and doctor share the served verdict and evidence, including absence and freshness. */
export function PreflightReportContent({ preflight, onRerun, presentation = "compact" }: { preflight: PreflightRerunState; onRerun: () => void; presentation?: "compact" | "settings" }) {
  const actions = usePreflightActions();
  if (presentation === "settings") return <SettingsPreflightReport preflight={preflight} onRerun={onRerun} />;
  const completed = preflight.state === "completed" ? preflight : undefined;
  const verdict = completed === undefined ? undefined : preflightVerdict(completed.checks);
  const tone = verdict === "fail" ? "danger" : verdict === "warning" ? "warning" : "success";
  return <div className="flex min-w-0 flex-col gap-[var(--ds-space-base)]" aria-live="polite">
    <PreflightScopeSelect />
    <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
      {completed !== undefined && <Badge tone={tone}>{verdict}</Badge>}
      <Button size="sm" variant="secondary" onClick={onRerun} disabled={preflight.state === "running" || preflight.state === "idle"}>
        {preflight.state === "running" ? "Running preflight…" : "Rerun preflight"}
      </Button>
    </div>
    {preflight.state === "idle" && <span className={dsText.meta}>No current preflight report. Loading readiness…</span>}
    {preflight.state === "refused" && <Banner tone="warning" title="Readiness unavailable">{preflight.message}</Banner>}
    {completed !== undefined && <>
      <span className={cn(dsText.meta, "break-words text-[color:var(--ds-fg-muted)]")}>
        Scope: {completed.report.requestedCapabilities.join(" · ")}<br />
        Checked <time dateTime={completed.report.checkedAt}>{completed.report.checkedAt}</time>
      </span>
      <div className="settings-preflight-list">
        {completed.checks.map(check => <div key={check.id} className="settings-preflight-item">
          <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
            <Badge tone={check.verdict === "fail" ? "danger" : check.verdict === "warning" ? "warning" : "success"}>{check.verdict}</Badge>
            <span className={cn(dsText.ui, "break-words font-medium")}>{checkCopy(check.id).name}</span>
          </div>
          <span className={cn(dsText.body, "break-words text-[color:var(--ds-fg-muted)]")}>{checkCopy(check.id).description}</span>
          {check.verdict === "pass"
            ? <details className={cn(dsText.meta, "break-words text-[color:var(--ds-fg-muted)]")}><summary>Technical details</summary>{check.label}: {check.detail}</details>
            : <span className={cn(dsText.body, "break-words text-[color:var(--ds-fg-muted)]")}>{check.detail}</span>}
          {check.blocks.length > 0 && <span className={dsText.meta}>Blocks: {check.blocks.join(" · ")}</span>}
          {check.remediation !== undefined && <span className={cn(dsText.meta, "break-words")}>Remedy: {check.remediation}</span>}
          {check.verdict !== "pass" && <Button size="sm" variant="ghost" onClick={() => {
            const remedy = preflightRemedy(check.id);
            if (remedy === "sessions") actions.showSessions();
            else actions.showSettings(remedy === "storage" ? "storage" : undefined);
          }}>{preflightRemedy(check.id) === "sessions" ? "Open Sessions" : preflightRemedy(check.id) === "storage" ? "Open Storage" : "Open Settings"}</Button>}
        </div>)}
      </div>
    </>}
  </div>;
}

export function PreflightSection({ editor }: { editor: ReturnType<typeof useEditableSettings> }) {
  return <PreflightReportContent presentation="settings" preflight={editor.preflight} onRerun={editor.rerunPreflight} />;
}
