import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { useRef, useState, type ReactNode } from "react";
import { Banner, BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, FormGroup, Input, dsText } from "../../../ds/ui.js";
import type { useStorageRelocation } from "./settings-relocation-model.js";

export function FixedStorageRows({ editor, children }: { editor: ReturnType<typeof useStorageRelocation>; children?: ReactNode }) {
  const view = editor.read.state === "available" ? editor.read.view : undefined;
  return <BodySection title="App data">
    <p>Relay assigns the app-data location. Moving the data folder is unavailable. Document, download, and report folders remain selectable.</p>
    {view ? <FormGroup label="Runtime locations"><div data-settings-path="paths.stateRoot"><Field label="Runtime state folder" description="Fixed app-data location." orientation="horizontal"><Input readOnly value={view.sourcePair.stateRoot} /></Field></div><div data-settings-path="paths.artifactRoot"><Field label="Artifact folder" description="Fixed evidence location." orientation="horizontal"><Input readOnly value={view.sourcePair.artifactRoot} /></Field></div></FormGroup> : <div className="mb-[var(--ds-space-heading-content)]"><Banner tone="info" title={editor.read.state === "loading" ? "Reading app-data locations" : "App-data locations unavailable"}>No location is inferred.</Banner></div>}
    {editor.readProblem && <Banner tone="warning" title="Current app-data locations unavailable">{editor.readProblem}</Banner>}
    {view?.pending && <Banner tone="warning" title="Prior folder plan is not applied">The recorded plan has not moved these folders. Folder relocation is unavailable.</Banner>}
    <FormGroup label="Runtime browser locations">{children}</FormGroup>
  </BodySection>;
}

export function BackupRestoreControls({ state, backupLabel, onBackup, onRestore }: {
  state: "ready" | "backing-up" | "backup-complete" | "restoring" | "blocked" | "unavailable";
  backupLabel?: string;
  onBackup?: () => void;
  onRestore?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const restore = useRef<HTMLButtonElement>(null);
  const ready = state === "ready" || state === "backup-complete";
  return <div className="flex flex-col gap-2" aria-label="Backup and Restore">
    <p className={dsText.body}>Backup is explicit. Restore accepts only a verified backup for the same person and installation, with ordinary Relay work stopped.</p>
    <div className="flex gap-2"><Button variant="secondary" disabled={!ready || !onBackup} onClick={onBackup}>{state === "backing-up" ? "Backing up…" : "Backup"}</Button><Button ref={restore} variant="secondary" disabled={!ready || !onRestore || !backupLabel} onClick={() => setConfirming(true)}>{state === "restoring" ? "Restoring…" : "Restore"}</Button></div>
    {backupLabel && <p>Selected verified backup: {backupLabel}</p>}
    {state === "backing-up" && <Banner tone="info" title="Backup in progress">Waiting for backup verification. Completion is not confirmed.</Banner>}
    {state === "backup-complete" && <Banner tone="success" title="Backup verified">The explicit backup completed and was verified.</Banner>}
    {state === "restoring" && <Banner tone="info" title="Restore in progress">Waiting for the recorded replacement to settle. Restore is not complete.</Banner>}
    {state === "blocked" && <Banner tone="warning" title="Restore blocked">RUNTIME_CUSTODY_UNCERTAIN: {ERROR_CATALOG.RUNTIME_CUSTODY_UNCERTAIN.text}</Banner>}
    {state === "unavailable" && <p>Backup and Restore are unavailable until maintenance authority and verified backup selection are connected.</p>}
    <Dialog open={confirming && ready} onOpenChange={setConfirming}><DialogContent size="sm" title="Restore this backup?" description={backupLabel} onCloseAutoFocus={event => { event.preventDefault(); restore.current?.focus(); }}>
      <DialogBody><p>Replace this person’s database and artifacts with the verified backup. Stop ordinary work and prove owned resources closed first. Current credentials remain outside the restored database. Unresolved writes remain protected.</p></DialogBody>
      <DialogFooter><Button variant="muted" autoFocus onClick={() => setConfirming(false)}>Keep current data</Button><Button disabled={!onRestore} onClick={() => { setConfirming(false); onRestore?.(); }}>Restore verified backup</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
