import { Archive, ArrowRight, ChevronDown, ChevronUp, Layers3, Search, Workflow } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ArchiveGroupQuery } from "../../domain/archive/report.js";
import type { SavedArchiveQuery, SavedRuntimeVersionIndexWire } from "../../domain/dashboard/archive.js";
import { formatRuntimeVersion } from "../../domain/archive/runtime-version.js";
import { settleCommandResult } from "../app/command-result.js";
import { Badge, Button, Card, Checkbox, DateInput, dsIcon, dsText, Input, PageHeader, Panel, PanelBody, Popover, PopoverContent, PopoverTrigger, Select } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useArchiveClient } from "../state/archive-client.js";
import { archiveDisplayDate, archiveReportCount, archiveVersionKey, archiveVersionLabel, archiveWorkflowMark, groupArchiveVersions, sameArchiveGroup, type ArchiveGroup } from "./archive-runtime-model.js";
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
    <div className="min-h-0 flex-1 overflow-auto p-[var(--ds-shell-inset)]">
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
  const [showAllReports, setShowAllReports] = useState(false);
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
  const chooseGroup = (group: ArchiveGroup) => { setSelectedGroup(group); setAfter(undefined); setShowAllReports(false); onSelection(""); };
  const available = allGroups.state === "loaded" ? allGroups.value.groups : [];
  const dashboardOptions = [...new Map(available.filter(group => group.dashboardVersion !== null).map(group => [archiveVersionKey(group.dashboardVersion), group.dashboardVersion])).entries()];
  const workflowOptions = [...new Set([...available.map(group => group.workflow), ...(versions.state === "loaded" ? versions.value.workflows.map(row => row.workflowId) : [])])].sort();
  const workflowVersionOptions = [...new Map(available.filter(group => group.workflowVersion !== null).map(group => [archiveVersionKey(group.workflowVersion), group.workflowVersion])).entries()];
  const dashboardFilter = filters.versionState === "unrecorded" ? "unrecorded" : filters.dashboardVersion === undefined ? "" : archiveVersionKey(filters.dashboardVersion);
  const reportTotal = hierarchy.reduce((count, dashboard) => count + dashboard.reportCount, 0);
  const filtered = Object.keys(filters).length > 0;
  const toggleDashboard = (dashboard: (typeof hierarchy)[number], open: boolean) => {
    setExpandedDashboard(open ? "" : dashboard.key);
    if (!open && dashboard.workflows[0]?.versions[0] !== undefined) {
      setExpandedWorkflow(`${dashboard.key}:${dashboard.workflows[0].workflow}`);
      chooseGroup(dashboard.workflows[0].versions[0]);
    }
  };
  const toggleWorkflow = (dashboardKey: string, workflow: (typeof hierarchy)[number]["workflows"][number], open: boolean) => {
    setExpandedWorkflow(open ? "" : `${dashboardKey}:${workflow.workflow}`);
    if (!open && workflow.versions[0] !== undefined) chooseGroup(workflow.versions[0]);
  };
  const selectedDetail = selection !== "" && <Panel aria-label="Selected saved report"><PanelBody className="space-y-[var(--ds-space-base)] p-[var(--ds-space-cozy)]"><Button variant="ghost" onClick={() => onSelection("")}>Close report</Button>
    {detail.state === "loading" ? <p role="status">Loading saved report…</p> : detail.state === "error" ? <p role="alert">{detail.message}</p> : detail.value === null ? null
      : detail.value.state === "deleted" ? <SavedArchiveDeletionStatus status={detail.value.deletion} onRefresh={onRefresh} />
        : detail.value.state !== "available" ? <p role="status">Report {detail.value.state}: {detail.value.reason}</p>
          : <><SavedArchiveReport report={detail.value} /><SavedArchiveDeletion report={detail.value} actorId={actorId} onChanged={onRefresh} /></>}
  </PanelBody></Panel>;
  return <Panel aria-label="Version archives" className="min-h-full"><PanelBody className="min-w-0 space-y-[var(--ds-space-loose)] p-[var(--ds-space-section)]">
    <div role="group" aria-label="Filter version archives" className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
      <label className="relative min-w-[var(--ds-w-archive-search)] flex-1">
        <span className="sr-only">Search reports and retained files</span>
        <Search aria-hidden className={cn(dsIcon.sm, "pointer-events-none absolute left-[var(--ds-space-cozy)] top-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")} />
        <Input className="h-[var(--ds-h-bar)] pl-[var(--ds-space-page)]" placeholder="Search reports and retained files" value={filters.search ?? ""} onChange={event => setFilter({ ...filters, search: event.target.value || undefined })} />
      </label>
      <label className="flex h-[var(--ds-h-bar)] items-center gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-2)] pl-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]">Dashboard
        <Select variant="toolbar" className="w-[var(--ds-w-archive-filter)] border-0 bg-transparent pl-0 font-semibold text-[color:var(--ds-fg)]" value={dashboardFilter} onChange={event => {
        const value = event.target.value; const { dashboardVersion: _version, versionState: _state, ...rest } = filters;
        setFilter(value === "unrecorded" ? { ...rest, versionState: "unrecorded", workflowVersion: undefined }
          : value === "" ? rest : { ...rest, dashboardVersion: dashboardOptions.find(([key]) => key === value)?.[1] ?? undefined });
      }}><option value="">All</option>{dashboardOptions.map(([key]) => <option key={key} value={key}>{key}</option>)}<option value="unrecorded">Not recorded</option></Select></label>
      <label className="flex h-[var(--ds-h-bar)] items-center gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-2)] pl-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]">Workflow
        <Select variant="toolbar" className="w-[var(--ds-w-archive-filter)] border-0 bg-transparent pl-0 font-semibold text-[color:var(--ds-fg)]" value={filters.workflow ?? ""} onChange={event => setFilter({ ...filters, workflow: event.target.value || undefined })}><option value="">All</option>{workflowOptions.map(workflow => <option key={workflow} value={workflow}>{versions.state === "loaded" ? versions.value.workflows.find(row => row.workflowId === workflow)?.label ?? workflow : workflow}</option>)}</Select></label>
      <label className="flex h-[var(--ds-h-bar)] items-center gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-2)] pl-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]">Workflow version
        <Select variant="toolbar" className="w-[var(--ds-w-archive-filter)] border-0 bg-transparent pl-0 font-semibold text-[color:var(--ds-fg)]" disabled={filters.versionState === "unrecorded"} value={filters.workflowVersion === undefined ? "" : archiveVersionKey(filters.workflowVersion)} onChange={event => setFilter({ ...filters, workflowVersion: workflowVersionOptions.find(([key]) => key === event.target.value)?.[1] ?? undefined })}><option value="">All</option>{workflowVersionOptions.map(([key]) => <option key={key} value={key}>{key}</option>)}</Select></label>
      <label className="flex h-[var(--ds-h-bar)] items-center gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-2)] pl-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]">Outcome
        <Select variant="toolbar" className="w-[var(--ds-w-archive-filter)] border-0 bg-transparent pl-0 font-semibold text-[color:var(--ds-fg)]" value={filters.outcome ?? ""} onChange={event => setFilter({ ...filters, outcome: event.target.value || undefined })}><option value="">All</option>{["done", "failed", "cancelled", "discarded", "interrupted", "superseded"].map(outcome => <option key={outcome} value={outcome}>{savedOutcomeLabel(outcome as "done")}</option>)}</Select></label>
      <Popover><PopoverTrigger asChild><Button variant="secondary" size="toolbar" className="shrink-0">Date <strong className="text-[color:var(--ds-fg)]">{filters.from === undefined && filters.to === undefined ? "Any" : "Set"}</strong></Button></PopoverTrigger>
        <PopoverContent title="Completed date filters" align="end" width="lg"><div className="flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
          <DateInput label="Completed from (UTC)" value={filters.from?.slice(0, 10) ?? ""} onChange={date => setFilter({ ...filters, from: date === "" ? undefined : `${date}T00:00:00.000Z` })} />
          <DateInput label="Completed through (UTC)" value={filters.to?.slice(0, 10) ?? ""} onChange={date => setFilter({ ...filters, to: date === "" ? undefined : `${date}T23:59:59.999Z` })} />
        </div></PopoverContent>
      </Popover>
      <span className={cn(dsText.meta, "ml-auto whitespace-nowrap text-[color:var(--ds-fg-muted)]")}>{reportTotal} saved {reportTotal === 1 ? "report" : "reports"}</span>
    </div>
    {filtered && hierarchy.length > 0 && <Button variant="ghost" onClick={() => setFilter({})}>Clear filters</Button>}
    {versions.state === "loaded" && <Card className="flex-row items-center gap-[var(--ds-space-loose)] border-[color:var(--ds-archive-current-border)] bg-[var(--ds-archive-current-bg)] p-[var(--ds-space-cozy)]">
      <span className="flex h-[var(--ds-h-bar)] w-[var(--ds-h-bar)] shrink-0 items-center justify-center rounded-[var(--ds-radius-md)] border border-[color:var(--ds-archive-current-border)] text-[color:var(--ds-accent-mark)]"><Layers3 className={dsIcon.md} aria-hidden /></span>
      <div className="min-w-0 flex-1"><strong className={dsText.title}>Dashboard {formatRuntimeVersion(versions.value.dashboard)} is current</strong><p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>{versions.value.workflows.length} current workflows · new runs use their current versions</p></div>
      <Button variant="primary" iconAfter={<ArrowRight className={dsIcon.sm} aria-hidden />} onClick={onPlan}>Plan a bump</Button>
    </Card>}
    {versions.state === "error" && <p role="alert">{versions.message}</p>}
    {groups.state === "loading" ? <p role="status">Loading version archives…</p> : groups.state === "error" ? <p role="alert">{groups.message}</p>
      : hierarchy.length === 0 ? <><Card><PanelBody className="space-y-[var(--ds-space-base)] p-[var(--ds-space-section)]"><h2 className={dsText.title}>No saved reports yet</h2><p className={dsText.body}>{filtered ? "No saved reports match these filters." : "Completed runs appear here after a reviewed version change."}</p>{filtered ? <Button onClick={() => setFilter({})}>Clear filters</Button> : <Button onClick={onPlan}>Plan a bump</Button>}</PanelBody></Card>{selectedDetail}</>
        : <div className={cn(dsText.body, "space-y-[var(--ds-space-base)]")}>
          <h2 className={cn(dsText.caps, "text-[color:var(--ds-fg-muted)]")}>Archived dashboard versions</h2>
          <div className={cn(selection === "" ? "" : "grid gap-[var(--ds-space-base)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
            <div className="min-w-0 space-y-[var(--ds-space-base)]">{hierarchy.map((dashboard, dashboardIndex) => {
              const open = expandedDashboard === null ? dashboardIndex === 0 : expandedDashboard === dashboard.key;
              const latest = dashboard.workflows.flatMap(workflow => workflow.versions).reduce<string | null>((date, group) => date === null || group.latestCompletedAt > date ? group.latestCompletedAt : date, null);
              return <Card key={dashboard.key} className="min-w-0 overflow-hidden">
                <Button variant="ghost" className="h-auto w-full justify-start gap-[var(--ds-space-loose)] rounded-none px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)] text-left" aria-expanded={open} onClick={() => toggleDashboard(dashboard, open)}>
                  <span className="flex h-[var(--ds-h-bar)] w-[var(--ds-h-bar)] shrink-0 items-center justify-center rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-2)] font-semibold text-[color:var(--ds-fg)]">{dashboard.version === null ? "—" : archiveVersionLabel(dashboard.version)}</span>
                  <span className="min-w-0 flex-1"><strong className={cn(dsText.title, "block text-[color:var(--ds-fg)]")}>{dashboard.version === null ? "Version not recorded" : `Dashboard ${archiveVersionLabel(dashboard.version)}`}</strong><span className={cn(dsText.meta, "block text-[color:var(--ds-fg-muted)]")}>{dashboard.version === null ? "Older saved reports · runtime version not recorded" : `${dashboard.workflows.length} archived ${dashboard.workflows.length === 1 ? "workflow" : "workflows"}${latest === null ? "" : ` · latest ${archiveDisplayDate(latest)}`}`}</span></span>
                  <span className={cn(dsText.meta, "whitespace-nowrap text-[color:var(--ds-fg-muted)]")}>{archiveReportCount(dashboard.reportCount)}</span>
                  <span className="flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-fg)]">{open ? "Hide" : "Show"}{open ? <ChevronUp className={dsIcon.sm} aria-hidden /> : <ChevronDown className={dsIcon.sm} aria-hidden />}</span>
                </Button>
                {open && <div className="space-y-[var(--ds-space-snug)] border-t border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]">{dashboard.workflows.map((workflow, workflowIndex) => {
                  const workflowKey = `${dashboard.key}:${workflow.workflow}`;
                  const workflowOpen = expandedWorkflow === null ? dashboardIndex === 0 && workflowIndex === 0 : expandedWorkflow === workflowKey;
                  const label = versions.state === "loaded" ? versions.value.workflows.find(row => row.workflowId === workflow.workflow)?.label ?? workflow.workflow : workflow.workflow;
                  return <Card key={workflowKey} className="overflow-hidden bg-[var(--ds-surface-1)]">
                    <Button variant="ghost" className="h-auto w-full justify-start gap-[var(--ds-space-cozy)] rounded-none px-[var(--ds-space-cozy)] py-[var(--ds-space-base)] text-left" aria-expanded={workflowOpen} onClick={() => toggleWorkflow(dashboard.key, workflow, workflowOpen)}>
                      <span className="flex h-[var(--ds-h-md)] w-[var(--ds-h-md)] shrink-0 items-center justify-center rounded-[var(--ds-radius-sm)] border border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-2)] text-[color:var(--ds-fg)]">{archiveWorkflowMark(label)}</span>
                      <strong className="min-w-0 truncate text-[color:var(--ds-fg)]">{label}</strong>
                      {workflow.versions.length === 1 && <Badge tone="neutral">{workflow.versions[0]?.workflowVersion === null ? "Version not recorded" : `Workflow ${archiveVersionLabel(workflow.versions[0]?.workflowVersion ?? null)}`}</Badge>}
                      <span className={cn(dsText.meta, "ml-auto whitespace-nowrap text-[color:var(--ds-fg-muted)]")}>{archiveReportCount(workflow.reportCount)}</span>
                      <span className="flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-fg)]">{workflowOpen ? "Hide" : "Show"}{workflowOpen ? <ChevronUp className={dsIcon.sm} aria-hidden /> : <ChevronDown className={dsIcon.sm} aria-hidden />}</span>
                    </Button>
                    {workflowOpen && <div className="border-t border-[color:var(--ds-border)] bg-[var(--ds-surface-2)]">
                      {workflow.versions.length > 1 && <div className="flex flex-wrap gap-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] p-[var(--ds-space-base)]">{workflow.versions.map(group => <Button key={archiveVersionKey(group.workflowVersion)} size="sm" variant={sameArchiveGroup(activeGroup, group) ? "secondary" : "ghost"} aria-pressed={sameArchiveGroup(activeGroup, group)} onClick={() => chooseGroup(group)}>{group.workflowVersion === null ? "Version not recorded" : `Workflow ${archiveVersionLabel(group.workflowVersion)}`} · {archiveReportCount(group.reportCount)}</Button>)}</div>}
                      {workflow.versions.some(group => sameArchiveGroup(activeGroup, group)) && <div className="min-w-0">
                        {reports.state === "loading" ? <p role="status">Loading saved reports…</p> : reports.state === "error" ? <p role="alert">{reports.message}</p> : <>
                          {(showAllReports ? reports.value.items : reports.value.items.slice(0, 2)).map(report => <Button key={report.runId} variant="ghost" className={cn("h-auto w-full justify-start rounded-none border-b border-[color:var(--ds-border)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)] text-left", selection === report.runId && "bg-[var(--ds-surface-selected)]")} onClick={() => onSelection(report.runId)}>
                            <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-[var(--ds-space-section)]">
                              <span className="min-w-0 truncate font-semibold text-[color:var(--ds-fg)]">{report.title}</span>
                              <Badge tone={report.outcome === "done" ? "success" : report.outcome === "failed" ? "danger" : "neutral"}>{savedOutcomeLabel(report.outcome)}</Badge>
                              <span className={cn(dsText.meta, "whitespace-nowrap text-[color:var(--ds-fg-muted)]")}>{archiveDisplayDate(report.completedAt)}</span>
                              <span className="flex items-center gap-[var(--ds-space-tight)] whitespace-nowrap text-[color:var(--ds-fg)]">Open report <ArrowRight className={dsIcon.sm} aria-hidden /></span>
                            </span>
                          </Button>)}
                          {reports.value.items.length === 0 && <p className="p-[var(--ds-space-cozy)]">No saved reports match this query.</p>}
                          {!showAllReports && reports.value.items.length > 2 && <Button variant="ghost" className="w-full justify-start rounded-none px-[var(--ds-space-cozy)]" onClick={() => setShowAllReports(true)}>View all {archiveReportCount(workflow.reportCount)} and attachments <ArrowRight className={dsIcon.sm} aria-hidden /></Button>}
                          {showAllReports && reports.value.next !== null && <Button onClick={() => setAfter(reports.value.next ?? undefined)}>Next reports</Button>}
                          {showAllReports && after !== undefined && <Button variant="ghost" onClick={() => setAfter(undefined)}>First reports</Button>}
                        </>}
                      </div>}
                    </div>}
                  </Card>;
                })}</div>}
              </Card>;
            })}</div>
            {selectedDetail}
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
  const applyRequests = useRef(new Map<string, unknown>());
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
      if (change.state === "applying") {
        if (change.resumeRequest === undefined) { setMessage("This change is applying, but its original command request is unavailable."); return; }
        request = change.resumeRequest;
      } else {
      request = { ...savedCommandEnvelope(actorId), type: "apply-runtime-version", target: { changeId: change.changeId, reviewFingerprint: change.reviewFingerprint } };
      }
      applyRequests.current.set(change.changeId, request);
    }
    submit(request);
  };
  return <Panel aria-label="Plan a version bump" className="min-h-full"><PanelBody className="p-[var(--ds-space-section)]">
    <Card className="space-y-[var(--ds-space-loose)] p-[var(--ds-space-section)]">
      <div><span className={cn(dsText.caps, "text-[color:var(--ds-fg-muted)]")}>Version change</span><h2 className={cn(dsText.section, "m-0 font-semibold")}>What is changing?</h2><p className={cn(dsText.body, "m-0 text-[color:var(--ds-fg-muted)]")}>Dashboard {formatRuntimeVersion(wire.dashboard)} · {wire.workflows.length} workflows</p></div>
      <div className="grid grid-cols-2 gap-[var(--ds-space-cozy)]">
        <Button variant="outline" className={cn("h-auto min-h-[var(--ds-h-archive-choice)] flex-col items-start justify-start gap-[var(--ds-space-base)] whitespace-normal p-[var(--ds-space-loose)] text-left", kind === "workflows" && "border-[color:var(--ds-archive-current-border)] bg-[var(--ds-archive-current-bg)]")} aria-pressed={kind === "workflows"} onClick={() => setKind("workflows")}>
          <Workflow aria-hidden className={cn(dsIcon.md, "text-[color:var(--ds-accent-mark)]")} />
          <strong className={cn(dsText.title, "text-[color:var(--ds-fg)]")}>Workflow version</strong>
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>Advance one or several workflows. Their completed runs stay with the version that produced them.</span>
          <Badge tone="neutral">{wire.workflows[0] === undefined ? "No workflows" : `${formatRuntimeVersion(wire.workflows[0].version)} → ${wire.workflows[0].version.major}.${wire.workflows[0].version.minor + 1}`}</Badge>
        </Button>
        <Button variant="outline" className={cn("h-auto min-h-[var(--ds-h-archive-choice)] flex-col items-start justify-start gap-[var(--ds-space-base)] whitespace-normal p-[var(--ds-space-loose)] text-left", kind === "dashboard" && "border-[color:var(--ds-archive-current-border)] bg-[var(--ds-archive-current-bg)]")} aria-pressed={kind === "dashboard"} onClick={() => setKind("dashboard")}>
          <Layers3 aria-hidden className={cn(dsIcon.md, "text-[color:var(--ds-accent-mark)]")} />
          <strong className={cn(dsText.title, "text-[color:var(--ds-fg)]")}>Dashboard version</strong>
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>Advance every workflow together to the next major version.</span>
          <Badge tone="neutral">{formatRuntimeVersion(wire.dashboard)} → {wire.dashboard.major + 1}.0</Badge>
        </Button>
      </div>
      <div className="border-t border-[color:var(--ds-border)] pt-[var(--ds-space-loose)]">
        {kind === "workflows" ? <fieldset><legend className={cn(dsText.ui, "mb-[var(--ds-space-cozy)] font-semibold")}>Workflows</legend><div className="grid grid-cols-2 gap-[var(--ds-space-base)]">{wire.workflows.map(row => <Card key={row.workflowId} className="p-[var(--ds-space-cozy)]"><Checkbox label={<span>{row.label} · {formatRuntimeVersion(row.version)} → {row.version.major}.{row.version.minor + 1}</span>} checked={selectedIds.includes(row.workflowId)} onCheckedChange={checked => setSelected(checked ? [...selectedIds, row.workflowId] : selectedIds.filter(id => id !== row.workflowId))} /></Card>)}</div></fieldset>
          : <div><h3 className={cn(dsText.ui, "m-0 font-semibold")}>All workflows</h3><p className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>Dashboard and every workflow advance to {wire.dashboard.major + 1}.0.</p></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-[var(--ds-space-base)]">
        <p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>Review the affected runs before applying this change.</p>
        <Button variant="primary" iconAfter={<ArrowRight className={dsIcon.sm} aria-hidden />} disabled={busy || (kind === "workflows" && (selectedIds.length === 0 || (wire.workflows.length > 1 && selectedIds.length === wire.workflows.length)))} onClick={review}>Review affected runs</Button>
      </div>
      {kind === "workflows" && wire.workflows.length > 1 && selectedIds.length === wire.workflows.length && <p role="status">For every workflow, choose Dashboard version.</p>}
      {wire.applyingChangeId !== undefined && <p role="status">Version change {wire.applyingChangeId} is applying.</p>}
    </Card>
    {wire.changes.filter(change => change.state !== "applied").map(change => {
      const affected = change.scope.kind === "dashboard" ? change.before.workflows.map(row => row.workflowId) : change.scope.workflowIds;
      const blockers = change.members.filter(member => member.state !== "terminal");
      return <Card key={change.changeId} className="mt-[var(--ds-space-loose)] space-y-[var(--ds-space-base)] p-[var(--ds-space-section)]"><h3 className={dsText.title}>Reviewed {change.scope.kind === "dashboard" ? "dashboard" : "workflow"} change</h3>
        <p className={dsText.body}>{affected.join(", ")} · {change.members.length} affected runs · {blockers.length} blockers · {change.completedRunIds.length} archived</p>
        {affected.map(id => {
          const before = change.before.workflows.find(row => row.workflowId === id)?.version;
          const after = change.after.workflows.find(row => row.workflowId === id)?.version;
          return <p key={id} className={dsText.meta}>{id}: {before === undefined ? "Version unavailable" : formatRuntimeVersion(before)} → {after === undefined ? "Version unavailable" : formatRuntimeVersion(after)}</p>;
        })}
        {blockers.map(member => <p key={member.runId} role="status">Blocked: {member.workflowId} · {member.runId} · {member.state}</p>)}
        {change.state === "planned" && <Button disabled={busy || blockers.length > 0} onClick={() => apply(change)}>Apply reviewed change</Button>}
        {change.state === "applying" && <Button disabled={busy || (change.resumeRequest === undefined && !applyRequests.current.has(change.changeId))} onClick={() => apply(change)}>Resume version change</Button>}
      </Card>;
    })}
    {message !== "" && <p role="status">{message}</p>}
  </PanelBody></Panel>;
}
