import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import { BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, FormGroup, IconButton, Input, dsText } from "../../../ds/ui.js";
import type { useStorageRelocation } from "./settings-relocation-model.js";

export function FixedStorageRows({ editor }: { editor: ReturnType<typeof useStorageRelocation> }) {
  const view = editor.read.state === "available" ? editor.read.view : undefined;
  return <AppDataPaths locations={view?.sourcePair} loading={editor.read.state === "loading"} readProblem={editor.readProblem} pending={Boolean(view?.pending)} onRetry={editor.reload} />;
}

export function AppDataPaths({ locations, loading = false, readProblem = false, pending = false, onRetry }: { locations?: { stateRoot: string; artifactRoot: string }; loading?: boolean; readProblem?: boolean; pending?: boolean; onRetry?: () => void }) {
  const [copyProblem, setCopyProblem] = useState(false);
  return <BodySection title={<span className="flex items-baseline justify-between">App data<span className={`${dsText.meta} font-normal text-ui-muted`}>Managed by Relay</span></span>}>
    <FormGroup label="App data">{locations ? <>{([["paths.stateRoot", "Data", "Runs, settings, and history.", locations.stateRoot], ["paths.artifactRoot", "Evidence", "Screenshots and downloads kept as evidence.", locations.artifactRoot]] as const).map(([path, label, description, value]) => <div key={path} data-settings-path={path} className="hub-settings-row"><div><div className="hub-row-label">{label}</div><span className="hub-row-note">{description}</span></div><div className="hub-setting-control app-data-path-control"><Input aria-label={label + " path"} readOnly value={value} title={value} className="app-data-path" /><IconButton label={`Copy ${label.toLowerCase()} path`} icon={<Copy aria-hidden className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(value).then(() => setCopyProblem(false), () => setCopyProblem(true)); }} /></div></div>)}</> : <div className="hub-settings-row"><span>{loading ? "Reading app-data locations…" : "App-data locations couldn’t be read."}</span><Button variant="secondary" disabled={loading || !onRetry} onClick={onRetry}>Try again</Button></div>}
    {copyProblem && <p role="status" className="px-[var(--ds-space-loose)] pb-[var(--ds-space-cozy)]">The path couldn’t be copied. Select and copy it from the field.</p>}
    {readProblem && <div className="hub-settings-row"><span>Current app-data locations couldn’t be read.</span><Button variant="secondary" disabled={!onRetry} onClick={onRetry}>Try again</Button></div>}
    {pending && <p className="px-[var(--ds-space-loose)] pb-[var(--ds-space-cozy)]">The folder plan is not applied. These locations are unchanged.</p>}
    </FormGroup>
  </BodySection>;
}

export function BackupRestoreControls({ state, backupLabel, backups, onBackup, onRestore }: {
  state: "ready" | "backing-up" | "backup-complete" | "restoring" | "blocked" | "unavailable";
  backupLabel?: string;
  onBackup?: () => void;
  backups?: readonly { id: string; label: string; description: string; size: string }[];
  onRestore?: (backupId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const restore = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(backups?.[0]?.id ?? "");
  const backup = backups?.find(candidate => candidate.id === selected);
  const ready = state === "ready" || state === "backup-complete";
  return <FormGroup label="Backup and restore">
    <div className="hub-settings-row"><div><div className="hub-row-label">Back up</div><span className="hub-row-note" role={state === "backing-up" || state === "backup-complete" ? "status" : undefined}>{state === "backing-up" ? "Backing up; verification is pending." : state === "backup-complete" ? "Backup complete and verified." : state === "unavailable" ? "Backups are unavailable. Try again when connected." : backupLabel ? `Last backup ${backupLabel}` : "No verified backup selected."}</span></div><div className="hub-setting-control"><Button variant="secondary" disabled={!(ready || state === "blocked") || !onBackup} onClick={onBackup}>{state === "backing-up" ? "Backing up…" : "Back up now"}</Button></div></div>
    <div className="hub-settings-row"><div><div className="hub-row-label">Restore</div><span className="hub-row-note" role={state === "restoring" ? "status" : undefined}>{state === "restoring" ? "Restoring your data; replacement is not complete." : state === "unavailable" ? "Restore is unavailable. Try again when connected." : "Stop all runs before restoring."}</span></div><div className="hub-setting-control"><Button ref={restore} variant="secondary" disabled={!ready || !onRestore || !backup} onClick={() => setConfirming(true)}>{state === "restoring" ? "Restoring…" : "Restore…"}</Button></div></div>
    <Dialog open={confirming && ready} onOpenChange={setConfirming}><DialogContent size="sm" title="Restore from backup" description="Your current data is replaced. You’ll sign in again afterwards." onCloseAutoFocus={event => { event.preventDefault(); restore.current?.focus(); }}>
      <DialogBody><div className="divide-y divide-ui-stroke">{backups?.map(candidate => <label key={candidate.id} className="flex items-center gap-[var(--ds-space-cozy)] py-[var(--ds-space-cozy)]"><input type="radio" name="verified-backup" checked={selected === candidate.id} onChange={() => setSelected(candidate.id)} aria-label={candidate.label} /><span className="flex-1">{candidate.label}<span className={`block ${dsText.meta} text-ui-muted`}>{candidate.description}</span></span><span className={`${dsText.meta} text-ui-muted`}>{candidate.size}</span></label>)}</div></DialogBody>
      <DialogFooter><Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>Cancel</Button><Button disabled={!onRestore || !backup} onClick={() => { if (backup) { setConfirming(false); onRestore?.(backup.id); } }}>Restore</Button></DialogFooter>
    </DialogContent></Dialog>
  </FormGroup>;
}
