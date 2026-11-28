import { Form } from "@heroui/react";
import { SavingMark } from "../editor/settings-controls.js";
import { useRef,useState,type ReactNode } from "react";
import type { NativePathField } from "../../../../models/dashboard/native-path-picker.js";
import type { EditableSettingsLeafWire } from "../../../../models/dashboard/settings-editor.js";
import {BodySection,Button,DateInput,Dialog,DialogContent,DialogFooter,Field,FormGroup,Input,PageHeading,Select,Switch, Notice, ResultRow, FailureNotice } from "../../../ds/ui.js";
import { useSettingsFormFocus } from "../editor/settings-autosave-model.js";
import { settingInput,type SettingsDraftOperation } from "../editor/settings-draft-model.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { settingTitle } from "../settings-presentation.js";
import { SettingsSectionSkeleton } from "../settings-loading.js";
import type { DeleteAccountPresentation } from "./delete-account-model.js";
import { SettingsPathPicker } from "./settings-path-picker.js";
import { AssistantSettings } from "./hub-preferences.js";
import { GENERAL_RUN_GROUPS,type GeneralChoice } from "./general-groups-model.js";

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

function ScalarRow({ editor, leaf, wide = false, note }: { editor: Editor; leaf: EditableSettingsLeafWire; wide?: boolean; note?: string | null }) {
  const raw = rawValue(leaf, editor.draft[leaf.path]);
  const error = editor.errors[leaf.path];
  const title = settingTitle(leaf);
  const description = note ?? undefined;
  if (leaf.input === "boolean") return <div data-settings-path={leaf.path} className="settings-compact-row">
    <Switch name={leaf.path} label={title} description={description} checked={raw === "true"} disabled={editor.locked} onCheckedChange={value => editor.update(leaf.path, String(value), true)} /><SavingMark editor={editor} path={leaf.path} />
  </div>;
  return <div data-settings-path={leaf.path} className="settings-compact-row" onKeyDown={event => {
    if (leaf.input !== "date" || editor.draft[leaf.path] === undefined || event.defaultPrevented || event.repeat
      || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z"
      || (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))) return;
    event.preventDefault(); editor.reset(leaf.path);
  }}>
    <Field orientation="horizontal" controlWidth={wide ? "wide" : "standard"} label={title} description={description} error={error} disabled={editor.locked}>
      <div className="settings-compact-control">{leaf.input === "date"
        ? <DateInput name={leaf.path} label={title} value={raw} onChange={value => editor.update(leaf.path, value)} valueFormat="us" hideLabel disabled={editor.locked} />
        : <Input type="text" name={leaf.path} autoComplete="off" value={raw} disabled={editor.locked} onChange={event => editor.update(leaf.path, event.target.value)} />}
      </div>
    </Field>
    <SavingMark editor={editor} path={leaf.path} />
  </div>;
}

