import { SettingsSectionSkeleton } from "../settings-loading.js";
import { Form } from "@heroui/react";
import type { EditableSettingsLeafWire } from "../../../../models/dashboard/settings-editor.js";
import { BodySection, Field, FormGroup, PageHeading, UnitField, Notice, FailureNotice } from "../../../ds/ui.js";
import { settingInput } from "../editor/settings-draft-model.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { performancePresentation, performanceSectionGroups, type PerformanceGroup } from "./settings-performance-model.js";
import { settingNote, settingTitle } from "../settings-presentation.js";
import { timeoutSetting } from "./settings-timeouts-model.js";
import { SavingMark, SettingsValueControl } from "../editor/settings-controls.js";

import { SettingsSearchDisclosure } from "../navigation/settings-search-disclosure.js";
import { useSettingsFormFocus } from "../editor/settings-autosave-model.js";

type Editor = ReturnType<typeof useEditableSettings>;

const PRIMARY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  Navigation: "Time allowed for pages to load and respond.",
  Work: "Time allowed for each workflow step.",
  "Sign-in & Duo": "Time allowed for sign-in and Duo approval.",
};
const ADDITIONAL_DESCRIPTIONS: Partial<Record<PerformanceGroup, string>> = {
  "Worker scheduling": "Worker count and idle polling.",
  "Retry & termination": "Navigation retries and separation timing.",
  "OCR processing": "Concurrency, patience, validation, and backoff.",
  "Browser recovery": "Health checks, refreshes, and close verification.",
  "Other limits": "Additional settings served by this runtime.",
};

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
      : <div className="settings-performance-fallback"><SettingsValueControl leaf={leaf} operation={operation} error={error} disabled={editor.locked} update={(rawValue, immediate) => editor.update(leaf.path, rawValue, immediate)} />
        </div>}
    <SavingMark editor={editor} path={leaf.path} />
    {leaf.validity === "unset" && <p className="settings-performance-hazard">Not set</p>}
    {leaf.hazard !== undefined && <p className="settings-performance-hazard">{leaf.hazard}</p>}
  </div>;
}

export function PerformanceSettingsSection({ editor }: { editor: Editor }) {
  const settingsFocus = useSettingsFormFocus<HTMLFormElement>(editor.locked || editor.protectedEditor.locked, editor.onFieldBlur);
  if (editor.editor.state === "loading") return <SettingsSectionSkeleton section="performance" />;
  if (editor.editor.state === "failed") return <FailureNotice sentence="Settings unavailable; reopen Settings to try again." />;
  const document = editor.editor.document;
  const section = document.sections.find(candidate => candidate.id === "performance");
  if (section === undefined) return <FailureNotice sentence="Performance unavailable." />;
  const groups = performanceSectionGroups(section.leaves);
  const primary = groups.filter(group => ["Navigation", "Work", "Sign-in & Duo"].includes(group.title));
  const additional = groups.filter(group => !primary.includes(group));
  return <section className="settings-compact-page settings-performance-page">
    <PageHeading title="Performance" description="Time limits for navigation, work, and sign-in." />
    <Form validationBehavior="aria" className="settings-compact-form" ref={settingsFocus} onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Notice sticky tone="warning" title="Restart required" description="Saved settings apply after Relay restarts." />}
      {editor.readProblem !== undefined && <Notice sticky tone="warning" title="Current settings unavailable" description="Reopen Settings to refresh." />}
      <div className="ds-body-stack">
        {primary.map(group => <BodySection key={group.title} title={group.title} description={PRIMARY_DESCRIPTIONS[group.title]}><FormGroup label={group.title}>
          {group.leaves.map(leaf => <PerformanceRow key={leaf.path} editor={editor} leaf={leaf} />)}
        </FormGroup></BodySection>)}
        {additional.length > 0 && <BodySection title="Additional limits" description="Scheduling, retry, OCR, and recovery limits."><FormGroup label="Additional limits">
          {additional.map(group => <SettingsSearchDisclosure paths={group.leaves.map(leaf => leaf.path)} key={group.title} variant="body" summary={group.title} description={ADDITIONAL_DESCRIPTIONS[group.title]}
            defaultOpen={group.leaves.some(leaf => editor.errors[leaf.path] !== undefined)}
            className="settings-performance-disclosure" contentClassName="settings-performance-disclosure-content">
            {group.leaves.map(leaf => <PerformanceRow key={leaf.path} editor={editor} leaf={leaf} />)}
          </SettingsSearchDisclosure>)}
        </FormGroup></BodySection>}
      </div>
    </Form>
  </section>;
}
