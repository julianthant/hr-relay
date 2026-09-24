import { KeyRound, Monitor, Server, ShieldCheck } from "lucide-react";
import { Badge, Banner, Button, Field, Input, Panel, PanelBody, PanelFooter, PanelHeader, Spinner, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { formatSetting } from "./settings-draft-model.js";
import { differingSettingsValues, groupDeploymentFacts, providerName, settingsFactLabel, settingsValueGroups } from "./ui-settings-records-labels.js";

export function SettingsAuthoritySection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  if (editor.editor.state !== "loaded") return <Spinner label="Reading settings authorities" />;
  const document = editor.editor.document;
  if (sectionId === "protected-store") {
    const authority = document.protectedSettings;
    const credentials = editor.protectedEditor;
    return <Panel className="min-h-0 flex-1"><PanelHeader title="Credentials" headingLevel={2} icon={<KeyRound aria-hidden className={dsIcon.lg} />}
      meta={authority.state === "available" ? `Revision ${String(authority.readback.revision)}` : "Presence unknown"} />
      <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); const invalid = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]'); if (invalid !== null) invalid.focus(); else credentials.submit(); }}
          onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
        <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
          <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Credential changes apply at the next use. Saved values are shown below.</p>
          {authority.state === "unknown" && <Banner tone="warning" title="Credential presence unknown">The credential store could not be read. <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          {editor.readProblem !== undefined && <Banner tone="warning" title="Current presence unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          <div className="grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-section)] min-[840px]:grid-cols-2">{authority.rows.map(row => {
            const operation = credentials.draft[row.name];
            const presence = authority.state === "available" ? authority.readback.entries[row.name] : undefined;
            const stored = authority.state === "available" ? authority.entries[row.name] : undefined;
            return <section key={row.name} data-protected-name={row.name} aria-label={`${row.label} credential`} className="flex min-w-0 flex-col gap-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] py-[var(--ds-space-cozy)]">
              <Field label={row.label} description={row.purpose} error={credentials.errors[row.name]} disabled={credentials.locked || authority.state !== "available" || operation?.kind === "clear"}>
                <Input type="text" spellCheck={false} value={operation?.kind === "set" ? operation.raw : ""}
                  onChange={event => credentials.update(row.name, event.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
                <Badge tone="neutral">{presence === undefined ? "Unknown" : presence.present ? "Present" : "Missing"}</Badge>
                {operation !== undefined && <Badge tone="attention">{operation.kind === "clear" ? "Clear on save" : "Unsaved"}</Badge>}
                <Button size="sm" variant="ghost" aria-label={`Clear ${row.label}`} disabled={credentials.locked || authority.state !== "available"} onClick={() => credentials.clear(row.name)}>Clear</Button>
                {operation !== undefined && <Button size="sm" variant="ghost" disabled={credentials.locked} onClick={() => credentials.reset(row.name)}>Reset</Button>}
              </div>
              <details className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                <summary className="cursor-pointer">Credential identifiers</summary>
                <code className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-tight)] block break-all")}>{row.name}</code>
                {presence?.present === true && <dl className="mt-[var(--ds-space-tight)] grid grid-cols-1 gap-[var(--ds-space-tight)] sm:grid-cols-2">
                  <div><dt>Stored write identity</dt><dd className="m-0 break-all">{presence.valueId}</dd></div><div><dt>Last updated</dt><dd className="m-0 break-words">{presence.updatedAt}</dd></div>
                </dl>}
              </details>
              {stored !== undefined && <dl className={cn(dsText.body, "min-w-0")}><dt>Current value</dt><dd className="m-0 break-all [overflow-wrap:anywhere]">{formatSetting(stored.value)}</dd></dl>}
            </section>;
          })}</div>
        </PanelBody>
        <PanelFooter className="flex-wrap gap-[var(--ds-space-base)]">
          <div className="w-full"><SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} /></div>
          <span className={cn(dsText.meta, "mr-auto text-[color:var(--ds-fg-muted)]")}>{credentials.dirtyCount === 0 ? "No unsaved changes" : `${String(credentials.dirtyCount)} unsaved credential ${credentials.dirtyCount === 1 ? "change" : "changes"}`}</span>
          <Button size="sm" variant="ghost" onClick={credentials.discard} disabled={credentials.dirtyCount === 0 || credentials.save.state === "saving"}>Discard credentials</Button>
          <Button type="submit" size="sm" variant="primary" disabled={credentials.dirtyCount === 0 || credentials.locked || authority.state !== "available" || editor.readProblem !== undefined || Object.values(credentials.errors).some(error => error !== undefined)}>{credentials.save.state === "saving" ? "Saving credentials…" : `Save credentials ${String(credentials.dirtyCount)}`}</Button>
        </PanelFooter>
      </form>
    </Panel>;
  }
  if (sectionId === "provider-env") return <Panel className="min-h-0 flex-1"><PanelHeader title="Provider availability" headingLevel={2} icon={<ShieldCheck aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
      <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Source: .env.providers. Read-only at process start; restart after changing a provider key.</p>
      <div className="grid grid-cols-1 gap-x-[var(--ds-space-section)] min-[840px]:grid-cols-2">{Object.entries(document.providers).map(([name, availability]) => <div key={name} className="flex min-w-0 flex-col gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border)] py-[var(--ds-space-snug)]"><div className="flex min-w-0 items-center justify-between gap-[var(--ds-space-base)]"><span className={cn(dsText.ui, "truncate")}>{providerName(name)}</span><Badge tone={availability.state === "unknown" ? "warning" : "neutral"}>{availability.state === "present" ? `${String(availability.count)} ${availability.count === 1 ? "key configured" : "keys configured"}` : availability.state === "missing" ? "Missing" : "Unknown"}</Badge></div><details className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}><summary className="cursor-pointer">Environment key family</summary><code className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-tight)] block break-all")}>{name}</code></details>{availability.state === "present" && <ul className={cn(dsText.body, "m-0 list-none p-0")}>{availability.values.map((value, index) => <li key={String(index)} className="break-all [overflow-wrap:anywhere]">Key {String(index + 1)}: {value}</li>)}</ul>}</div>)}</div>
    </PanelBody></Panel>;
  if (sectionId === "derived-host") {
    const display = document.host.primaryDisplay;
    const overrides = document.sections.find(section => section.id === "display")?.leaves;
    return <Panel className="min-h-0 flex-1"><PanelHeader title="Observed host" headingLevel={2} icon={<Monitor aria-hidden className={dsIcon.lg} />} />
      <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
        <p className={cn(dsText.ui, "text-[color:var(--ds-fg-secondary)]")}>{display === null ? "No primary display reported" : `Primary display ${String(display.screenWidth)} × ${String(display.screenHeight)}`}</p>
        <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Source: active process observation. Values describe this process lifetime.</p>
        {overrides?.map(leaf => {
          const differences = differingSettingsValues(leaf);
          const values = differences.length > 0 ? differences : settingsValueGroups(leaf);
          return <div key={leaf.path} data-settings-path={leaf.path} className="flex min-w-0 flex-wrap items-center justify-between gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] py-[var(--ds-space-snug)]">
            <span className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
              <span className={dsText.ui}>{leaf.label}</span>
              {leaf.settingsValue === undefined && <Badge tone="neutral">Using default</Badge>}
            </span>
            <dl className="grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-base)] sm:grid-cols-3">
              {values.map(source => <div key={source.label} className="min-w-0"><dt className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>{source.label}</dt><dd className={cn(dsText.meta, "m-0 break-words [overflow-wrap:anywhere] text-[color:var(--ds-fg)]")}>{formatSetting(source.value)}</dd></div>)}
            </dl>
            <details className={cn(dsText.meta, "w-full text-[color:var(--ds-fg-muted)]")}><summary className="cursor-pointer">Setting identity</summary><code className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-tight)] block break-all")}>{leaf.path}</code></details>
          </div>;
        })}
        <Button size="sm" variant="secondary" disabled={editor.locked || overrides?.every(leaf => leaf.settingsValue === undefined)} onClick={() => editor.clear("display.screenWidth")}>Clear override</Button>
        {editor.dirtyCount > 0 && <p className={dsText.meta}>Display draft retained. Save from Display.</p>}
      </PanelBody></Panel>;
  }
  if (sectionId !== "runtime-isolation") throw new Error("settings-authority-section-unknown");
  return <Panel className="min-h-0 flex-1"><PanelHeader title="Deployment" headingLevel={2} icon={<Server aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
      <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Source: active process configuration. Read-only here; changes apply after restart.</p>
      {groupDeploymentFacts(document.deployment).map(group => <section key={group.label} aria-label={group.label} className="flex min-w-0 flex-col gap-[var(--ds-space-cozy)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)] last:border-0">
        <h3 className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>{group.label}</h3>
        <dl className="grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-section)] min-[840px]:grid-cols-2">{group.entries.map(({ key, value }) => <div key={key} className={cn(dsText.meta, "min-w-0 border-b border-[color:var(--ds-border)] py-[var(--ds-space-snug)]")}>
          <dt className="text-[color:var(--ds-fg-muted)]">{settingsFactLabel(key)}</dt>
          <dd className="m-0 break-words [overflow-wrap:anywhere] text-[color:var(--ds-fg)]">
            {typeof value === "object" && !Array.isArray(value)
              ? <dl className="grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-base)] min-[840px]:grid-cols-2">{Object.entries(value).map(([property, endpoint]) => <div key={property} className="min-w-0"><dt className="text-[color:var(--ds-fg-muted)]">{settingsFactLabel(property)}</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{formatSetting(endpoint)}</dd></div>)}</dl>
              : formatSetting(value)}
          </dd>
          <details className="mt-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]"><summary className="cursor-pointer">Configuration key</summary><code className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-tight)] block break-all")}>{key}</code></details>
        </div>)}</dl>
      </section>)}
    </PanelBody></Panel>;
}
