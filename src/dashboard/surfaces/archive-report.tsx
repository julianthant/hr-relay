import { Archive,Download,FileText,RefreshCw,ZoomIn } from "lucide-react";
import { useCallback,useEffect,useRef,useState, type ReactNode } from "react";
import type { SavedArchiveDeletionStatusWire,SavedArchiveIndexWire,SavedArchiveQuery,SavedArchiveReportWire,SavedVersionIndexWire } from "../../domain/dashboard/archive.js";
import { formatRuntimeVersion } from "../../domain/archive/runtime-version.js";
import { ArchiveReportCellSchema, type ArchiveReportCell } from "../../domain/archive/report.js";
import { settleCommandResult } from "../app/command-result.js";
import { Badge,Button,ButtonLink,DateInput,Dialog,DialogBody,DialogContent,DialogFooter,DialogTrigger,Disclosure,dsIcon,dsText,Input,PageHeader,Panel,PanelBody,PanelHeader,Select,Table,TBody,TD,TH,THead,TR,Textarea } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useArchiveClient as useDashboardClient } from "../state/archive-client.js";
import { archiveFileRelationships,archiveWorkflowGroups,readableArchiveLabel,savedCommandEnvelope,savedDateFilterSummary,savedDownload,savedFilterQuery,savedOutcomeLabel,savedPlanRequest,useSavedResource,visibleArchiveSections } from "./archive-report-model.js";
import { ArchiveFieldGroup, ArchiveFieldRows, ArchiveStructuredValue, ArchiveTable } from "./archive-visual.js";

