import { Copy } from "lucide-react";
import { useState } from "react";
import { BodySection,Button,FormGroup,IconButton,Input,dsText } from "../../../ds/ui.js";
export function AppDataPaths({ locations, loading = false, readProblem = false, onRetry }: { locations?: { stateRoot: string; artifactRoot: string }; loading?: boolean; readProblem?: boolean; onRetry?: () => void }) {
  const [copyProblem, setCopyProblem] = useState(false);
  return <BodySection title={<span className="flex items-baseline justify-between">App data<span className={`${dsText.meta} font-normal text-ui-muted`}>Managed by Relay</span></span>}>
    <FormGroup label="App data">{locations ? <>{([["paths.stateRoot", "Data", "Runs, settings, and history.", locations.stateRoot], ["paths.artifactRoot", "Evidence", "Screenshots and downloads kept as evidence.", locations.artifactRoot]] as const).map(([path, label, description, value]) => <div key={path} data-settings-path={path} className="hub-settings-row"><div><div className="hub-row-label">{label}</div><span className="hub-row-note">{description}</span></div><div className="hub-setting-control app-data-path-control"><Input aria-label={label + " path"} readOnly value={value} title={value} className="app-data-path" /><IconButton label={`Copy ${label.toLowerCase()} path`} icon={<Copy aria-hidden className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(value).then(() => setCopyProblem(false), () => setCopyProblem(true)); }} /></div></div>)}</> : <div className="hub-settings-row"><span>{loading ? "Reading app-data locations…" : "App-data locations couldn’t be read."}</span><Button variant="secondary" disabled={loading || !onRetry} onClick={onRetry}>Try again</Button></div>}
    {copyProblem && <p role="status" className="px-[var(--ds-space-loose)] pb-[var(--ds-space-cozy)]">The path couldn’t be copied. Select and copy it from the field.</p>}
    {readProblem && <div className="hub-settings-row"><span>Current app-data locations couldn’t be read.</span><Button variant="secondary" disabled={!onRetry} onClick={onRetry}>Try again</Button></div>}
    </FormGroup>
  </BodySection>;
}
