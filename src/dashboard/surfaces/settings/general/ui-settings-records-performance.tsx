import { SettingsSectionSkeleton } from "../settings-loading.js";
import { Form } from "@heroui/react";
import type { EditableSettingsLeafWire, EditorValue } from "../../../../models/dashboard/settings-editor.js";
import { Banner, BodySection, Button, Field, FormGroup, PageHeading, UnitField, dsText } from "../../../ds/ui.js";
import { formatSetting, settingInput } from "../editor/settings-draft-model.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { SettingsSaveFeedback } from "../editor/settings-feedback.js";
import { performancePresentation, performanceSectionGroups, type PerformanceGroup } from "./settings-performance-model.js";
import { settingNote, settingTitle } from "../settings-presentation.js";
import { timeoutReadableValue, timeoutSetting } from "./settings-timeouts-model.js";
import { SettingsValueControl } from "../editor/settings-controls.js";

import { SettingsSearchDisclosure } from "../navigation/settings-search-disclosure.js";
import { useSettingsFormFocus } from "../editor/settings-autosave-model.js";

type Editor = ReturnType<typeof useEditableSettings>;

const ADDITIONAL_DESCRIPTIONS: Partial<Record<PerformanceGroup, string>> = {
  "Worker scheduling": "Worker count and idle polling.",
  "Retry & termination": "Navigation retries and separation timing.",
  "OCR processing": "Concurrency, patience, validation, and backoff.",
  "Browser recovery": "Health checks, refreshes, and close verification.",
  "Other limits": "Additional settings served by this runtime.",
};

function readableValue(leaf: EditableSettingsLeafWire, value: EditorValue | undefined): string {
  return timeoutSetting(leaf.path) !== undefined && value !== undefined
    ? timeoutReadableValue(leaf, value)
    : formatSetting(value);
}

function PerformanceRow({ editor, leaf }: { editor: Editor; leaf: EditableSettingsLeafWire }) {
  const operation = editor.draft[leaf.path];
  const error = editor.errors[leaf.path];
  const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf, operation?.kind === "clear" ? leaf.defaultValue ?? "" : leaf.effectiveValue);
  const unit = timeoutSetting(leaf.path) !== undefined ? "seconds" : performancePresentation(leaf.path)?.unit;
  return <div data-settings-path={leaf.path} className="settings-performance-row">
    {unit !== undefined && leaf.input === "number" && typeof raw === "string"
      ? <Field orientation="horizontal" label={settingTitle(leaf)} description={settingNote(leaf)} error={error} disabled={editor.locked}>
        <div className="settings-compact-control">
          <UnitField name={leaf.path} autoComplete="off" type="text" inputMode={unit === "seconds" ? "decimal" : "numeric"} unit={unit} value={raw} disabled={editor.locked}
            aria-invalid={error !== undefined || undefined} onChange={event => editor.update(leaf.path, event.target.value)} />

        </div>
      </Field>
      : <div className="settings-performance-fallback"><SettingsValueControl leaf={leaf} operation={operation} error={error} disabled={editor.locked} update={rawValue => editor.update(leaf.path, rawValue)} />
        </div>}
    {leaf.validity === "unset" && <p className="settings-performance-hazard">Not set</p>}
    {leaf.hazard !== undefined && <p className="settings-performance-hazard">{leaf.hazard}</p>}
    {editor.save.state === "conflict" && operation !== undefined && <p className={dsText.meta}>Current value: {readableValue(leaf, leaf.effectiveValue)}</p>}
  </div>;
}

export function PerformanceSettingsSection({ editor }: { editor: Editor }) {
  const settingsFocus = useSettingsFormFocus<HTMLFormElement>(editor.locked || editor.protectedEditor.locked, editor.onFieldBlur);
  if (editor.editor.state === "loading") return <SettingsSectionSkeleton section="performance" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Editable settings could not be read">{editor.editor.message} <Button size="sm" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  const section = document.sections.find(candidate => candidate.id === "performance");
  if (section === undefined) return <Banner tone="danger" title="Performance unavailable">The settings document did not include Performance.</Banner>;
  const groups = performanceSectionGroups(section.leaves);
  const primary = groups.filter(group => ["Navigation", "Work", "Sign-in & Duo"].includes(group.title));
  const additional = groups.filter(group => !primary.includes(group));
  return <section className="settings-compact-page settings-performance-page">
    <PageHeading title="Performance" description="Time limits for navigation, work, and sign-in." />
    <Form validationBehavior="aria" className="settings-compact-form" ref={settingsFocus} onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
      {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></Banner>}
      <SettingsSaveFeedback save={editor.save} restartRequired={editor.editor.state === "loaded" && editor.editor.document.runtimeStatus.state === "restart-required"} retry={editor.retry} retryConflict={editor.submit} />
      <div className="ds-body-stack">
        {primary.map(group => <BodySection key={group.title} title={group.title}><FormGroup label={group.title}>
          {group.leaves.map(leaf => <PerformanceRow key={leaf.path} editor={editor} leaf={leaf} />)}
        </FormGroup></BodySection>)}
        {additional.length > 0 && <BodySection title="Additional limits"><FormGroup label="Additional limits">
          {additional.map(group => <SettingsSearchDisclosure paths={group.leaves.map(leaf => leaf.path)} key={group.title} variant="body" summary={group.title} description={ADDITIONAL_DESCRIPTIONS[group.title]}
            defaultOpen={group.leaves.some(leaf => editor.errors[leaf.path] !== undefined || (editor.save.state === "conflict" && editor.draft[leaf.path] !== undefined))}
            className="settings-performance-disclosure" contentClassName="settings-performance-disclosure-content">
            {group.leaves.map(leaf => <PerformanceRow key={leaf.path} editor={editor} leaf={leaf} />)}
          </SettingsSearchDisclosure>)}
        </FormGroup></BodySection>}
      </div>
    </Form>
  </section>;
}
