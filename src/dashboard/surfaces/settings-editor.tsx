import { Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Badge, Banner, Button, dsIcon, dsText, Field, Input, Panel, PanelBody, PanelHeader, Spinner } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { plural } from "./format.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { formatSetting } from "./settings-draft-model.js";
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
  const submit = (form: HTMLFormElement): void => {
    const firstError = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (firstError !== null) { firstError.focus(); return; }
    editor.submit();
  };
  return <Panel className="min-h-0 flex-1">
    <PanelHeader title={section.label} headingLevel={2} subtitle={section.description} icon={<SettingsIcon aria-hidden className={dsIcon.lg} />} meta={`Revision ${String(document.revision)}`} />
    <PanelBody className="flex flex-col gap-[var(--ds-space-section)] p-[var(--ds-space-cozy)]">
      <form noValidate className="flex flex-col gap-[var(--ds-space-cozy)]" onSubmit={event => { event.preventDefault(); submit(event.currentTarget); }}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(event.currentTarget); } }}>
        {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
        {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable"><span>{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></span></Banner>}
        {sectionId === "display" && <div className={cn(dsText.meta, "flex flex-wrap items-center gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
          <span>Observed host: {document.host.primaryDisplay === null ? "no primary display reported" : `${String(document.host.primaryDisplay.screenWidth)} × ${String(document.host.primaryDisplay.screenHeight)}`}</span>
          <Button size="sm" variant="secondary" onClick={() => editor.clear("display.screenWidth")} disabled={editor.locked || section.leaves.every(leaf => leaf.settingsValue === undefined)}>Clear override</Button>
        </div>}
        {sectionId === "annual-dates" && <div className="flex items-end gap-[var(--ds-space-base)]">
          <Field label="New fiscal year" error={editor.yearError} disabled={editor.locked}><Input value={year} placeholder="FY2027" onChange={event => setYear(event.target.value)} /></Field>
          <Button size="sm" variant="secondary" disabled={editor.locked} onClick={() => editor.addYear(year)}>Add fiscal year</Button>
        </div>}
        {sectionId === "annual-dates" && leaves.length === 0 && <p className={cn(dsText.ui, "text-[color:var(--ds-fg-muted)]")}>No fiscal years saved. Add a year and all three dates.</p>}
        {leaves.map(leaf => {
          const operation = editor.draft[leaf.path];
          return <div key={leaf.path} data-settings-path={leaf.path} className="flex min-w-0 flex-col gap-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)]">
            <SettingsValueControl leaf={leaf} operation={operation} error={editor.errors[leaf.path]} disabled={editor.locked || operation?.kind === "clear"} update={raw => editor.update(leaf.path, raw)} />
            <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
              <Badge tone={leaf.source === "settings" ? "info" : "neutral"}>{leaf.source === "settings" ? "Saved" : "Default"}</Badge>
              {operation !== undefined && <Badge tone="attention">{operation.kind === "clear" ? "Clear on save" : "Unsaved"}</Badge>}
              <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{leaf.validity === "valid" ? "Valid" : "Unset"} · Ordinary · Editable · {leaf.activationScope === "next-idle" ? "Next idle boundary" : "New runs"}</span>
              <span className={cn(dsText.micro, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>{leaf.path}</span>
              {operation !== undefined && <Button size="sm" variant="ghost" onClick={() => editor.reset(leaf.path)} disabled={editor.locked}>Reset</Button>}
              {!leaf.path.startsWith("display.") && <Button size="sm" variant="ghost" aria-label={`Clear ${leaf.label}`} onClick={() => editor.clear(leaf.path)} disabled={editor.locked || leaf.settingsValue === undefined}>Clear</Button>}
            </div>
            {leaf.hazard !== undefined && <span className={cn(dsText.meta, "text-[color:var(--ds-status-waiting-fg)]")}>{leaf.hazard}</span>}
            <dl className={cn(dsText.meta, "grid min-w-0 grid-cols-3 gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
              {([["Saved", leaf.settingsValue], ["Active", leaf.activeValue], ["Default", leaf.defaultValue]] as const).map(([name, value]) => <div key={name} className="min-w-0"><dt>{name}</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{formatSetting(value)}</dd></div>)}
            </dl>
          </div>;
        })}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-[var(--ds-space-snug)] border-t border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] py-[var(--ds-space-base)]">
          <div className="w-full"><SettingsSaveFeedback save={editor.save} retry={editor.retry} /></div>
          <span className={cn(dsText.meta, "mr-auto text-[color:var(--ds-fg-muted)]")}>{plural(editor.dirtyCount, "unsaved change")}</span>
          <Button size="sm" variant="ghost" onClick={editor.discard} disabled={editor.dirtyCount === 0 || editor.save.state === "saving"}>Discard all</Button>
          <Button type="submit" size="sm" variant="primary" disabled={editor.dirtyCount === 0 || Object.values(editor.errors).some(error => error !== undefined) || editor.locked || editor.readProblem !== undefined}>{editor.save.state === "saving" ? "Saving…" : `Save ${String(editor.dirtyCount)}`}</Button>
        </div>
      </form>
    </PanelBody>
  </Panel>;
}
