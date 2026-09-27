import { Ellipsis } from "lucide-react";
import { Banner, Button, Field, IconButton, Input, Popover, PopoverContent, PopoverTrigger, Spinner, dsIcon } from "../ds/ui.js";
import type { useStorageRelocation } from "./settings-relocation-model.js";
import { desiredRelocationPair } from "./settings-relocation-model.js";

type Editor = ReturnType<typeof useStorageRelocation>;

export function StorageRelocationRows({ editor }: { editor: Editor }) {
  if (editor.read.state === "loading") return <Spinner label="Reading runtime locations" />;
  if (editor.read.state === "unavailable") return <Banner tone="warning" title="Runtime locations unavailable">
    The active paths and relocation plan could not be verified. Editing is unavailable. <Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button>
  </Banner>;
  const view = editor.read.view;
  const pair = desiredRelocationPair(view, editor.draft);
  return <>
    <div data-settings-path="paths.stateRoot" className="settings-relocation-row">
      <Field orientation="horizontal" controlWidth="wide" label="Runtime state folder" description="Persistent settings and run data." error={editor.errors.stateRoot} disabled={editor.locked}>
        <div className="settings-compact-control"><Input type="text" value={pair.stateRoot} disabled={editor.locked} onChange={event => editor.update("stateRoot", event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); editor.submit(); } }} />
          {editor.draft.stateRoot !== undefined && <Popover><PopoverTrigger asChild><IconButton size="xs" label="Actions for Runtime state folder" icon={<Ellipsis aria-hidden className={dsIcon.sm} />} /></PopoverTrigger><PopoverContent title="Value actions" width="sm" align="end"><Button size="sm" variant="ghost" disabled={editor.locked} onClick={() => editor.reset("stateRoot")}>Undo edit</Button></PopoverContent></Popover>}
        </div>
      </Field>
    </div>
    <div data-settings-path="paths.artifactRoot" className="settings-relocation-row">
      <Field orientation="horizontal" controlWidth="wide" label="Artifact folder" description="Run evidence and generated artifacts." error={editor.errors.artifactRoot} disabled={editor.locked}>
        <div className="settings-compact-control"><Input type="text" value={pair.artifactRoot} disabled={editor.locked} onChange={event => editor.update("artifactRoot", event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); editor.submit(); } }} />
          {editor.draft.artifactRoot !== undefined && <Popover><PopoverTrigger asChild><IconButton size="xs" label="Actions for Artifact folder" icon={<Ellipsis aria-hidden className={dsIcon.sm} />} /></PopoverTrigger><PopoverContent title="Value actions" width="sm" align="end"><Button size="sm" variant="ghost" disabled={editor.locked} onClick={() => editor.reset("artifactRoot")}>Undo edit</Button></PopoverContent></Popover>}
        </div>
      </Field>
    </div>
    {editor.save.state === "saving" && <p role="status" className="settings-relocation-note">Recording relocation plan…</p>}
    {editor.readProblem && <Banner tone="warning" title="Current relocation plan unavailable">The last verified paths remain shown, but editing is blocked until a fresh plan can be read. <Button size="sm" variant="secondary" onClick={editor.reload}>Refresh plan</Button></Banner>}
    {editor.save.state === "conflict" || editor.save.state === "refused" || editor.save.state === "unconfirmed" ? <Banner tone="warning" title={editor.save.state === "unconfirmed" ? "Plan write unconfirmed" : editor.save.state === "conflict" ? "Relocation plan changed" : "Relocation plan not recorded"}>
      {editor.save.message} {editor.save.state === "unconfirmed" && <Button size="sm" variant="secondary" onClick={editor.retry}>Retry exact attempt</Button>}
      {editor.save.state === "conflict" && !editor.readProblem && <Button size="sm" variant="secondary" onClick={editor.submit}>Retry updated plan</Button>}
    </Banner> : null}
    {view.pending !== null && <Banner tone="warning" title="Folder change planned">
      <div className="settings-relocation-plan">
        <p>The folders have not moved. A stopped, verified relocation is required before the new locations become active.</p>
        <div><span>Runtime state:</span> <span>{view.sourcePair.stateRoot}</span> <span aria-hidden="true">→</span> <span>{view.pending.desiredPair.stateRoot}</span></div>
        <div><span>Artifacts:</span> <span>{view.sourcePair.artifactRoot}</span> <span aria-hidden="true">→</span> <span>{view.pending.desiredPair.artifactRoot}</span></div>
        <Button size="sm" variant="secondary" disabled={editor.locked || editor.dirtyCount > 0} onClick={editor.cancel}>Cancel plan</Button>
      </div>
    </Banner>}
  </>;
}
