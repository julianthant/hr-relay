import { useState } from "react";
import { Banner, Button, BodySection, DsBodyScope, Field, Input, PageHeading, TooltipProvider, dsText, useDemoTheme } from "../../../src/dashboard/ds/ui.js";
import { BackupRestoreControls } from "../../../src/dashboard/surfaces/settings/general/settings-relocation.js";
export function ControlPreview() {
  const { theme } = useDemoTheme();
  const [state, setState] = useState<"ready" | "backing-up" | "backup-complete" | "restoring" | "blocked" | "unavailable">("ready");
  return <div data-app-root data-demo-theme={theme}><TooltipProvider><DsBodyScope><main className={`ds-body-stack ${dsText.body}`} style={{ margin: "0 auto", maxWidth: 900, padding: "var(--ds-space-section)" }}>
    <Banner tone="info" title="UI mock">No backup, restore, or file operation is performed.</Banner><PageHeading title="Paths" description="Fixed app data · Backup and Restore" />
    <BodySection title="App data"><p>Relay assigns the app-data location. Moving the data folder is unavailable.</p><Field label="Runtime state folder"><Input readOnly value="Example app data / person / database" /></Field><Field label="Artifact folder"><Input readOnly value="Example app data / person / artifacts" /></Field></BodySection>
    <BackupRestoreControls state={state} backupLabel="Example verified backup · same person and installation" onBackup={() => setState("backing-up")} onRestore={() => setState("restoring")} />
    <div className="flex gap-2">{(["ready", "backup-complete", "blocked", "unavailable"] as const).map(value => <Button key={value} variant="muted" onClick={() => setState(value)}>Show {value}</Button>)}</div>
  </main></DsBodyScope></TooltipProvider></div>;
}