export function SavedArchiveReport({ report, deletion, section, onSection }: { report: SavedArchiveReportWire; deletion?: ReactNode; section?: number; onSection?: (section: number) => void }) {
  const sectionItems = visibleArchiveSections(report);
  const defaultSection = sectionItems[0]?.key ?? report.sections.length + 1;
  const [active, setActive] = useState(() => ({ runId: report.runId, section: defaultSection }));
  const sectionNavRef = useRef<HTMLElement>(null);
  const requestedSection = section ?? (active.runId === report.runId ? active.section : defaultSection);
  const activeSection = sectionItems.some(item => item.key === requestedSection) ? requestedSection : defaultSection;
  useEffect(() => {
    const nav = sectionNavRef.current;
    if (nav === null || nav.scrollHeight <= nav.clientHeight) return;
    const selected = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (selected === null) return;
    const bounds = nav.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (item.top < bounds.top) nav.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) nav.scrollTop += item.bottom - bounds.bottom;
  }, [activeSection, report.runId]);
  const selectedItem = sectionItems.find(item => item.key === activeSection);
  const dashboardVersion = report.runtimeVersion === undefined ? "Not recorded" : formatRuntimeVersion(report.runtimeVersion.dashboard);
  const workflowVersion = report.runtimeVersion === undefined ? "Not recorded" : formatRuntimeVersion(report.runtimeVersion.workflow);
  return <article aria-label="Saved archive report" className="min-w-0 space-y-[20px] text-body">
    {requestedSection !== activeSection && <p role="alert">This view is no longer shown. Choose a section below.</p>}
    <dl className="m-0 flex flex-wrap gap-x-[28px] gap-y-[12px] border-b border-[color:var(--ds-border)] pb-[16px] text-caption [&>div]:grid [&>div]:gap-[4px] [&_dt]:text-[color:var(--ds-fg-muted)] [&_dd]:text-body">
      <div><dt>Dashboard version</dt><dd className="m-0 text-[color:var(--ds-fg)]">{dashboardVersion}</dd></div>
      <div><dt>Workflow version</dt><dd className="m-0 text-[color:var(--ds-fg)]">{workflowVersion}</dd></div>

      <div><dt>Archived</dt><dd className="m-0 text-[color:var(--ds-fg)]"><SavedArchiveTime value={report.capturedAt} /></dd></div>
      <div><dt>Outcome</dt><dd className="m-0 text-[color:var(--ds-fg)]">{savedOutcomeLabel(report.outcome)}</dd></div>
      <div><dt>Retained files</dt><dd className="m-0 text-[color:var(--ds-fg)]">{report.files.length}</dd></div>
    </dl>
    <div className="grid min-w-0 grid-cols-[160px_minmax(0,1fr)] items-start gap-[20px] min-[1200px]:grid-cols-[180px_minmax(0,1fr)] min-[1200px]:gap-[24px]">
      <nav ref={sectionNavRef} aria-label="Run sections" className="sticky top-[16px] flex max-h-[max(160px,calc(100vh-180px))] min-w-0 flex-col gap-[var(--ds-space-tight)] overflow-y-auto border-r border-[color:var(--ds-border)] pr-[var(--ds-space-cozy)] [&>button]:shrink-0">{sectionItems.map(item => <Button key={item.key} variant={activeSection === item.key ? "secondary" : "ghost"} aria-label={item.label} aria-current={activeSection === item.key ? "page" : undefined} className={cn("min-h-[var(--ds-h-bar)] w-full min-w-0 justify-start whitespace-normal break-words border-0 px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)] text-left [overflow-wrap:anywhere]")} onClick={() => { if (onSection === undefined) setActive({ runId: report.runId, section: item.key }); else onSection(item.key); }}>{item.label}{item.key === report.sections.length + 1 && <span aria-hidden className="ml-auto tabular-nums">{report.files.length}</span>}</Button>)}</nav>
      <div className="flex min-w-0 flex-col gap-[16px]"><h2 className="m-0 text-section">{selectedItem?.label}</h2>

    {selectedItem?.kind === "facts" && <div className="flex flex-col gap-[20px]">{archiveWorkflowGroups(report).filter(group => group.kind !== "files" && group.kind !== "logs").map(group => <section key={group.key} className="flex flex-col gap-[10px]"><h3 className="m-0 text-heading">{group.label}</h3>
    {group?.kind === "summary" && <ArchiveFieldGroup title="Run summary" showHeading={false}><ArchiveFieldRows rows={group.values?.map(cell => ({ label: cell.label,
      value: cell.label === "Queued" || cell.label === "Completed" ? (typeof cell.value === "string" && Number.isFinite(Date.parse(cell.value)) ? <SavedArchiveTime value={cell.value} /> : <ArchiveStructuredValue value={cell.value} />)
        : cell.label === "Total elapsed" && typeof cell.value === "number" ? <span title="Includes queued and waiting time">{formatArchiveElapsed(cell.value)}</span> : <ArchiveStructuredValue value={cell.value} /> })) ?? []} /></ArchiveFieldGroup>}
    {group?.kind === "facts" && <ArchiveFieldGroup title={group.label} showHeading={false}>
      {(group.values?.length ?? 0) > 0 && <ArchiveFieldRows rows={group.values!.map(cell => ({ label: cell.label, value: <ArchiveStructuredValue value={cell.value} /> }))} />}
      {group.sections?.map((section, index) => section.kind === "unavailable" ? <p key={index} className="m-[var(--ds-space-cozy)]">{section.reason}</p>
        : section.kind === "text" ? <p key={index} className="m-[var(--ds-space-cozy)] whitespace-pre-wrap">{section.text}</p>
          : section.kind === "table" ? <div key={index} className="overflow-x-auto"><ArchiveTable label={group.label}><THead><TR>{section.columns.map((column, n) => <TH key={n}>{column}</TH>)}</TR></THead><TBody>{section.rows.map((row, n) => <TR key={n}>{row.map((cell, m) => <TD key={m}><ArchiveStructuredValue value={cell} /></TD>)}</TR>)}</TBody></ArchiveTable></div> : null)}
    </ArchiveFieldGroup>}
    {group?.kind === "input" && group.value !== undefined && <ArchiveFieldGroup title={group.label} showHeading={false}><ArchiveFieldRows rows={archiveDisplayRows(group.value)} /></ArchiveFieldGroup>}
    {group?.kind === "settings" && <ArchiveFieldGroup title="Settings" showHeading={false}><ArchiveFieldRows rows={group.values?.flatMap(cell => cell.label === "Captured settings" && cell.value !== null && typeof cell.value === "object" && !Array.isArray(cell.value) && Object.keys(cell.value).length > 0
      ? archiveDisplayRows(cell.value) : [{ label: cell.label, value: <ArchiveStructuredValue value={cell.value} /> }]) ?? []} /></ArchiveFieldGroup>}
    </section>)}</div>}
    {selectedItem?.kind === "files" && <ArchiveFieldGroup title="Retained files" ariaLabel="Retained attachments" showHeading={false}>
      {report.files.length === 0 ? <p className="m-[var(--ds-space-cozy)]">No attachment was retained with this report.</p> : <>{report.files.map(file => <SavedAttachment key={`${report.runId}:${file.digest}`} runId={report.runId} file={file} relationships={archiveFileRelationships(report, file.digest)} />)}</>}
    </ArchiveFieldGroup>}
      </div>
    </div>
    {deletion}
  </article>;
}
function archiveDisplayRows(value: ArchiveReportCell): { label: string; value: ReactNode }[] {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0
    ? Object.entries(value).map(([label, entry]) => ({ label: readableArchiveLabel(label), value: <ArchiveStructuredValue value={ArchiveReportCellSchema.parse(entry)} /> }))
    : [{ label: "Value", value: <ArchiveStructuredValue value={value} /> }];
}
function formatArchiveElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours > 0 ? `${hours}h` : "", minutes > 0 ? `${minutes}m` : "", `${seconds % 60}s`].filter(Boolean).join(" ");
}
function SavedArchiveTime({ value }: { value: string }) {
  const instant = new Date(value);
  const label = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(instant);
  return <time dateTime={value} title={value}>{label} UTC</time>;
}
function SavedAttachment({ runId, file: retained, relationships }: { runId: string; file: SavedArchiveReportWire["files"][number]; relationships: readonly { taskId: string; actionId: string }[] }) {
  const client = useDashboardClient();
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const inspectButton = useRef<HTMLButtonElement>(null);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) requestAnimationFrame(() => inspectButton.current?.focus());
  };
  const read = useCallback(async () => savedDownload(await client.savedArchiveFile(runId, retained.digest), runId, retained.digest), [client, runId, retained.digest]);
  const resource = useSavedResource(read);
  const available = resource.state === "loaded" && resource.value.state === "available" ? resource.value : null;
  const image = /^image\//u.test(retained.mediaType);
  return <section aria-label={`File ${retained.name}`} className="min-w-0 border-b border-[color:var(--ds-border)] px-[20px] py-[16px] last:border-b-0">
    <div className="flex min-w-0 flex-wrap items-center gap-[12px]">
      <FileText className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} aria-hidden />
      <div className="min-w-0 flex-1"><strong className="block break-words [overflow-wrap:anywhere]">{retained.name}</strong><span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{retained.mediaType} · {retained.byteLength} bytes</span></div>
      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{resource.state === "loading" ? <span role="status">Checking {retained.name}…</span> : resource.state === "error" ? <span role="alert">{resource.message}</span> : resource.value.state === "available" ? "Available" : <span role="status">{resource.value.state === "missing" ? resource.value.reason : resource.value.message}</span>}</span>
      <div className="ml-auto flex shrink-0 items-center gap-[var(--ds-space-tight)]">
        {available !== null && image && <Button ref={inspectButton} size="toolbar" variant="secondary" icon={<ZoomIn className={dsIcon.sm} aria-hidden />} onClick={() => { setImageError(false); setOpen(true); }}>Inspect {retained.name}</Button>}
        {available !== null && <ButtonLink size="toolbar" className="max-w-full whitespace-normal break-all" href={available.downloadUrl} download={retained.name}>Download {retained.name}</ButtonLink>}
        <Button className="h-[32px]" variant="secondary" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>Details</Button>
      </div>
    </div>
    {detailsOpen && <dl className={cn(dsText.meta, "mt-[16px] grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)] border-t border-[color:var(--ds-border)] pt-[16px]")}><dt>Digest</dt><dd className="m-0 select-text break-all">{retained.digest}</dd><dt>Artifact IDs</dt><dd className="m-0 select-text break-all">{retained.artifactIds === undefined || retained.artifactIds.length === 0 ? "Not recorded" : retained.artifactIds.join(", ")}</dd>{relationships.map(relationship => <div key={`${relationship.taskId}:${relationship.actionId}`} className="contents"><dt>Retained task ID</dt><dd className="m-0 select-text break-all">{relationship.taskId}</dd><dt>Retained action ID</dt><dd className="m-0 select-text break-all">{relationship.actionId}</dd></div>)}</dl>}
    {available !== null && image && <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent size="lg" title={retained.name} description="Verified retained image">
        <DialogBody className="flex min-h-0 items-center justify-center">
          {imageError
            ? <p role="alert">{retained.name}: retained image bytes could not be decoded.</p>
            : <img src={available.downloadUrl} alt={retained.name} loading="lazy" className="h-auto max-h-full max-w-full object-contain" onError={() => setImageError(true)} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => changeOpen(false)}>Close</Button>
          <ButtonLink href={available.downloadUrl} download={retained.name} icon={<Download />}>Download image</ButtonLink>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </section>;
}
function SavedVersions({ actorId, nonce, onChanged, onArchive }: { actorId: string; nonce: number; onChanged: () => void; onArchive: () => void }) {
  const client = useDashboardClient();
  const read = useCallback(() => client.savedArchiveVersions(), [client]);
  const resource = useSavedResource(read, nonce);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const applyRequests = useRef(new Map<string, unknown>());
  const apply = (change: SavedVersionIndexWire["changes"][number]) => {
    const request = applyRequests.current.get(change.changeId) ?? change.resumeRequest ?? (change.state === "planned"
      ? { ...savedCommandEnvelope(actorId), type: "apply-version-bump", target: { versionPlanId: change.changeId, expectedVersion: 1 }, payload: { planFingerprint: change.reviewFingerprint } }
      : undefined);
    if (request === undefined) { setMessage("Original apply request unavailable. Resume with the original command."); return; }
    applyRequests.current.set(change.changeId, request);
    execute(request, change.changeId);
  };
  const [appliedChanges,setAppliedChanges]=useState<ReadonlySet<string>>(new Set());
  const pending=useRef(false);
  const execute = (request: unknown, changeId?:string) => {
    if(pending.current)return;
    pending.current=true;
    setBusy(true);
    void client.executeCommand(request).then(result => {
      const settled = settleCommandResult(result);
      setMessage(settled.kind === "applied" ? "Version change saved. The list is refreshing." : settled.problem);
      if (settled.kind === "applied") {
        if(changeId!==undefined)setAppliedChanges(prior=>new Set([...prior,changeId]));
        onChanged();
      } else if (settled.reason === "rejected" && settled.code === "replan-required") {
        onChanged();
      }
    }, (error: unknown) => setMessage(error instanceof Error ? error.message : "Version command failed.")).finally(() => {pending.current=false;setBusy(false);});
  };
  return <Panel aria-label="Versions and saved changes">
    <PanelHeader title="Versions and saved changes" headingLevel={2} subtitle={resource.state === "loaded" ? `Application ${resource.value.appVersion}` : undefined} />
    <PanelBody className={`${dsText.body} min-w-0 space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>
      {resource.state === "loading" ? <p role="status">Loading versions…</p> : resource.state === "error" ? <p role="alert">{resource.message}</p>
        : <>
          <section aria-label="Review a version change" className="min-w-0 border-b border-[color:var(--ds-border)] pb-[var(--ds-space-base)]">
            <PanelHeader title="Review a version change" headingLevel={3} subtitle="Create a saved record before applying a version change." className="px-0" />
            <SavedVersionForm wire={resource.value} actorId={actorId} busy={busy} onCommand={execute} />
          </section>
          <section aria-label="Saved version changes" className="min-w-0 space-y-[var(--ds-space-base)]">
            <PanelHeader title="Saved changes" headingLevel={3} className="px-0" />
            <p>{resource.value.historicalChanges} historical version {resource.value.historicalChanges === 1 ? "record" : "records"} retained.</p>
            {resource.value.changes.length === 0 ? <p>No active version changes.</p> : resource.value.changes.map(change => <section key={change.changeId} aria-label={`Version change ${change.changeId}`} className="min-w-0 border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)]">
              <h4 className={cn(dsText.ui, "font-semibold")}>{change.change.what}</h4>
              <p>{change.change.why}</p>
              <dl className={cn(dsText.meta, "grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)] sm:grid-cols-2")}>
                <div><dt>Change kind</dt><dd className="m-0">{change.change.kind === "major" ? "Major change" : "Minor change"}</dd></div>
                <div><dt>Version state</dt><dd className="m-0"><Badge tone="neutral">{change.state}</Badge></dd></div>
                <div><dt>Target version</dt><dd className="m-0 break-words">{change.targetVersion}</dd></div>
                <div><dt>Scope</dt><dd className="m-0 break-words">{change.scope.kind === "application" ? `Application ${change.scope.applicationVersion}` : change.scope.workflowIds.join(", ")}</dd></div>
                <div className="min-w-0"><dt>Reviewed membership</dt><dd className="m-0 break-all">{change.memberRunIds.length === 0 ? "No runs are part of this change." : change.memberRunIds.join(", ")}</dd></div>
                <div className="min-w-0"><dt>Blockers</dt><dd className="m-0 break-all">{change.blockerRunIds.length === 0 ? "None" : change.blockerRunIds.join(", ")}</dd></div>
                <div className="min-w-0"><dt>Archived runs</dt><dd className="m-0 break-all">{change.completedRunIds.length === 0 ? "None" : change.completedRunIds.join(", ")}</dd></div>
                <div><dt>Progress</dt><dd className="m-0">Progress: {change.memberRunIds.length} reviewed runs · {change.completedRunIds.length} archived.</dd></div>
              </dl>
              {(change.state === "planned" || change.state === "applying") && !appliedChanges.has(change.changeId) && <Button disabled={busy || change.blockerRunIds.length > 0} onClick={() => apply(change)}>Apply reviewed change</Button>}
            </section>)}
          </section>
        </>}
      {message && <div role="status"><pre className="whitespace-pre-wrap break-words">{message}</pre><Button onClick={onArchive}>Open the archive</Button></div>}
    </PanelBody>
  </Panel>;
}
function SavedVersionForm({ wire, actorId, busy, onCommand }: { wire: SavedVersionIndexWire; actorId: string; busy: boolean; onCommand: (request: unknown) => void }) {
  const [workflow, setWorkflow] = useState(wire.workflows[0]?.workflow ?? "");
  const [kind, setKind] = useState<"major" | "minor">("major");
  const [what, setWhat] = useState(""); const [why, setWhy] = useState("");
  return <form onSubmit={event => { event.preventDefault(); onCommand(savedPlanRequest(wire, actorId, workflow, kind, what, why)); }} className="max-w-4xl space-y-[var(--ds-space-base)] pt-[var(--ds-space-base)]">
    <p className={cn(dsText.body, "m-0 max-w-prose text-[color:var(--ds-fg-secondary)]")}>A major change archives reviewed terminal prior-version runs. A minor change archives none.</p>
    <div className="grid grid-cols-1 gap-[var(--ds-space-base)] md:grid-cols-2">
      <label className={cn(dsText.meta, "flex min-w-0 flex-col gap-[var(--ds-space-tight)] font-medium")}>Scope<Select value={workflow} onChange={event => setWorkflow(event.target.value)}><option value="application">Dashboard update · every workflow</option>{wire.workflows.map(row => <option key={row.workflow} value={row.workflow}>{row.label} · v{row.version}</option>)}</Select></label>
      <label className={cn(dsText.meta, "flex min-w-0 flex-col gap-[var(--ds-space-tight)] font-medium")}>Change kind<Select value={kind} onChange={event => setKind(event.target.value === "minor" ? "minor" : "major")}><option value="major">Major</option><option value="minor">Minor</option></Select></label>
      <label className={cn(dsText.meta, "flex min-w-0 flex-col gap-[var(--ds-space-tight)] font-medium md:col-span-2")}>What changed<Textarea required maxLength={200} rows={2} value={what} onChange={event => setWhat(event.target.value)} /></label>
      <label className={cn(dsText.meta, "flex min-w-0 flex-col gap-[var(--ds-space-tight)] font-medium md:col-span-2")}>Why<Textarea required maxLength={1000} rows={3} value={why} onChange={event => setWhy(event.target.value)} /></label>
    </div>
    <Button type="submit" disabled={busy || workflow === ""}>Create review</Button>
  </form>;
}
export function SavedArchiveWorkspace({ selection, view, actorId, onSelection, onView }: {
  selection: string; view: "runs" | "versions"; actorId: string; onSelection: (id: string) => void; onView: (view: "runs" | "versions") => void;
}) {
  const client = useDashboardClient(); const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState<SavedArchiveQuery>({ limit: 50 });
  const refresh = useCallback(() => setNonce(value => value + 1), []);
  const changeQuery = (next: SavedArchiveQuery) => { onSelection(""); setQuery(next); };
  const filter = (key: "workflow" | "title" | "descriptorVersion" | "outcome" | "from" | "to" | "capturedFrom" | "capturedTo", value: string) => changeQuery(savedFilterQuery(query, key, value));
  const dateFilterSummary = savedDateFilterSummary(query);
  const read = useCallback(() => client.savedArchiveIndex(query), [client, query]);
  const index = useSavedResource(read, nonce);
  const detailRead = useCallback(() => selection === "" ? Promise.resolve(null) : client.savedArchiveReport(selection), [client, selection]);
  const detail = useSavedResource(detailRead, nonce);
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Archive" icon={<Archive className={dsIcon.md} />} />
    <div className="flex flex-wrap items-center justify-between gap-[var(--ds-space-snug)] px-[var(--ds-space-base)] py-[var(--ds-space-snug)]">
      <span role="group" aria-label="Archive view" className="inline-flex items-center gap-[var(--ds-space-hair)] rounded-[var(--ds-radius-md)] border border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] p-[var(--ds-space-hair)]">
        <Button size="sm" variant={view === "runs" ? "secondary" : "ghost"} aria-pressed={view === "runs"} onClick={() => onView("runs")}>Saved reports</Button>
        <Button size="sm" variant={view === "versions" ? "secondary" : "ghost"} aria-pressed={view === "versions"} onClick={() => onView("versions")}>Versions &amp; bumps</Button>
      </span>
      <Button size="sm" variant="secondary" icon={<RefreshCw className={dsIcon.sm} />} onClick={refresh}>Refresh</Button>
    </div>
    {view === "versions" ? <SavedVersions actorId={actorId} nonce={nonce} onChanged={refresh} onArchive={() => {setQuery({limit:50});onSelection("");onView("runs");}} />
      : <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-[var(--ds-space-base)] overflow-auto p-[var(--ds-space-base)]">
        <Panel aria-label="Saved reports"><PanelHeader title="Saved reports" headingLevel={2} meta={index.state === "loaded" ? `${String(index.value.items.length)} shown` : undefined} /><PanelBody className={`${dsText.body} min-w-0 space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>
          <form aria-label="Filter saved reports" className="grid grid-cols-1 gap-[var(--ds-space-base)]" onSubmit={event => event.preventDefault()}>
            <div className="grid grid-cols-1 gap-[var(--ds-space-base)] min-[840px]:grid-cols-2">
              <label>Workflow<Input value={query.workflow ?? ""} onChange={event => filter("workflow", event.target.value)} /></label>
              <label>Title<Input value={query.title ?? ""} onChange={event => filter("title", event.target.value)} /></label>
              <label>Version<Input value={query.descriptorVersion ?? ""} onChange={event => filter("descriptorVersion", event.target.value)} /></label>
              <label>Outcome<Select value={query.outcome ?? ""} onChange={event => filter("outcome", event.target.value)}><option value="">All outcomes</option>{["done", "failed", "cancelled", "discarded", "interrupted", "superseded"].map(outcome => <option key={outcome} value={outcome}>{outcome}</option>)}</Select></label>
            </div>
            <Disclosure summaryClassName={cn(dsText.meta, "text-[color:var(--ds-fg-secondary)]")} summary={<>Date filters{dateFilterSummary !== "" && <span className="ml-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]">Active: {dateFilterSummary}</span>}</>}>
              <div className="mt-[var(--ds-space-base)] grid grid-cols-1 gap-[var(--ds-space-base)] min-[840px]:grid-cols-2">
                {([ ["from", "Completed from (UTC)"], ["to", "Completed through (UTC)"], ["capturedFrom", "Captured from (UTC)"], ["capturedTo", "Captured through (UTC)"]] as const).map(([key, label]) => <DateInput key={key} label={label} value={query[key]?.slice(0, 10) ?? ""} onChange={date => filter(key, date === "" ? "" : `${date}${key === "to" || key === "capturedTo" ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)} />)}
              </div>
            </Disclosure>
            <Button type="button" variant="secondary" onClick={() => changeQuery({ limit: 50 })}>Clear filters</Button>
          </form>
          {index.state === "loading" ? <p role="status">Loading saved reports…</p> : index.state === "error" ? <p role="alert">{index.message}</p>
            : <>{query.after !== undefined && <Button onClick={() => changeQuery(savedFilterQuery(query, "title", query.title ?? ""))}>First reports</Button>}<SavedReportList index={index.value} selection={selection} onSelection={onSelection} onNext={() => { if (index.value.next !== null) changeQuery({ ...query, after: index.value.next }); }} /></>}
        </PanelBody></Panel>
        <Panel aria-label="Selected saved report"><PanelBody className={`${dsText.body} min-w-0 space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>{selection === "" ? <p>Select a saved report.</p> : detail.state === "loading" ? <p role="status">Loading saved report…</p> : detail.state === "error" ? <p role="alert">{detail.message}</p>
          : detail.value === null ? <p>Select a saved report.</p>
            : detail.value.state === "deleted" ? <SavedArchiveDeletionStatus status={detail.value.deletion} onRefresh={refresh} />
              : detail.value.state !== "available" ? <p role="status">Report {detail.value.state}: {detail.value.reason}</p>
                : <><SavedArchiveReport report={detail.value} /><SavedArchiveDeletion key={`${detail.value.runId}:${detail.value.archiveFingerprint}`} report={detail.value} actorId={actorId} onChanged={refresh} /></>}</PanelBody></Panel>
      </div>}
  </div>;
}
function SavedReportList({ index, selection, onSelection, onNext }: { index: SavedArchiveIndexWire; selection: string; onSelection: (id: string) => void; onNext: () => void }) {
  if (index.items.length === 0) return <p>No saved reports match this query.</p>;
  return <><Table label="Saved reports"><THead><TR><TH>Report</TH><TH>Outcome</TH><TH>Completed</TH></TR></THead><TBody>{index.items.map(report => {
    const selected = selection === report.runId;
    return <TR key={report.runId} aria-selected={selected}><TD><Button variant={selected ? "secondary" : "ghost"} aria-pressed={selected} onClick={() => onSelection(report.runId)}>{report.title}</Button><p>{report.workflow} · v{report.descriptorVersion}</p></TD><TD>{savedOutcomeLabel(report.outcome)}</TD><TD>{report.completedAt}</TD></TR>;
  })}</TBody></Table>{index.next !== null && <Button onClick={onNext}>Next reports</Button>}</>;
}

export function SavedArchiveDeletion({ report, actorId, onChanged }: { report: SavedArchiveReportWire; actorId: string; onChanged: () => void }) {
  const client = useDashboardClient(); const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState("");
  const active = useRef(true);
  const pending = useRef(false);
  const request = useRef<ReturnType<typeof savedCommandEnvelope> & { type: "delete-archived-run"; target: { archivedRunId: string; archiveFingerprint: string } } | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const remove = () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setProblem("");
    request.current ??= { ...savedCommandEnvelope(actorId), type: "delete-archived-run", target: { archivedRunId: report.runId, archiveFingerprint: report.archiveFingerprint } };
    void client.executeCommand(request.current).then(result => {
      const settled = settleCommandResult(result);
      if (settled.kind === "applied") { setConfirming(false); onChanged(); }
      else if (active.current) setProblem(settled.reason === "rejected"
        ? `That command was refused (code ${settled.code}). ${settled.message}`
        : settled.problem);
    }, async (error: unknown) => {
      if (!active.current) return;
      const message = error instanceof Error ? error.message : "Deletion failed.";
      try {
        const readback = await client.savedArchiveReport(report.runId);
        if (!active.current) return;
        if (readback.state === "deleted") { setConfirming(false); onChanged(); return; }
        setProblem(`Deletion could not be confirmed (${message}). The latest report status is ${readback.state}. Refresh the report before deciding what to do next.`);
      } catch (readbackError: unknown) {
        if (active.current) setProblem(`Deletion could not be confirmed (${message}). Status check failed: ${readbackError instanceof Error ? readbackError.message : "unknown error"}`);
      }
    }).finally(() => { pending.current = false; if (active.current) setBusy(false); });
  };
  return <section aria-label="Delete saved report" className="border-t border-[color:var(--ds-border)] pt-[var(--ds-space-loose)]">
    <Dialog open={confirming} onOpenChange={open => { if (!busy) { setConfirming(open); if (open) setProblem(""); } }}>
      <DialogTrigger asChild><Button variant="danger">Delete saved report</Button></DialogTrigger>
      <DialogContent size="md" title="Delete saved report?" description={report.title}>
        <DialogBody className="flex flex-col gap-[var(--ds-space-base)]">
          <p>This permanently deletes this report and files used only by it.</p>
          <p>This cannot be undone. A later run may submit the same work again.</p>
          {problem !== "" && <p role="alert" className="m-0">{problem}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete this report"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

export function SavedArchiveDeletionStatus({ status, onRefresh }: { status: SavedArchiveDeletionStatusWire; onRefresh: () => void }) {
  const client = useDashboardClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const resume = status.command.state === "pending" ? status.command.resumeRequest : undefined;
  const removed = status.removed.reduce((sum, entry) => sum + entry.rows, 0);
  const execute = () => {
    if (resume === undefined || busy) return;
    setBusy(true);
    setProblem("");
    void client.executeCommand(resume).then(result => {
      const settled = settleCommandResult(result);
      if (settled.kind !== "applied") setProblem(settled.reason === "rejected" ? `That command was refused (code ${settled.code}). ${settled.message}` : settled.problem);
      onRefresh();
    }, (error: unknown) => {
      setProblem(error instanceof Error ? error.message : "Deletion resume failed.");
      onRefresh();
    }).finally(() => setBusy(false));
  };
  return <section aria-label="Saved report deletion status" className="space-y-[var(--ds-space-base)]">
    <h2 className={dsText.title}>Saved report deleted</h2>
    <p>Canonical removal recorded {status.deletedAt} · {removed} authority rows removed.</p>
    <p>File cleanup: {status.cleanup.state === "complete" ? `complete (${status.cleanup.fileCount} retained file references checked)`
      : status.cleanup.state === "pending" ? `pending (${status.cleanup.fileCount} retained file references)`
        : `unavailable · ${status.cleanup.reason}`}</p>
    <p>Command settlement: {status.command.state === "complete" ? `complete ${status.command.completedAt}`
      : status.command.state === "pending" ? status.command.reason : `unavailable · ${status.command.reason}`}</p>
    {resume !== undefined && <Button disabled={busy} onClick={execute}>Resume deletion cleanup</Button>}
    {problem && <p role="alert">{problem}</p>}
  </section>;
}
