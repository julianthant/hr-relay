import { Archive, ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ArchiveGroupQuery } from "../../domain/archive/report.js";
import type { SavedArchiveQuery, SavedRuntimeVersionIndexWire } from "../../domain/dashboard/archive.js";
import { formatRuntimeVersion } from "../../domain/archive/runtime-version.js";
import { settleCommandResult } from "../app/command-result.js";
import { Badge, Button, DateInput, dsIcon, dsText, Input, PageHeader, Panel, PanelBody, Select } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useArchiveClient } from "../state/archive-client.js";
import { archiveReportCount, archiveVersionKey, archiveVersionLabel, groupArchiveVersions, sameArchiveGroup, type ArchiveGroup } from "./archive-runtime-model.js";
import { SavedArchiveDeletion, SavedArchiveDeletionStatus, SavedArchiveReport } from "./archive-report.js";
import { savedCommandEnvelope, savedOutcomeLabel, useSavedResource } from "./archive-report-model.js";

type Props = {
  selection: string;
  view: "runs" | "versions";
  actorId: string;
  onSelection: (id: string) => void;
  onView: (view: "runs" | "versions") => void;
  onClose: () => void;
};

export function RuntimeArchiveWorkspace({ selection, view, actorId, onSelection, onView }: Props) {
  const client = useArchiveClient();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const versionsRead = useCallback(() => client.savedRuntimeVersions(), [client]);
  const versions = useSavedResource(versionsRead, revision);
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Archive" icon={<Archive className={dsIcon.md} />} actions={<>
      <Button size="toolbar" variant={view === "runs" ? "secondary" : "ghost"} aria-pressed={view === "runs"} onClick={() => onView("runs")}>Version archives</Button>
      <Button size="toolbar" variant={view === "versions" ? "secondary" : "ghost"} aria-pressed={view === "versions"} onClick={() => onView("versions")}>Plan a bump</Button>
    </>} />
    <div className="min-h-0 flex-1 overflow-auto p-[var(--ds-space-base)]">
      {view === "versions"
        ? <RuntimeBumpPanel actorId={actorId} versions={versions} onChanged={refresh} />
        : <ArchiveGroupsPanel selection={selection} onSelection={onSelection} versions={versions} revision={revision} onRefresh={refresh} onPlan={() => onView("versions")} actorId={actorId} />}
    </div>
  </div>;
}

