import { Archive,ArrowLeft,Download,RefreshCw,ZoomIn } from "lucide-react";
import { useCallback,useEffect,useRef,useState } from "react";
import type { SavedArchiveDeletionStatusWire,SavedArchiveIndexWire,SavedArchiveQuery,SavedArchiveReportWire,SavedVersionIndexWire } from "../../domain/dashboard/archive.js";
import { settleCommandResult } from "../app/command-result.js";
import { Badge,Button,ButtonLink,DateInput,Dialog,DialogBody,DialogContent,DialogFooter,DialogTrigger,dsIcon,dsText,Input,PageHeader,Panel,PanelBody,PanelHeader,Select,Table,TBody,TD,TH,THead,TR,Textarea } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useArchiveClient as useDashboardClient } from "../state/archive-client.js";
import { savedCell,savedCommandEnvelope,savedDateFilterSummary,savedDownload,savedFilterQuery,savedOutcomeLabel,savedPlanRequest,savedReportExport,useSavedResource } from "./archive-report-model.js";

export function SavedArchiveReport({ report }: { report: SavedArchiveReportWire }) {
  const exported = savedReportExport(report);
  const hasPriorAttachmentSection = report.sections.length > 0 || report.versionChange !== undefined;
  return <article aria-label="Saved archive report" className={`${dsText.body} min-w-0 space-y-[var(--ds-space-cozy)]`}>
    <header className="flex min-w-0 flex-col gap-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-cozy)]">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-[var(--ds-space-base)]">
        <div className="min-w-0"><h2 className={cn(dsText.title, "break-words font-semibold")}>{report.title}</h2><p className={cn(dsText.meta, "mt-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>{report.workflow} · version {report.descriptorVersion}</p></div>
        <div className="flex flex-col items-start gap-[var(--ds-space-tight)] sm:items-end">
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Outcome</span>
          <Badge tone="neutral">{savedOutcomeLabel(report.outcome)}</Badge>
        </div>
      </div>
      <dl className={cn(dsText.meta, "grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)] sm:grid-cols-2")}>
        <div><dt>Completed</dt><dd className="m-0 break-words text-[color:var(--ds-fg)]">{report.completedAt}</dd></div>
        <div><dt>Captured</dt><dd className="m-0 break-words text-[color:var(--ds-fg)]">{report.capturedAt}</dd></div>
      </dl>
      <p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>Saved record · read-only</p>
      <details className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}><summary className="cursor-pointer">Report identity</summary><p className="mb-0 break-all">{report.runId}</p></details>
      <ButtonLink variant="secondary" className="self-start" href={exported.href} download={exported.filename} icon={<Download aria-hidden />}>Export report</ButtonLink>
    </header>
    {report.sections.map((section, index) => <section key={`${String(index)}:${section.title}`} aria-label={section.title} className={cn("min-w-0 pt-[var(--ds-space-cozy)]", index > 0 && "border-t border-[color:var(--ds-border)]")}>
      <h3 className={cn(dsText.ui, "mb-[var(--ds-space-snug)] font-semibold")}>{section.title}</h3>
      {section.kind === "unavailable" ? <p role="status" className="mb-0">{section.reason}</p> : section.kind === "text" ? <pre className="m-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{section.text}</pre>
        : section.kind === "values" ? <dl>{section.values.map((cell, n) => <div key={n} className="grid grid-cols-1 gap-x-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] py-[var(--ds-space-tight)] sm:grid-cols-2"><dt className="break-words text-[color:var(--ds-fg-muted)]">{cell.label}</dt><dd className="m-0 break-words">{savedCell(cell.value)}</dd></div>)}</dl>
          : <div className="overflow-x-auto"><Table label={section.title}><THead><TR>{section.columns.map((column, n) => <TH key={n}>{column}</TH>)}</TR></THead><TBody>{section.rows.map((row, n) => <TR key={n}>{row.map((cell, m) => <TD key={m}>{savedCell(cell)}</TD>)}</TR>)}</TBody></Table></div>}
    </section>)}
    {report.versionChange !== undefined && <section aria-label="Recorded version change" className="min-w-0 border-t border-[color:var(--ds-border)] pt-[var(--ds-space-cozy)]"><h3 className={cn(dsText.ui, "font-semibold")}>{report.versionChange.change.what}</h3>
      <p>{report.versionChange.change.why}</p><dl className={cn(dsText.meta, "grid min-w-0 grid-cols-1 gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)] sm:grid-cols-2")}><div><dt>Reviewed</dt><dd className="m-0 break-words">{report.versionChange.reviewedAt}</dd></div><div><dt>Started</dt><dd className="m-0 break-words">{report.versionChange.startedAt}</dd></div><div><dt>Scope</dt><dd className="m-0 break-words">{report.versionChange.scope.kind === "application" ? `Application ${report.versionChange.scope.applicationVersion}` : report.versionChange.scope.workflowIds.join(", ")}</dd></div><div><dt>Version</dt><dd className="m-0">{report.versionChange.change.kind} · target {report.versionChange.targetVersion}</dd></div><div><dt>Applied by</dt><dd className="m-0 break-words">{report.versionChange.appliedBy}</dd></div><div><dt>Commit</dt><dd className="m-0 break-words">{report.versionChange.change.commit.state === "present" ? report.versionChange.change.commit.value : report.versionChange.change.commit.reason}</dd></div></dl></section>}
    <section aria-label="Retained attachments" className={cn("flex min-w-0 flex-col gap-[var(--ds-space-snug)]", hasPriorAttachmentSection && "border-t border-[color:var(--ds-border)] pt-[var(--ds-space-cozy)]")}><h3 className={cn(dsText.ui, "font-semibold")}>Retained attachments</h3>
      {report.files.length === 0 ? <p>No attachment was retained with this report.</p> : report.files.map(file =>
        <SavedAttachment key={`${report.runId}:${file.digest}`} runId={report.runId} digest={file.digest} name={file.name} mediaType={file.mediaType} />)}
    </section>
  </article>;
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
  return <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
    {image && <Button ref={inspectButton} icon={<ZoomIn />} onClick={() => { setImageError(false); setOpen(true); }}>Inspect {name}</Button>}
    <ButtonLink href={file.downloadUrl} download={name} icon={<Download />}>{name}</ButtonLink>
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
export function SavedArchiveWorkspace({ selection, view, actorId, onSelection, onView, onClose }: {
  selection: string; view: "runs" | "versions"; actorId: string; onSelection: (id: string) => void; onView: (view: "runs" | "versions") => void; onClose: () => void;
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
    <PageHeader title="Archive" icon={<Archive className={dsIcon.md} />} back={<Button size="toolbar" icon={<ArrowLeft className={dsIcon.md} />} onClick={onClose}>Back</Button>} actions={<><Button size="toolbar" aria-pressed={view === "runs"} onClick={() => onView("runs")}>Saved reports</Button><Button size="toolbar" aria-pressed={view === "versions"} onClick={() => onView("versions")}>Versions &amp; bumps</Button><Button size="toolbar" icon={<RefreshCw className={dsIcon.md} />} onClick={refresh}>Refresh</Button></>} />
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
            <details><summary className={cn(dsText.meta, "cursor-pointer text-[color:var(--ds-fg-secondary)]")}>Date filters{dateFilterSummary !== "" && <span className="ml-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]">Active: {dateFilterSummary}</span>}</summary>
              <div className="mt-[var(--ds-space-base)] grid grid-cols-1 gap-[var(--ds-space-base)] min-[840px]:grid-cols-2">
                {([ ["from", "Completed from (UTC)"], ["to", "Completed through (UTC)"], ["capturedFrom", "Captured from (UTC)"], ["capturedTo", "Captured through (UTC)"]] as const).map(([key, label]) => <DateInput key={key} label={label} value={query[key]?.slice(0, 10) ?? ""} onChange={date => filter(key, date === "" ? "" : `${date}${key === "to" || key === "capturedTo" ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)} />)}
              </div>
            </details>
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

function SavedArchiveDeletion({ report, actorId, onChanged }: { report: SavedArchiveReportWire; actorId: string; onChanged: () => void }) {
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
          <p>This deletes the saved report “{report.title}” for {report.workflow} (version {report.descriptorVersion}, completed {report.completedAt}) and its exclusively owned retained files, including transaction evidence.</p>
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

function SavedArchiveDeletionStatus({ status, onRefresh }: { status: SavedArchiveDeletionStatusWire; onRefresh: () => void }) {
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
