import { Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Badge, Banner, Button, Disclosure, dsIcon, dsText, Field, Input, Panel, PanelBody, PanelFooter, PanelHeader, Separator, Spinner } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { plural } from "./format.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { formatSetting } from "./settings-draft-model.js";
import { SettingsValueControl } from "./settings-controls.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { differingSettingsValues, groupSettingsLeaves } from "./ui-settings-records-labels.js";

export function EditableSettingsSection({ editor, sectionId }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string }) {
  const [year, setYear] = useState("");
  if (editor.editor.state === "loading") return <Spinner label="Reading editable settings" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Editable settings could not be read"><Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  const section = document.sections.find(candidate => candidate.id === sectionId);
  if (section === undefined) return <Banner tone="danger" title="Server-listed section is unavailable">The settings document did not include this section.</Banner>;
  const leaves = sectionId === "annual-dates" ? editor.leaves.filter(leaf => leaf.path.startsWith("annualDates.")) : section.leaves;
  const groups = groupSettingsLeaves(sectionId, leaves);
  const hasNextIdleChanges = leaves.some(leaf => leaf.activationScope === "next-idle");
  const hasNewRunChanges = leaves.some(leaf => leaf.activationScope === "new-runs");
  const submit = (form: HTMLFormElement): void => {
    const firstError = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (firstError !== null) { firstError.focus(); return; }
    editor.submit();
  };
  return <Panel className="min-h-0 flex-1">
    <PanelHeader title={section.label} headingLevel={2} icon={<SettingsIcon aria-hidden className={dsIcon.lg} />} meta={`Revision ${String(document.revision)}`} />
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); submit(event.currentTarget); }}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(event.currentTarget); } }}>
      <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
        {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
        {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable"><span>{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></span></Banner>}
        {(hasNewRunChanges || hasNextIdleChanges) && <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          {hasNewRunChanges ? "Saved values apply to new runs." : ""}{hasNewRunChanges && hasNextIdleChanges ? " " : ""}{hasNextIdleChanges ? "Worker limits take effect at the next idle boundary." : ""}
        </p>}
        {sectionId === "display" && <div className={cn(dsText.meta, "flex flex-wrap items-center gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
          <span>Observed host: {document.host.primaryDisplay === null ? "no primary display reported" : `${String(document.host.primaryDisplay.screenWidth)} × ${String(document.host.primaryDisplay.screenHeight)}`}</span>
          <Button size="sm" variant="secondary" onClick={() => editor.clear("display.screenWidth")} disabled={editor.locked || section.leaves.every(leaf => leaf.settingsValue === undefined)}>Clear override</Button>
        </div>}
        {sectionId === "annual-dates" && <div className="flex flex-wrap items-end gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)]">
          <Field label="New fiscal year" error={editor.yearError} disabled={editor.locked}><Input value={year} placeholder="FY2027" onChange={event => setYear(event.target.value)} /></Field>
          <Button size="sm" variant="secondary" disabled={editor.locked} onClick={() => editor.addYear(year)}>Add fiscal year</Button>
        </div>}
        {sectionId === "annual-dates" && leaves.length === 0 && <p className={cn(dsText.ui, "text-[color:var(--ds-fg-muted)]")}>No fiscal years saved. Add a year and all three dates.</p>}
        {groups.map(group => <section key={group.label} aria-label={group.label} className="flex min-w-0 flex-col gap-[var(--ds-space-cozy)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)] last:border-0">
          <h3 className={cn(dsText.ui, "min-w-0 font-semibold text-[color:var(--ds-fg)]")}>{group.label}</h3>
          <Separator />
          <div className={cn("grid min-w-0 grid-cols-1 gap-[var(--ds-space-cozy)] min-[1280px]:grid-cols-2", sectionId === "providers" && group.leaves.some(leaf => leaf.control.input === "object") && "min-[1280px]:grid-cols-1")}>
            {group.leaves.map(leaf => {
              const operation = editor.draft[leaf.path];
              const valueDifferences = differingSettingsValues(leaf);
              const sourceLabel = leaf.source === "settings" ? "Saved" : "Using default";
              return <div key={leaf.path} data-settings-path={leaf.path} className="flex min-w-0 flex-col gap-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)] last:border-0">
                <SettingsValueControl leaf={leaf} operation={operation} error={editor.errors[leaf.path]} disabled={editor.locked || operation?.kind === "clear"} update={raw => editor.update(leaf.path, raw)} />
                <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">
                  <Badge tone={leaf.source === "settings" ? "info" : "neutral"}>{sourceLabel}</Badge>
                  {leaf.validity === "unset" && <Badge tone="warning">Not set</Badge>}
                  {operation !== undefined && <Badge tone="attention">{operation.kind === "clear" ? "Clear on save" : "Unsaved"}</Badge>}
                  {operation !== undefined && <Button size="sm" variant="ghost" onClick={() => editor.reset(leaf.path)} disabled={editor.locked}>Reset</Button>}
                  {!leaf.path.startsWith("display.") && <Button size="sm" variant="ghost" aria-label={`Clear ${leaf.label}`} onClick={() => editor.clear(leaf.path)} disabled={editor.locked || leaf.settingsValue === undefined}>Clear</Button>}
                </div>
                {valueDifferences.length > 0 && <dl className="grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)] sm:grid-cols-3">
                  {valueDifferences.map(source => <div key={source.label} className="min-w-0"><dt className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>{source.label}</dt><dd className={cn(dsText.meta, "m-0 break-words [overflow-wrap:anywhere] text-[color:var(--ds-fg)]")}>{formatSetting(source.value)}</dd></div>)}
                </dl>}
                {leaf.hazard !== undefined && <p className={cn(dsText.meta, "text-[color:var(--ds-status-waiting-fg)]")}>{leaf.hazard}</p>}
                {!leaf.path.startsWith("display.") && <Disclosure className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")} summary="Setting identity">
                  <code className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-tight)] block break-all")}>{leaf.path}</code>
                </Disclosure>}
              </div>;
            })}
          </div>
          {group.leaves.some(leaf => leaf.path.startsWith("display.")) && <Disclosure className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")} summary="Setting identities">
            <dl className="mt-[var(--ds-space-tight)] grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-base)] sm:grid-cols-2">
              {group.leaves.map(leaf => <div key={leaf.path} className="min-w-0"><dt>{leaf.label}</dt><dd className="m-0 break-all"><code className={cn(dsText.micro, dsText.nums)}>{leaf.path}</code></dd></div>)}
            </dl>
          </Disclosure>}
        </section>)}
        <div aria-hidden="true" className="h-[var(--ds-space-section)] shrink-0" />
      </PanelBody>
      <PanelFooter className="flex-wrap gap-[var(--ds-space-snug)]">
        <div className="w-full"><SettingsSaveFeedback save={editor.save} retry={editor.retry} /></div>
        <span className={cn(dsText.meta, "mr-auto text-[color:var(--ds-fg-muted)]")}>{editor.dirtyCount === 0 ? "No unsaved changes" : plural(editor.dirtyCount, "unsaved change")}</span>
        <Button size="sm" variant="ghost" onClick={editor.discard} disabled={editor.dirtyCount === 0 || editor.save.state === "saving"}>Discard all</Button>
        <Button type="submit" size="sm" variant="primary" disabled={editor.dirtyCount === 0 || Object.values(editor.errors).some(error => error !== undefined) || editor.locked || editor.readProblem !== undefined}>{editor.save.state === "saving" ? "Saving…" : `Save ${String(editor.dirtyCount)}`}</Button>
      </PanelFooter>
    </form>
  </Panel>;
}
