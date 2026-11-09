import { Copy } from "lucide-react";
import { useState } from "react";
import { BodySection,Button,FormGroup,IconButton,ResultRow,Skeleton,dsText } from "../../../ds/ui.js";

/** Keeps the start and the end of a long path. */
export const middle = (path: string, head = 14, tail = 12) => path.length <= head + tail + 1 ? path : `${path.slice(0, head)}…${path.slice(-tail)}`;
export function AppDataPaths({ title, locations, loading = false, readProblem = false, onRetry }: { title?: string; locations?: { stateRoot: string; artifactRoot: string }; loading?: boolean; readProblem?: boolean; onRetry?: () => void }) {
  const [copyProblem, setCopyProblem] = useState(false);
  return <BodySection title={title ?? <span className="flex items-baseline justify-between">App data<span className={`${dsText.meta} font-normal text-ui-muted`}>Managed by Relay</span></span>}>
    {loading && !locations && <span role="status" className="sr-only">Reading app-data locations…</span>}
    <FormGroup label="App data">{locations || loading ? <>{([["paths.stateRoot", "Data", "Runs, settings, and history.", locations?.stateRoot], ["paths.artifactRoot", "Evidence", "Screenshots and downloads kept as evidence.", locations?.artifactRoot]] as const).map(([path, label, description, value]) => <div key={path} data-settings-path={path}><ResultRow label={label} description={description} value={value === undefined ? <Skeleton className="h-[var(--ds-h-md)] w-[220px]" /> : <span className="inline-flex items-center justify-end gap-2"><span title={value} aria-label={label + " path"} className="font-mono text-[13px]">{middle(value)}</span><IconButton size="xs" label={`Copy ${label.toLowerCase()} path`} icon={<Copy aria-hidden className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(value).then(() => setCopyProblem(false), () => setCopyProblem(true)); }} /></span>} /></div>)}</> : <div className="hub-settings-row"><span>App-data locations couldn’t be read.</span><Button variant="secondary" disabled={!onRetry} onClick={onRetry}>Try again</Button></div>}
    {copyProblem && <p role="status" className="px-[var(--ds-space-loose)] pb-[var(--ds-space-cozy)]">The path couldn’t be copied. Select and copy it from the field.</p>}
    {readProblem && <div className="hub-settings-row"><span>Current app-data locations couldn’t be read.</span><Button variant="secondary" disabled={!onRetry} onClick={onRetry}>Try again</Button></div>}
    </FormGroup>
  </BodySection>;
}
