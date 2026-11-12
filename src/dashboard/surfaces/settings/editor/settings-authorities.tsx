import { profileInitials } from "../../../../models/profiles/profile-identity.js";
import { SettingsSectionSkeleton } from "../settings-loading.js";
import { Fragment, useRef, useState } from "react";
import { Server } from "lucide-react";
import { Form } from "@heroui/react";
import { BodySection, Button, Dialog, DialogContent, DialogFooter, FormGroup, PageHeading, Panel, PanelBody, PanelHeader, ResultRow, Spinner, dsIcon, dsText, Notice } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { ProtectedSettingField } from "../providers/settings-protected-field.js";
import { ProtectedPencilRow } from "../providers/protected-pencil-row.js";
import { formatSetting } from "./settings-draft-model.js";
import { groupDeploymentFacts, settingsFactLabel, PROFILE_WORKFLOW_FACTS } from "./ui-settings-records-labels.js";
import { useSettingsFormFocus } from "./settings-autosave-model.js";


type Editor = ReturnType<typeof useEditableSettings>;
const PROTECTED_DESCRIPTION: Readonly<Record<string, string>> = {
  ucpathUserId: "Login name for UCPath access.",
  ucpathPassword: "Password for UCPath access.",
};

type Removal = { name: Parameters<Editor["protectedEditor"]["clear"]>[0]; label: string; hasSaved: boolean };

function CredentialsSection({ editor, profileName, embedded }: { editor: Editor; profileName: string; embedded: boolean }) {
  const [removal, setRemoval] = useState<Removal | null>(null);
  const removeTrigger = useRef<HTMLElement | null>(null);
  const settingsFocus = useSettingsFormFocus<HTMLFormElement>(editor.locked || editor.protectedEditor.locked, editor.onFieldBlur);
  if (editor.editor.state === "loading") return <SettingsSectionSkeleton section="credentials" />;
  if (editor.editor.state === "failed") return <Notice sticky tone="danger" title="Credentials unavailable" description={editor.editor.message.replace(/ Try again\.$/u, " Reopen Settings to try again.")} />;
  const settingsDocument = editor.editor.document;
  const authority = settingsDocument.protectedSettings;
  const credentials = editor.protectedEditor;
  const Root = embedded ? Fragment : "div";
  const profile = { displayName: profileName, initials: profileInitials(profileName) };
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
  return <Root {...embedded ? {} : { className: "settings-compact-page settings-credentials-page" }}>
    {!embedded && <PageHeading title="Account" description="Sign-in details and protected workflow configuration." />}
    {editor.readProblem !== undefined && <Notice sticky tone="warning" title="Current values unavailable" description={`${editor.readProblem} Reopen Settings to refresh.`} />}
    {authority.state === "unknown" && <Notice sticky tone="warning" title="Credentials unavailable" description="Reopen Settings to try again." />}
    <SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} retryConflict={credentials.submit} />
    <Form validationBehavior="aria" className="settings-compact-form" ref={settingsFocus} onSubmit={event => { event.preventDefault(); credentials.submit(); }}>
      <BodySection title="UCPath sign-in" description={embedded ? "What workflows use to sign in to UCPath. Separate from your Relay account." : undefined}>
        <FormGroup label="UCPath sign-in">
          {authority.rows.filter(row => row.name === "ucpathUserId" || row.name === "ucpathPassword").map(row => {
            const label = row.name === "ucpathUserId" ? "UCPath username" : row.label;
            const description = PROTECTED_DESCRIPTION[row.name] ?? row.purpose;
            const onRemove = (hasSaved: boolean, removeLabel: string): void => askRemove({ name: row.name, label: removeLabel, hasSaved });
            return embedded
              ? <ProtectedPencilRow key={row.name} editor={editor} name={row.name} label={label} description={description} onRemove={onRemove} />
              : <ProtectedSettingField key={row.name} editor={editor} name={row.name} description={description} onRemove={onRemove} />;
          })}
        </FormGroup>
      </BodySection>
      {!embedded && <BodySection title="Workflow configuration">
        <FormGroup label="Workflow configuration">
          {PROFILE_WORKFLOW_FACTS.map(fact => <ResultRow key={fact.key} label={<span data-settings-path={fact.target}>{fact.label}</span>} value={profile[fact.key]} />)}
        </FormGroup>
      </BodySection>}
    </Form>
    <Dialog open={removal !== null} onOpenChange={open => { if (!open) setRemoval(null); }}>
      <DialogContent size="sm" hideClose className="ds-body-overlay" title={`Remove ${removal?.label ?? "value"}?`}
        description={removal?.hasSaved ? "The stored credential will be removed from the protected store." : "This unsent value will be removed from the editor. No write will be sent."}
        onCloseAutoFocus={event => { if (removeTrigger.current?.isConnected) { event.preventDefault(); removeTrigger.current.focus(); } removeTrigger.current = null; }}>
        <DialogFooter><Button variant="muted" onClick={() => setRemoval(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmRemove}>Remove credential</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Root>;
}

export function SettingsAuthoritySection({ editor, sectionId, profileName, embedded = false }: { editor: Editor; sectionId: string; profileName: string; embedded?: boolean }) {
  if (sectionId === "protected-store" || sectionId === "credentials") return <CredentialsSection editor={editor} profileName={profileName} embedded={embedded} />;
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
