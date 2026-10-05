import type { ReactNode } from "react";
import { CapabilitiesSection } from "./settings-capabilities.js";
import { Badge, Banner, BodySection, Button, FormGroup, PageHeading, ResultRow, Select, StatusDot, dsText, Field } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { usePreflightActions } from "../state/preflight-actions.js";
import { usePreflightScope } from "../state/preflight-client.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { preflightRemedy, preflightVerdict } from "./preflight-popover-model.js";
import type { PreflightRerunState } from "./settings-preflight-model.js";
import { fmtClock } from "./format.js";
import type { PreflightCheckWire } from "./preflight-popover-model.js";
import type { EditableSettingsWire } from "../../domain/dashboard/settings-editor.js";
import "./diagnostic-presentation.css";

const CHECK_COPY: Record<string, { name: string; description: string }> = {
  "runtime.compatibility": { name: "Runtime compatibility", description: "Checks Node.js and installed dependencies for this release." },
  "browser.assets": { name: "Browser tools", description: "Checks the required browser and extension files." },
  "config.valid": { name: "Runtime settings", description: "Checks current configuration validity." },
  "filesystem.health": { name: "Files and disk space", description: "Checks required directories and free space." },
  "authority.health": { name: "Data store readiness", description: "Checks the data store and run records for this scope." },
  "ports.available": { name: "Network ports", description: "Checks the dashboard's reserved ports." },
  "fiscal.current": { name: "Current fiscal year", description: "Checks the workflow's fiscal year configuration." },
  "secrets.ucpath-sso": { name: "UCPath sign-in", description: "Checks the username and password required for UCPath sign-in." },
  "secrets.timekeeper": { name: "Timekeeper name", description: "Checks the timekeeper name needed by this workflow." },
  "secrets.sharepoint-roster": { name: "SharePoint roster", description: "Checks the onboarding roster location used by this workflow." },
  "process.orphans": { name: "Unfinished processes", description: "Checks for stale processes or worker leases." },
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

const SECRET_FIELDS = {
  "secrets.ucpath-sso": [{ name: "ucpathUserId", label: "UCPath username" }, { name: "ucpathPassword", label: "UCPath password" }],
  "secrets.timekeeper": [{ name: "timekeeperName", label: "Timekeeper name" }],
  "secrets.sharepoint-roster": [{ name: "sharepointOnboardingRosterUrl", label: "SharePoint onboarding roster URL" }],
} as const;

const BLOCK_LABELS: Readonly<Record<string, string>> = {
  "system.ucpath.prod": "UCPath", "system.crm.prod": "CRM", "system.onbase.prod": "OnBase",
  "system.kuali.prod": "Kuali", "system.servicenow.prod": "ServiceNow", "system.i9.prod": "I-9",
  "system.new-kronos.prod": "New Kronos", "system.old-kronos.prod": "Old Kronos",
  "system.sharepoint.prod": "SharePoint", "workflow.kuali-fill": "Kuali fill",
  "workflow.sharepoint-download": "SharePoint download", "executor.run": "Run execution", "dashboard.serve": "Dashboard",
};

function missingCredentialCopy(check: PreflightCheckWire, protectedSettings: EditableSettingsWire["protectedSettings"] | undefined): string | undefined {
  const fields = SECRET_FIELDS[check.id as keyof typeof SECRET_FIELDS];
  if (fields === undefined || check.verdict === "pass") return undefined;
  if (protectedSettings?.state !== "available") return "Credential presence could not be verified from Settings.";
  const missing = fields.filter(field => !protectedSettings.readback.entries[field.name].present).map(field => field.label);
  if (missing.length === 0) return "Credentials are present in Settings, but this check still needs attention.";
  if (check.id === "secrets.ucpath-sso") return `UCPath ${missing.map(label => label.replace(/^UCPath /u, "")).join(" and ")} ${missing.length === 1 ? "is" : "are"} missing.`;
  return `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing.`;
}

function targetedRemedy(id: string): "settings" | "storage" | "sessions" | "credentials" | "routes" | undefined {
  if (id === "authority.health") return "storage";
  if (id === "process.orphans") return "sessions";
  if (id === "fiscal.current") return "settings";
  if (id === "secrets.sharepoint-roster") return "routes";
  if (Object.hasOwn(SECRET_FIELDS, id)) return "credentials";
  return undefined;
}

function SettingsPreflightCheck({ check, protectedSettings }: { check: PreflightCheckWire; protectedSettings?: EditableSettingsWire["protectedSettings"] }) {
  const actions = usePreflightActions();
  const remedy = check.verdict === "pass" ? undefined : targetedRemedy(check.id);
  const action = remedy === undefined ? undefined : () => {
    if (remedy === "sessions") actions.showSessions();
    else actions.showSettings(remedy === "storage" ? "storage" : remedy === "credentials" ? "credentials" : remedy === "routes" ? "routes" : undefined);
  };
  const copy = checkCopy(check.id);
  const missing = missingCredentialCopy(check, protectedSettings);
  const affected = check.verdict === "pass" ? [] : check.blocks.map(block => BLOCK_LABELS[block] ?? block);
  return <div className="diagnostic-check-entry" role="listitem">
    <ResultRow label={copy.name} description={<><span>{copy.description}</span>
      {missing !== undefined && <span className="diagnostic-check-evidence">{missing}</span>}
      {affected.length > 0 && <span className="diagnostic-check-evidence">Affected: {affected.join(" · ")}</span>}
    </>} value={check.verdict === "pass"
      ? <span className="diagnostic-check-status"><StatusDot status="verifiedDone" />Passed</span>
      : <Badge tone={check.verdict === "fail" ? "danger" : "warning"}>{check.verdict === "warning" ? "Needs attention" : "Blocked"}</Badge>} />
    {action !== undefined && <div className="diagnostic-check-detail">
      <Button size="sm" variant="ghost" className="diagnostic-remedy-action" onClick={action}>
        {remedy === "sessions" ? "Open Sessions" : remedy === "storage" ? "Open Storage" : remedy === "credentials" ? "Configure credentials" : remedy === "routes" ? "Configure SharePoint route" : "Open Settings"}
      </Button>
    </div>}
  </div>;
}

function SettingsPreflightGroup({ title, subtitle, checks, protectedSettings, children }: { title: string; subtitle?: string; checks: readonly PreflightCheckWire[]; children?: ReactNode; protectedSettings?: EditableSettingsWire["protectedSettings"] }) {
  return <BodySection title={title} description={subtitle}>
    {children ? <div role="group" aria-label={title} className="preflight-readiness-content">
      {checks.length > 0 && <div className="workflow-readiness-requirements"><h3 className="workflow-readiness-subheading">Requirements</h3><FormGroup label="Workflow requirements"><div role="list">
        {checks.map(check => <SettingsPreflightCheck key={check.id} check={check} protectedSettings={protectedSettings} />)}
      </div></FormGroup></div>}
      {children}
    </div> : <FormGroup label={title}><div role="list">
      {checks.length === 0
        ? <div className="diagnostic-empty-group">No checks were returned for this group.</div>
        : checks.map(check => <SettingsPreflightCheck key={check.id} check={check} protectedSettings={protectedSettings} />)}
    </div></FormGroup>}
  </BodySection>;
}

function SettingsPreflightReport({ preflight, onRerun, protectedSettings, workflowLabels }: { workflowLabels?: ReadonlyMap<string, string>; preflight: PreflightRerunState; onRerun: () => void; protectedSettings?: EditableSettingsWire["protectedSettings"] }) {
  const scope = usePreflightScope();
  const completed = preflight.state === "completed" ? preflight : undefined;
  const displayed = preflight.state === "historical" ? preflight : completed;
  const historical = preflight.state === "historical";
  const verdict = displayed === undefined ? undefined : preflightVerdict(displayed.checks);
  const workflowChecks = displayed?.checks.filter(check => check.id === "fiscal.current" || check.id.startsWith("secrets.")) ?? [];
  const runtimeChecks = displayed?.checks.filter(check => check.id !== "fiscal.current" && !check.id.startsWith("secrets.")) ?? [];
  const attentionCount = displayed?.checks.filter(check => check.verdict !== "pass").length ?? 0;
  return <section className="diagnostics-page ds-body-stack settings-preflight" aria-label="Preflight" aria-live="polite">
    <PageHeading title="Preflight" description="Readiness for the dashboard and its workflows." className="settings-heading-actions" actions={<>
        <label className="sr-only" htmlFor="settings-preflight-scope">Check readiness for</label>
        <Select id="settings-preflight-scope" className="diagnostic-scope-select" value={scope.selected} onChange={event => scope.select(event.target.value)}
          aria-invalid={scope.state === "unavailable" || undefined}>
          <option value="dashboard">Dashboard</option>
          {scope.workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.label}</option>)}
        </Select>
      <Button variant="secondary" onClick={onRerun} disabled={preflight.state === "running" || preflight.state === "idle" || (preflight.state === "historical" && preflight.checking)}>
        {preflight.state === "running" || (preflight.state === "historical" && preflight.checking) ? "Running checks…" : "Run checks again"}
      </Button>
    </>} />
    <div className="diagnostic-status">
      {scope.state === "unavailable" && <span>Workflow scopes could not be read.</span>}
      {displayed !== undefined && <span>{historical ? "Last checked" : "Checked"} <time dateTime={displayed.report.checkedAt}>{fmtClock(displayed.report.checkedAt)}</time></span>}
      {displayed === undefined && <span>{preflight.state === "running" ? "Checking readiness…" : "No current check"}</span>}
    </div>
    {preflight.state === "refused" && <Banner tone="warning" title="Readiness unavailable">{preflight.message}</Banner>}
    {historical && <Banner tone="warning" title="Previous result">{preflight.message} Run checks again for current readiness.</Banner>}
    {preflight.state !== "refused" && <FormGroup label="Readiness summary" className="diagnostic-summary">
      <ResultRow label={<span className="diagnostic-summary-label">
        <StatusDot status={historical ? "queued" : displayed === undefined ? preflight.state === "running" ? "running" : "queued"
          : verdict === "fail" ? "failed" : verdict === "warning" ? "doneWarnings" : "verifiedDone"} />
        {historical ? "Previous check" : displayed === undefined ? preflight.state === "running" ? "Checking readiness" : "Loading readiness"
          : attentionCount === 0 ? "Ready to run" : `${attentionCount} ${attentionCount === 1 ? "check needs" : "checks need"} attention`}
      </span>}
        description={historical ? "Last completed result. Run checks again before starting work." : displayed === undefined ? preflight.state === "running" ? "The current scope is being checked." : "No current preflight report. Loading readiness…"
          : attentionCount === 0 ? "All returned checks passed for this scope." : "Review the failed or warning checks before starting the affected workflow."}
        value={<span className="diagnostic-summary-meta">{displayed === undefined ? "No current result" : `${displayed.checks.length} returned checks`}</span>} />
    </FormGroup>}
    {displayed !== undefined && <>
      <SettingsPreflightGroup title="Workflow readiness" checks={workflowChecks} protectedSettings={historical ? undefined : protectedSettings}>
        {workflowLabels && <CapabilitiesSection integrated workflowLabels={workflowLabels} workflowId={scope.selected === "dashboard" ? undefined : scope.selected} />}
      </SettingsPreflightGroup>
      <SettingsPreflightGroup title="Runtime" subtitle="Compatibility, browser tools, storage, and local resources." checks={runtimeChecks} protectedSettings={historical ? undefined : protectedSettings} />
    </>}
  </section>;
}

