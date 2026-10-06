import { SettingsSectionSkeleton } from "../settings-loading.js";
import type { ReactNode } from "react";
import { Form } from "@heroui/react";
import type { EditableSettingsLeafWire } from "../../../../domain/dashboard/settings-editor.js";
import { Banner, BodySection, Button, DateInput, Field, FormGroup, Input, PageHeading, ResultRow, Switch, UnitField, dsText } from "../../../ds/ui.js";
import { formatSetting, settingInput, type SettingsDraftOperation } from "../editor/settings-draft-model.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { SettingsSaveFeedback } from "../editor/settings-feedback.js";
import { settingNote, settingTitle } from "../settings-presentation.js";
import { SettingsRowActions } from "../editor/ui-settings-records-row-actions.js";
import { StorageRelocationRows } from "./settings-relocation.js";
import { SettingsPathPicker } from "./settings-path-picker.js";
import type { NativePathField } from "../../../../domain/dashboard/native-path-picker.js";

type Editor = ReturnType<typeof useEditableSettings>;

function servedLeaf(editor: Editor, path: string): EditableSettingsLeafWire {
  const leaf = editor.leaves.find(candidate => candidate.path === path);
  if (leaf === undefined) throw new Error(`settings-required-leaf-missing:${path}`);
  return leaf;
}

function rawValue(leaf: EditableSettingsLeafWire, operation: SettingsDraftOperation | undefined): string {
  const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf, operation?.kind === "clear" ? leaf.defaultValue ?? "" : leaf.effectiveValue);
  if (typeof raw !== "string") throw new Error(`settings-scalar-draft-invalid:${leaf.path}`);
  return raw;
}

