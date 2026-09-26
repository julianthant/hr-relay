import { KeyRound, Server } from "lucide-react";
import { Form } from "@heroui/react";
import type { ReactNode } from "react";
import { Badge, Banner, Button, Field, FormGroup, Panel, PanelBody, PanelHeader, ResultRow, SecretField, Spinner, dsFocus, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { formatSetting } from "./settings-draft-model.js";
import { groupDeploymentFacts, providerName, settingsFactLabel } from "./ui-settings-records-labels.js";

function SettingsFact({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <ResultRow label={label} description={description} value={children} />;
}

export function SettingsAuthoritySection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  if (editor.editor.state !== "loaded") return <Spinner label="Reading settings authorities" />;
  const document = editor.editor.document;
  if (sectionId === "protected-store" || sectionId === "credentials") {
    const authority = document.protectedSettings;
    const credentials = editor.protectedEditor;
    return <Panel className="settings-page-panel"><PanelHeader title="Credentials" headingLevel={2} icon={<KeyRound aria-hidden className={dsIcon.lg} />} />
      <PanelBody className="settings-page-body">
        <Form validationBehavior="aria" className="flex flex-col gap-[var(--ds-space-section)]" onSubmit={event => { event.preventDefault(); const invalid = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]'); if (invalid !== null) invalid.focus(); else credentials.submit(); }}>
          {authority.state === "unknown" && <Banner tone="warning" title="Credential presence unknown">The credential store could not be read. <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          {editor.readProblem !== undefined && <Banner tone="warning" title="Current presence unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh presence</Button></Banner>}
          <SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} retryConflict={credentials.submit} />
      <FormGroup label="Stored credentials" className="settings-group">
            <h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-medium")}>Stored credentials</h3>
            <div className="settings-group-rows">
              {authority.rows.map(row => {
                const operation = credentials.draft[row.name];
                const presence = authority.state === "available" ? authority.readback.entries[row.name] : undefined;
                const stored = authority.state === "available" ? authority.entries[row.name] : undefined;
                return <div key={row.name} data-protected-name={row.name} className="settings-row settings-credential-row">
                  <Field orientation="horizontal" label={row.label} description={row.purpose} error={credentials.errors[row.name]} disabled={credentials.locked || authority.state !== "available" || operation?.kind === "clear"} className="settings-row-field">
                    <SecretField label={row.label} autoComplete="new-password" spellCheck={false} value={operation?.kind === "set" ? operation.raw : ""}
                      placeholder="Enter replacement" onChange={event => credentials.update(row.name, event.target.value)} />
                  </Field>
                  <div className="settings-row-actions">
                    <Badge tone={presence === undefined ? "warning" : "neutral"}>{presence === undefined ? "Unknown" : presence.present ? "Present" : "Missing"}</Badge>
                    <Button size="sm" variant="ghost" aria-label={`Clear ${row.label}`} disabled={credentials.locked || authority.state !== "available"} onClick={() => credentials.clear(row.name)}>Clear</Button>
                    {operation !== undefined && <Button size="sm" variant="ghost" disabled={credentials.locked} onClick={() => credentials.reset(row.name)}>Undo edit</Button>}
                  </div>
                  {stored !== undefined && <dl className={cn(dsText.body, "settings-credential-detail")}><dt>Current value</dt><dd className="m-0 break-all [overflow-wrap:anywhere]">{formatSetting(stored.value)}</dd></dl>}
                  {presence?.present === true && <details className="settings-credential-audit"><summary aria-label={`Write details for ${row.label}`} className={cn(dsText.meta, dsFocus)}>Write details</summary>
                    <dl className={cn(dsText.meta, "settings-credential-meta")}><div><dt>Write identity</dt><dd className="m-0 break-all">{presence.valueId}</dd></div><div><dt>Updated</dt><dd className="m-0">{presence.updatedAt}</dd></div></dl>
                  </details>}
                </div>;
              })}
            </div>
      </FormGroup>
      {sectionId === "credentials" && <FormGroup label="Provider keys from environment" className="settings-group">
        <h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-medium")}>Provider keys from environment</h3>
        <div className="settings-group-rows">
          {Object.entries(document.providers).map(([name, availability]) => <SettingsFact key={name} label={providerName(name)}>
            <Badge tone={availability.state === "unknown" ? "warning" : "neutral"}>{availability.state === "present" ? `${String(availability.count)} ${availability.count === 1 ? "key configured" : "keys configured"}` : availability.state === "missing" ? "Missing" : "Unknown"}</Badge>
            {availability.state === "present" && <ul className="settings-fact-list">{availability.values.map((value, index) => <li key={String(index)}><span>Key {String(index + 1)}</span><span className="break-all [overflow-wrap:anywhere]">{value}</span></li>)}</ul>}
          </SettingsFact>)}
        </div><p className={cn(dsText.meta, "settings-group-note")}>Source: .env.providers. Read-only at process start; restart after changing a provider key.</p>
      </FormGroup>}
        </Form>
      </PanelBody>
    </Panel>;
  }
  if (sectionId !== "runtime-isolation") throw new Error("settings-authority-section-unknown");
  return <Panel className="settings-page-panel"><PanelHeader title="Paths" headingLevel={2} subtitle="Code-owned paths for this process." icon={<Server aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <p className={cn(dsText.body, "mb-[var(--ds-space-section)] text-[color:var(--ds-fg-muted)]")}>These paths change through config/runtime-isolation.json and runtime-paths.ts.</p>
      <div className="settings-section-stack">
        {groupDeploymentFacts(document.deployment).map(group => <section key={group.label} className="settings-group"><h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-medium")}>{group.label}</h3><div className="settings-group-rows">
          {group.entries.map(({ key, value }) => <ResultRow key={key} label={settingsFactLabel(key)} value={typeof value === "object" && value !== null && !Array.isArray(value)
            ? <dl>{Object.entries(value).map(([property, endpoint]) => <div key={property}><dt>{settingsFactLabel(property)}</dt><dd>{formatSetting(endpoint)}</dd></div>)}</dl>
            : <span className="break-all [overflow-wrap:anywhere]">{formatSetting(value)}</span>} />)}
        </div></section>)}
      </div>
    </PanelBody></Panel>;
}
