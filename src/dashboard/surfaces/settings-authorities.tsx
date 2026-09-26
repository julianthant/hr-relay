import { useRef, useState } from "react";
import { Plus, Server } from "lucide-react";
import { Form } from "@heroui/react";
import { BodySection, Badge, Banner, Button, Dialog, DialogContent, DialogFooter, Disclosure, Field, FormGroup, PageHeading, Panel, PanelBody, PanelHeader, ResultRow, SecretField, Spinner, dsIcon, dsText } from "../ds/ui.js";
import { SECRET_FAMILY_SPECS } from "../../domain/config/provider-family-specs.js";
import { ProviderKeySlotSchema } from "../../domain/config/provider-keys.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { formatSetting } from "./settings-draft-model.js";
import { groupDeploymentFacts, providerName, settingsFactLabel } from "./ui-settings-records-labels.js";

type Editor = ReturnType<typeof useEditableSettings>;
type Slot = (typeof ProviderKeySlotSchema.options)[number];
const PROTECTED_DESCRIPTION: Readonly<Record<string, string>> = {
  ucpathUserId: "Login name for UCPath access.",
  ucpathPassword: "Password for UCPath access.",
  timekeeperName: "Name used in timekeeping workflows.",
  sharepointOnboardingRosterUrl: "Location of the onboarding roster.",
  activityPersonPseudonym: "Identifier used in historical Activity records.",
};

type Removal = { kind: "protected"; name: Parameters<Editor["protectedEditor"]["clear"]>[0]; label: string; hasSaved: boolean }
  | { kind: "provider"; slot: Slot; label: string; parentOverride: boolean; active: boolean; hasSaved: boolean };

