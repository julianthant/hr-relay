import { SettingsSectionSkeleton } from "../settings-loading.js";
import { useRef, useState } from "react";
import { Server } from "lucide-react";
import { Form } from "@heroui/react";
import { BodySection, Banner, Button, Dialog, DialogContent, DialogFooter, FormGroup, PageHeading, Panel, PanelBody, PanelHeader, ResultRow, Spinner, dsIcon, dsText } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { ProtectedSettingField } from "../providers/settings-protected-field.js";
import { formatSetting } from "./settings-draft-model.js";
import { groupDeploymentFacts, settingsFactLabel } from "./ui-settings-records-labels.js";


type Editor = ReturnType<typeof useEditableSettings>;
const PROTECTED_DESCRIPTION: Readonly<Record<string, string>> = {
  ucpathUserId: "Login name for UCPath access.",
  ucpathPassword: "Password for UCPath access.",
  timekeeperName: "Name used in timekeeping workflows.",
  activityPersonPseudonym: "Identifier used in historical Activity records.",
};

type Removal = { name: Parameters<Editor["protectedEditor"]["clear"]>[0]; label: string; hasSaved: boolean };

function CredentialsSection({ editor }: { editor: Editor }) {
  const [removal, setRemoval] = useState<Removal | null>(null);
  const removeTrigger = useRef<HTMLElement | null>(null);
  if (editor.editor.state === "loading") return <SettingsSectionSkeleton section="credentials" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Credentials unavailable">
    {editor.editor.message.replace(/ Try again\.$/u, "")} <Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button>
  </Banner>;
  const settingsDocument = editor.editor.document;
  const authority = settingsDocument.protectedSettings;
  const credentials = editor.protectedEditor;
  const askRemove = (target: Removal): void => {
    removeTrigger.current = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    setRemoval(target);
  };
  const confirmRemove = (): void => {
    if (removal === null) return;
    if (!removal.hasSaved) credentials.reset(removal.name);
    else credentials.clear(removal.name);
    setRemoval(null);
  };
  return <div className="settings-compact-page settings-credentials-page">
    <PageHeading title="Credentials" description="Sign-in details and protected workflow configuration." />
    {editor.readProblem !== undefined && <Banner tone="warning" title="Current values unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh values</Button></Banner>}
    {authority.state === "unknown" && <Banner tone="warning" title="Credentials unavailable">Saved credentials could not be read. <Button size="sm" onClick={editor.reload}>Retry read</Button></Banner>}
    <SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} retryConflict={credentials.submit} />
    <Form validationBehavior="aria" className="settings-compact-form" onBlur={editor.onFieldBlur} onSubmit={event => { event.preventDefault(); credentials.submit(); }}>
      {(["UCPath sign-in", "Workflow configuration"] as const).map((title, groupIndex) => <BodySection key={title} title={title}>
        <FormGroup label={title}>
          {authority.rows.slice(groupIndex === 0 ? 0 : 2, groupIndex === 0 ? 2 : undefined)
            .filter(row => row.name !== "sharepointOnboardingRosterUrl").map(row => <ProtectedSettingField key={row.name}
              editor={editor} name={row.name} description={PROTECTED_DESCRIPTION[row.name] ?? row.purpose}
              onRemove={(hasSaved, label) => askRemove({ name: row.name, label, hasSaved })} />)}
        </FormGroup>
      </BodySection>)}
    </Form>
    <Dialog open={removal !== null} onOpenChange={open => { if (!open) setRemoval(null); }}>
      <DialogContent size="sm" hideClose className="ds-body-overlay" title={`Remove ${removal?.label ?? "value"}?`}
        description={removal?.hasSaved ? "The stored credential will be removed from the protected store." : "This unsent value will be removed from the editor. No write will be sent."}
        onCloseAutoFocus={event => { if (removeTrigger.current?.isConnected) { event.preventDefault(); removeTrigger.current.focus(); } removeTrigger.current = null; }}>
        <DialogFooter><Button variant="muted" onClick={() => setRemoval(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmRemove}>Remove credential</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

export function SettingsAuthoritySection({ editor, sectionId }: { editor: Editor; sectionId: string }) {
  if (sectionId === "protected-store" || sectionId === "credentials") return <CredentialsSection editor={editor} />;
  if (editor.editor.state !== "loaded") return <Spinner label="Reading settings authorities" />;
  if (sectionId !== "runtime-isolation") throw new Error("settings-authority-section-unknown");
  const document = editor.editor.document;
  return <Panel className="settings-page-panel"><PanelHeader title="Paths" headingLevel={2} subtitle="Code-owned paths for this process." icon={<Server aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <p className={cn(dsText.body, "mb-[var(--ds-space-section)] text-[color:var(--ds-fg-muted)]")}>These paths change through config/runtime-isolation.json and runtime-paths.ts.</p>
      <div className="settings-section-stack">
        {groupDeploymentFacts(document.deployment).map(group => <section key={group.label} className="settings-group"><h3 className={cn(dsText.title, "mb-[var(--ds-space-cozy)] font-medium")}>{group.label}</h3><div className="settings-group-rows">
          {group.entries.map(({ key, value }) => <ResultRow key={key} label={settingsFactLabel(key)} value={typeof value === "object" && value !== null && !Array.isArray(value)
            ? <dl>{Object.entries(value).map(([property, endpoint]) => <div key={property}><dt>{settingsFactLabel(property)}</dt><dd>{formatSetting(endpoint)}</dd></div>)}</dl>
            : <span className="break-all [overflow-wrap:anywhere]">{formatSetting(value)}</span>} />)}
        </div></section>)}
      </div>
    </PanelBody></Panel>;
}
