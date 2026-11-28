import type { ReactNode } from "react";
import { Form } from "@heroui/react";
import { Banner, Button, FailureNotice, FormGroup, PageHeading, Spinner, dsText, Notice } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { settingsSectionGroups, formatSetting } from "./settings-draft-model.js";
import { SavingMark, SettingsValueControl } from "./settings-controls.js";
import { timeoutReadableValue, timeoutSetting } from "../general/settings-timeouts-model.js";
import { CompactSettingsSection } from "../general/ui-settings-records-general-paths.js";
import { PerformanceSettingsSection } from "../general/ui-settings-records-performance.js";
import { useSettingsFormFocus } from "./settings-autosave-model.js";

const SECTION_DESCRIPTION: Readonly<Record<string, string>> = {
  paths: "Folders Relay reads from and writes to.",
  routes: "Production destinations, organized by system.",
};
const GROUP_DESCRIPTION: Readonly<Record<string, string>> = {
  "Working locations": "Where Relay keeps files while it works.",
  "System destinations": "Addresses Relay opens in each system.",
};

export function EditableSettingsSection({ editor, sectionId, appearance }: { editor: ReturnType<typeof useEditableSettings>; sectionId: string; appearance?: ReactNode }) {
  const settingsFocus = useSettingsFormFocus<HTMLFormElement>(editor.locked || editor.protectedEditor.locked, editor.onFieldBlur);
  if (sectionId === "general") return <CompactSettingsSection editor={editor} appearance={appearance} />;
  if (sectionId === "performance") return <PerformanceSettingsSection editor={editor} />;
  if (sectionId === "providers") return <Banner tone="info" title="Provider settings retired">ChatGPT sign-in is available in General.</Banner>;
  if (editor.editor.state === "loading") return <Spinner label="Reading editable settings" />;
  if (editor.editor.state === "failed") return <FailureNotice sentence="Settings unavailable; reopen Settings to try again." />;
  const document = editor.editor.document;
  const sections = document.sections.filter(section => section.id === sectionId);
  if (sections.length === 0) return <FailureNotice sentence="Section unavailable." />;
  const leaves = sections.flatMap(section => section.leaves);
  const pageTitle = sections[0]?.label ?? sectionId;
  return <section className="settings-editor">
    <PageHeading title={pageTitle} description={SECTION_DESCRIPTION[sectionId] ?? `${pageTitle} settings.`} />
    <Form validationBehavior="aria" className="flex flex-col gap-[var(--ds-space-section)]" ref={settingsFocus} onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Notice sticky tone="warning" title="Restart required" description="Saved settings apply after Relay restarts." />}
      {editor.readProblem !== undefined && <Notice sticky tone="warning" title="Current settings unavailable" description="Reopen Settings to refresh." />}
      {settingsSectionGroups(sectionId, leaves).map(group => <section key={group.title} className="settings-editor-group">
        <div className="settings-group-heading"><h2 className={cn(dsText.title, "m-0 font-medium text-[color:var(--ds-fg)]")}>{group.title}</h2><p className="ds-body-section-description">{GROUP_DESCRIPTION[group.title] ?? `${group.title} settings.`}</p></div>
        <FormGroup label={group.title} className="settings-group">
          <div className="settings-group-rows">
            {group.leaves.map(leaf => {
            const operation = editor.draft[leaf.path];
            const custom = leaf.source === "settings";
            const requiredJobEndDate = leaf.path.startsWith("annualDates.") && leaf.path.endsWith(".jobEndDate");
            const shownDefault = timeoutSetting(leaf.path) !== undefined && leaf.defaultValue !== undefined
              ? timeoutReadableValue(leaf, leaf.defaultValue)
              : formatSetting(leaf.defaultValue);
              return <div key={leaf.path} data-settings-path={leaf.path} className="settings-row">
                <SettingsValueControl leaf={leaf} operation={operation} error={editor.errors[leaf.path]} disabled={editor.locked} update={(raw, immediate) => editor.update(leaf.path, raw, immediate)} />
              <SavingMark editor={editor} path={leaf.path} />
              {leaf.validity === "unset" && <span className={cn(dsText.meta, "settings-row-hazard text-[color:var(--ds-status-waiting-fg)]")}>Not set</span>}
              {(custom || operation !== undefined) && <div className="settings-row-actions">
                {custom && !requiredJobEndDate && operation?.kind !== "clear" && <Button size="sm" variant="ghost" title={`Standard value: ${shownDefault}`} onClick={() => editor.clear(leaf.path)} disabled={editor.locked}>Restore standard</Button>}
              </div>}
              {leaf.hazard !== undefined && <span className={cn(dsText.meta, "settings-row-hazard text-[color:var(--ds-status-waiting-fg)]")}>{leaf.hazard}</span>}
              </div>;
            })}
          </div>
        </FormGroup>
      </section>)}
    </Form>
  </section>;
}
