import { Archive,Download,RefreshCw,ZoomIn } from "lucide-react";
import { useCallback,useEffect,useRef,useState, type ReactNode } from "react";
import type { SavedArchiveDeletionStatusWire,SavedArchiveIndexWire,SavedArchiveQuery,SavedArchiveReportWire,SavedVersionIndexWire } from "../../domain/dashboard/archive.js";
import { formatRuntimeVersion } from "../../domain/archive/runtime-version.js";
import { settleCommandResult } from "../app/command-result.js";
import { Badge,Button,ButtonLink,DateInput,Dialog,DialogBody,DialogContent,DialogFooter,DialogTrigger,Disclosure,dsIcon,dsText,Input,PageHeader,Panel,PanelBody,PanelHeader,Select,Table,TBody,TD,TH,THead,TR,Textarea } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useArchiveClient as useDashboardClient } from "../state/archive-client.js";
import { savedCell,savedCommandEnvelope,savedDateFilterSummary,savedDownload,savedFilterQuery,savedOutcomeLabel,savedPlanRequest,useSavedResource } from "./archive-report-model.js";
import { archiveFieldRows } from "../../domain/dashboard/archive-export.js";

export function SavedArchiveReport({ report, deletion }: { report: SavedArchiveReportWire; deletion?: ReactNode }) {
  const defaultSection = report.sections.length === 0 && report.versionChange === undefined ? 1 : 0;
  const [active, setActive] = useState(() => ({ runId: report.runId, section: defaultSection }));
  const [search, setSearch] = useState(() => ({ runId: report.runId, value: "" }));
  const activeSection = active.runId === report.runId ? active.section : defaultSection;
  const fieldSearch = search.runId === report.runId ? search.value : "";
  const sectionItems = [...report.sections.map((section, index) => ({ label: index === 0 && section.title.startsWith("Identity and ") ? "Workflow details" : section.title, key: index })),
    ...(report.versionChange === undefined ? [] : [{ label: "Recorded version change", key: report.sections.length }]),
    { label: "Retained files", key: report.sections.length + 1 },
    { label: "Record details", key: report.sections.length + 2 },
    { label: "All fields", key: report.sections.length + 3 }];
  const fields = archiveFieldRows([report]).filter(([, path, type, value]) => `${path} ${type} ${value}`.toLowerCase().includes(fieldSearch.toLowerCase()));
  const dashboardVersion = report.runtimeVersion === undefined ? "Not recorded" : formatRuntimeVersion(report.runtimeVersion.dashboard);
  const workflowVersion = report.runtimeVersion === undefined ? "Not recorded" : formatRuntimeVersion(report.runtimeVersion.workflow);
  return <article aria-label="Saved archive report" className={`${dsText.body} min-w-0 space-y-[var(--ds-space-page)]`}>
    <dl className={cn(dsText.meta, "flex flex-wrap gap-x-[var(--ds-space-section)] gap-y-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-loose)]")}>
      <div><dt>Dashboard version</dt><dd className="m-0 text-[color:var(--ds-fg)]">{dashboardVersion}</dd></div>
      <div><dt>Workflow version</dt><dd className="m-0 text-[color:var(--ds-fg)]">{workflowVersion}</dd></div>
      {report.runtimeVersion !== undefined && <div><dt>Version attribution</dt><dd className="m-0 text-[color:var(--ds-fg)]">{report.runtimeVersion.state}</dd></div>}
      <div><dt>Archived</dt><dd className="m-0 text-[color:var(--ds-fg)]"><SavedArchiveTime value={report.capturedAt} /></dd></div>
      <div><dt>Outcome</dt><dd className="m-0 text-[color:var(--ds-fg)]">{savedOutcomeLabel(report.outcome)}</dd></div>
      <div><dt>Retained files</dt><dd className="m-0 text-[color:var(--ds-fg)]">{report.files.length}</dd></div>
    </dl>
    <div className="grid min-w-0 gap-[var(--ds-space-section)] md:grid-cols-[11.5rem_minmax(0,1fr)]">
      <nav aria-label="Run sections" className="flex min-w-0 flex-col gap-[var(--ds-space-tight)] md:border-r md:border-[color:var(--ds-border)] md:pr-[var(--ds-space-cozy)]"><span className={cn(dsText.caps, "px-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")}>Archived report</span>{sectionItems.map(item => <Button key={item.key} variant={activeSection === item.key ? "secondary" : "ghost"} aria-current={activeSection === item.key ? "page" : undefined} className="min-h-[var(--ds-h-bar)] w-full min-w-0 justify-start whitespace-normal break-words px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)] text-left [overflow-wrap:anywhere]" onClick={() => setActive({ runId: report.runId, section: item.key })}>{item.label}</Button>)}<p className={cn(dsText.meta, "px-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")}>The saved record, as it was when archived.</p></nav>
      <div className="min-w-0 space-y-[var(--ds-space-base)]"><div className="flex flex-wrap items-center justify-between gap-[var(--ds-space-base)]"><h2 className={dsText.title}>{sectionItems.find(item => item.key === activeSection)?.label}</h2><span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Saved at archive time</span></div>
    {report.sections.map((section, index) => activeSection !== index ? null : <section key={`${String(index)}:${section.title}`} aria-label={section.title} className="min-w-0 overflow-hidden rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)]">
      <h3 className={cn(dsText.ui, "m-0 border-b border-[color:var(--ds-border)] px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)] font-semibold")}>{section.title}</h3>
      {section.kind === "unavailable" ? <p role="status" className="m-[var(--ds-space-cozy)] break-words [overflow-wrap:anywhere]">{section.reason}</p> : section.kind === "text" ? <pre className="m-[var(--ds-space-cozy)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{section.text}</pre>
        : section.kind === "values" ? section.values.length === 0 ? <p className="m-[var(--ds-space-cozy)]">No saved values were captured.</p> : <dl className="grid min-w-0 grid-cols-1 md:grid-cols-2">{section.values.map((cell, n) => <div key={n} className="flex min-h-[46px] min-w-0 flex-wrap items-center justify-between gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)] border-b border-[color:var(--ds-border)] px-[var(--ds-space-loose)] py-[var(--ds-space-snug)] md:[&:nth-child(odd)]:border-r"><dt className="min-w-0 break-words text-[color:var(--ds-fg-muted)] [overflow-wrap:anywhere]">{cell.label}</dt><dd className="m-0 min-w-0 break-words text-right font-medium [overflow-wrap:anywhere]">{savedCell(cell.value)}</dd></div>)}</dl>
          : <div className="overflow-x-auto"><Table className="min-w-max" label={section.title}><THead><TR>{section.columns.map((column, n) => <TH key={n}>{column}</TH>)}</TR></THead><TBody>{section.rows.length === 0 ? <TR><TD colSpan={section.columns.length}>No saved rows were captured.</TD></TR> : section.rows.map((row, n) => <TR key={n}>{row.map((cell, m) => <TD key={m}>{savedCell(cell)}</TD>)}</TR>)}</TBody></Table></div>}
    </section>)}
    {report.versionChange !== undefined && activeSection === report.sections.length && <section aria-label="Recorded version change" className="min-w-0 rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]"><h3 className={cn(dsText.ui, "break-words font-semibold [overflow-wrap:anywhere]")}>{report.versionChange.change.what}</h3>
      <p className="break-words [overflow-wrap:anywhere]">{report.versionChange.change.why}</p><dl className={cn(dsText.meta, "grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)] sm:grid-cols-2")}><div><dt>Change ID</dt><dd className="m-0 break-all">{report.versionChange.changeId}</dd></div><div><dt>Change kind</dt><dd className="m-0">{report.versionChange.change.kind}</dd></div><div><dt>Reviewed</dt><dd className="m-0 break-words"><SavedArchiveTime value={report.versionChange.reviewedAt} /></dd></div><div><dt>Started</dt><dd className="m-0 break-words"><SavedArchiveTime value={report.versionChange.startedAt} /></dd></div><div><dt>Scope</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{report.versionChange.scope.kind === "application" ? `Application ${report.versionChange.scope.applicationVersion}` : report.versionChange.scope.workflowIds.join(", ")}</dd></div><div><dt>Target version</dt><dd className="m-0 break-words">{report.versionChange.targetVersion}</dd></div><div><dt>Applied by</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{report.versionChange.appliedBy}</dd></div><div><dt>Commit</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{report.versionChange.change.commit.state} · {report.versionChange.change.commit.state === "present" ? report.versionChange.change.commit.value : report.versionChange.change.commit.reason}</dd></div></dl></section>}
    {activeSection === report.sections.length + 1 && <section aria-label="Retained attachments" className="flex min-w-0 flex-col gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]">
      {report.files.length === 0 ? <p className="m-0">No attachment was retained with this report.</p> : report.files.map(file =>
        <div key={`${report.runId}:${file.digest}`} className="min-w-0"><SavedAttachment runId={report.runId} digest={file.digest} name={file.name} mediaType={file.mediaType} />
          <p className={cn(dsText.meta, "break-all")}>{file.mediaType} · {file.byteLength} bytes · digest {file.digest}{file.artifactIds === undefined ? "" : ` · artifacts ${file.artifactIds.join(", ")}`}</p></div>)}
    </section>}
    {activeSection === report.sections.length + 2 && <section aria-label="Record details" className="rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]">
      <dl className="grid min-w-0 grid-cols-1 gap-[var(--ds-space-snug)] sm:grid-cols-2">{([
        ["Report state", report.state], ["Title", report.title], ["Run ID", report.runId], ["Transfer ID", report.transferId],
        ["Workflow", report.workflow], ["Item ID", report.itemId], ["Attempt", report.attempt], ["Run number", report.runNumber],
        ["Descriptor version", report.descriptorVersion], ["Outcome", report.outcome], ["Publication", report.publicationState],
        ["Completed", report.completedAt], ["Captured", report.capturedAt], ["Report integrity", report.reportIntegrity],
        ["Dashboard runtime version", report.runtimeVersion === undefined ? undefined : formatRuntimeVersion(report.runtimeVersion.dashboard)],
        ["Workflow runtime version", report.runtimeVersion === undefined ? undefined : formatRuntimeVersion(report.runtimeVersion.workflow)],
        ["Runtime attribution", report.runtimeVersion?.state], ["Version change ID", report.versionChange?.changeId],
        ["Public fingerprint", report.archiveFingerprint],
      ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[color:var(--ds-fg-muted)]">{label}</dt><dd className="m-0 break-all">{savedRecordDetailValue(label, value)}</dd></div>)}</dl>
      {deletion}
    </section>}
    {activeSection === report.sections.length + 3 && <section aria-label="All fields" className="rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]">
      <label className="block"><span className="sr-only">Search all report fields</span><Input value={fieldSearch} onChange={event => setSearch({ runId: report.runId, value: event.target.value })} placeholder="Search all report fields" /></label>
      <p className={dsText.meta}>{fields.length} matching fields · public retained record</p>
      <div className="overflow-x-auto"><Table className="min-w-max" label="All public retained fields"><THead><TR><TH>Field path</TH><TH>Type</TH><TH>Value</TH></TR></THead><TBody>{fields.map(([, path, type, value]) => <TR key={path}><TD>{path}</TD><TD>{type}</TD><TD>{archiveFieldValue(type, value)}</TD></TR>)}</TBody></Table></div>
    </section>}
      </div>
    </div>
  </article>;
}
function savedMetadataValue(value: string | number | boolean | null | undefined): string {
  return value === undefined ? "Absent" : savedCell(value);
}
function savedRecordDetailValue(label: string, value: string | number | boolean | null | undefined): ReactNode {
  return (label === "Completed" || label === "Captured") && typeof value === "string"
    ? <SavedArchiveTime value={value} />
    : savedMetadataValue(value);
}
function SavedArchiveTime({ value }: { value: string }) {
  const instant = new Date(value);
  const label = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(instant);
  return <time dateTime={value} title={value}>{label} UTC</time>;
}
function archiveFieldValue(type: string, value: string): string {
  if (type === "null") return "null";
  return type === "string" && value === "" ? '""' : value;
}
function SavedAttachment({ runId, digest, name, mediaType }: { runId: string; digest: string; name: string; mediaType: string }) {
  const client = useDashboardClient();
  const [open, setOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const inspectButton = useRef<HTMLButtonElement>(null);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) requestAnimationFrame(() => inspectButton.current?.focus());
  };
  const read = useCallback(async () => savedDownload(await client.savedArchiveFile(runId, digest), runId, digest), [client, runId, digest]);
  const resource = useSavedResource(read);
  if (resource.state === "loading") return <p role="status">Checking {name}…</p>;
  if (resource.state === "error") return <p role="alert">{name}: {resource.message}</p>;
  const file = resource.value;
  if (file.state !== "available") return <p role="status">{name}: {file.state === "missing" ? file.reason : file.message}</p>;
  const image = /^image\//u.test(mediaType);
  return <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-base)]">
    {image && <Button ref={inspectButton} className="max-w-full whitespace-normal break-all" icon={<ZoomIn />} onClick={() => { setImageError(false); setOpen(true); }}>Inspect {name}</Button>}
    <ButtonLink className="max-w-full whitespace-normal break-all" href={file.downloadUrl} download={name}>{name}</ButtonLink>
    {image && <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent size="lg" title={name} description="Verified retained image">
        <DialogBody className="flex min-h-0 items-center justify-center">
          {imageError
            ? <p role="alert">{name}: retained image bytes could not be decoded.</p>
            : <img src={file.downloadUrl} alt={name} loading="lazy" className="h-auto max-h-full max-w-full object-contain" onError={() => setImageError(true)} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => changeOpen(false)}>Close</Button>
          <ButtonLink href={file.downloadUrl} download={name} icon={<Download />}>Download image</ButtonLink>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </div>;
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
  return <section aria-label="Delete saved report" className="border-t border-[color:var(--ds-border)] pt-[var(--ds-space-cozy)]">
    <Dialog open={confirming} onOpenChange={open => { if (!busy) { setConfirming(open); if (open) setProblem(""); } }}>
      <DialogTrigger asChild><Button variant="danger">Delete saved report</Button></DialogTrigger>
      <DialogContent size="md" title={`Delete ${report.title}?`} description="Deleting this report is permanent and cannot be undone.">
        <DialogBody className="flex flex-col gap-[var(--ds-space-base)]">
          <p>This deletes the saved report “{report.title}” for {report.workflow} (descriptor {report.descriptorVersion}, completed {report.completedAt}) and its exclusively owned retained files, including transaction evidence.</p>
          <p>If no other run owns this report&apos;s permanent idempotency keys, deleting it releases them. A later run could submit the same write again.</p>
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
