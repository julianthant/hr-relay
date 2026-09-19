import type { FrontendBootstrapWire } from "../../domain/dashboard/bootstrap.js";
import { Badge, Banner, Button, dsText, Field, SectionLabel, Select } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { usePreflightActions } from "../state/preflight-actions.js";
import { usePreflightScope } from "../state/preflight-client.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { preflightRemedy, preflightVerdict } from "./preflight-popover-model.js";
import type { PreflightRerunState } from "./settings-preflight-model.js";

export function PreflightScopeSelect() {
  const scope = usePreflightScope();
  return <Field label="Check readiness for" error={scope.state === "unavailable" ? "Workflow scopes could not be read." : undefined}>
    <Select value={scope.selected} onChange={event => { scope.select(event.target.value); }}>
      <option value="dashboard">Dashboard</option>
      {scope.workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.label}</option>)}
    </Select>
  </Field>;
}

/** Setup and doctor render this exact served projection, including absence and freshness. */
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
      <div className="flex min-w-0 flex-col gap-[var(--ds-space-base)]">
        {completed.checks.map(check => <div key={check.id} className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
          <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
            <Badge tone={check.verdict === "fail" ? "danger" : check.verdict === "warning" ? "warning" : "success"}>{check.verdict}</Badge>
            <span className={cn(dsText.ui, "break-words font-medium")}>{check.label}</span>
          </div>
          <span className={cn(dsText.body, "break-words text-[color:var(--ds-fg-muted)]")}>{check.detail}</span>
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

export function PreflightControl({ editor }: { editor: ReturnType<typeof useEditableSettings>; retained: NonNullable<FrontendBootstrapWire["preflight"]> }) {
  return <section className="flex flex-col gap-[var(--ds-space-snug)]" aria-label="Preflight">
    <SectionLabel>Preflight</SectionLabel>
    <PreflightReportContent preflight={editor.preflight} onRerun={editor.rerunPreflight} />
  </section>;
}
