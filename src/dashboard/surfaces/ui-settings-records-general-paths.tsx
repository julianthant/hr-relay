import { Form } from "@heroui/react";
import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";
import { Banner, BodySection, Button, DateInput, Field, FormGroup, Input, PageHeading, ResultRow, Spinner, Switch, UnitField, dsText } from "../ds/ui.js";
import { formatSetting, settingInput, type SettingsDraftOperation } from "./settings-draft-model.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { settingNote, settingTitle } from "./settings-presentation.js";
import { SettingsRowActions } from "./ui-settings-records-row-actions.js";

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
    <SettingsRowActions editor={editor} leaf={leaf} />
    {editor.save.state === "conflict" && editor.draft[leaf.path] !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
  </div>;
  return <div data-settings-path={leaf.path} className="settings-compact-row">
    <Field orientation="horizontal" controlWidth={wide ? "wide" : "standard"} label={title} description={description} error={error} required={leaf.input === "date"} disabled={editor.locked}>
      <div className="settings-compact-control">{leaf.input === "date"
        ? <DateInput label={title} value={raw} onChange={value => editor.update(leaf.path, value)} textEntry required disabled={editor.locked} />
        : <Input type="text" value={raw} disabled={editor.locked} onChange={event => editor.update(leaf.path, event.target.value)} />}
      <SettingsRowActions editor={editor} leaf={leaf} /></div>
    </Field>
    {editor.save.state === "conflict" && editor.draft[leaf.path] !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
  </div>;
}

function RuntimeRow({ label, description, value }: { label: string; description: string; value: unknown }) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`settings-runtime-location-unavailable:${label}`);
  return <ResultRow label={label} description={description} controlWidth="wide" className="settings-runtime-row" value={<Input aria-label={label} value={value} readOnly />} />;
}

function GeneralContent({ editor, year }: { editor: Editor; year: number }) {
  const date = servedLeaf(editor, `annualDates.FY${String(year)}.jobEndDate`);
  const width = servedLeaf(editor, "display.screenWidth");
  const height = servedLeaf(editor, "display.screenHeight");
  return <>
    <BodySection title="Employment"><FormGroup label="Employment"><ScalarRow editor={editor} leaf={date} /></FormGroup></BodySection>
    <BodySection title="Operator"><FormGroup label="Operator"><ScalarRow editor={editor} leaf={servedLeaf(editor, "actor.label")} /></FormGroup></BodySection>
    <BodySection title="Browser"><FormGroup label="Browser">
      {(["browser.headless", "features.debugScreenshots", "features.duoWebAuthn"] as const).map(path => <ScalarRow key={path} editor={editor} leaf={servedLeaf(editor, path)} />)}
    </FormGroup></BodySection>
    <BodySection title="Display"><FormGroup label="Display"><div data-settings-path="display.viewport" className="settings-viewport-row">
      <ResultRow controlWidth="wide" label="Browser viewport" description="Width and height used for browser sessions." value={<div className="settings-compact-control"><div className="settings-viewport-pair">
          {([width, height] as const).map(leaf => <label key={leaf.path} htmlFor={`settings-${leaf.path}`} data-settings-path={leaf.path} className="settings-viewport-control">
            <span>{settingTitle(leaf)}</span>
            <UnitField id={`settings-${leaf.path}`} bodyWidth="stretch" type="number" min={leaf.minimum} step={1} unit="px" aria-label={`Browser viewport ${settingTitle(leaf).toLowerCase()}`} aria-describedby={editor.errors[width.path] !== undefined || editor.errors[height.path] !== undefined ? "settings-viewport-error" : undefined} value={rawValue(leaf, editor.draft[leaf.path])} disabled={editor.locked} aria-invalid={editor.errors[leaf.path] !== undefined || undefined} onChange={event => editor.update(leaf.path, event.target.value)} />
          </label>)}
        </div><SettingsRowActions editor={editor} leaf={width} companion={height} /></div>} />
      {(editor.errors[width.path] ?? editor.errors[height.path]) !== undefined && <p id="settings-viewport-error" role="alert" className="settings-viewport-error">{editor.errors[width.path] ?? editor.errors[height.path]}</p>}
      {editor.save.state === "conflict" && (editor.draft[width.path] !== undefined || editor.draft[height.path] !== undefined) && <p className={dsText.meta}>Current value: {formatSetting(width.effectiveValue)} × {formatSetting(height.effectiveValue)} px</p>}
    </div></FormGroup></BodySection>
  </>;
}

function PathsContent({ editor, deployment }: { editor: Editor; deployment: Readonly<Record<string, unknown>> }) {
  return <>
    <BodySection title="Runtime locations"><FormGroup label="Runtime locations">
      <RuntimeRow label="Runtime state folder" description="Persistent settings and run data." value={deployment["paths.stateRoot"]} />
      <RuntimeRow label="Artifact folder" description="Run evidence and generated artifacts." value={deployment["paths.artifactRoot"]} />
      <ScalarRow editor={editor} leaf={servedLeaf(editor, "paths.browserProfileRoot")} wide />
      <ScalarRow editor={editor} leaf={servedLeaf(editor, "paths.duoCredential")} wide />
      <ScalarRow editor={editor} leaf={servedLeaf(editor, "paths.duoExtensionDir")} wide />
    </FormGroup></BodySection>
    <BodySection title="Generated files"><FormGroup label="Generated files">
      {(["paths.reportsDir", "paths.downloadsDir"] as const).map(path => <ScalarRow key={path} editor={editor} leaf={servedLeaf(editor, path)} wide />)}
    </FormGroup></BodySection>
    <BodySection title="Workflow documents"><FormGroup label="Workflow documents">
      {(["paths.onboardingDocsDir", "paths.i9CheckTrackerPath"] as const).map(path => <ScalarRow key={path} editor={editor} leaf={servedLeaf(editor, path)} wide />)}
    </FormGroup></BodySection>
  </>;
}

export function CompactSettingsSection({ editor, sectionId }: { editor: Editor; sectionId: "general" | "paths" }) {
  if (editor.editor.state === "loading") return <Spinner label="Reading editable settings" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Editable settings could not be read"><Button size="sm" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  return <section className="settings-compact-page">
    <PageHeading title={sectionId === "general" ? "General" : "Paths"} description={sectionId === "general" ? "Operator identity, browser behavior, display, and job end date." : "Workflow files and runtime locations."} />
    <Form validationBehavior="aria" className="settings-compact-form" onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
      {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></Banner>}
      <SettingsSaveFeedback save={editor.save} retry={editor.retry} retryConflict={editor.submit} />
      <div className="ds-body-stack">{sectionId === "general" ? <GeneralContent editor={editor} year={document.currentFiscalYear} /> : <PathsContent editor={editor} deployment={document.deployment} />}</div>
    </Form>
  </section>;
}
