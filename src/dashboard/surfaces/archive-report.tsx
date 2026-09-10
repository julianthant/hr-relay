import { useCallback, useState } from "react";
import { Archive, ArrowLeft, RefreshCw, Download } from "lucide-react";
import type { SavedArchiveReportWire, SavedArchiveQuery, SavedArchiveIndexWire, SavedVersionIndexWire } from "../../domain/dashboard/archive.js";
import { settleCommandResult } from "../app/command-result.js";
import { useDashboardClient } from "../state/client-context.js";
import { Button, ButtonLink, Input, Select, PageHeader, Panel, PanelBody, PanelHeader, Table, THead, TBody, TR, TH, TD, StatusPill } from "../ds/ui.js";
import { dsText } from "../ds/tokens.js";
import { dsStatusOf } from "./status-model.js";
import { savedCell, savedCommandEnvelope, savedPlanRequest, useSavedResource } from "./archive-report-model.js";

export function SavedArchiveReport({ report }: { report: SavedArchiveReportWire }) {
  return <article aria-label="Saved archive report" className={`${dsText.body} space-y-[var(--ds-space-cozy)]`}>
    <header><h2 className={dsText.title}>{report.title}</h2><p>{report.workflow} · version {report.descriptorVersion}</p>
      <p>Completed {report.completedAt} · Captured {report.capturedAt}</p><p>Saved record · read-only</p></header>
    {report.sections.map((section, index) => <section key={`${String(index)}:${section.title}`} aria-label={section.title}>
      <h3 className={dsText.ui}>{section.title}</h3>
      {section.kind === "unavailable" ? <p>{section.reason}</p> : section.kind === "text" ? <pre className="whitespace-pre-wrap break-words">{section.text}</pre>
        : section.kind === "values" ? <dl>{section.values.map((cell, n) => <div key={n} className="grid grid-cols-2 gap-[var(--ds-space-base)] border-b py-[var(--ds-space-tight)]"><dt className="break-words">{cell.label}</dt><dd className="break-words">{savedCell(cell.value)}</dd></div>)}</dl>
          : <div className="overflow-auto"><Table><THead><TR>{section.columns.map((column, n) => <TH key={n}>{column}</TH>)}</TR></THead><TBody>{section.rows.map((row, n) => <TR key={n}>{row.map((cell, m) => <TD key={m}>{savedCell(cell)}</TD>)}</TR>)}</TBody></Table></div>}
    </section>)}
    {report.versionChange !== undefined && <section aria-label="Recorded version change"><h3 className={dsText.ui}>{report.versionChange.change.what}</h3>
      <p>{report.versionChange.change.why}</p><p>{report.versionChange.change.kind} · target {report.versionChange.targetVersion} · applied by {report.versionChange.appliedBy}</p>
      <p>{report.versionChange.change.commit.state === "present" ? report.versionChange.change.commit.value : report.versionChange.change.commit.reason}</p></section>}
    <section aria-label="Retained attachments"><h3 className={dsText.ui}>Retained attachments</h3>
      {report.files.length === 0 ? <p>No attachment was retained with this report.</p> : report.files.map(file =>
        <SavedAttachment key={file.digest} runId={report.runId} digest={file.digest} name={file.name} />)}
    </section>
  </article>;
}
function SavedAttachment({ runId, digest, name }: { runId: string; digest: string; name: string }) {
  const client = useDashboardClient();
  const read = useCallback(() => client.savedArchiveFile(runId, digest), [client, runId, digest]);
  const resource = useSavedResource(read);
  if (resource.state === "loading") return <p role="status">Checking {name}…</p>;
  if (resource.state === "error") return <p role="alert">{name}: {resource.message}</p>;
  const file = resource.value.resource;
  return file.state === "available" ? <ButtonLink href={file.downloadUrl} icon={<Download />}>{name}</ButtonLink>
    : <p role="status">{name}: {file.state === "missing" ? file.reason : file.message}</p>;
}
function SavedVersions({ actorId, nonce, onChanged, onArchive }: { actorId: string; nonce: number; onChanged: () => void; onArchive: () => void }) {
  const client = useDashboardClient();
  const read = useCallback(() => client.savedArchiveVersions(), [client]);
  const resource = useSavedResource(read, nonce);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const execute = (request: unknown) => {
    setBusy(true);
    void client.executeCommand(request).then(result => {
      const settled = settleCommandResult(result);
      setMessage(settled.kind === "applied" ? "Version change saved. The list is refreshing." : settled.problem);
      if (settled.kind === "applied") onChanged();
    }, (error: unknown) => setMessage(error instanceof Error ? error.message : "Version command failed.")).finally(() => setBusy(false));
  };
  return <Panel aria-label="Versions and saved changes"><PanelBody className={`${dsText.body} space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>
    {resource.state === "loading" ? <p role="status">Loading versions…</p> : resource.state === "error" ? <p role="alert">{resource.message}</p>
      : <><SavedVersionForm wire={resource.value} actorId={actorId} busy={busy} onCommand={execute} />
        <p>{resource.value.historicalChanges} historical version records retained.</p>
        {resource.value.changes.map(change => <section key={change.changeId} className="border-b py-[var(--ds-space-cozy)]">
          <h3>{change.change.what}</h3><p>{change.change.why}</p><p>{change.state} · target {change.targetVersion} · {change.memberRunIds.length} reviewed runs · {change.completedRunIds.length} archived</p>
          {change.blockerRunIds.length > 0 && <p role="status">Blocked by: {change.blockerRunIds.join(", ")}</p>}
          {(change.state === "planned" || change.state === "applying") && <Button disabled={busy || change.blockerRunIds.length > 0} onClick={() => execute({ ...savedCommandEnvelope(actorId), type: "apply-version-bump", target: { versionPlanId: change.changeId, expectedVersion: 1 }, payload: { planFingerprint: change.reviewFingerprint } })}>Apply reviewed change</Button>}
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
  const read = useCallback(() => client.savedArchiveIndex(query), [client, query]);
  const index = useSavedResource(read, nonce);
  const detailRead = useCallback(() => selection === "" ? Promise.resolve(null) : client.savedArchiveReport(selection), [client, selection]);
  const detail = useSavedResource(detailRead, nonce);
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Archive" icon={<Archive />} back={<Button icon={<ArrowLeft />} onClick={onClose}>Back</Button>} actions={<><Button onClick={() => onView("runs")}>Saved reports</Button><Button onClick={() => onView("versions")}>Versions &amp; bumps</Button><Button icon={<RefreshCw />} onClick={refresh}>Refresh</Button></>} />
    {view === "versions" ? <SavedVersions actorId={actorId} nonce={nonce} onChanged={refresh} onArchive={() => onView("runs")} />
      : <div className="grid min-h-0 flex-1 grid-cols-2 gap-[var(--ds-space-base)] overflow-auto p-[var(--ds-space-base)]">
        <Panel aria-label="Saved reports"><PanelHeader title="Saved reports" headingLevel={2} /><PanelBody className={`${dsText.body} space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>
          <label>Workflow<Input value={query.workflow ?? ""} onChange={event => setQuery({ limit: 50, ...(event.target.value === "" ? {} : { workflow: event.target.value }) })} /></label>
          {index.state === "loading" ? <p role="status">Loading saved reports…</p> : index.state === "error" ? <p role="alert">{index.message}</p>
            : <SavedReportList index={index.value} selection={selection} onSelection={onSelection} onNext={() => { if (index.value.next !== null) setQuery({ ...query, after: index.value.next }); }} />}
        </PanelBody></Panel>
        <Panel aria-label="Selected saved report"><PanelBody className={`${dsText.body} space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]`}>{selection === "" ? <p>Select a saved report.</p> : detail.state === "loading" ? <p role="status">Loading saved report…</p> : detail.state === "error" ? <p role="alert">{detail.message}</p>
          : detail.value === null ? <p>Select a saved report.</p> : detail.value.state !== "available" ? <p role="status">{detail.value.reason}</p> : <><SavedArchiveReport report={detail.value} /><SavedArchiveDeletion report={detail.value} actorId={actorId} onDeleted={() => { onSelection(""); refresh(); }} /></>}</PanelBody></Panel>
      </div>}
  </div>;
}
function SavedReportList({ index, selection, onSelection, onNext }: { index: SavedArchiveIndexWire; selection: string; onSelection: (id: string) => void; onNext: () => void }) {
  if (index.items.length === 0) return <p>No saved reports match this query.</p>;
  return <><Table><THead><TR><TH>Report</TH><TH>Outcome</TH><TH>Completed</TH></TR></THead><TBody>{index.items.map(report => <TR key={report.runId}><TD><Button aria-pressed={selection === report.runId} onClick={() => onSelection(report.runId)}>{report.title}</Button><p>{report.workflow} · v{report.descriptorVersion}</p></TD><TD><StatusPill status={dsStatusOf(report.outcome === "done" ? "done" : report.outcome === "failed" ? "failed" : report.outcome === "interrupted" ? "blocked" : "cancelled")} /></TD><TD>{report.completedAt}</TD></TR>)}</TBody></Table>{index.next !== null && <Button onClick={onNext}>Next reports</Button>}</>;
}

function SavedArchiveDeletion({ report, actorId, onDeleted }: { report: SavedArchiveReportWire; actorId: string; onDeleted: () => void }) {
  const client = useDashboardClient(); const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState("");
  const remove = () => {
    setBusy(true);
    void client.executeCommand({ ...savedCommandEnvelope(actorId), type: "delete-archived-run", target: { archivedRunId: report.runId, archiveFingerprint: report.archiveFingerprint } }).then(result => {
      const settled = settleCommandResult(result);
      if (settled.kind === "applied") onDeleted(); else setProblem(settled.problem);
    }, (error: unknown) => setProblem(error instanceof Error ? error.message : "Deletion failed.")).finally(() => setBusy(false));
  };
  return <section aria-label="Delete saved report">{confirming ? <><p>Delete this saved report and its exclusively owned retained files? This cannot be undone.</p><Button disabled={busy} onClick={remove}>Confirm deletion</Button><Button disabled={busy} onClick={() => setConfirming(false)}>Keep report</Button></> : <Button onClick={() => setConfirming(true)}>Delete saved report</Button>}{problem && <p role="alert">{problem}</p>}</section>;
}