/** Setup and doctor share the served verdict and evidence, including absence and freshness. */
export function PreflightReportContent({ preflight, onRerun, presentation = "compact", protectedSettings, workflowLabels }: { workflowLabels?: ReadonlyMap<string, string>; preflight: PreflightRerunState; onRerun: () => void; presentation?: "compact" | "settings"; protectedSettings?: EditableSettingsWire["protectedSettings"] }) {
  const actions = usePreflightActions();
  if (presentation === "settings") return <SettingsPreflightReport preflight={preflight} onRerun={onRerun} protectedSettings={protectedSettings} workflowLabels={workflowLabels} />;
  const completed = preflight.state === "completed" ? preflight : undefined;
  const verdict = completed === undefined ? undefined : preflightVerdict(completed.checks);
  const tone = verdict === "fail" ? "danger" : verdict === "warning" ? "warning" : "success";
  return <div className="flex min-w-0 flex-col gap-[var(--ds-space-base)]" aria-live="polite">
    <PreflightScopeSelect />
    <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
      {completed !== undefined && <Badge tone={tone}>{verdict}</Badge>}
      <Button size="sm" variant="secondary" onClick={onRerun} disabled={preflight.state === "running" || preflight.state === "idle" || (preflight.state === "historical" && preflight.checking)}>
        {preflight.state === "running" || (preflight.state === "historical" && preflight.checking) ? "Running preflight…" : "Rerun preflight"}
      </Button>
    </div>
    {preflight.state === "idle" && <span className={dsText.meta}>No current preflight report. Loading readiness…</span>}
    {preflight.state === "refused" && <Banner tone="warning" title="Readiness unavailable">{preflight.message}</Banner>}
    {preflight.state === "historical" && <Banner tone="warning" title="Previous result">{preflight.message} Run checks again for current readiness.</Banner>}
    {completed !== undefined && <>
      <span className={cn(dsText.meta, "break-words text-[color:var(--ds-fg-muted)]")}>
        Checked <time dateTime={completed.report.checkedAt}>{completed.report.checkedAt}</time>
      </span>
      <div className="settings-preflight-list">
        {completed.checks.map(check => <div key={check.id} className="settings-preflight-item">
          <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
            <Badge tone={check.verdict === "fail" ? "danger" : check.verdict === "warning" ? "warning" : "success"}>{check.verdict}</Badge>
            <span className={cn(dsText.ui, "break-words font-medium")}>{checkCopy(check.id).name}</span>
          </div>
          <span className={cn(dsText.body, "break-words text-[color:var(--ds-fg-muted)]")}>{checkCopy(check.id).description}</span>
          {check.verdict !== "pass" && <span className={cn(dsText.body, "break-words text-[color:var(--ds-fg-muted)]")}>{check.detail}</span>}
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

export function PreflightSection({ editor, workflowLabels }: { workflowLabels?: ReadonlyMap<string, string>; editor: ReturnType<typeof useEditableSettings> }) {
  return <PreflightReportContent presentation="settings" preflight={editor.preflight} onRerun={editor.rerunPreflight}
    workflowLabels={workflowLabels} protectedSettings={editor.editor.state === "loaded" ? editor.editor.document.protectedSettings : undefined} />;
}
