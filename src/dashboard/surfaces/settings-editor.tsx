import {
Settings as SettingsIcon
} from "lucide-react";
import { Badge,Banner,Button,dsIcon,dsText,Field,Input,Panel,PanelBody,PanelHeader,Spinner } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { plural } from "./format.js";
import { useEditableSettings } from "./settings-editor-model.js";


function sourceTone(source: "settings" | "default"): "info" | "neutral" {
  if (source === "settings") return "info";
  return "neutral";
}


export function EditableSettingsSection({
  editor,
  sectionId,
}: {
  editor: ReturnType<typeof useEditableSettings>;
  sectionId: string;
}) {
  if (editor.editor.state === "loading") {
    return <Spinner label="Reading editable settings" />;
  }
  if (editor.editor.state === "failed") {
    return (
      <Banner tone="danger" title="Editable settings could not be read">
        <span className="flex flex-col gap-[var(--ds-space-base)]">
          <span>{editor.editor.message}</span>
          <span><Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button></span>
        </span>
      </Banner>
    );
  }
  const section = editor.editor.document.sections.find((candidate) => candidate.id === sectionId);
  if (section === undefined) {
    return <Banner tone="danger" title="Server-listed section is unavailable">The editable settings document did not include {sectionId}.</Banner>;
  }
  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader
        title={section.label}
        headingLevel={2}
        subtitle={section.description}
        icon={<SettingsIcon aria-hidden className={dsIcon.lg} />}
      />
      <PanelBody className="flex flex-col gap-[var(--ds-space-section)] p-[var(--ds-space-cozy)]">
        <form
          className="flex flex-col gap-[var(--ds-space-section)]"
          onSubmit={(event) => {
            event.preventDefault();
            editor.submit();
          }}
        >
        {editor.editor.document.runtimeStatus.state === "restart-required" && (
          <Banner tone="warning" title="Restart required">
            Settings revision {String(editor.editor.document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(editor.editor.document.runtimeStatus.active.settingsRevision)}.
          </Banner>
        )}
        {section.leaves.map((leaf) => {
          const value = editor.draft[leaf.path] ?? leaf.effectiveValue;
          const locked = !leaf.editable;
          return (
            <div key={leaf.path} className="flex flex-col gap-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)] last:border-b-0 last:pb-0">
              <Field
                label={leaf.label}
                description={locked
                  ? `Set by ${leaf.environmentVariable}; change it in the environment, not in Settings.`
                  : leaf.description}
                error={editor.errors[leaf.path]}
                disabled={locked || editor.save.state === "saving"}
                hint={leaf.input === "number" ? leaf.unit : undefined}
              >
                <Input
                  type={leaf.input === "number" ? "number" : "text"}
                  value={String(value)}
                  min={leaf.input === "number" ? leaf.minimum : undefined}
                  step={leaf.input === "number" ? 1 : undefined}
                  onChange={(event) => editor.update(leaf.path, event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
                <Badge tone={sourceTone(leaf.source)}>{leaf.source === "settings" ? "Saved" : "Default"}</Badge>
                {editor.draft[leaf.path] !== leaf.effectiveValue && <Badge tone="attention">Unsaved</Badge>}
                {leaf.hazard !== undefined && <Badge tone="warning">Review impact</Badge>}
                <span className={cn(dsText.micro, dsText.nums, "text-[color:var(--ds-fg-faint)]")}>{leaf.path}</span>
                {!locked && editor.draft[leaf.path] !== leaf.effectiveValue && (
                  <Button size="sm" variant="ghost" onClick={() => editor.reset(leaf.path)}>Reset</Button>
                )}
              </div>
              {leaf.hazard !== undefined && <span className={cn(dsText.meta, "text-[color:var(--ds-status-waiting-fg)]")}>{leaf.hazard}</span>}
              <div className={cn(dsText.micro, "grid grid-cols-3 gap-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
                <span>Environment: {leaf.environmentVariable ?? "not set"}</span>
                <span>Saved: {leaf.settingsValue === undefined ? "not set" : String(leaf.settingsValue)}</span>
                <span>Default: {String(leaf.defaultValue)}</span>
              </div>
            </div>
          );
        })}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-[var(--ds-space-snug)] border-t border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] py-[var(--ds-space-base)]">
          <span className={cn(dsText.meta, "mr-auto text-[color:var(--ds-fg-muted)]")}>{plural(editor.dirtyCount, "unsaved change")}</span>
          <Button size="sm" variant="ghost" onClick={editor.discard} disabled={editor.dirtyCount === 0 || editor.save.state === "saving"}>Discard all</Button>
          <Button type="submit" size="sm" variant="primary" disabled={editor.dirtyCount === 0 || Object.values(editor.errors).some((error) => error !== undefined) || editor.save.state === "saving"}>
            {editor.save.state === "saving" ? "Saving…" : `Save ${String(editor.dirtyCount)}`}
          </Button>
        </div>
        {editor.save.state === "applied" && <Banner tone="success" title={editor.save.replayed ? "Settings already applied" : "Settings applied"}>Saved settings are active for new runs. Existing runs keep their original settings.</Banner>}
        {editor.save.state === "refused" && <Banner tone="danger" title="Settings were not applied">{editor.save.message}</Banner>}
        </form>
      </PanelBody>
    </Panel>
  );
}