function ScalarRow({ editor, leaf, wide = false }: { editor: Editor; leaf: EditableSettingsLeafWire; wide?: boolean }) {
  const raw = rawValue(leaf, editor.draft[leaf.path]);
  const error = editor.errors[leaf.path];
  const title = settingTitle(leaf);
  const description = settingNote(leaf);
  if (leaf.input === "boolean") return <div data-settings-path={leaf.path} className="settings-compact-row">
    <Switch label={title} description={description} checked={raw === "true"} disabled={editor.locked} onCheckedChange={value => editor.update(leaf.path, String(value))} />
    {editor.save.state === "conflict" && editor.draft[leaf.path] !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
  </div>;
  return <div data-settings-path={leaf.path} className="settings-compact-row">
    <Field orientation="horizontal" controlWidth={wide ? "wide" : "standard"} label={title} description={description} error={error} required={leaf.input === "date"} disabled={editor.locked}>
      <div className="settings-compact-control">{leaf.input === "date"
        ? <DateInput label={title} value={raw} onChange={value => editor.update(leaf.path, value)} valueFormat="us" hideLabel required disabled={editor.locked} />
        : <Input type="text" value={raw} disabled={editor.locked} onChange={event => editor.update(leaf.path, event.target.value)} />}
      <SettingsRowActions editor={editor} leaf={leaf} textEntry /></div>
    </Field>
    {editor.save.state === "conflict" && editor.draft[leaf.path] !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
  </div>;
}

function PathRow({ editor, field }: { editor: Editor; field: NativePathField }) {
  const leaf = servedLeaf(editor, field);
  const raw = rawValue(leaf, editor.draft[field]);
  const title = settingTitle(leaf);
  return <div data-settings-path={field} className="settings-compact-row">
    <Field orientation="horizontal" controlWidth="wide" label={title} description={settingNote(leaf)} error={editor.errors[field]} disabled={editor.locked}>
      <div className="settings-compact-control">
        <SettingsPathPicker field={field} label={title} value={raw} disabled={editor.locked} onSelected={path => editor.update(field, path)} />
      </div>
    </Field>
    {editor.save.state === "conflict" && editor.draft[field] !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
  </div>;
}

function GeneralContent({ editor, year }: { editor: Editor; year: number }) {
  const date = servedLeaf(editor, `annualDates.FY${String(year)}.jobEndDate`);
  const width = servedLeaf(editor, "display.screenWidth");
  const height = servedLeaf(editor, "display.screenHeight");
  return <>
    <BodySection title="Employment"><FormGroup label="Employment"><ScalarRow editor={editor} leaf={date} /></FormGroup></BodySection>
    <BodySection title="Browser"><FormGroup label="Browser">
      {(["browser.headless", "features.debugScreenshots", "features.duoWebAuthn"] as const).map(path => <ScalarRow key={path} editor={editor} leaf={servedLeaf(editor, path)} />)}
    </FormGroup></BodySection>
    <BodySection title="Display"><FormGroup label="Display"><div data-settings-path="display.viewport" className="settings-viewport-row">
      <ResultRow controlWidth="wide" label="Browser viewport" description="Width and height used for browser sessions." value={<div className="settings-compact-control"><div className="settings-viewport-pair">
          {([width, height] as const).map(leaf => <label key={leaf.path} htmlFor={`settings-${leaf.path}`} data-settings-path={leaf.path} className="settings-viewport-control">
            <span>{settingTitle(leaf)}</span>
            <UnitField id={`settings-${leaf.path}`} bodyWidth="stretch" type="number" min={leaf.minimum} step={1} unit="px" aria-label={`Browser viewport ${settingTitle(leaf).toLowerCase()}`} aria-describedby={editor.errors[width.path] !== undefined || editor.errors[height.path] !== undefined ? "settings-viewport-error" : undefined} value={rawValue(leaf, editor.draft[leaf.path])} disabled={editor.locked} aria-invalid={editor.errors[leaf.path] !== undefined || undefined} onChange={event => editor.update(leaf.path, event.target.value)} />
          </label>)}
        </div><SettingsRowActions editor={editor} leaf={width} companion={height} textEntry /></div>} />
      {(editor.errors[width.path] ?? editor.errors[height.path]) !== undefined && <p id="settings-viewport-error" role="alert" className="settings-viewport-error">{editor.errors[width.path] ?? editor.errors[height.path]}</p>}
      {editor.save.state === "conflict" && (editor.draft[width.path] !== undefined || editor.draft[height.path] !== undefined) && <p className={dsText.meta}>Current value: {formatSetting(width.effectiveValue)} × {formatSetting(height.effectiveValue)} px</p>}
    </div></FormGroup></BodySection>
  </>;
}

function PathsContent({ editor }: { editor: Editor }) {
  return <>
    <BodySection title="Runtime locations"><FormGroup label="Runtime locations">
      <StorageRelocationRows editor={editor.relocationEditor} />
      <PathRow editor={editor} field="paths.browserProfileRoot" />
      <PathRow editor={editor} field="paths.duoCredential" />
      <PathRow editor={editor} field="paths.duoExtensionDir" />
    </FormGroup></BodySection>
    <BodySection title="Generated files"><FormGroup label="Generated files">
      {(["paths.reportsDir", "paths.downloadsDir"] as const).map(path => <PathRow key={path} editor={editor} field={path} />)}
    </FormGroup></BodySection>
    <BodySection title="Workflow documents"><FormGroup label="Workflow documents">
      {(["paths.onboardingDocsDir", "paths.i9CheckTrackerPath"] as const).map(path => <PathRow key={path} editor={editor} field={path} />)}
    </FormGroup></BodySection>
  </>;
}

export function CompactSettingsSection({ editor, sectionId, appearance }: { editor: Editor; sectionId: "general" | "paths"; appearance?: ReactNode }) {
  return <section className="settings-compact-page">
    <PageHeading title={sectionId === "general" ? "General" : "Paths"} description={sectionId === "general" ? "Appearance, browser behavior, display, and job end date." : "Workflow files and runtime locations."} />
    {sectionId === "general" && appearance}
    {editor.editor.state === "loading" ? <SettingsSectionSkeleton section={sectionId} contentOnly /> : editor.editor.state === "failed" ? <Banner tone="danger" title="Editable settings could not be read"><Button size="sm" onClick={editor.reload}>Try again</Button></Banner> : <CompactSettingsForm editor={editor} sectionId={sectionId} />}
  </section>;
}

function CompactSettingsForm({ editor, sectionId }: { editor: Editor; sectionId: "general" | "paths" }) {
  if (editor.editor.state !== "loaded") throw new Error("settings-form-document-unavailable");
  const document = editor.editor.document;
  return <Form validationBehavior="aria" className="settings-compact-form" onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
      {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></Banner>}
      <SettingsSaveFeedback save={editor.save} dirty={editor.dirtyCount > 0} restartRequired={editor.editor.state === "loaded" && editor.editor.document.runtimeStatus.state === "restart-required"} retry={editor.retry} retryConflict={editor.submit} />
      <div className="ds-body-stack">{sectionId === "general" ? <GeneralContent editor={editor} year={document.currentFiscalYear} /> : <PathsContent editor={editor} />}</div>
    </Form>;
}
