import { KeyRound, Monitor, Server, ShieldCheck } from "lucide-react";
import { Form } from "@heroui/react";
import type { KeyboardEvent } from "react";
import { Badge, Banner, Button, Field, Input, Panel, PanelBody, PanelHeader, Spinner, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { formatSetting } from "./settings-draft-model.js";
import { settingTitle } from "./settings-presentation.js";
import { differingSettingsValues, groupDeploymentFacts, providerName, settingsFactLabel, settingsValueGroups } from "./ui-settings-records-labels.js";

export function SettingsAuthoritySection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  if (editor.editor.state !== "loaded") return <Spinner label="Reading settings authorities" />;
  const document = editor.editor.document;
  if (sectionId === "protected-store") {
    const authority = document.protectedSettings;
    const credentials = editor.protectedEditor;
    return <Panel className="settings-page-panel"><PanelHeader title="Credentials" headingLevel={2} subtitle="View stored values and replace credentials for their next use." icon={<KeyRound aria-hidden className={dsIcon.lg} />}
      meta={authority.state === "available" ? `Revision ${String(authority.readback.revision)}` : "Presence unknown"} />
      <PanelBody className="settings-page-body">
        <div onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.querySelector("form")?.requestSubmit(); } }}>
        <Form validationBehavior="aria" className="flex flex-col gap-[var(--ds-space-section)]" onSubmit={event => { event.preventDefault(); const invalid = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]'); if (invalid !== null) invalid.focus(); else credentials.submit(); }}>
            {authority.state === "unknown" && <Banner tone="warning" title="Credential presence unknown">The credential store could not be read. <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          {editor.readProblem !== undefined && <Banner tone="warning" title="Current presence unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
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
                {operation !== undefined && <Badge tone="attention">{operation.kind === "clear" ? "Clear on save" : "Unsaved"}</Badge>}
                <Button size="sm" variant="ghost" aria-label={`Clear ${row.label}`} disabled={credentials.locked || authority.state !== "available"} onClick={() => credentials.clear(row.name)}>Clear</Button>
                {operation !== undefined && <Button size="sm" variant="ghost" disabled={credentials.locked} onClick={() => credentials.reset(row.name)}>Reset</Button>}
              </div>
              {stored !== undefined && <dl className={cn(dsText.body, "min-w-0")}><dt>Current value</dt><dd className="m-0 break-all [overflow-wrap:anywhere]">{formatSetting(stored.value)}</dd></dl>}
              {presence?.present === true && <dl className={cn(dsText.meta, "settings-row-hazard flex flex-wrap gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
                <div><dt>Write identity</dt><dd className="m-0 break-all">{presence.valueId}</dd></div><div><dt>Updated</dt><dd className="m-0">{presence.updatedAt}</dd></div>
              </dl>}
              <details className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}><summary className="cursor-pointer">Credential identifiers</summary><code className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-tight)] block break-all")}>{row.name}</code></details>
            </div>;
          })}
            </div>
          </section>
          <div className="settings-savebar">
          <div className="w-full"><SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} /></div>
            <span className={cn(dsText.meta, "mr-auto text-[color:var(--ds-fg-muted)]")}>{credentials.dirtyCount === 0 ? "All changes saved · Replacements apply at next use" : `${String(credentials.dirtyCount)} unsaved credential ${credentials.dirtyCount === 1 ? "change" : "changes"}`}</span>
            <Button size="sm" variant="ghost" onClick={credentials.discard} disabled={credentials.dirtyCount === 0 || credentials.save.state === "saving"}>Discard</Button>
            <Button type="submit" size="sm" variant="primary" disabled={credentials.dirtyCount === 0 || credentials.locked || authority.state !== "available" || editor.readProblem !== undefined || Object.values(credentials.errors).some(error => error !== undefined)}>{credentials.save.state === "saving" ? "Saving credentials…" : "Save credentials"}</Button>
          </div>
        </Form>
        </div>
      </PanelBody>
    </Panel>;
  }
  if (sectionId === "provider-env") return <Panel className="settings-page-panel"><PanelHeader title="Provider availability" headingLevel={2} subtitle="Key presence for configured services." icon={<ShieldCheck aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <p className={cn(dsText.body, "mb-[var(--ds-space-section)] text-[color:var(--ds-fg-muted)]")}>Source: .env.providers. Read-only at process start; restart after changing a provider key.</p>
      <section className="settings-group"><h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-semibold")}>Provider keys</h3><div className="settings-group-rows">
      {Object.entries(document.providers).map(([name, availability]) => <div key={name} className="settings-row"><div className="settings-fact-row"><span className={dsText.ui}>{providerName(name)}</span><Badge tone={availability.state === "unknown" ? "warning" : "neutral"}>{availability.state === "present" ? `${String(availability.count)} ${availability.count === 1 ? "key configured" : "keys configured"}` : availability.state === "missing" ? "Missing" : "Unknown"}</Badge></div>{availability.state === "present" && <ul className={cn(dsText.body, "m-0 list-none p-0")}>{availability.values.map((value, index) => <li key={String(index)} className="break-all [overflow-wrap:anywhere]">Key {String(index + 1)}: {value}</li>)}</ul>}<details className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}><summary className="cursor-pointer">Environment key family</summary><code className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-tight)] block break-all")}>{name}</code></details></div>)}
      </div></section>
    </PanelBody></Panel>;
  if (sectionId === "derived-host") {
    const display = document.host.primaryDisplay;
    const overrides = document.sections.find(section => section.id === "display")?.leaves;
    return <Panel className="settings-page-panel"><PanelHeader title="Observed host" headingLevel={2} subtitle="Display facts reported by this host." icon={<Monitor aria-hidden className={dsIcon.lg} />} />
      <PanelBody className="settings-page-body">
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Source: active process observation. Values describe this process lifetime.</p>
        <section className="settings-group"><h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-semibold")}>Primary display</h3><div className="settings-group-rows">
          <div className="settings-fact-row"><span className={dsText.ui}>Observed size</span><span className={dsText.ui}>{display === null ? "Not reported" : `${String(display.screenWidth)} × ${String(display.screenHeight)}`}</span></div>
          {overrides?.map(leaf => {
            const differences = differingSettingsValues(leaf);
            const values = differences.length > 0 ? differences : settingsValueGroups(leaf);
            return <div key={leaf.path} data-settings-path={leaf.path} className="settings-row">
              <div className="settings-fact-row"><span className={dsText.ui}>{settingTitle(leaf)}</span>{leaf.settingsValue === undefined && <Badge tone="neutral">Using default</Badge>}</div>
              <dl className="grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-base)] sm:grid-cols-3">
                {values.map(source => <div key={source.label}><dt className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>{source.label}</dt><dd className={cn(dsText.meta, "m-0 break-words [overflow-wrap:anywhere]")}>{formatSetting(source.value)}</dd></div>)}
              </dl>
            </div>;
          })}
        </div></section>
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Change these values in Display. Saved changes apply to new browser sessions.</p>
      </PanelBody></Panel>;
  }
  if (sectionId !== "runtime-isolation") throw new Error("settings-authority-section-unknown");
  return <Panel className="settings-page-panel"><PanelHeader title="Deployment" headingLevel={2} subtitle="Code-owned configuration for this process." icon={<Server aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <p className={cn(dsText.body, "mb-[var(--ds-space-section)] text-[color:var(--ds-fg-muted)]")}>Deployment facts change through config/runtime-isolation.json, runtime-paths.ts and configuration code.</p>
      <section className="settings-group"><h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-semibold")}>Runtime paths and routes</h3><div className="settings-group-rows">
      {groupDeploymentFacts(document.deployment).map(group => <section key={group.label} aria-label={group.label} className="settings-group"><h4 className={cn(dsText.ui, "mb-[var(--ds-space-tight)] font-semibold")}>{group.label}</h4>{group.entries.map(({ key, value }) => <dl key={key} className="settings-row"><dt className={dsText.ui}>{settingsFactLabel(key)}</dt><dd className={cn(dsText.meta, "m-0 min-w-0 break-words [overflow-wrap:anywhere]")}>{typeof value === "object" && !Array.isArray(value) ? <dl className="grid min-w-0 grid-cols-1 gap-[var(--ds-space-tight)]">{Object.entries(value).map(([property, endpoint]) => <div key={property}><dt className="text-[color:var(--ds-fg-muted)]">{settingsFactLabel(property)}</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{formatSetting(endpoint)}</dd></div>)}</dl> : formatSetting(value)}</dd><details className="text-[color:var(--ds-fg-muted)]"><summary className="cursor-pointer">Configuration key</summary><code className={cn(dsText.micro, dsText.nums, "block break-all")}>{key}</code></details></dl>)}</section>)}
      </div></section>
    </PanelBody></Panel>;
}
