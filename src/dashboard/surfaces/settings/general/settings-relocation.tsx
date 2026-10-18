import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../../shared/loading/loading.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { Banner, BodySection, Button, Field, FormGroup, IconButton, Input, dsIcon } from "../../../ds/ui.js";
import type { useStorageRelocation } from "./settings-relocation-model.js";
import { desiredRelocationPair } from "./settings-relocation-model.js";
import { SettingsPathPicker } from "./settings-path-picker.js";

type Editor = ReturnType<typeof useStorageRelocation>;

function RelocationCommand({ commandId }: { commandId: string }) {
  const command = `npm run cli -- storage relocate --plan ${commandId}`;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2400);
  };
  return <div className="settings-relocation-command-block">
    <div className="settings-relocation-command">
      <Input name="storageRelocationCommand" autoComplete="off" type="text" aria-label="Relocation command" value={command} readOnly onFocus={event => event.currentTarget.select()} />
      <IconButton size="sm" variant="outline" label="Copy relocation command" icon={<Copy aria-hidden className={dsIcon.sm} />} onClick={() => { void copy(); }} />
    </div>
    {copyState === "copied" && <span role="status">Command copied</span>}
    {copyState === "unavailable" && <span role="alert">Copy unavailable. Select and copy the command.</span>}
  </div>;
}

function RuntimePathRow({ editor, name, value, title, description }: {
  editor: Editor; name: "stateRoot" | "artifactRoot"; value: string; title: string; description: string;
}) {
  const field = name === "stateRoot" ? "paths.stateRoot" : "paths.artifactRoot";
  return <div data-settings-path={field} className="settings-relocation-row" onKeyDown={event => {
    if (editor.draft[name] === undefined || event.defaultPrevented || event.repeat || event.altKey || event.shiftKey
      || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z"
      || (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))) return;
    event.preventDefault(); editor.reset(name);
  }}>
    <Field orientation="horizontal" controlWidth="wide" label={title} description={description} error={editor.errors[name]} disabled={editor.locked}>
      <div className="settings-compact-control">
        <SettingsPathPicker field={field} label={title} value={value} disabled={editor.locked} onSelected={path => editor.update(name, path)} />
      </div>
    </Field>
  </div>;
}

export function StorageRelocationRows({ editor, children }: { editor: Editor; children?: ReactNode }) {
  const show = useDelayedLoading(editor.read.state === "loading");
  const view = editor.read.state === "available" ? editor.read.view : undefined;
  const pair = view === undefined ? undefined : desiredRelocationPair(view, editor.draft);
  const hasWarning = editor.read.state === "unavailable" || editor.readProblem
    || editor.save.state === "conflict" || editor.save.state === "refused" || editor.save.state === "unconfirmed" || (view !== undefined && view.pending !== null);
  return <BodySection title="Runtime locations">
    {hasWarning && <div className="mb-[var(--ds-space-heading-content)] flex flex-col gap-[var(--ds-space-heading-content)]">
      {editor.read.state === "unavailable" && <Banner tone="warning" title="Runtime locations unavailable">
        The active paths and relocation plan could not be verified. Editing is unavailable. <Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button>
      </Banner>}
    {editor.readProblem && <Banner tone="warning" title="Current relocation plan unavailable">The last verified paths remain shown, but editing is blocked until a fresh plan can be read. <Button size="sm" variant="secondary" onClick={editor.reload}>Refresh plan</Button></Banner>}
    {editor.save.state === "conflict" || editor.save.state === "refused" || editor.save.state === "unconfirmed" ? <Banner tone="warning" title={editor.save.state === "unconfirmed" ? "Plan write unconfirmed" : editor.save.state === "conflict" ? "Relocation plan changed" : "Relocation plan not recorded"}>
      {editor.save.message} {editor.save.state === "unconfirmed" && <Button size="sm" variant="secondary" onClick={editor.retry}>Retry exact attempt</Button>}
      {editor.save.state === "conflict" && !editor.readProblem && <Button size="sm" variant="secondary" onClick={editor.submit}>Retry updated plan</Button>}
    </Banner> : null}
    {view !== undefined && view.pending !== null && <Banner tone="warning" title="Folder change planned">
      <div className="settings-relocation-plan">
        <p>The folders have not moved. A stopped, verified relocation is required before the new locations become active.</p>
        <div><span>Runtime state:</span> <span>{view.sourcePair.stateRoot}</span> <span aria-hidden="true">→</span> <span>{view.pending.desiredPair.stateRoot}</span></div>
        <div><span>Artifacts:</span> <span>{view.sourcePair.artifactRoot}</span> <span aria-hidden="true">→</span> <span>{view.pending.desiredPair.artifactRoot}</span></div>
        <p>Stop the dashboard and workers, then run this command. Restart them after relocation completes.</p>
        <RelocationCommand key={view.pending.commandId} commandId={view.pending.commandId} />
        <Button size="sm" variant="secondary" disabled={editor.locked || editor.dirtyCount > 0} onClick={editor.cancel}>Cancel plan</Button>
      </div>
    </Banner>}
    </div>}
    <FormGroup label="Runtime locations">
      {editor.read.state === "loading" && show && <LoadingRegion label="Loading runtime locations" className="[&>*+*]:border-t [&>*+*]:border-ui-stroke"><SettingsRowsSkeleton rows={2} wide /></LoadingRegion>}
      {pair !== undefined && <>
        <RuntimePathRow editor={editor} name="stateRoot" value={pair.stateRoot} title="Runtime state folder" description="Persistent settings and run data." />
        <RuntimePathRow editor={editor} name="artifactRoot" value={pair.artifactRoot} title="Artifact folder" description="Run evidence and generated artifacts." />
      </>}
      {editor.save.state === "saving" && <p role="status" className="settings-relocation-note">Recording relocation plan…</p>}
      {children}
    </FormGroup>
  </BodySection>;
}
