import { Settings as SettingsIcon } from "lucide-react";
import { Form } from "@heroui/react";
import { useState } from "react";
import { Banner, Button, dsIcon, dsText, Field, Input, Panel, PanelBody, PanelHeader, Spinner } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { settingsSectionGroups, formatSetting } from "./settings-draft-model.js";
import { SettingsValueControl } from "./settings-controls.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";

export function EditableSettingsSection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  const [year, setYear] = useState("");
  if (editor.editor.state === "loading") return <Spinner label="Reading editable settings" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Editable settings could not be read"><Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  const section = document.sections.find(candidate => candidate.id === sectionId);
  if (section === undefined) return <Banner tone="danger" title="Server-listed section is unavailable">The settings document did not include this section.</Banner>;
  const leaves = sectionId === "annual-dates" ? editor.leaves.filter(leaf => leaf.path.startsWith("annualDates.")) : section.leaves;
  return <Panel className="settings-page-panel">
    <PanelHeader title={section.label} headingLevel={2} icon={<SettingsIcon aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <Form validationBehavior="aria" className="flex flex-col gap-[var(--ds-space-section)]" onSubmit={event => { event.preventDefault(); editor.submit(); }}>
        {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
        {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable"><span>{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></span></Banner>}
        <SettingsSaveFeedback save={editor.save} retry={editor.retry} retryConflict={editor.submit} />
        {sectionId === "display" && <p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>Observed host: {document.host.primaryDisplay === null ? "not reported" : `${String(document.host.primaryDisplay.screenWidth)} × ${String(document.host.primaryDisplay.screenHeight)}`}</p>}
        {sectionId === "annual-dates" && <div className="settings-add-year flex items-end gap-[var(--ds-space-base)]">
          <Field label="New fiscal year" error={editor.yearError} disabled={editor.locked}><Input value={year} placeholder="FY2027" onChange={event => setYear(event.target.value)} /></Field>
          <Button size="sm" variant="secondary" disabled={editor.locked} onClick={() => editor.addYear(year)}>Add fiscal year</Button>
        </div>}
        {sectionId === "annual-dates" && leaves.length === 0 && <p className={cn(dsText.ui, "text-[color:var(--ds-fg-muted)]")}>No fiscal years saved. Add a year and all three dates.</p>}
        {settingsSectionGroups(sectionId, leaves).map(group => <section key={group.title} className="settings-group">
          <h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-medium")}>{group.title}</h3>
          <div className="settings-group-rows">
            {group.leaves.map(leaf => {
              const operation = editor.draft[leaf.path];
              const custom = leaf.source === "settings";
              return <div key={leaf.path} data-settings-path={leaf.path} className="settings-row">
                <SettingsValueControl leaf={leaf} operation={operation} error={editor.errors[leaf.path]} disabled={editor.locked} update={raw => editor.update(leaf.path, raw)} />
                {leaf.validity === "unset" && <span className={cn(dsText.meta, "settings-row-hazard text-[color:var(--ds-status-waiting-fg)]")}>Not set</span>}
                {(custom || operation !== undefined) && <div className="settings-row-actions">
                  {editor.save.state === "conflict" && operation !== undefined && <span className={cn(dsText.meta, "w-full text-[color:var(--ds-fg-muted)]")}>Current value: {formatSetting(leaf.effectiveValue)}</span>}
                  {custom && operation?.kind !== "clear" && <Button size="sm" variant="ghost" title={`Standard value: ${formatSetting(leaf.defaultValue)}`} onClick={() => editor.clear(leaf.path)} disabled={editor.locked}>Restore standard</Button>}
                  {operation !== undefined && <Button size="sm" variant="ghost" onClick={() => editor.reset(leaf.path)} disabled={editor.locked}>Undo edit</Button>}
                </div>}
                {leaf.hazard !== undefined && <span className={cn(dsText.meta, "settings-row-hazard text-[color:var(--ds-status-waiting-fg)]")}>{leaf.hazard}</span>}
              </div>;
            })}
          </div>
        </section>)}
      </Form>
    </PanelBody>
  </Panel>;
}
