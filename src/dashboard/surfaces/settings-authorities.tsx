import { KeyRound, Monitor, Server, ShieldCheck } from "lucide-react";
import { Badge, Banner, Button, Field, Input, Panel, PanelBody, PanelHeader, Spinner, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { formatSetting } from "./settings-draft-model.js";

export function SettingsAuthoritySection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  if (editor.editor.state !== "loaded") return <Spinner label="Reading settings authorities" />;
  const document = editor.editor.document;
  if (sectionId === "protected-store") {
    const authority = document.protectedSettings;
    const credentials = editor.protectedEditor;
    return <Panel className="min-h-0 flex-1"><PanelHeader title="Credentials" headingLevel={2} subtitle="Independent credential store" icon={<KeyRound aria-hidden className={dsIcon.lg} />}
      meta={authority.state === "available" ? `Revision ${String(authority.readback.revision)}` : "Presence unknown"} />
      <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
        <form noValidate className="flex flex-col gap-[var(--ds-space-cozy)]" onSubmit={event => { event.preventDefault(); const invalid = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]'); if (invalid !== null) invalid.focus(); else credentials.submit(); }}
          onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
            {authority.state === "unknown" && <Banner tone="warning" title="Credential presence unknown">The credential store could not be read. <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          {editor.readProblem !== undefined && <Banner tone="warning" title="Current presence unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          {authority.rows.map(row => {
            const operation = credentials.draft[row.name];
            const presence = authority.state === "available" ? authority.readback.entries[row.name] : undefined;
            const stored = authority.state === "available" ? authority.entries[row.name] : undefined;
            return <div key={row.name} data-protected-name={row.name} className="flex flex-col gap-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)]">
              <Field label={row.label} description={row.purpose} error={credentials.errors[row.name]} disabled={credentials.locked || authority.state !== "available" || operation?.kind === "clear"}>
                <Input type="text" spellCheck={false} value={operation?.kind === "set" ? operation.raw : ""}
                  onChange={event => credentials.update(row.name, event.target.value)} />
              </Field>
              <div className={cn(dsText.meta, "flex flex-wrap items-center gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
                <Badge tone="neutral">{presence === undefined ? "Unknown" : presence.present ? "Present" : "Missing"}</Badge>
                <span>{row.name} · Protected · Next use</span>
                {operation !== undefined && <Badge tone="attention">{operation.kind === "clear" ? "Clear on save" : "Unsaved"}</Badge>}
                <Button size="sm" variant="ghost" aria-label={`Clear ${row.label}`} disabled={credentials.locked || authority.state !== "available"} onClick={() => credentials.clear(row.name)}>Clear</Button>
                {operation !== undefined && <Button size="sm" variant="ghost" disabled={credentials.locked} onClick={() => credentials.reset(row.name)}>Reset</Button>}
              </div>
              {presence?.present === true && <dl className={cn(dsText.meta, "flex flex-wrap gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
                <div><dt>Write identity</dt><dd className="m-0 break-all">{presence.valueId}</dd></div><div><dt>Updated</dt><dd className="m-0">{presence.updatedAt}</dd></div>
              </dl>}
              {stored !== undefined && <dl className={cn(dsText.body, "min-w-0")}><dt>Current value</dt><dd className="m-0 break-all [overflow-wrap:anywhere]">{formatSetting(stored.value)}</dd></dl>}
            </div>;
          })}
          <div className="sticky bottom-0 flex flex-wrap items-center gap-[var(--ds-space-base)] border-t border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] py-[var(--ds-space-base)]">
          <div className="w-full"><SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} /></div>
            <span className={cn(dsText.meta, "mr-auto text-[color:var(--ds-fg-muted)]")}>{String(credentials.dirtyCount)} unsaved credential {credentials.dirtyCount === 1 ? "change" : "changes"}</span>
            <Button size="sm" variant="ghost" onClick={credentials.discard} disabled={credentials.dirtyCount === 0 || credentials.save.state === "saving"}>Discard credentials</Button>
            <Button type="submit" size="sm" variant="primary" disabled={credentials.dirtyCount === 0 || credentials.locked || authority.state !== "available" || editor.readProblem !== undefined || Object.values(credentials.errors).some(error => error !== undefined)}>{credentials.save.state === "saving" ? "Saving credentials…" : `Save credentials ${String(credentials.dirtyCount)}`}</Button>
          </div>
        </form>
      </PanelBody>
    </Panel>;
  }
  if (sectionId === "provider-env") return <Panel className="min-h-0 flex-1"><PanelHeader title="Provider availability" headingLevel={2} subtitle=".env.providers · Read-only · Process startup" icon={<ShieldCheck aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
      <p className={cn(dsText.ui, "text-[color:var(--ds-fg-muted)]")}>Edit .env.providers and restart to change provider keys.</p>
      {Object.entries(document.providers).map(([name, availability]) => <div key={name} className="flex min-w-0 flex-col gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-base)]"><div className="flex items-center gap-[var(--ds-space-base)]"><span className={dsText.ui}>{name}</span><Badge tone={availability.state === "unknown" ? "warning" : "neutral"}>{availability.state === "present" ? `${String(availability.count)} populated keys` : availability.state === "missing" ? "Missing" : "Unknown"}</Badge></div>{availability.state === "present" && <ul className={cn(dsText.body, "m-0 list-none p-0")}>{availability.values.map((value, index) => <li key={String(index)} className="break-all [overflow-wrap:anywhere]">Key {String(index + 1)}: {value}</li>)}</ul>}</div>)}
    </PanelBody></Panel>;
  if (sectionId === "derived-host") {
    const display = document.host.primaryDisplay;
    const overrides = document.sections.find(section => section.id === "display")?.leaves;
    return <Panel className="min-h-0 flex-1"><PanelHeader title="Observed host" headingLevel={2} subtitle="Host observation · Read-only · Process lifetime" icon={<Monitor aria-hidden className={dsIcon.lg} />} />
      <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
        <p className={dsText.ui}>{display === null ? "No primary display reported" : `Primary display: ${String(display.screenWidth)} × ${String(display.screenHeight)}`}</p>
        {overrides?.map(leaf => <div key={leaf.path} className={cn(dsText.ui, "flex flex-col gap-[var(--ds-space-tight)]")}><span>{leaf.label}</span><span>Saved: {formatSetting(leaf.settingsValue)} · Active: {formatSetting(leaf.activeValue)} · Default: {formatSetting(leaf.defaultValue)}</span></div>)}
        <Button size="sm" variant="secondary" disabled={editor.locked || overrides?.every(leaf => leaf.settingsValue === undefined)} onClick={() => editor.clear("display.screenWidth")}>Clear override</Button>
        {editor.dirtyCount > 0 && <p className={dsText.meta}>Display draft retained. Save it from the Display section.</p>}
      </PanelBody></Panel>;
  }
  if (sectionId !== "runtime-isolation") throw new Error("settings-authority-section-unknown");
  return <Panel className="min-h-0 flex-1"><PanelHeader title="Deployment" headingLevel={2} subtitle="Code-owned · Read-only · Process lifetime" icon={<Server aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
      <p className={cn(dsText.ui, "text-[color:var(--ds-fg-muted)]")}>Deployment facts change through config/runtime-isolation.json, runtime-paths.ts and configuration code.</p>
      {Object.entries(document.deployment).map(([name, value]) => <dl key={name} className={cn(dsText.meta, "min-w-0 border-b border-[color:var(--ds-border)] pb-[var(--ds-space-base)]")}><dt>{name}</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{formatSetting(value)}</dd></dl>)}
    </PanelBody></Panel>;
}
