import { Form } from "@heroui/react";
import { Banner, Button, FormGroup, PageHeading, Spinner, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { settingsSectionGroups, formatSetting } from "./settings-draft-model.js";
import { SettingsValueControl } from "./settings-controls.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { timeoutReadableValue, timeoutSetting } from "./settings-timeouts-model.js";
import { CompactSettingsSection } from "./ui-settings-records-general-paths.js";
import { PerformanceSettingsSection } from "./ui-settings-records-performance.js";
import { ProviderSettingsSection } from "./settings-provider.js";

export function EditableSettingsSection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  if (sectionId === "general" || sectionId === "paths") return <CompactSettingsSection editor={editor} sectionId={sectionId} />;
  if (sectionId === "performance") return <PerformanceSettingsSection editor={editor} />;
  if (sectionId === "providers") return <ProviderSettingsSection editor={editor} />;
  if (editor.editor.state === "loading") return <Spinner label="Reading editable settings" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Editable settings could not be read"><Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  const sections = document.sections.filter(section => section.id === sectionId);
  if (sections.length === 0) return <Banner tone="danger" title="Server-listed section is unavailable">The settings document did not include this section.</Banner>;
  const leaves = sections.flatMap(section => section.leaves);
  const pageTitle = sections[0]?.label ?? sectionId;
  return <section className="settings-editor">
    <PageHeading title={pageTitle} />
    <Form validationBehavior="aria" className="flex flex-col gap-[var(--ds-space-section)]" onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
      {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable"><span>{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></span></Banner>}
      <SettingsSaveFeedback save={editor.save} retry={editor.retry} retryConflict={editor.submit} />
      {settingsSectionGroups(sectionId, leaves).map(group => <section key={group.title} className="settings-editor-group">
        <div className="settings-group-heading"><h2 className={cn(dsText.title, "m-0 font-medium text-[color:var(--ds-fg)]")}>{group.title}</h2></div>
        <FormGroup label={group.title} className="settings-group">
          <div className="settings-group-rows">
            {group.leaves.map(leaf => {
            const operation = editor.draft[leaf.path];
            const custom = leaf.source === "settings";
            const requiredJobEndDate = leaf.path.startsWith("annualDates.") && leaf.path.endsWith(".jobEndDate");
            const shownCurrent = timeoutSetting(leaf.path) !== undefined && leaf.effectiveValue !== undefined
              ? timeoutReadableValue(leaf, leaf.effectiveValue)
              : formatSetting(leaf.effectiveValue);
            const shownDefault = timeoutSetting(leaf.path) !== undefined && leaf.defaultValue !== undefined
              ? timeoutReadableValue(leaf, leaf.defaultValue)
              : formatSetting(leaf.defaultValue);
              return <div key={leaf.path} data-settings-path={leaf.path} className="settings-row">
                <SettingsValueControl leaf={leaf} operation={operation} error={editor.errors[leaf.path]} disabled={editor.locked} update={raw => editor.update(leaf.path, raw)} />
              {leaf.validity === "unset" && <span className={cn(dsText.meta, "settings-row-hazard text-[color:var(--ds-status-waiting-fg)]")}>Not set</span>}
              {(custom || operation !== undefined) && <div className="settings-row-actions">
                {editor.save.state === "conflict" && operation !== undefined && <span className={cn(dsText.meta, "w-full text-[color:var(--ds-fg-muted)]")}>Current value: {shownCurrent}</span>}
                {custom && !requiredJobEndDate && operation?.kind !== "clear" && <Button size="sm" variant="ghost" title={`Standard value: ${shownDefault}`} onClick={() => editor.clear(leaf.path)} disabled={editor.locked}>Restore standard</Button>}
                {operation !== undefined && <Button size="sm" variant="ghost" onClick={() => editor.reset(leaf.path)} disabled={editor.locked}>Undo edit</Button>}
              </div>}
              {leaf.hazard !== undefined && <span className={cn(dsText.meta, "settings-row-hazard text-[color:var(--ds-status-waiting-fg)]")}>{leaf.hazard}</span>}
              </div>;
            })}
          </div>
        </FormGroup>
      </section>)}
    </Form>
  </section>;
}