function ArchiveGroupsPanel({ selection, onSelection, versions, revision, onRefresh, onPlan, actorId }: {
  selection: string; onSelection: (id: string) => void; versions: ReturnType<typeof useSavedResource<SavedRuntimeVersionIndexWire>>;
  revision: number; onRefresh: () => void; onPlan: () => void; actorId: string;
}) {
  const client = useArchiveClient();
  const [filters, setFilters] = useState<ArchiveGroupQuery>({});
  const [after, setAfter] = useState<SavedArchiveQuery["after"]>();
  const [expandedDashboard, setExpandedDashboard] = useState<string | null>(null);
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ArchiveGroup | null>(null);
  const allRead = useCallback(() => client.savedArchiveGroups({}), [client]);
  const allGroups = useSavedResource(allRead, revision);
  const groupRead = useCallback(() => client.savedArchiveGroups(filters), [client, filters]);
  const groups = useSavedResource(groupRead, revision);
  const hierarchy = useMemo(() => groups.state === "loaded" ? groupArchiveVersions(groups.value.groups) : [], [groups]);
  const firstGroup = hierarchy[0]?.workflows[0]?.versions[0] ?? null;
  const activeGroup = selectedGroup !== null && groups.state === "loaded" && groups.value.groups.some(group => sameArchiveGroup(selectedGroup, group))
    ? selectedGroup : firstGroup;
  const reportQuery = useMemo<SavedArchiveQuery | null>(() => activeGroup === null ? null : {
    ...filters, workflow: activeGroup.workflow, limit: 50,
    ...(activeGroup.dashboardVersion === null ? { versionState: "unrecorded" as const } : { dashboardVersion: activeGroup.dashboardVersion }),
    ...(activeGroup.workflowVersion === null ? {} : { workflowVersion: activeGroup.workflowVersion }),
    ...(after === undefined ? {} : { after }),
  }, [activeGroup, after, filters]);
  const reportsRead = useCallback(() => reportQuery === null ? Promise.resolve({ items: [], next: null }) : client.savedArchiveIndex(reportQuery), [client, reportQuery]);
  const reports = useSavedResource(reportsRead, revision);
  const detailRead = useCallback(() => selection === "" ? Promise.resolve(null) : client.savedArchiveReport(selection), [client, selection]);
  const detail = useSavedResource(detailRead, revision);
  const setFilter = (next: ArchiveGroupQuery) => {
    setFilters(Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)));
    setAfter(undefined); setSelectedGroup(null); onSelection("");
  };
  const chooseGroup = (group: ArchiveGroup) => { setSelectedGroup(group); setAfter(undefined); onSelection(""); };
  const available = allGroups.state === "loaded" ? allGroups.value.groups : [];
  const dashboardOptions = [...new Map(available.filter(group => group.dashboardVersion !== null).map(group => [archiveVersionKey(group.dashboardVersion), group.dashboardVersion])).entries()];
  const workflowOptions = [...new Set([...available.map(group => group.workflow), ...(versions.state === "loaded" ? versions.value.workflows.map(row => row.workflowId) : [])])].sort();
  const workflowVersionOptions = [...new Map(available.filter(group => group.workflowVersion !== null).map(group => [archiveVersionKey(group.workflowVersion), group.workflowVersion])).entries()];
  const dashboardFilter = filters.versionState === "unrecorded" ? "unrecorded" : filters.dashboardVersion === undefined ? "" : archiveVersionKey(filters.dashboardVersion);
  return <Panel aria-label="Version archives"><PanelBody className="min-w-0 space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
    <div className="flex flex-wrap items-end gap-[var(--ds-space-base)]">
      <label className="min-w-0 flex-[2]">Search reports and retained files<Input value={filters.search ?? ""} onChange={event => setFilter({ ...filters, search: event.target.value || undefined })} /></label>
      <label>Dashboard version<Select value={dashboardFilter} onChange={event => {
        const value = event.target.value; const { dashboardVersion: _version, versionState: _state, ...rest } = filters;
        setFilter(value === "unrecorded" ? { ...rest, versionState: "unrecorded", workflowVersion: undefined }
          : value === "" ? rest : { ...rest, dashboardVersion: dashboardOptions.find(([key]) => key === value)?.[1] ?? undefined });
      }}><option value="">All versions</option>{dashboardOptions.map(([key]) => <option key={key} value={key}>{key}</option>)}<option value="unrecorded">Version not recorded</option></Select></label>
      <label>Workflow<Select value={filters.workflow ?? ""} onChange={event => setFilter({ ...filters, workflow: event.target.value || undefined })}><option value="">All workflows</option>{workflowOptions.map(workflow => <option key={workflow} value={workflow}>{versions.state === "loaded" ? versions.value.workflows.find(row => row.workflowId === workflow)?.label ?? workflow : workflow}</option>)}</Select></label>
      <label>Workflow version<Select disabled={filters.versionState === "unrecorded"} value={filters.workflowVersion === undefined ? "" : archiveVersionKey(filters.workflowVersion)} onChange={event => setFilter({ ...filters, workflowVersion: workflowVersionOptions.find(([key]) => key === event.target.value)?.[1] ?? undefined })}><option value="">All versions</option>{workflowVersionOptions.map(([key]) => <option key={key} value={key}>{key}</option>)}</Select></label>
      <label>Outcome<Select value={filters.outcome ?? ""} onChange={event => setFilter({ ...filters, outcome: event.target.value || undefined })}><option value="">All outcomes</option>{["done", "failed", "cancelled", "discarded", "interrupted", "superseded"].map(outcome => <option key={outcome} value={outcome}>{savedOutcomeLabel(outcome as "done")}</option>)}</Select></label>
    </div>
    <details><summary className={cn(dsText.meta, "cursor-pointer")}>Date filters</summary><div className="mt-[var(--ds-space-base)] grid grid-cols-2 gap-[var(--ds-space-base)]">
      <DateInput label="Completed from (UTC)" value={filters.from?.slice(0, 10) ?? ""} onChange={date => setFilter({ ...filters, from: date === "" ? undefined : `${date}T00:00:00.000Z` })} />
      <DateInput label="Completed through (UTC)" value={filters.to?.slice(0, 10) ?? ""} onChange={date => setFilter({ ...filters, to: date === "" ? undefined : `${date}T23:59:59.999Z` })} />
    </div></details>
    {hierarchy.length > 0 && Object.keys(filters).some(key => filters[key as keyof ArchiveGroupQuery] !== undefined) && <Button variant="ghost" onClick={() => setFilter({})}>Clear filters</Button>}
    {versions.state === "loaded" && <div className="flex flex-wrap items-center justify-between gap-[var(--ds-space-base)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-2)] p-[var(--ds-space-base)]">
      <div><strong className={dsText.ui}>Dashboard {formatRuntimeVersion(versions.value.dashboard)} is current</strong><div className="flex flex-wrap gap-[var(--ds-space-tight)]">{versions.value.workflows.map(row => <Badge key={row.workflowId} tone="neutral">{row.label} {formatRuntimeVersion(row.version)}</Badge>)}</div></div>
      <Button variant="secondary" onClick={onPlan}>Plan a bump</Button>
    </div>}
    {versions.state === "error" && <p role="alert">{versions.message}</p>}
    {groups.state === "loading" ? <p role="status">Loading version archives…</p> : groups.state === "error" ? <p role="alert">{groups.message}</p>
      : hierarchy.length === 0 ? <div className="border border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]"><h2 className={dsText.title}>No saved reports yet</h2><p className={dsText.body}>{Object.keys(filters).length > 0 ? "No saved reports match these filters." : "Completed runs appear here after a reviewed version change."}</p>{Object.keys(filters).length > 0 ? <Button onClick={() => setFilter({})}>Clear filters</Button> : <Button onClick={onPlan}>Plan a bump</Button>}</div>
        : <div className={cn(dsText.body, "space-y-[var(--ds-space-base)]")}>
          <h2 className={cn(dsText.caps, "text-[color:var(--ds-fg-muted)]")}>Archived dashboard versions</h2>
          <div className={cn(selection === "" ? "" : "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-[var(--ds-space-base)]")}>
            <div className="min-w-0 space-y-[var(--ds-space-snug)]">{hierarchy.map((dashboard, dashboardIndex) => {
              const open = expandedDashboard === null ? dashboardIndex === 0 : expandedDashboard === dashboard.key;
              return <section key={dashboard.key} className="min-w-0 border border-[color:var(--ds-border)] bg-[var(--ds-surface-2)]">
                <Button variant="ghost" className="flex w-full justify-between" aria-expanded={open} onClick={() => setExpandedDashboard(open ? "" : dashboard.key)}><span>{dashboard.version === null ? "Version not recorded" : `Dashboard ${archiveVersionLabel(dashboard.version)}`} · {archiveReportCount(dashboard.reportCount)}</span>{open ? <ChevronDown className={dsIcon.sm} /> : <ChevronRight className={dsIcon.sm} />}</Button>
                {open && <div className="space-y-[var(--ds-space-tight)] border-t border-[color:var(--ds-border)] p-[var(--ds-space-snug)]">{dashboard.workflows.map((workflow, workflowIndex) => {
                  const workflowKey = `${dashboard.key}:${workflow.workflow}`;
                  const workflowOpen = expandedWorkflow === null ? dashboardIndex === 0 && workflowIndex === 0 : expandedWorkflow === workflowKey;
                  const label = versions.state === "loaded" ? versions.value.workflows.find(row => row.workflowId === workflow.workflow)?.label ?? workflow.workflow : workflow.workflow;
                  return <section key={workflowKey} className="border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]">
                    <Button variant="ghost" className="flex w-full justify-between" aria-expanded={workflowOpen} onClick={() => setExpandedWorkflow(workflowOpen ? "" : workflowKey)}><span>{label} · {archiveReportCount(workflow.reportCount)}</span>{workflowOpen ? <ChevronDown className={dsIcon.sm} /> : <ChevronRight className={dsIcon.sm} />}</Button>
                    {workflowOpen && <div className="border-t border-[color:var(--ds-border)] p-[var(--ds-space-snug)]">{workflow.versions.map(group => <div key={archiveVersionKey(group.workflowVersion)} className="min-w-0">
                      <Button variant={sameArchiveGroup(activeGroup, group) ? "secondary" : "ghost"} aria-pressed={sameArchiveGroup(activeGroup, group)} onClick={() => chooseGroup(group)}>{group.workflowVersion === null ? "Version not recorded" : `Workflow ${archiveVersionLabel(group.workflowVersion)}`} · {archiveReportCount(group.reportCount)}</Button>
                      {sameArchiveGroup(activeGroup, group) && <div className="mt-[var(--ds-space-tight)] space-y-[var(--ds-space-tight)]">
                        {reports.state === "loading" ? <p role="status">Loading saved reports…</p> : reports.state === "error" ? <p role="alert">{reports.message}</p> : <>
                          {reports.value.items.map(report => <Button key={report.runId} variant={selection === report.runId ? "secondary" : "ghost"} className="flex w-full justify-between gap-[var(--ds-space-base)]" onClick={() => onSelection(report.runId)}><span className="min-w-0 truncate">{report.title}</span><span className={cn(dsText.meta, "ml-auto text-[color:var(--ds-fg-muted)]")}>{report.completedAt.slice(0, 10)} · {report.files.length} files</span><Badge tone="neutral">{savedOutcomeLabel(report.outcome)}</Badge></Button>)}
                          {reports.value.items.length === 0 && <p>No saved reports match this query.</p>}
                          {reports.value.next !== null && <Button onClick={() => setAfter(reports.value.next ?? undefined)}>Next reports</Button>}
                          {after !== undefined && <Button variant="ghost" onClick={() => setAfter(undefined)}>First reports</Button>}
                        </>}
                      </div>}
                    </div>)}</div>}
                  </section>;
                })}</div>}
              </section>;
            })}</div>
            {selection !== "" && <Panel aria-label="Selected saved report"><PanelBody className="space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]"><Button variant="ghost" onClick={() => onSelection("")}>Close report</Button>
              {detail.state === "loading" ? <p role="status">Loading saved report…</p> : detail.state === "error" ? <p role="alert">{detail.message}</p> : detail.value === null ? null
                : detail.value.state === "deleted" ? <SavedArchiveDeletionStatus status={detail.value.deletion} onRefresh={onRefresh} />
                  : detail.value.state !== "available" ? <p role="status">Report {detail.value.state}: {detail.value.reason}</p>
                    : <><SavedArchiveReport report={detail.value} /><SavedArchiveDeletion report={detail.value} actorId={actorId} onChanged={onRefresh} /></>}
            </PanelBody></Panel>}
          </div>
        </div>}
  </PanelBody></Panel>;
}