function CredentialsSection({ editor }: { editor: Editor }) {
  const [removal, setRemoval] = useState<Removal | null>(null);
  const removeTrigger = useRef<HTMLElement | null>(null);
  if (editor.editor.state !== "loaded") return <Spinner label="Reading settings authorities" />;
  const settingsDocument = editor.editor.document;
  const authority = settingsDocument.protectedSettings;
  const credentials = editor.protectedEditor;
  const provider = editor.providerEditor;
  const keys = settingsDocument.providerKeys;
  const askRemove = (target: Removal): void => {
    removeTrigger.current = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    setRemoval(target);
  };
  const confirmRemove = (): void => {
    if (removal === null) return;
    if (removal.kind === "protected") {
      if (!removal.hasSaved) credentials.reset(removal.name);
      else credentials.clear(removal.name);
    } else provider.remove(removal.slot);
    setRemoval(null);
  };
  const providerAvailable = keys.state === "available" || keys.state === "pending";
  const providerLocked = keys.state !== "available" || provider.locked || editor.readProblem !== undefined;
  const parent = providerAvailable ? new Set(keys.parentSlotNames) : new Set<Slot>();
  const rawSaved = providerAvailable ? keys.slots : {};
  const active = providerAvailable ? keys.activeSlots : {};
  return <div className="settings-compact-page settings-credentials-page">
    <PageHeading title="Credentials" description="Sign-in details, protected configuration, and provider keys." />
    {editor.readProblem !== undefined && <Banner tone="warning" title="Current values unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh values</Button></Banner>}
    {authority.state === "unknown" && <Banner tone="warning" title="Credentials unavailable">Saved credentials could not be read. <Button size="sm" onClick={editor.reload}>Retry read</Button></Banner>}
    <SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} retryConflict={credentials.submit} />
    <Form validationBehavior="aria" className="settings-compact-form" onSubmit={event => { event.preventDefault(); credentials.submit(); }}>
      {(["UCPath sign-in", "Workflow configuration"] as const).map((title, groupIndex) => <BodySection key={title} title={title}>
        <FormGroup label={title}>
          {authority.rows.slice(groupIndex === 0 ? 0 : 2, groupIndex === 0 ? 2 : undefined).map(row => {
            const operation = credentials.draft[row.name];
            const stored = authority.state === "available" ? authority.entries[row.name] : undefined;
            const value = operation?.kind === "set" ? operation.raw : operation?.kind === "clear" ? "" : stored === undefined ? "" : formatSetting(stored.value);
            const canRemove = stored !== undefined || operation?.kind === "set";
            return <Field key={row.name} label={row.label} description={PROTECTED_DESCRIPTION[row.name] ?? row.purpose}
              error={credentials.errors[row.name]} orientation="horizontal" controlWidth="medium"
              disabled={credentials.locked || authority.state !== "available" || editor.readProblem !== undefined}>
              <SecretField label={row.label} identity={`${row.name}:${stored?.valueId ?? "empty"}`} value={value}
                autoComplete="new-password" spellCheck={false} placeholder="Enter value"
                onChange={event => credentials.update(row.name, event.target.value)}
                {...(canRemove ? { onRemove: () => askRemove({ kind: "protected", name: row.name, label: row.label, hasSaved: stored !== undefined }) } : {})} />
            </Field>;
          })}
        </FormGroup>
      </BodySection>)}
    </Form>
    <BodySection title="Provider keys">
      {keys.state === "unknown" && <Banner tone="warning" title="Provider keys unavailable">Saved provider keys cannot be verified. Refresh before editing. <Button size="sm" onClick={editor.reload}>Retry read</Button></Banner>}
      {keys.state === "pending" && <Banner tone="warning" title="Provider write pending">A previous write may already be saved. Recover its exact command before making another change. <Button size="sm" variant="secondary" disabled={provider.save.state === "saving"} onClick={() => { if (provider.hasExactAttempt) provider.retry(); else void provider.retryPending(); }}>Retry pending write</Button></Banner>}
      <SettingsSaveFeedback save={provider.save} name="Provider keys" retry={provider.hasExactAttempt ? provider.retry : () => { void provider.retryPending(); }} retryConflict={provider.submit} />
      {providerAvailable && <FormGroup label="Provider keys" className="settings-provider-families">
        {SECRET_FAMILY_SPECS.map((family, index) => {
          const slots = ProviderKeySlotSchema.options.filter(slot => slot === family.envPrefix || slot.startsWith(family.envPrefix) && /^\d+$/u.test(slot.slice(family.envPrefix.length)));
          const visible = slots.filter(slot => rawSaved[slot] !== undefined || active[slot] !== undefined || parent.has(slot) || provider.draft[slot] !== undefined);
          const savedCount = slots.filter(slot => rawSaved[slot] !== undefined).length;
          return <Disclosure key={family.name} summary={providerName(family.name)} description={`Keys used for ${providerName(family.name)} requests.`}
            meta={<Badge tone="neutral">{`${String(savedCount)} ${savedCount === 1 ? "saved key" : "saved keys"}`}</Badge>} variant="body" defaultOpen={index === 0}
            contentClassName="settings-provider-disclosure-content">
            {visible.map(slot => {
              const position = slot === family.envPrefix ? 1 : Number(slot.slice(family.envPrefix.length));
              const operation = provider.draft[slot];
              const saved = rawSaved[slot];
              const parentOverride = parent.has(slot);
              const parentOnly = saved === undefined && operation === undefined && parentOverride;
              const value = operation?.kind === "set" ? operation.raw : operation?.kind === "clear" ? "" : saved ?? active[slot] ?? "";
              const note = parentOnly ? active[slot] === undefined ? "Empty environment override" : "Active from environment · read only"
                : parentOverride ? active[slot] === undefined ? "Saved key is shadowed by an empty environment override" : "Saved key is shadowed by the environment" : "Configured API key";
              return <Field key={slot} label={`Key ${String(position)}`} description={note} error={provider.errors[slot]}
                orientation="horizontal" controlWidth="medium" disabled={providerLocked}>
                <SecretField label={`${providerName(family.name)} Key ${String(position)}`} identity={`${slot}:${keys.sourceVersionToken}`}
                  value={value} readOnly={parentOnly} autoComplete="new-password" spellCheck={false}
                  placeholder={parentOnly ? "No active value" : "Enter API key"}
                  onChange={event => provider.update(slot, event.target.value)}
                  {...(parentOnly ? {} : { onRemove: () => askRemove({ kind: "provider", slot, label: `${providerName(family.name)} Key ${String(position)}`,
                    parentOverride, active: active[slot] !== undefined, hasSaved: saved !== undefined }) })} />
              </Field>;
            })}
            {visible.length === 0 && <p className={cn(dsText.meta, "settings-provider-empty")}>No saved keys.</p>}
            <div className="settings-provider-add"><Button variant="ghost" disabled={providerLocked || slots.every(slot => rawSaved[slot] !== undefined || provider.draft[slot] !== undefined)}
              onClick={() => provider.add(family.envPrefix)}><Plus aria-hidden className={dsIcon.sm} />Add key</Button></div>
          </Disclosure>;
        })}
      </FormGroup>}
      {providerAvailable && (keys.restartRequired || keys.parentSlotNames.length > 0) && <p className={cn(dsText.meta, "settings-provider-note")}>
        {keys.restartRequired ? "Saved key changes take effect after restart." : "Environment values override saved keys in this process."}
      </p>}
    </BodySection>
    <Dialog open={removal !== null} onOpenChange={open => { if (!open) setRemoval(null); }}>
      <DialogContent size="sm" hideClose className="ds-body-overlay" title={`Remove ${removal?.label ?? "value"}?`}
        description={removal?.kind === "provider"
          ? !removal.hasSaved ? "This unsent key will be removed from the editor. No write will be sent."
            : removal.parentOverride ? "The saved key will be removed. The environment override remains active."
              : removal.active ? "The saved key will be removed. The active value may remain until restart."
                : "The saved key will be removed."
          : removal?.hasSaved ? "The stored credential will be removed from the protected store." : "This unsent value will be removed from the editor. No write will be sent."}
        onCloseAutoFocus={event => { if (removeTrigger.current?.isConnected) { event.preventDefault(); removeTrigger.current.focus(); } removeTrigger.current = null; }}>
        <DialogFooter><Button variant="secondary" onClick={() => setRemoval(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmRemove}>Remove {removal?.kind === "provider" ? "key" : "credential"}</Button></DialogFooter>
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
