import { ClipboardCheck } from "lucide-react";
import { Badge, Banner, Button, dsIcon, dsText, Field, Panel, PanelBody, PanelHeader, Select } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { usePreflightActions } from "../state/preflight-actions.js";
import { usePreflightScope } from "../state/preflight-client.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { preflightRemedy, preflightVerdict } from "./preflight-popover-model.js";
import type { PreflightRerunState } from "./settings-preflight-model.js";

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

/** Setup and doctor share the served verdict and evidence, including absence and freshness. */
export function PreflightReportContent({ preflight, onRerun }: { preflight: PreflightRerunState; onRerun: () => void }) {
  const actions = usePreflightActions();
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
  return <Panel className="settings-page-panel">
    <PanelHeader title="Preflight" headingLevel={2} subtitle="Check whether the dashboard or a workflow is ready to run." icon={<ClipboardCheck aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <section aria-label="Preflight" className="settings-preflight">
        <PreflightReportContent preflight={editor.preflight} onRerun={editor.rerunPreflight} />
      </section>
    </PanelBody>
  </Panel>;
}
