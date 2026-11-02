import { useState } from "react";
import { BodySection,Button,Field,FormGroup,PathControl } from "../../../../../src/dashboard/ds/ui.js";
import { AppDataPaths } from "../../../../../src/dashboard/surfaces/settings/general/settings-storage.js";
import { SettingsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const scenario = new URLSearchParams(location.search).get("state");
  const [retried, setRetried] = useState(false);
  return <SettingsSurface section="Paths"><BodySection title="Folders"><FormGroup label="Folders">{scenario === "read-failure" && !retried ? <div className="hub-settings-row"><div><div className="hub-row-label">Couldn’t load your folders</div><span className="hub-row-note">Your saved folders are unchanged.</span></div><Button variant="secondary" onClick={() => setRetried(true)}>Try again</Button></div> : [["Documents", "Exported records and reports.", "~/Documents/Relay"], ["Downloads", "Files downloaded during runs.", "~/Downloads/Relay"], ["Reports", "CSV and XLSX exports.", "~/Documents/Relay/Reports"]].map(([label, description, path]) => <div key={label} className="settings-compact-row"><Field orientation="horizontal" controlWidth="wide" label={label} description={description}><PathControl label={label} value={path} onChange={() => undefined} /></Field></div>)}</FormGroup></BodySection>
    <AppDataPaths locations={{ stateRoot: "~/Library/Application Support/Relay/people/am", artifactRoot: "~/Library/Application Support/Relay/people/am/artifacts" }} />
  </SettingsSurface>;
}
