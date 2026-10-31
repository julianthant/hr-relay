import { HubPermissionSettings, HubBrowserWindowSettings } from "./hub-preferences.js";
import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../../shared/loading/loading.js";
import { SettingsSectionSkeleton } from "../settings-loading.js";
import { useRef, useState, type ReactNode } from "react";
import type { DeleteAccountPresentation } from "./delete-account-model.js";
import { Form } from "@heroui/react";
import type { EditableSettingsLeafWire } from "../../../../models/dashboard/settings-editor.js";
import { Banner, BodySection, Button, Dialog, DialogContent, DialogFooter, DateInput, Field, FormGroup, Input, PageHeading, Switch, dsText } from "../../../ds/ui.js";
import { formatSetting, settingInput, type SettingsDraftOperation } from "../editor/settings-draft-model.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { SettingsSaveFeedback } from "../editor/settings-feedback.js";
import { settingNote, settingTitle, settingPlaceholderCopy } from "../settings-presentation.js";
import { BackupRestoreControls, FixedStorageRows } from "./settings-relocation.js";
import { SettingsPathPicker } from "./settings-path-picker.js";
import type { NativePathField } from "../../../../models/dashboard/native-path-picker.js";
import { ChatGptAccountSettings } from "./chatgpt-account.js";
import { useSettingsFormFocus } from "../editor/settings-autosave-model.js";

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
    <Switch name={leaf.path} label={title} description={description} checked={raw === "true"} disabled={editor.locked} onCheckedChange={value => editor.update(leaf.path, String(value))} />
    {editor.save.state === "conflict" && editor.draft[leaf.path] !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
  </div>;
  return <div data-settings-path={leaf.path} className="settings-compact-row" onKeyDown={event => {
    if (leaf.input !== "date" || editor.draft[leaf.path] === undefined || event.defaultPrevented || event.repeat
      || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z"
      || (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))) return;
    event.preventDefault(); editor.reset(leaf.path);
  }}>
    <Field orientation="horizontal" controlWidth={wide ? "wide" : "standard"} label={title} description={description} error={error} required={leaf.input === "date"} disabled={editor.locked}>
      <div className="settings-compact-control">{leaf.input === "date"
        ? <DateInput name={leaf.path} label={title} value={raw} onChange={value => editor.update(leaf.path, value)} valueFormat="us" hideLabel required disabled={editor.locked} />
        : <Input type="text" name={leaf.path} autoComplete="off" value={raw} disabled={editor.locked} onChange={event => editor.update(leaf.path, event.target.value)} />}
      </div>
    </Field>
    {editor.save.state === "conflict" && editor.draft[leaf.path] !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
  </div>;
}

function PathRow({ editor, field }: { editor: Editor; field: NativePathField }) {
  const leaf = servedLeaf(editor, field);
  const raw = rawValue(leaf, editor.draft[field]);
  const title = settingTitle(leaf);
  return <div data-settings-path={field} className="settings-compact-row" onKeyDown={event => {
    if (editor.draft[field] === undefined || event.defaultPrevented || event.repeat || event.altKey || event.shiftKey
      || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z"
      || (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))) return;
    event.preventDefault(); editor.reset(field);
  }}>
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
  return <>
    <BodySection title="Employment"><FormGroup label="Employment"><ScalarRow editor={editor} leaf={date} /></FormGroup></BodySection>
    <BodySection title="Browser"><FormGroup label="Browser">
      <ScalarRow editor={editor} leaf={servedLeaf(editor, "browser.headless")} />
      <HubBrowserWindowSettings binding={{ width: rawValue(servedLeaf(editor, "display.screenWidth"), editor.draft["display.screenWidth"]), height: rawValue(servedLeaf(editor, "display.screenHeight"), editor.draft["display.screenHeight"]), disabled: editor.locked, error: [editor.errors["display.screenWidth"], editor.errors["display.screenHeight"]].filter(Boolean).join(" · ") || undefined, onChange: (path, value) => editor.update(path, value) }} />
    </FormGroup></BodySection>

  </>;
}

