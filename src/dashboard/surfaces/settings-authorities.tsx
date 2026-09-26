import { KeyRound, Monitor, Server, ShieldCheck } from "lucide-react";
import { Form } from "@heroui/react";
import { Badge, Banner, Button, Field, Input, Panel, PanelBody, PanelHeader, Spinner, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { formatSetting } from "./settings-draft-model.js";
import { settingTitle } from "./settings-presentation.js";
import { groupDeploymentFacts, providerName, settingsFactLabel } from "./ui-settings-records-labels.js";

export function SettingsAuthoritySection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  if (editor.editor.state !== "loaded") return <Spinner label="Reading settings authorities" />;
  const document = editor.editor.document;
  if (sectionId === "protected-store") {
    const authority = document.protectedSettings;
    const credentials = editor.protectedEditor;
    return <Panel className="settings-page-panel"><PanelHeader title="Credentials" headingLevel={2} icon={<KeyRound aria-hidden className={dsIcon.lg} />} />
      <PanelBody className="settings-page-body">
        <Form validationBehavior="aria" className="flex flex-col gap-[var(--ds-space-section)]" onSubmit={event => { event.preventDefault(); const invalid = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]'); if (invalid !== null) invalid.focus(); else credentials.submit(); }}>
            {authority.state === "unknown" && <Banner tone="warning" title="Credential presence unknown">The credential store could not be read. <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          {editor.readProblem !== undefined && <Banner tone="warning" title="Current presence unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          <SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} retryConflict={credentials.submit} />
          <section className="settings-group">
            <h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-semibold")}>Stored credentials</h3>
            <div className="settings-group-rows">
          {authority.rows.map(row => {
            const operation = credentials.draft[row.name];
            const presence = authority.state === "available" ? authority.readback.entries[row.name] : undefined;
            const stored = authority.state === "available" ? authority.entries[row.name] : undefined;
            return <div key={row.name} data-protected-name={row.name} className="settings-row">
              <Field label={row.label} description={row.purpose} error={credentials.errors[row.name]} disabled={credentials.locked || authority.state !== "available" || operation?.kind === "clear"} className="settings-row-field">
                <Input type="password" autoComplete="new-password" spellCheck={false} value={operation?.kind === "set" ? operation.raw : ""}
                  placeholder="Enter replacement"
                  onChange={event => credentials.update(row.name, event.target.value)} />
              </Field>
              <div className={cn(dsText.meta, "settings-row-actions text-[color:var(--ds-fg-muted)]")}>
                <Badge tone="neutral">{presence === undefined ? "Unknown" : presence.present ? "Present" : "Missing"}</Badge>
                <Button size="sm" variant="ghost" aria-label={`Clear ${row.label}`} disabled={credentials.locked || authority.state !== "available"} onClick={() => credentials.clear(row.name)}>Clear</Button>
                {operation !== undefined && <Button size="sm" variant="ghost" disabled={credentials.locked} onClick={() => credentials.reset(row.name)}>Undo edit</Button>}
              </div>
              {stored !== undefined && <dl className={cn(dsText.body, "min-w-0")}><dt>Current value</dt><dd className="m-0 break-all [overflow-wrap:anywhere]">{formatSetting(stored.value)}</dd></dl>}
              {presence?.present === true && <dl className={cn(dsText.meta, "settings-row-hazard flex flex-wrap gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
                <div><dt>Write identity</dt><dd className="m-0 break-all">{presence.valueId}</dd></div><div><dt>Updated</dt><dd className="m-0">{presence.updatedAt}</dd></div>
              </dl>}
            </div>;
          })}
            </div>
          </section>
        </Form>
      </PanelBody>
    </Panel>;
  }
  if (sectionId === "provider-env") return <Panel className="settings-page-panel"><PanelHeader title="Provider availability" headingLevel={2} subtitle="Key presence for configured services." icon={<ShieldCheck aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <p className={cn(dsText.body, "mb-[var(--ds-space-section)] text-[color:var(--ds-fg-muted)]")}>Source: .env.providers. Read-only at process start; restart after changing a provider key.</p>
      <section className="settings-group"><h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-semibold")}>Provider keys</h3><div className="settings-group-rows">
      {Object.entries(document.providers).map(([name, availability]) => <div key={name} className="settings-row"><div className="settings-fact-row"><span className={dsText.ui}>{providerName(name)}</span><Badge tone={availability.state === "unknown" ? "warning" : "neutral"}>{availability.state === "present" ? `${String(availability.count)} ${availability.count === 1 ? "key configured" : "keys configured"}` : availability.state === "missing" ? "Missing" : "Unknown"}</Badge></div>{availability.state === "present" && <ul className={cn(dsText.body, "m-0 list-none p-0")}>{availability.values.map((value, index) => <li key={String(index)} className="break-all [overflow-wrap:anywhere]">Key {String(index + 1)}: {value}</li>)}</ul>}</div>)}
      </div></section>
    </PanelBody></Panel>;
  if (sectionId === "derived-host") {
    const display = document.host.primaryDisplay;
    const overrides = document.sections.find(section => section.id === "display")?.leaves;
    return <Panel className="settings-page-panel"><PanelHeader title="Observed host" headingLevel={2} subtitle="Display facts reported by this host." icon={<Monitor aria-hidden className={dsIcon.lg} />} />
      <PanelBody className="settings-page-body">
        <section className="settings-group"><h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-semibold")}>Primary display</h3><div className="settings-group-rows">
          <div className="settings-fact-row"><span className={dsText.ui}>Observed size</span><span className={dsText.ui}>{display === null ? "Not reported" : `${String(display.screenWidth)} × ${String(display.screenHeight)}`}</span></div>
          {overrides?.map(leaf => <div key={leaf.path} data-settings-path={leaf.path} className="settings-fact-row"><span className={dsText.ui}>{settingTitle(leaf)}</span><span className={dsText.ui}>{formatSetting(leaf.effectiveValue)}</span></div>)}
        </div></section>
      </PanelBody></Panel>;
  }
  if (sectionId !== "runtime-isolation") throw new Error("settings-authority-section-unknown");
  return <Panel className="settings-page-panel"><PanelHeader title="Runtime paths" headingLevel={2} subtitle="Code-owned paths for this process." icon={<Server aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <p className={cn(dsText.body, "mb-[var(--ds-space-section)] text-[color:var(--ds-fg-muted)]")}>These paths change through config/runtime-isolation.json and runtime-paths.ts.</p>
      <section className="settings-group"><h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-semibold")}>Operator and runtime paths</h3><div className="settings-group-rows">
      {groupDeploymentFacts(document.deployment).map(group => <section key={group.label} aria-label={group.label} className="settings-group"><h4 className={cn(dsText.ui, "mb-[var(--ds-space-tight)] font-semibold")}>{group.label}</h4>{group.entries.map(({ key, value }) => <dl key={key} className="settings-row"><dt className={dsText.ui}>{settingsFactLabel(key)}</dt><dd className={cn(dsText.meta, "m-0 min-w-0 break-words [overflow-wrap:anywhere]")}>{typeof value === "object" && !Array.isArray(value) ? <dl className="grid min-w-0 grid-cols-1 gap-[var(--ds-space-tight)]">{Object.entries(value).map(([property, endpoint]) => <div key={property}><dt className="text-[color:var(--ds-fg-muted)]">{settingsFactLabel(property)}</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{formatSetting(endpoint)}</dd></div>)}</dl> : formatSetting(value)}</dd></dl>)}</section>)}
      </div></section>
    </PanelBody></Panel>;
}
