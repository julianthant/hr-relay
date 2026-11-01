import { useState } from "react";
import { BodySection, Button, Field, FormGroup, PathControl } from "../../../../../src/dashboard/ds/ui.js";
import { AppDataPaths, BackupRestoreControls } from "../../../../../src/dashboard/surfaces/settings/general/settings-relocation.js";
import { SettingsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const scenario = new URLSearchParams(location.search).get("state");
  const [pending, setPending] = useState<"backing-up" | "restoring">();
  const [retried, setRetried] = useState(false);
  const state = pending ?? (scenario === "backing-up" || scenario === "backup-complete" || scenario === "restoring" || scenario === "blocked" || scenario === "unavailable" ? scenario : "ready");
  return <SettingsSurface section="Paths"><BodySection title="Folders"><FormGroup label="Folders">{scenario === "read-failure" && !retried ? <div className="hub-settings-row"><div><div className="hub-row-label">Couldn’t load your folders</div><span className="hub-row-note">Your saved folders are unchanged.</span></div><Button variant="secondary" onClick={() => setRetried(true)}>Try again</Button></div> : [["Documents", "Exported records and reports.", "~/Documents/Relay"], ["Downloads", "Files downloaded during runs.", "~/Downloads/Relay"], ["Reports", "CSV and XLSX exports.", "~/Documents/Relay/Reports"]].map(([label, description, path]) => <div key={label} className="settings-compact-row"><Field orientation="horizontal" controlWidth="wide" label={label} description={description}><PathControl label={label} value={path} onChange={() => undefined} /></Field></div>)}</FormGroup></BodySection>
    <AppDataPaths locations={{ stateRoot: "~/Library/Application Support/Relay/people/am", artifactRoot: "~/Library/Application Support/Relay/people/am/artifacts" }} />
    <BodySection title="Backup and restore"><BackupRestoreControls state={state} backupLabel="Oct 30, 2026 at 9:12 PM" onBackup={() => setPending("backing-up")} backups={[{ id: "latest", label: "Oct 30, 2026 · 9:12 PM", description: "Automatic before upgrade", size: "48 MB" }, { id: "manual", label: "Oct 28, 2026 · 6:40 PM", description: "Manual", size: "46 MB" }, { id: "older", label: "Oct 21, 2026 · 8:05 AM", description: "Manual", size: "41 MB" }]} onRestore={id => { document.documentElement.dataset.selectedBackup = id; setPending("restoring"); }} /></BodySection>
  </SettingsSurface>;
}
