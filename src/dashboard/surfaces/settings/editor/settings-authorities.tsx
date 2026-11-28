import { CREDENTIALS_UNAVAILABLE } from "../settings-model.js";
import { profileInitials } from "../../../../models/profiles/profile-identity.js";
import { SettingsSectionSkeleton } from "../settings-loading.js";
import { Fragment } from "react";
import { Server } from "lucide-react";
import { Form } from "@heroui/react";
import { BodySection, FormGroup, PageHeading, Panel, PanelBody, PanelHeader, ResultRow, Spinner, dsIcon, dsText, Notice, FailureNotice } from "../../../ds/ui.js";
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

function CredentialsSection({ editor, profileName, embedded }: { editor: Editor; profileName: string; embedded: boolean }) {
  const settingsFocus = useSettingsFormFocus<HTMLFormElement>(editor.locked || editor.protectedEditor.locked, editor.onFieldBlur);
  if (editor.editor.state === "loading") return <SettingsSectionSkeleton section="credentials" contentOnly={embedded} />;
  if (editor.editor.state === "failed") return embedded ? null : <FailureNotice sentence={CREDENTIALS_UNAVAILABLE} />;
  const settingsDocument = editor.editor.document;
  const authority = settingsDocument.protectedSettings;
  const credentials = editor.protectedEditor;
  const Root = embedded ? Fragment : "div";
  const profile = { displayName: profileName, initials: profileInitials(profileName) };
  return <Root {...embedded ? {} : { className: "settings-compact-page settings-credentials-page" }}>
    {!embedded && <PageHeading title="Account" description="Sign-in details and protected workflow configuration." />}
    {editor.readProblem !== undefined && <Notice sticky tone="warning" title="Current values unavailable" description="Reopen Settings to refresh." />}
    {authority.state === "unknown" && <Notice sticky tone="warning" title="Credentials unavailable" description="Reopen Settings to try again." />}
    <SettingsSaveFeedback save={credentials.save} />
    <Form validationBehavior="aria" className="settings-compact-form" ref={settingsFocus} onSubmit={event => { event.preventDefault(); credentials.submit(); }}>
      <BodySection title="UCPath sign-in" description="Workflows use this to sign in to UCPath.">
        <FormGroup label="UCPath sign-in">
          {authority.rows.filter(row => row.name === "ucpathUserId" || row.name === "ucpathPassword").map(row => {
            const description = PROTECTED_DESCRIPTION[row.name] ?? row.purpose;
            return embedded
              ? <ProtectedPencilRow key={row.name} editor={editor} name={row.name} label={row.name === "ucpathUserId" ? "Username" : "Password"} thing={row.name === "ucpathUserId" ? "UCPath username" : "UCPath password"} description={description} />
              : <ProtectedSettingField key={row.name} editor={editor} name={row.name} description={description} />;
          })}
        </FormGroup>
      </BodySection>
      {!embedded && <BodySection title="Workflow configuration" description="Names workflows put on the forms they file.">
        <FormGroup label="Workflow configuration">
          {PROFILE_WORKFLOW_FACTS.map(fact => <ResultRow key={fact.key} label={<span data-settings-path={fact.target}>{fact.label}</span>} value={profile[fact.key]} />)}
        </FormGroup>
      </BodySection>}
    </Form>
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