function RuntimeBumpPanel({ actorId, versions, onChanged }: { actorId: string; versions: ReturnType<typeof useSavedResource<SavedRuntimeVersionIndexWire>>; onChanged: () => void }) {
  const client = useArchiveClient();
  const [kind, setKind] = useState<"workflows" | "dashboard">("workflows");
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const applyRequests = useRef(new Map<string, ReturnType<typeof savedCommandEnvelope> & { type: "apply-runtime-version"; target: { changeId: string; reviewFingerprint: string } }>());
  if (versions.state === "loading") return <p role="status">Loading runtime versions…</p>;
  if (versions.state === "error") return <p role="alert">{versions.message}</p>;
  const wire = versions.value;
  const selectedIds = selected === null && wire.workflows[0] !== undefined ? [wire.workflows[0].workflowId] : selected ?? [];
  const submit = (request: unknown) => {
    setBusy(true); setMessage("");
    void client.executeCommand(request).then(result => {
      const settled = settleCommandResult(result);
      setMessage(settled.kind === "applied" ? "Version review updated." : settled.reason === "rejected" ? `${settled.code}: ${settled.message}` : settled.problem);
      onChanged();
    }, (error: unknown) => setMessage(error instanceof Error ? error.message : "Version command failed.")).finally(() => setBusy(false));
  };
  const review = () => submit({ ...savedCommandEnvelope(actorId), type: "plan-runtime-version",
    target: { scope: kind === "dashboard" ? { kind: "dashboard" } : { kind: "workflows", workflowIds: selectedIds } } });
  const apply = (change: SavedRuntimeVersionIndexWire["changes"][number]) => {
    let request = applyRequests.current.get(change.changeId);
    if (request === undefined) {
      if (change.state === "applying") { setMessage("This change is applying. Resume with its original command request."); return; }
      request = { ...savedCommandEnvelope(actorId), type: "apply-runtime-version", target: { changeId: change.changeId, reviewFingerprint: change.reviewFingerprint } };
      applyRequests.current.set(change.changeId, request);
    }
    submit(request);
  };
  return <Panel aria-label="Plan a version bump"><PanelBody className="space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
    <div><h2 className={dsText.section}>What is changing?</h2><p className={cn(dsText.body, "m-0 text-[color:var(--ds-fg-muted)]")}>Dashboard {formatRuntimeVersion(wire.dashboard)} · {wire.workflows.length} workflows</p></div>
    <div className="grid grid-cols-2 gap-[var(--ds-space-base)]">
      <Button variant={kind === "workflows" ? "secondary" : "outline"} className="flex h-auto flex-col items-start" aria-pressed={kind === "workflows"} onClick={() => setKind("workflows")}><strong>Workflow version</strong><span>Advance selected workflows by .1</span></Button>
      <Button variant={kind === "dashboard" ? "secondary" : "outline"} className="flex h-auto flex-col items-start" aria-pressed={kind === "dashboard"} onClick={() => setKind("dashboard")}><strong>Dashboard version</strong><span>Advance every workflow to {wire.dashboard.major + 1}.0</span></Button>
    </div>
    {kind === "workflows" ? <fieldset className="space-y-[var(--ds-space-tight)]"><legend className={cn(dsText.ui, "font-semibold")}>Workflows</legend>{wire.workflows.map(row => <label key={row.workflowId} className="flex items-center gap-[var(--ds-space-snug)]"><input type="checkbox" checked={selectedIds.includes(row.workflowId)} onChange={event => setSelected(event.target.checked ? [...selectedIds, row.workflowId] : selectedIds.filter(id => id !== row.workflowId))} />{row.label} · {formatRuntimeVersion(row.version)} → {row.version.major}.{row.version.minor + 1}</label>)}</fieldset>
      : <p className={dsText.body}>All workflows advance to {wire.dashboard.major + 1}.0.</p>}
    <Button disabled={busy || (kind === "workflows" && (selectedIds.length === 0 || selectedIds.length === wire.workflows.length))} onClick={review}>Review affected runs</Button>
    {kind === "workflows" && selectedIds.length === wire.workflows.length && <p role="status">For every workflow, choose Dashboard version.</p>}
    {wire.applyingChangeId !== undefined && <p role="status">Version change {wire.applyingChangeId} is applying.</p>}
    {wire.changes.filter(change => change.state !== "applied").map(change => {
      const affected = change.scope.kind === "dashboard" ? change.before.workflows.map(row => row.workflowId) : change.scope.workflowIds;
      const blockers = change.members.filter(member => member.state !== "terminal");
      return <section key={change.changeId} className="space-y-[var(--ds-space-tight)] border-t border-[color:var(--ds-border)] pt-[var(--ds-space-base)]"><h3 className={dsText.title}>Reviewed {change.scope.kind === "dashboard" ? "dashboard" : "workflow"} change</h3>
        <p className={dsText.body}>{affected.join(", ")} · {change.members.length} affected runs · {blockers.length} blockers · {change.completedRunIds.length} archived</p>
        {affected.map(id => {
          const before = change.before.workflows.find(row => row.workflowId === id)?.version;
          const after = change.after.workflows.find(row => row.workflowId === id)?.version;
          return <p key={id} className={dsText.meta}>{id}: {before === undefined ? "Version unavailable" : formatRuntimeVersion(before)} → {after === undefined ? "Version unavailable" : formatRuntimeVersion(after)}</p>;
        })}
        {blockers.map(member => <p key={member.runId} role="status">Blocked: {member.workflowId} · {member.runId} · {member.state}</p>)}
        {change.state === "planned" && <Button disabled={busy || blockers.length > 0} onClick={() => apply(change)}>Apply reviewed change</Button>}
        {change.state === "applying" && <Button disabled={busy || !applyRequests.current.has(change.changeId)} onClick={() => apply(change)}>Resume version change</Button>}
      </section>;
    })}
    {message !== "" && <p role="status">{message}</p>}
  </PanelBody></Panel>;
}
