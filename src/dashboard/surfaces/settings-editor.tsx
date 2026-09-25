import { Settings as SettingsIcon } from "lucide-react";
import { Form } from "@heroui/react";
import { useState, type KeyboardEvent } from "react";
import { Badge, Banner, Button, dsIcon, dsText, Field, Input, Panel, PanelBody, PanelHeader, Spinner } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { plural } from "./format.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { settingsSectionGroups, formatSetting } from "./settings-draft-model.js";
import { SettingsValueControl } from "./settings-controls.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { settingsSubtitle } from "./settings-presentation.js";
import { differingSettingsValues } from "./ui-settings-records-labels.js";

export function EditableSettingsSection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  const [year, setYear] = useState("");
  if (editor.editor.state === "loading") return <Spinner label="Reading editable settings" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Editable settings could not be read"><Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  const section = document.sections.find(candidate => candidate.id === sectionId);
  if (section === undefined) return <Banner tone="danger" title="Server-listed section is unavailable">The settings document did not include this section.</Banner>;
  const leaves = sectionId === "annual-dates" ? editor.leaves.filter(leaf => leaf.path.startsWith("annualDates.")) : section.leaves;
  const hasNextIdleChanges = leaves.some(leaf => leaf.activationScope === "next-idle");
  const hasNewRunChanges = leaves.some(leaf => leaf.activationScope === "new-runs");
  const submit = (form: HTMLFormElement): void => {
    const firstError = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (firstError !== null) { firstError.focus(); return; }
    editor.submit();
  };
  return <Panel className="settings-page-panel">
    <PanelHeader title={section.label} headingLevel={2} subtitle={settingsSubtitle(sectionId, section.description)} icon={<SettingsIcon aria-hidden className={dsIcon.lg} />} meta={`Revision ${String(document.revision)}`} />
    <PanelBody className="settings-page-body">
      <div onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); const form = event.currentTarget.querySelector("form"); if (form !== null) submit(form); } }}>
      <Form validationBehavior="aria" className="flex flex-col gap-[var(--ds-space-section)]" onSubmit={event => { event.preventDefault(); submit(event.currentTarget); }}>
        {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
        {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable"><span>{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></span></Banner>}
        {(hasNewRunChanges || hasNextIdleChanges) && <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          {hasNewRunChanges ? "Saved values apply to new runs." : ""}{hasNewRunChanges && hasNextIdleChanges ? " " : ""}{hasNextIdleChanges ? "Worker limits take effect at the next idle boundary." : ""}
        </p>}
        {sectionId === "display" && <div className={cn(dsText.meta, "flex flex-wrap items-center gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
          <span>Observed host: {document.host.primaryDisplay === null ? "no primary display reported" : `${String(document.host.primaryDisplay.screenWidth)} × ${String(document.host.primaryDisplay.screenHeight)}`}</span>
        </div>}
        {sectionId === "annual-dates" && <div className="settings-add-year flex items-end gap-[var(--ds-space-base)]">
          <Field label="New fiscal year" error={editor.yearError} disabled={editor.locked}><Input value={year} placeholder="FY2027" onChange={event => setYear(event.target.value)} /></Field>
          <Button size="sm" variant="secondary" disabled={editor.locked} onClick={() => editor.addYear(year)}>Add fiscal year</Button>
        </div>}
        {sectionId === "annual-dates" && leaves.length === 0 && <p className={cn(dsText.ui, "text-[color:var(--ds-fg-muted)]")}>No fiscal years saved. Add a year and all three dates.</p>}
        {settingsSectionGroups(sectionId, leaves).map(group => <section key={group.title} className="settings-group">
          <h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-semibold")}>{group.title}</h3>
          <div className="settings-group-rows">
            {group.leaves.map(leaf => {
              const operation = editor.draft[leaf.path];
              const custom = leaf.source === "settings";
              const valueDifferences = differingSettingsValues(leaf);
              return <div key={leaf.path} data-settings-path={leaf.path} className="settings-row">
                <SettingsValueControl leaf={leaf} operation={operation} error={editor.errors[leaf.path]} disabled={editor.locked} update={raw => editor.update(leaf.path, raw)} />
                <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
                  <Badge tone={custom ? "info" : "neutral"}>{custom ? "Saved" : "Using default"}</Badge>
                  {leaf.validity === "unset" && <Badge tone="warning">Not set</Badge>}
                  {operation !== undefined && <Badge tone="attention">{operation.kind === "clear" ? "Clear on save" : "Unsaved"}</Badge>}
                </div>
                {valueDifferences.length > 0 && <dl className="grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)] sm:grid-cols-3">
                  {valueDifferences.map(source => <div key={source.label} className="min-w-0"><dt className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>{source.label}</dt><dd className={cn(dsText.meta, "m-0 break-words [overflow-wrap:anywhere] text-[color:var(--ds-fg)]")}>{formatSetting(source.value)}</dd></div>)}
                </dl>}
                {(custom || operation !== undefined) && <div className="settings-row-actions">
                  {editor.save.state === "conflict" && operation !== undefined && <span className={cn(dsText.meta, "w-full text-[color:var(--ds-fg-muted)]")}>Current value: {formatSetting(leaf.effectiveValue)}</span>}
                  {operation?.kind === "clear" ? <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Standard after save</span> : null}
                  {custom && operation?.kind !== "clear" && <Button size="sm" variant="ghost" title={`Standard value: ${formatSetting(leaf.defaultValue)}`} onClick={() => editor.clear(leaf.path)} disabled={editor.locked}>Restore standard</Button>}
                  {operation !== undefined && <Button size="sm" variant="ghost" onClick={() => editor.reset(leaf.path)} disabled={editor.locked}>{operation.kind === "clear" ? "Undo" : "Reset edit"}</Button>}
                </div>}
                {leaf.hazard !== undefined && <span className={cn(dsText.meta, "settings-row-hazard text-[color:var(--ds-status-waiting-fg)]")}>{leaf.hazard}</span>}
              </div>;
            })}
          </div>
          <details className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
            <summary className="cursor-pointer">Setting identities</summary>
            <dl className="mt-[var(--ds-space-tight)] grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-base)] sm:grid-cols-2">
              {group.leaves.map(leaf => <div key={leaf.path} className="min-w-0"><dt>{leaf.label}</dt><dd className="m-0 break-all"><code className={cn(dsText.micro, dsText.nums)}>{leaf.path}</code></dd></div>)}
            </dl>
          </details>
        </section>)}
        <div className="settings-savebar">
          <div className="w-full"><SettingsSaveFeedback save={editor.save} retry={editor.retry} /></div>
          <span className={cn(dsText.meta, "mr-auto text-[color:var(--ds-fg-muted)]")}>{editor.dirtyCount === 0 ? "All changes saved" : plural(editor.dirtyCount, "unsaved change")}</span>
          <Button size="sm" variant="ghost" onClick={editor.discard} disabled={editor.dirtyCount === 0 || editor.save.state === "saving"}>Discard</Button>
          <Button type="submit" size="sm" variant="primary" disabled={editor.dirtyCount === 0 || Object.values(editor.errors).some(error => error !== undefined) || editor.locked || editor.readProblem !== undefined}>{editor.save.state === "saving" ? "Saving…" : "Save changes"}</Button>
        </div>
      </Form>
      </div>
    </PanelBody>
  </Panel>;
}
