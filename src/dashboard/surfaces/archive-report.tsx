import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, RefreshCw, Download } from "lucide-react";
import type { SavedArchiveReportWire, SavedArchiveQuery, SavedArchiveIndexWire, SavedVersionIndexWire } from "../../domain/dashboard/archive.js";
import { settleCommandResult } from "../app/command-result.js";
import { useDashboardClient } from "../state/client-context.js";
import { Button, ButtonLink, Input, Select, PageHeader, Panel, PanelBody, PanelHeader, Table, THead, TBody, TR, TH, TD, StatusPill, dsText } from "../ds/ui.js";
import { dsStatusOf } from "./status-model.js";
import { savedCell, savedCommandEnvelope, savedPlanRequest, useSavedResource, savedDownload, savedFilterQuery } from "./archive-report-model.js";

export function SavedArchiveReport({ report }: { report: SavedArchiveReportWire }) {
  return <article aria-label="Saved archive report" className={`${dsText.body} min-w-0 space-y-[var(--ds-space-cozy)]`}>
    <header><h2 className={dsText.title}>{report.title}</h2><p>{report.workflow} · version {report.descriptorVersion}</p>
      <p>Outcome: {report.outcome}</p><p className="break-all">Report {report.runId}</p><p>Completed {report.completedAt} · Captured {report.capturedAt}</p><p>Saved record · read-only</p></header>
    {report.sections.map((section, index) => <section key={`${String(index)}:${section.title}`} aria-label={section.title}>
      <h3 className={dsText.ui}>{section.title}</h3>
      {section.kind === "unavailable" ? <p>{section.reason}</p> : section.kind === "text" ? <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{section.text}</pre>
        : section.kind === "values" ? <dl>{section.values.map((cell, n) => <div key={n} className="grid grid-cols-2 gap-[var(--ds-space-base)] border-b py-[var(--ds-space-tight)]"><dt className="break-words">{cell.label}</dt><dd className="break-words">{savedCell(cell.value)}</dd></div>)}</dl>
          : <div className="overflow-auto"><Table label={section.title}><THead><TR>{section.columns.map((column, n) => <TH key={n}>{column}</TH>)}</TR></THead><TBody>{section.rows.map((row, n) => <TR key={n}>{row.map((cell, m) => <TD key={m}>{savedCell(cell)}</TD>)}</TR>)}</TBody></Table></div>}
    </section>)}
    {report.versionChange !== undefined && <section aria-label="Recorded version change"><h3 className={dsText.ui}>{report.versionChange.change.what}</h3>
      <p>{report.versionChange.change.why}</p><p>Reviewed {report.versionChange.reviewedAt} · Started {report.versionChange.startedAt}</p><p>Scope: {report.versionChange.scope.kind === "application" ? `Application ${report.versionChange.scope.applicationVersion}` : report.versionChange.scope.workflowIds.join(", ")}</p><p>{report.versionChange.change.kind} · target {report.versionChange.targetVersion} · applied by {report.versionChange.appliedBy}</p>
      <p>{report.versionChange.change.commit.state === "present" ? report.versionChange.change.commit.value : report.versionChange.change.commit.reason}</p></section>}
    <section aria-label="Retained attachments"><h3 className={dsText.ui}>Retained attachments</h3>
      {report.files.length === 0 ? <p>No attachment was retained with this report.</p> : report.files.map(file =>
        <SavedAttachment key={`${report.runId}:${file.digest}`} runId={report.runId} digest={file.digest} name={file.name} />)}
    </section>
  </article>;
}
function SavedAttachment({ runId, digest, name }: { runId: string; digest: string; name: string }) {
  const client = useDashboardClient();
  const read = useCallback(async () => savedDownload(await client.savedArchiveFile(runId, digest), runId, digest), [client, runId, digest]);
  const resource = useSavedResource(read);
  if (resource.state === "loading") return <p role="status">Checking {name}…</p>;
  if (resource.state === "error") return <p role="alert">{name}: {resource.message}</p>;
  const file = resource.value;
  return file.state === "available" ? <ButtonLink href={file.downloadUrl} download={name} icon={<Download />}>{name}</ButtonLink>
    : <p role="status">{name}: {file.state === "missing" ? file.reason : file.message}</p>;
}
function SavedVersions({ actorId, nonce, onChanged, onArchive }: { actorId: string; nonce: number; onChanged: () => void; onArchive: () => void }) {
  const client = useDashboardClient();
  const read = useCallback(() => client.savedArchiveVersions(), [client]);
  const resource = useSavedResource(read, nonce);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
      }
    }, (error: unknown) => setMessage(error instanceof Error ? error.message : "Version command failed.")).finally(() => {pending.current=false;setBusy(false);});
  };
  return <Panel aria-label="Versions and saved changes"><PanelBody className={`${dsText.body} space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>
    {resource.state === "loading" ? <p role="status">Loading versions…</p> : resource.state === "error" ? <p role="alert">{resource.message}</p>
      : <><SavedVersionForm wire={resource.value} actorId={actorId} busy={busy} onCommand={execute} />
        <p>{resource.value.historicalChanges} historical version records retained.</p>
        {resource.value.changes.map(change => <section key={change.changeId} className="border-b py-[var(--ds-space-cozy)]">
          <h3>{change.change.what}</h3><p>{change.change.why}</p><p>{change.state} · target {change.targetVersion} · {change.memberRunIds.length} reviewed runs · {change.completedRunIds.length} archived</p>
          {change.blockerRunIds.length > 0 && <p role="status">Blocked by: {change.blockerRunIds.join(", ")}</p>}
          {(change.state === "planned" || change.state === "applying") && !appliedChanges.has(change.changeId) && <Button disabled={busy || change.blockerRunIds.length > 0} onClick={() => execute({ ...savedCommandEnvelope(actorId), type: "apply-version-bump", target: { versionPlanId: change.changeId, expectedVersion: 1 }, payload: { planFingerprint: change.reviewFingerprint } },change.changeId)}>Apply reviewed change</Button>}
        </section>)}</>}
    {message && <div role="status"><pre className="whitespace-pre-wrap break-words">{message}</pre><Button onClick={onArchive}>Open the archive</Button></div>}
  </PanelBody></Panel>;
}
function SavedVersionForm({ wire, actorId, busy, onCommand }: { wire: SavedVersionIndexWire; actorId: string; busy: boolean; onCommand: (request: unknown) => void }) {
  const [workflow, setWorkflow] = useState(wire.workflows[0]?.workflow ?? "");
  const [kind, setKind] = useState<"major" | "minor">("major");
  const [what, setWhat] = useState(""); const [why, setWhy] = useState("");
  return <form onSubmit={event => { event.preventDefault(); onCommand(savedPlanRequest(wire, actorId, workflow, kind, what, why)); }} className="space-y-[var(--ds-space-base)]">
    <h2>Review a version change</h2><p>A major change archives reviewed terminal prior-version runs. A minor change archives none.</p>
    <label>Scope<Select value={workflow} onChange={event => setWorkflow(event.target.value)}><option value="application">Dashboard update · every workflow</option>{wire.workflows.map(row => <option key={row.workflow} value={row.workflow}>{row.label} · v{row.version}</option>)}</Select></label>
    <label>Change kind<Select value={kind} onChange={event => setKind(event.target.value === "minor" ? "minor" : "major")}><option value="major">Major</option><option value="minor">Minor</option></Select></label>
    <label>What changed<Input required maxLength={200} value={what} onChange={event => setWhat(event.target.value)} /></label>
    <label>Why<Input required maxLength={1000} value={why} onChange={event => setWhy(event.target.value)} /></label>
    <Button type="submit" disabled={busy || workflow === ""}>Create review</Button>
  </form>;
}
export function SavedArchiveWorkspace({ selection, view, actorId, onSelection, onView, onClose }: {
  selection: string; view: "runs" | "versions"; actorId: string; onSelection: (id: string) => void; onView: (view: "runs" | "versions") => void; onClose: () => void;
}) {
  const client = useDashboardClient(); const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState<SavedArchiveQuery>({ limit: 50 });
  const refresh = useCallback(() => setNonce(value => value + 1), []);
  const currentSelection = useRef({ selection, onSelection });
  const mounted = useRef(true);
  useEffect(() => { currentSelection.current = { selection, onSelection }; }, [selection, onSelection]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const deleted = useCallback((runId: string) => {
    if (!mounted.current) return;
    if (currentSelection.current.selection === runId) currentSelection.current.onSelection("");
    setQuery(current => savedFilterQuery(current, "title", current.title ?? ""));
    refresh();
  }, [refresh]);
  const changeQuery = (next: SavedArchiveQuery) => { onSelection(""); setQuery(next); };
  const filter = (key: "workflow" | "title" | "descriptorVersion" | "outcome" | "from" | "to" | "capturedFrom" | "capturedTo", value: string) => changeQuery(savedFilterQuery(query, key, value));
  const read = useCallback(() => client.savedArchiveIndex(query), [client, query]);
  const index = useSavedResource(read, nonce);
  const detailRead = useCallback(() => selection === "" ? Promise.resolve(null) : client.savedArchiveReport(selection), [client, selection]);
  const detail = useSavedResource(detailRead, nonce);
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Archive" icon={<Archive />} back={<Button icon={<ArrowLeft />} onClick={onClose}>Back</Button>} actions={<><Button aria-pressed={view === "runs"} onClick={() => onView("runs")}>Saved reports</Button><Button aria-pressed={view === "versions"} onClick={() => onView("versions")}>Versions &amp; bumps</Button><Button icon={<RefreshCw />} onClick={refresh}>Refresh</Button></>} />
    {view === "versions" ? <SavedVersions actorId={actorId} nonce={nonce} onChanged={refresh} onArchive={() => {setQuery({limit:50});onSelection("");onView("runs");}} />
      : <div className="grid min-h-0 flex-1 grid-cols-2 gap-[var(--ds-space-base)] overflow-auto p-[var(--ds-space-base)]">
        <Panel aria-label="Saved reports"><PanelHeader title="Saved reports" headingLevel={2} /><PanelBody className={`${dsText.body} min-w-0 space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>
          <form aria-label="Filter saved reports" className="grid grid-cols-2 gap-[var(--ds-space-base)]" onSubmit={event => event.preventDefault()}>
            <label>Workflow<Input value={query.workflow ?? ""} onChange={event => filter("workflow", event.target.value)} /></label>
            <label>Title<Input value={query.title ?? ""} onChange={event => filter("title", event.target.value)} /></label>
            <label>Version<Input value={query.descriptorVersion ?? ""} onChange={event => filter("descriptorVersion", event.target.value)} /></label>
            <label>Outcome<Select value={query.outcome ?? ""} onChange={event => filter("outcome", event.target.value)}><option value="">All outcomes</option>{["done", "failed", "cancelled", "discarded", "interrupted", "superseded"].map(outcome => <option key={outcome} value={outcome}>{outcome}</option>)}</Select></label>
            {([ ["from", "Completed from (UTC)"], ["to", "Completed through (UTC)"], ["capturedFrom", "Captured from (UTC)"], ["capturedTo", "Captured through (UTC)"]] as const).map(([key, label]) => <label key={key}>{label}<Input type="date" value={query[key]?.slice(0, 10) ?? ""} onChange={event => filter(key, event.target.value === "" ? "" : `${event.target.value}${key === "to" || key === "capturedTo" ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)} /></label>)}
            <Button type="button" onClick={() => changeQuery({ limit: 50 })}>Clear filters</Button>
          </form>
          {index.state === "loading" ? <p role="status">Loading saved reports…</p> : index.state === "error" ? <p role="alert">{index.message}</p>
            : <>{query.after !== undefined && <Button onClick={() => changeQuery(savedFilterQuery(query, "title", query.title ?? ""))}>First reports</Button>}<SavedReportList index={index.value} selection={selection} onSelection={onSelection} onNext={() => { if (index.value.next !== null) changeQuery({ ...query, after: index.value.next }); }} /></>}
        </PanelBody></Panel>
        <Panel aria-label="Selected saved report"><PanelBody className={`${dsText.body} min-w-0 space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>{selection === "" ? <p>Select a saved report.</p> : detail.state === "loading" ? <p role="status">Loading saved report…</p> : detail.state === "error" ? <p role="alert">{detail.message}</p>
          : detail.value === null ? <p>Select a saved report.</p> : detail.value.state !== "available" ? <p role="status">Report {detail.value.state}: {detail.value.reason}</p> : <><SavedArchiveReport report={detail.value} /><SavedArchiveDeletion key={`${detail.value.runId}:${detail.value.archiveFingerprint}`} report={detail.value} actorId={actorId} onDeleted={deleted} /></>}</PanelBody></Panel>
      </div>}
  </div>;
}
function SavedReportList({ index, selection, onSelection, onNext }: { index: SavedArchiveIndexWire; selection: string; onSelection: (id: string) => void; onNext: () => void }) {
  if (index.items.length === 0) return <p>No saved reports match this query.</p>;
  return <><Table label="Saved reports"><THead><TR><TH>Report</TH><TH>Outcome</TH><TH>Completed</TH></TR></THead><TBody>{index.items.map(report => <TR key={report.runId}><TD><Button aria-pressed={selection === report.runId} onClick={() => onSelection(report.runId)}>{report.title}</Button><p>{report.workflow} · v{report.descriptorVersion}</p></TD><TD>{report.outcome === "done" || report.outcome === "failed" || report.outcome === "cancelled" ? <StatusPill status={dsStatusOf(report.outcome)} /> : report.outcome}</TD><TD>{report.completedAt}</TD></TR>)}</TBody></Table>{index.next !== null && <Button onClick={onNext}>Next reports</Button>}</>;
}

function SavedArchiveDeletion({ report, actorId, onDeleted }: { report: SavedArchiveReportWire; actorId: string; onDeleted: (runId: string) => void }) {
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
      if (settled.kind === "applied") onDeleted(report.runId); else if (active.current) setProblem(settled.reason === "rejected" ? `That command was refused (code ${settled.code}). ${settled.message} Nothing was changed.` : settled.problem);
    }, (error: unknown) => { if (active.current) setProblem(error instanceof Error ? error.message : "Deletion failed."); }).finally(() => { pending.current = false; if (active.current) setBusy(false); });
  };
  return <section aria-label="Delete saved report">{confirming ? <><p>Delete this saved report and its exclusively owned retained files? This cannot be undone.</p><p>Deleting this report also deletes its retained transaction evidence. If no other run owns its permanent idempotency keys, those keys are released; a later run could submit the same write again.</p><Button disabled={busy} onClick={remove}>Confirm deletion</Button><Button disabled={busy} onClick={() => setConfirming(false)}>Keep report</Button></> : <Button onClick={() => setConfirming(true)}>Delete saved report</Button>}{problem && <p role="alert">{problem}</p>}</section>;
}
