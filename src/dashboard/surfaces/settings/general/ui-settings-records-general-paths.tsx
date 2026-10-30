import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { HubPermissionSettings, HubBrowserWindowSettings } from "./hub-preferences.js";
import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../../shared/loading/loading.js";
import { SettingsSectionSkeleton } from "../settings-loading.js";
import { useRef, useState, type ReactNode } from "react";
import type { DeleteAccountPresentation } from "./delete-account-model.js";
import { Form } from "@heroui/react";
import type { EditableSettingsLeafWire } from "../../../../models/dashboard/settings-editor.js";
import { Banner, BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, DateInput, Field, FormGroup, Input, PageHeading, Switch, dsText } from "../../../ds/ui.js";
import { formatSetting, settingInput, type SettingsDraftOperation } from "../editor/settings-draft-model.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { SettingsSaveFeedback } from "../editor/settings-feedback.js";
import { settingNote, settingTitle, settingPlaceholderCopy } from "../settings-presentation.js";
import { FixedStorageRows } from "./settings-relocation.js";
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
    <FixedStorageRows editor={editor.relocationEditor}>
      {paths(["paths.browserProfileRoot", "paths.duoCredential", "paths.duoExtensionDir"])}
    </FixedStorageRows>
    <BodySection title="Generated files"><FormGroup label="Generated files">
      {paths(["paths.reportsDir", "paths.downloadsDir"])}
    </FormGroup></BodySection>
    <BodySection title="Workflow documents"><FormGroup label="Workflow documents">
      {paths(["paths.onboardingDocsDir", "paths.i9CheckTrackerPath"])}
    </FormGroup></BodySection>
  </>;
}

export function CompactSettingsSection({ editor, sectionId, appearance }: { editor: Editor; sectionId: "general" | "paths"; appearance?: ReactNode }) {
  return <section className="settings-compact-page">
    <PageHeading title={sectionId === "general" ? "General" : "Paths"} description={sectionId === "general" ? "ChatGPT account, appearance, and browser preferences." : "Workflow files and runtime locations."} />
    {sectionId === "general" && <ChatGptAccountSettings />}
    {sectionId === "general" && appearance}
    {sectionId === "general" && <HubPermissionSettings />}
    {sectionId === "general" && <DeleteAccountControl presentation={{ state: "unavailable" }} />}
    {editor.editor.state === "failed" && <Banner tone="danger" title="Editable settings could not be read">{editor.editor.message} <Button size="sm" onClick={editor.reload}>Try again</Button></Banner>}
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
  return <BodySection title="Account">
    <p>Delete the signed-in person’s data, history, evidence, settings, and encrypted credentials from this device. This cannot be undone.</p>
    {presentation.state === "unavailable" && <p>Account deletion is unavailable until Relay can verify the signed-in person and resource closure.</p>}
    {presentation.state === "blocked" && <Banner tone="warning" title="Account deletion blocked">{presentation.reason === "unresolved-write"
      ? `PARKED_CHECK_UNKNOWN: ${ERROR_CATALOG.PARKED_CHECK_UNKNOWN.text} Resolve the unknown submission in Logs before deleting this account. No data or credentials have been erased.`
      : `BROWSER_CLOSURE_UNPROVED: ${ERROR_CATALOG.BROWSER_CLOSURE_UNPROVED.text}`}</Banner>}
    {deleting && <Banner tone="info" title="Deleting account">Waiting for owned resources to close and erasure to settle. Deletion is not complete.</Banner>}
    <Button ref={trigger} variant="danger" disabled={presentation.state !== "ready"} onClick={() => setConfirming(true)}>{deleting ? "Deleting…" : "Delete account"}</Button>
    <Dialog open={confirming && presentation.state === "ready"} onOpenChange={setConfirming}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} title="Delete account?" description={presentation.state === "unavailable" ? "" : `Permanently erase ${presentation.personName}’s Relay account from this device.`} size="sm">
        <DialogBody><p>All data, history, evidence, settings, and encrypted credentials for this person will be erased. Other people’s accounts are unaffected.</p><p>This does not remove devices enrolled on the Duo website.</p></DialogBody>
        <DialogFooter><Button variant="muted" autoFocus onClick={() => setConfirming(false)}>Keep account</Button><Button variant="danger" onClick={() => { if (presentation.state === "ready") { setConfirming(false); presentation.onConfirm(); } }}>Delete account permanently</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </BodySection>;
}
