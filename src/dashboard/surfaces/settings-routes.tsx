import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Field, Input, PageHeading, SearchInput, Spinner, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { settingInput } from "./settings-draft-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { routePresentation } from "./settings-routes-model.js";

export function RoutesSection({ editor }: { editor: ReturnType<typeof useEditableSettings> }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState("urls.crm.prod");
  if (editor.editor.state === "loading") return <Spinner label="Reading routes" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Routes could not be read"><Button size="sm" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  const section = document.sections.find(candidate => candidate.id === "routes");
  if (section === undefined) return <Banner tone="danger" title="Routes unavailable">The settings document did not include Routes.</Banner>;
  const routes = section.leaves.map(leaf => ({ leaf, presentation: routePresentation(leaf) }));
  const destinationCount = routes.reduce((count, { leaf }) => count + (leaf.control.input === "object" ? leaf.control.fields.length : 0), 0);
  const filtered = routes.filter(({ presentation }) => `${presentation.name} ${presentation.description} ${Object.values(presentation.fields).map(field => `${field.name} ${field.description}`).join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const dirtyRoutes = routes.filter(({ leaf }) => editor.draft[leaf.path] !== undefined);
  const hasError = Object.values(editor.errors).some(error => error !== undefined);
  const cannotSave = dirtyRoutes.length === 0 || editor.locked || editor.readProblem !== undefined || hasError;

  return <section className="settings-page-panel routes-page">
    <PageHeading title="Routes" description="Choose a system, then edit its destinations."
      actions={<><Button variant="primary" disabled={cannotSave} onClick={editor.submit}>Save routes</Button><span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{String(routes.length)} systems · {String(destinationCount)} destinations</span></>} />
    <form className="routes-page-form" onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Saved routes take effect after this dashboard restarts. This process still uses settings revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
      {editor.readProblem !== undefined && <Banner tone="warning" title="Current routes unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></Banner>}
      <SettingsSaveFeedback save={editor.save} retry={editor.retry} retryConflict={editor.submit} />
      <SearchInput className="routes-page-search" aria-label="Find a system or route" placeholder="Find a system or route" value={query} onClear={() => setQuery("")} onChange={event => setQuery(event.target.value)} />
      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{String(filtered.length)} {filtered.length === 1 ? "system" : "systems"} shown</span>
      <div className="routes-page-list">
        {filtered.map(({ leaf, presentation }) => {
          const expanded = open === leaf.path;
          const operation = editor.draft[leaf.path];
          const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf, operation?.kind === "clear" ? leaf.defaultValue : leaf.effectiveValue);
          if (typeof raw === "string") throw new Error("routes-section-object-invalid");
          return <section key={leaf.path} data-settings-path={leaf.path} className="routes-page-system">
            <button type="button" className="routes-page-system-toggle" aria-expanded={expanded} aria-controls={`routes-fields-${leaf.path}`} onClick={() => setOpen(expanded ? "" : leaf.path)}>
              <span><strong>{presentation.name}</strong><span>{presentation.description}</span></span>
              <span className="routes-page-system-count">{String(leaf.control.input === "object" ? leaf.control.fields.length : 0)} {leaf.control.input === "object" && leaf.control.fields.length === 1 ? "URL" : "URLs"}<ChevronDown aria-hidden className={cn(dsIcon.md, expanded && "rotate-180")} /></span>
            </button>
            {expanded && leaf.control.input === "object" && <div id={`routes-fields-${leaf.path}`} className="routes-page-system-fields">
              {leaf.control.fields.map(field => {
                const detail = presentation.fields[field.name];
                if (detail === undefined) throw new Error("routes-section-field-missing");
                return <Field key={field.name} orientation="horizontal" label={detail.name} description={detail.description} required className="routes-page-field">
                  <Input type="url" required spellCheck={false} value={raw[field.name] ?? ""} disabled={editor.locked}
                    aria-invalid={editor.errors[leaf.path] !== undefined || undefined}
                    onChange={event => editor.update(leaf.path, { ...raw, [field.name]: event.target.value })} />
                </Field>;
              })}
              {editor.errors[leaf.path] !== undefined && <p role="alert" className="routes-page-error">{editor.errors[leaf.path]}</p>}
              {(leaf.source === "settings" || operation !== undefined) && <div className="routes-page-system-actions">
                {operation !== undefined && <Button size="sm" variant="ghost" disabled={editor.locked} onClick={() => editor.reset(leaf.path)}>Undo edit</Button>}
                {leaf.source === "settings" && <Button size="sm" variant="ghost" disabled={editor.locked} onClick={() => editor.clear(leaf.path)}>Reset to default</Button>}
              </div>}
            </div>}
          </section>;
        })}
      </div>
      {filtered.length === 0 && <p className={cn(dsText.ui, "text-[color:var(--ds-fg-muted)]")}>No routes match “{query}”.</p>}
    </form>
  </section>;
}
