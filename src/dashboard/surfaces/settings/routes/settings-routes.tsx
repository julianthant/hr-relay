import { SettingsSectionSkeleton } from "../settings-loading.js";
import { useContext, useEffect, useRef, useState } from "react";
import { Banner, BodySection, Button, Dialog, DialogContent, DialogFooter, Field, FormGroup, Input, PageHeading, SearchInput, dsText } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { settingInput } from "../editor/settings-draft-model.js";
import { SettingsSaveFeedback } from "../editor/settings-feedback.js";
import { routePresentation } from "./settings-routes-model.js";
import { ProtectedSettingField } from "../providers/settings-protected-field.js";

import { SettingsSearchTargetContext } from "../navigation/settings-search-target-model.js";
import { useSettingsFormFocus } from "../editor/settings-autosave-model.js";

export function RoutesSection({ editor }: { editor: ReturnType<typeof useEditableSettings> }) {
  const [query, setQuery] = useState("");
  const { target, visit } = useContext(SettingsSearchTargetContext);
  useEffect(() => { if (target !== undefined) setQuery(""); }, [target, visit]);
  const [removal, setRemoval] = useState<{ hasSaved: boolean; label: string } | null>(null);
  const removeTrigger = useRef<HTMLElement | null>(null);
  const settingsFocus = useSettingsFormFocus<HTMLFormElement>(editor.locked || editor.protectedEditor.locked, editor.onFieldBlur);
  if (editor.editor.state === "loading") return <SettingsSectionSkeleton section="routes" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Routes could not be read">{editor.editor.message} <Button size="sm" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  const section = document.sections.find(candidate => candidate.id === "routes");
  if (section === undefined) return <Banner tone="danger" title="Routes unavailable">The settings document did not include Routes.</Banner>;
  const routes = section.leaves.map(leaf => ({ leaf, presentation: routePresentation(leaf) })).sort((a, b) => Number(b.leaf.path === "urls.crm.prod") - Number(a.leaf.path === "urls.crm.prod"));
  const credentials = editor.protectedEditor;
  const rosterName = "sharepointOnboardingRosterUrl";
  const credentialWarning = credentials.save.state === "refused" || credentials.save.state === "conflict" || credentials.save.state === "unconfirmed";
  const filtered = routes.filter(({ leaf, presentation }) => `${presentation.name} ${presentation.description} ${Object.values(presentation.fields).map(field => `${field.name} ${field.description}`).join(" ")} ${leaf.path === "urls.sharepoint.prod" ? "Onboarding roster URL Download the onboarding roster" : ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="settings-page-panel routes-page">
    <PageHeading title="Routes" description="Production destinations, organized by system." />
    <form className="routes-page-form" ref={settingsFocus} onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Saved routes take effect after this dashboard restarts. This process still uses settings revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
      {editor.readProblem !== undefined && <Banner tone="warning" title="Current routes unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></Banner>}
      <SettingsSaveFeedback save={editor.save} restartRequired={editor.editor.state === "loaded" && editor.editor.document.runtimeStatus.state === "restart-required"} retry={editor.retry} retryConflict={editor.submit} />
      <SearchInput className="routes-page-search" aria-label="Find a system or route" placeholder="Search systems or routes" value={query} onClear={() => setQuery("")} onChange={event => setQuery(event.target.value)} />
      <div className="routes-page-list">
        {filtered.map(({ leaf, presentation }) => {
          const count = (leaf.control.input === "object" ? leaf.control.fields.length : 0) + Number(leaf.path === "urls.sharepoint.prod");
          const meta = `${String(count)} ${count === 1 ? "URL" : "URLs"}`;
          const operation = editor.draft[leaf.path];
          const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf, operation?.kind === "clear" ? leaf.defaultValue : leaf.effectiveValue);
          if (typeof raw === "string") throw new Error("routes-section-object-invalid");
          const content = leaf.control.input === "object" && <div data-settings-path={leaf.path} className="routes-page-system-fields">
              {leaf.control.fields.map(field => {
                const detail = presentation.fields[field.name];
                if (detail === undefined) throw new Error("routes-section-field-missing");
                return <Field data-settings-path={`${leaf.path}.${field.name}`} key={field.name} orientation="horizontal" controlWidth="wide" label={detail.name} description={detail.description} required className="routes-page-field">
                  <Input name={`${leaf.path}.${field.name}`} autoComplete="off" type="url" required spellCheck={false} value={raw[field.name] ?? ""} disabled={editor.locked}
                    aria-invalid={editor.errors[leaf.path] !== undefined || undefined}
                    onChange={event => editor.update(leaf.path, { ...raw, [field.name]: event.target.value })} />
                </Field>;
              })}
              {leaf.path === "urls.sharepoint.prod" && <>
                {!credentialWarning && <SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} retryConflict={credentials.submit} />}
                <ProtectedSettingField editor={editor} name={rosterName} description="Download the onboarding roster." controlWidth="wide" className="routes-page-field"
                  onRemove={(hasSaved, label) => { removeTrigger.current = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null; setRemoval({ hasSaved, label }); }} />
              </>}
              {editor.errors[leaf.path] !== undefined && <p role="alert" className="routes-page-error">{editor.errors[leaf.path]}</p>}
              {(leaf.source === "settings" || operation !== undefined) && <div className="routes-page-system-actions">
                {leaf.source === "settings" && <Button size="sm" variant="ghost" disabled={editor.locked} onClick={() => editor.clear(leaf.path)}>Reset to default</Button>}
              </div>}
            </div>;
          return <BodySection key={leaf.path} className="routes-page-system" title={<span className="routes-section-heading"><span>{presentation.name}</span><span>{meta}</span></span>}>
            {leaf.path === "urls.sharepoint.prod" && (document.protectedSettings.state === "unknown" || credentialWarning) && <div className="mb-[var(--ds-space-heading-content)] flex flex-col gap-[var(--ds-space-heading-content)]">
              {document.protectedSettings.state === "unknown" && <Banner tone="warning" title="Onboarding roster URL unavailable">The protected value could not be read. <Button size="sm" onClick={editor.reload}>Retry read</Button></Banner>}
              {credentialWarning && <SettingsSaveFeedback save={credentials.save} protectedStore retry={credentials.retry} retryConflict={credentials.submit} />}
            </div>}
            <FormGroup label={presentation.name}>{content}</FormGroup>
          </BodySection>;
        })}
      </div>
      {filtered.length === 0 && <p className={cn(dsText.ui, "text-[color:var(--ds-fg-muted)]")}>No routes match “{query}”.</p>}
    </form>
    <Dialog open={removal !== null} onOpenChange={next => { if (!next) setRemoval(null); }}>
      <DialogContent size="sm" hideClose className="ds-body-overlay" title={`Remove ${removal?.label ?? "onboarding roster URL"}?`}
        description={removal?.hasSaved ? "The stored URL will be removed from the protected store." : "This unsent value will be removed from the editor. No write will be sent."}
        onCloseAutoFocus={event => { if (removeTrigger.current?.isConnected) { event.preventDefault(); removeTrigger.current.focus(); } removeTrigger.current = null; }}>
        <DialogFooter><Button variant="muted" onClick={() => setRemoval(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (removal === null) return; if (removal.hasSaved) credentials.clear(rosterName); else credentials.reset(rosterName); setRemoval(null); }}>Remove URL</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