function PathsContent({ editor }: { editor: Editor }) {
  const loaded = editor.editor.state === "loaded";
  const show = useDelayedLoading(editor.editor.state === "loading");
  const paths = (fields: readonly NativePathField[]) => loaded
    ? fields.map(field => <PathRow key={field} editor={editor} field={field} />)
    : show ? <LoadingRegion label="Loading workflow paths" className="[&>*+*]:border-t [&>*+*]:border-ui-stroke"><SettingsRowsSkeleton rows={fields.length} wide copy={fields.map(settingPlaceholderCopy)} /></LoadingRegion> : null;
  return <>
    <BodySection title="Folders"><FormGroup label="Folders">{editor.editor.state === "failed" ? <div className="hub-settings-row"><div><div className="hub-row-label">Couldn’t load your folders</div><span className="hub-row-note">Your saved folders are unchanged.</span></div><Button variant="secondary" onClick={editor.reload}>Try again</Button></div> : paths(["paths.onboardingDocsDir", "paths.downloadsDir", "paths.reportsDir"])}</FormGroup></BodySection>
    <FixedStorageRows editor={editor.relocationEditor} />
    <BodySection title="Backup and restore"><BackupRestoreControls state="unavailable" /></BodySection>
    {(loaded || editor.editor.state === "loading") && <BodySection title="Workflow locations"><FormGroup label="Workflow locations">{paths(["paths.browserProfileRoot", "paths.duoCredential", "paths.duoExtensionDir", "paths.i9CheckTrackerPath"])}</FormGroup></BodySection>}
  </>;
}

export function CompactSettingsSection({ editor, sectionId, appearance }: { editor: Editor; sectionId: "general" | "paths"; appearance?: ReactNode }) {
  return <section className="settings-compact-page">
    <PageHeading title={sectionId === "general" ? "General" : "Paths"} description={sectionId === "general" ? "ChatGPT account, appearance, and account controls." : "Where Relay saves files on this Mac."} />
    {sectionId === "general" && <ChatGptAccountSettings />}
    {sectionId === "general" && appearance}
    {sectionId === "general" && <HubPermissionSettings />}
    {sectionId === "general" && <DeleteAccountControl presentation={{ state: "unavailable" }} />}
    {editor.editor.state === "failed" && sectionId !== "paths" && <Banner tone="danger" title="Editable settings could not be read">{editor.editor.message} <Button size="sm" onClick={editor.reload}>Try again</Button></Banner>}
    {editor.editor.state === "loaded" ? <CompactSettingsForm editor={editor} sectionId={sectionId} />
      : sectionId === "paths" ? <div className="settings-compact-form"><div className="ds-body-stack"><PathsContent editor={editor} /></div></div>
      : editor.editor.state === "loading" && <SettingsSectionSkeleton section={sectionId} contentOnly />}
  </section>;
}

function CompactSettingsForm({ editor, sectionId }: { editor: Editor; sectionId: "general" | "paths" }) {
  const settingsFocus = useSettingsFormFocus<HTMLFormElement>(editor.locked || editor.protectedEditor.locked, editor.onFieldBlur);
  if (editor.editor.state !== "loaded") throw new Error("settings-form-document-unavailable");
  const document = editor.editor.document;
  return <Form validationBehavior="aria" className="settings-compact-form" ref={settingsFocus} onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
      {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></Banner>}
      <SettingsSaveFeedback save={editor.save} restartRequired={editor.editor.state === "loaded" && editor.editor.document.runtimeStatus.state === "restart-required"} retry={editor.retry} retryConflict={editor.submit} />
      <div className="ds-body-stack">{sectionId === "general" ? <GeneralContent editor={editor} year={document.currentFiscalYear} /> : <PathsContent editor={editor} />}</div>
    </Form>;
}

export function DeleteAccountControl({ presentation }: { presentation: DeleteAccountPresentation }) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const deleting = presentation.state === "deleting";
  return <BodySection title="Account"><FormGroup label="Account">
    <div className="hub-settings-row">
      <div><div className="hub-row-label">Delete account</div><span className="hub-row-note" role={deleting ? "status" : undefined}>{deleting ? "Deleting your account; erasure is not complete." : presentation.state === "unavailable" ? "Account deletion is unavailable. Try again when connected." : "Remove your data and credentials from this Mac."}</span></div>
      <div className="hub-setting-control"><Button ref={trigger} variant="dangerGhost" disabled={presentation.state !== "ready"} onClick={() => setConfirming(true)}>{deleting ? "Deleting…" : "Delete account"}</Button></div>
    </div>
    <Dialog open={confirming && presentation.state === "ready"} onOpenChange={setConfirming}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} title={presentation.state === "unavailable" ? "Delete account?" : `Delete ${presentation.personName}’s account?`} description="Your runs, history, settings, and credentials will be erased from this Mac. This can’t be undone." size="sm">
        <DialogFooter><Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>Cancel</Button><Button variant="danger" onClick={() => { if (presentation.state === "ready") { setConfirming(false); presentation.onConfirm(); } }}>Delete account</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </FormGroup></BodySection>;
}