function ChoiceRow({ editor, leaf, choices, note }: { editor: Editor; leaf: EditableSettingsLeafWire; choices: readonly GeneralChoice[]; note?: string | null }) {
  const raw = rawValue(leaf, editor.draft[leaf.path]);
  const title = settingTitle(leaf);
  return <div data-settings-path={leaf.path} className="settings-compact-row">
    <ResultRow label={title} description={note ?? undefined} value={<Select aria-label={title} value={raw} disabled={editor.locked} onChange={event => editor.update(leaf.path, event.target.value, true)}>
      {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </Select>} />
    <SavingMark editor={editor} path={leaf.path} />
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
    <Field orientation="horizontal" controlWidth="wide" label={title} error={editor.errors[field]} disabled={editor.locked}>
      <div className="settings-compact-control">
        <SettingsPathPicker field={field} label={title} value={raw} disabled={editor.locked} onSelected={path => editor.update(field, path)} />
      </div>
    </Field>
    <SavingMark editor={editor} path={field} />
  </div>;
}

function GeneralContent({ editor, year, appearance }: { editor: Editor; year: number; appearance?: ReactNode }) {
  const date = servedLeaf(editor, `annualDates.FY${String(year)}.jobEndDate`);
  return <BodySection title="App" description="Download folder, employment end date, and appearance."><FormGroup label="App">
    <PathRow editor={editor} field="paths.downloadsDir" />
    <ScalarRow editor={editor} leaf={date} />
    {appearance}
  </FormGroup></BodySection>;
}

function RunGroups({ editor }: { editor: Editor }) {
  return <>{GENERAL_RUN_GROUPS.map(group => <BodySection key={group.title} title={group.title} description={group.description}><FormGroup label={group.title}>
    {group.rows.map(row => { const leaf = servedLeaf(editor, row.path); return row.choices === undefined
      ? <ScalarRow key={row.path} editor={editor} leaf={leaf} note={row.note} /> : <ChoiceRow key={row.path} editor={editor} leaf={leaf} choices={row.choices} note={row.note} />; })}
  </FormGroup></BodySection>)}</>;
}

export function CompactSettingsSection({ editor, appearance }: { editor: Editor; appearance?: ReactNode }) {
  return <section className="settings-compact-page">
    <PageHeading title="General" description="Assistant, app, run, and notification preferences." />
    <AssistantSettings />
    {editor.editor.state === "failed" && <FailureNotice sentence="Settings unavailable; reopen Settings to try again." />}
    {editor.editor.state === "loaded" ? <CompactSettingsForm editor={editor} appearance={appearance} />
      : editor.editor.state === "loading" && <SettingsSectionSkeleton section="general" contentOnly />}
  </section>;
}

function CompactSettingsForm({ editor, appearance }: { editor: Editor; appearance?: ReactNode }) {
  const settingsFocus = useSettingsFormFocus<HTMLFormElement>(editor.locked || editor.protectedEditor.locked, editor.onFieldBlur);
  if (editor.editor.state !== "loaded") throw new Error("settings-form-document-unavailable");
  const document = editor.editor.document;
  return <Form validationBehavior="aria" className="settings-compact-form" ref={settingsFocus} onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Notice sticky tone="warning" title="Restart required" description="Saved settings apply after Relay restarts." />}
      {editor.readProblem !== undefined && <Notice sticky tone="warning" title="Current settings unavailable" description="Reopen Settings to refresh." />}
      <div className="ds-body-stack"><GeneralContent editor={editor} year={document.currentFiscalYear} appearance={appearance} /><RunGroups editor={editor} /></div>
    </Form>;
}

export function DeleteAccountControl({ presentation }: { presentation: DeleteAccountPresentation }) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const deleting = presentation.state === "deleting";
  const failed = presentation.state === "refused" || presentation.state === "uncertain";
  const note = failed ? presentation.message : deleting ? "Deleting your account…" : presentation.state === "unavailable" ? "Not available right now." : undefined;
  return <BodySection title="Delete Account" description="Permanently erase your runs, history, and settings."><FormGroup label="Account">
    <ResultRow label="Delete account" description={note === undefined ? undefined : <span role={failed ? "alert" : deleting ? "status" : undefined}>{note}</span>}
      value={<Button ref={trigger} variant="danger" disabled={presentation.state !== "ready"} onClick={() => setConfirming(true)}>{deleting ? "Deleting…" : "Delete"}</Button>} />
    <Dialog open={confirming && presentation.state === "ready"} onOpenChange={setConfirming}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} title={presentation.state === "unavailable" ? "Delete account?" : `Delete ${presentation.personName}’s account?`} description="This erases your runs, history and settings. It can’t be undone." size="sm">
        <DialogFooter><Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>Cancel</Button><Button variant="danger" onClick={() => { if (presentation.state === "ready") { setConfirming(false); presentation.onConfirm(); } }}>Delete account</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </FormGroup></BodySection>;
}
