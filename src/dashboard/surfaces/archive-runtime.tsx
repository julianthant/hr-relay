import { EMPTY_ARCHIVE_BROWSE, ArchiveBrowseStateSchema, type ArchiveBrowseState } from "../app/archive-route-model.js";
import { Archive, ArrowRight, ChevronDown, ChevronRight, Download, Folder, Layers3, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ArchiveGroupQuery } from "../../domain/archive/report.js";
import type { SavedArchiveQuery, SavedRuntimeVersionIndexWire } from "../../domain/dashboard/archive.js";
import { formatRuntimeVersion } from "../../domain/archive/runtime-version.js";
import { settleCommandResult } from "../app/command-result.js";
import { Button, Card, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DsBodyScope, dsIcon, dsSurface, dsText, Input, PageHeader, PageHeading, Panel, PanelBody, Popover, PopoverContent, PopoverTrigger, Select, Table, TBody, TD, TH, THead, TR } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useArchiveClient } from "../state/archive-client.js";
import { archiveDisplayDate, archiveInitialSummaryColumns, archiveReportCount, archiveReviewRunLabel, archiveRuntimeVersionPreview, archiveSummaryColumnAlignment, archiveSummaryColumnLabel, archiveSummaryColumns, archiveSummaryValue, archiveVersionKey, archiveVersionLabel, archiveWorkflowVersionLabels, groupArchiveVersions, mergeArchiveSummaryColumns, type ArchiveSummaryColumn, type DashboardArchiveGroup } from "./archive-runtime-model.js";
import type { ArchiveExportFormat } from "../../domain/dashboard/archive-export.js";
import { archiveExportBlob, readWorkflowExport } from "./archive-export-model.js";
import { SavedArchiveDeletion, SavedArchiveDeletionStatus, SavedArchiveReport } from "./archive-report.js";
import { savedCommandEnvelope, useSavedResource } from "./archive-report-model.js";

type BrowseProps = { browse?: ArchiveBrowseState; browseInvalid?: boolean; onBrowse?: (browse: ArchiveBrowseState, mode?: "push" | "replace") => void };
type Props = BrowseProps & {
  selection: string;
  view: "runs" | "versions";
  folder: Folder | null;
  actorId: string;
  onSelection: (id: string) => void;
  onView: (view: "runs" | "versions") => void;
  onFolder: (folder: Folder | null) => void;
};

type Folder = Readonly<{ dashboardKey: string; workflow: string }>;
type WorkflowExportHandle = { start: (format: ArchiveExportFormat) => void; cancel: () => void };
type RunExportHandle = { identity: string; runId: string; start: (format: ArchiveExportFormat) => void };
const EXPORT_SELECTION_CHANGED = "Archive export stopped because its selection changed. Start it again for this selection.";
const RUN_EXPORT_SELECTION_CHANGED = "Run export stopped because the selected report changed. Start it again for this run.";

export function RuntimeArchiveWorkspace({ selection, view, folder, actorId, onSelection, onView, onFolder, browse, browseInvalid, onBrowse }: Props) {
  const client = useArchiveClient();
  const [revision, setRevision] = useState(0);
  const [workflowExportVisible, setWorkflowExportVisible] = useState(false);
  const [workflowExportActive, setWorkflowExportActive] = useState(false);
  const [workflowExportMenuOpen, setWorkflowExportMenuOpen] = useState(false);
  const [runExportVisible, setRunExportVisible] = useState(false);
  const [runExportMenuOpen, setRunExportMenuOpen] = useState(false);
  const workflowExportHandle = useRef<WorkflowExportHandle | null>(null);
  const runExportHandle = useRef<RunExportHandle | null>(null);
  const bumpTrigger = useRef<HTMLButtonElement | null>(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const versionsRead = useCallback(() => client.savedRuntimeVersions(), [client]);
  const versions = useSavedResource(versionsRead, revision);
  useEffect(() => {
    if (view !== "runs" || !workflowExportVisible) setWorkflowExportMenuOpen(false);
    if (view !== "runs" || !runExportVisible) setRunExportMenuOpen(false);
  }, [view, workflowExportVisible, runExportVisible]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader
      className="ds-body-scope !max-w-none min-h-[48px]"
      title="Archive"
      icon={<Archive className={dsIcon.md} />}
      badge={versions.state === "loaded" ? <span className={cn(dsText.meta, "border-l border-[color:var(--ds-border)] pl-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>Current · {archiveVersionLabel(versions.value.dashboard)}</span> : undefined}
      actions={<>
        <Button size="toolbar" variant={view === "runs" ? "secondary" : "ghost"} aria-pressed={view === "runs"} onClick={() => onView("runs")}>Version archives</Button>
        {view === "runs" && workflowExportVisible && <Popover open={workflowExportMenuOpen} onOpenChange={setWorkflowExportMenuOpen}>
          <PopoverTrigger asChild><Button size="toolbar" variant="secondary" icon={<Download className={dsIcon.sm} aria-hidden />}>Export workflow</Button></PopoverTrigger>
          <PopoverContent className="ds-body-scope ds-body-overlay !w-[320px] !max-w-[calc(100vw-var(--ds-space-section))] !bg-[var(--ds-surface-overlay)]" title="Export workflow" align="end" width="sm">
            <div className="flex flex-col gap-[var(--ds-space-tight)] p-[var(--ds-space-cozy)]"><p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>Complete public selection, including hidden fields. JSON preserves types; CSV uses typed field paths. Limit: 5,000 reports or 50 MB.</p>
              <Button variant="ghost" className="justify-start" onClick={() => { setWorkflowExportMenuOpen(false); workflowExportHandle.current?.start("json"); }}>JSON</Button>
              <Button variant="ghost" className="justify-start" onClick={() => { setWorkflowExportMenuOpen(false); workflowExportHandle.current?.start("csv"); }}>CSV</Button>
              {workflowExportActive && <Button variant="ghost" className="justify-start" onClick={() => { setWorkflowExportMenuOpen(false); workflowExportHandle.current?.cancel(); }}>Cancel export</Button>}
            </div>
          </PopoverContent>
        </Popover>}
        {view === "runs" && runExportVisible && <Popover open={runExportMenuOpen} onOpenChange={setRunExportMenuOpen}>
          <PopoverTrigger asChild><Button size="toolbar" variant="secondary" icon={<Download className={dsIcon.sm} aria-hidden />}>Export run</Button></PopoverTrigger>
          <PopoverContent className="ds-body-scope ds-body-overlay !w-[320px] !max-w-[calc(100vw-var(--ds-space-section))] !bg-[var(--ds-surface-overlay)]" title="Export saved run" align="end" width="sm">
            <div className="flex flex-col gap-[var(--ds-space-tight)] p-[var(--ds-space-cozy)]"><p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>Complete public selection, including hidden fields. JSON preserves types; CSV uses typed field paths. Limit: 5,000 reports or 50 MB.</p>
              <Button variant="ghost" className="justify-start" onClick={() => { setRunExportMenuOpen(false); runExportHandle.current?.start("json"); }}>JSON</Button>
              <Button variant="ghost" className="justify-start" onClick={() => { setRunExportMenuOpen(false); runExportHandle.current?.start("csv"); }}>CSV</Button>
            </div>
          </PopoverContent>
        </Popover>}
        <Button ref={bumpTrigger} size="toolbar" variant={view === "versions" ? "secondary" : "ghost"} aria-pressed={view === "versions"} onClick={() => onView("versions")}>Plan a bump</Button>
      </>}
    />
    <div className={cn("min-h-0 flex-1 overflow-auto p-[var(--ds-shell-inset)]", dsSurface.bodyPage)}><div className="relative min-h-full rounded-[var(--ds-radius-lg)] border border-[color:var(--ds-border)] px-[18px] pt-[22px] pb-[75px] min-[1200px]:px-[25px] min-[1200px]:pt-[26px] min-[1200px]:pb-[84px]">
      {browseInvalid && <p role="alert">Invalid Archive browsing state. Exports are blocked until you choose a valid scope. <Button variant="secondary" onClick={() => onBrowse?.({ filters: {} }, "replace")}>Use unfiltered archives</Button></p>}
      <ArchiveGroupsPanel active={view === "runs" || selection !== "" || folder !== null} selection={selection} folder={folder} onSelection={onSelection} onFolder={onFolder} versions={versions} revision={revision} onRefresh={refresh} actorId={actorId}
        exportHandle={workflowExportHandle} onExportVisibilityChange={setWorkflowExportVisible} onExportActivityChange={setWorkflowExportActive}
        runExportHandle={runExportHandle} onRunExportVisibilityChange={setRunExportVisible} browse={browse} browseInvalid={browseInvalid} onBrowse={onBrowse} />
    </div></div>
    <Dialog open={view === "versions"} onOpenChange={open => { if (!open) onView("runs"); }}>
      {view === "versions" && <DialogContent size="md" className="ds-body-scope ds-body-overlay !w-[calc(100vw-var(--ds-space-section))] !max-w-[650px] !bg-[var(--ds-surface-overlay)]" title="Plan a version bump" description={`Current dashboard ${versions.state === "loaded" ? formatRuntimeVersion(versions.value.dashboard) : "version unavailable"}`} onCloseAutoFocus={event => { event.preventDefault(); bumpTrigger.current?.focus(); }}>
        <RuntimeBumpPanel actorId={actorId} contextRunId={selection} contextWorkflowId={folder?.workflow} versions={versions} onChanged={refresh} onCancel={() => onView("runs")} />
      </DialogContent>}
    </Dialog>
  </div>;
}

function ArchiveGroupsPanel({ active, selection, folder, onSelection, onFolder, versions, revision, onRefresh, actorId, exportHandle, onExportVisibilityChange, onExportActivityChange, runExportHandle, onRunExportVisibilityChange, browse, browseInvalid, onBrowse }: BrowseProps & {
  active: boolean; selection: string; folder: Folder | null; onSelection: (id: string) => void; onFolder: (folder: Folder | null) => void; versions: ReturnType<typeof useSavedResource<SavedRuntimeVersionIndexWire>>;
  revision: number; onRefresh: () => void; actorId: string;
  exportHandle: { current: WorkflowExportHandle | null };
  onExportVisibilityChange: (visible: boolean) => void;
  onExportActivityChange: (active: boolean) => void;
  runExportHandle: { current: RunExportHandle | null };
  onRunExportVisibilityChange: (visible: boolean) => void;
}) {
  const client = useArchiveClient();
  const [localBrowse, setLocalBrowse] = useState<ArchiveBrowseState>({ filters: {} });
  const browsing = onBrowse === undefined ? localBrowse : browse ?? EMPTY_ARCHIVE_BROWSE;
  const filters = browsing.filters;
  const after = browsing.after;
  const selectedSummaryColumns = browsing.columns ?? null;
  const updateBrowse = (next: ArchiveBrowseState, mode: "push" | "replace" = "push") => onBrowse === undefined ? setLocalBrowse(next) : onBrowse(next, mode);
  const [filterMessage, setFilterMessage] = useState("");
  const setFilters = (next: ArchiveGroupQuery, mode: "push" | "replace" = "push") => { const parsed = ArchiveBrowseStateSchema.safeParse({ filters: next }); if (!parsed.success) { setFilterMessage("Archive filter is invalid. Check the date range and filter values."); return; } setFilterMessage(""); abortForSelectionChange(); updateBrowse({ ...browsing, filters: { ...parsed.data.filters, ...(next.search === undefined ? {} : { search: next.search }) }, after: undefined }, mode); };
  const setAfter = (next: SavedArchiveQuery["after"]) => updateBrowse({ ...browsing, after: next });
  const setSelectedSummaryColumns = (next: string[] | null | ((current: string[] | null) => string[] | null)) => {
    const columns = typeof next === "function" ? next(selectedSummaryColumns) : next;
    updateBrowse({ ...browsing, columns: columns ?? undefined }, "replace");
  };
  const [discoveredSummaryColumns, setDiscoveredSummaryColumns] = useState<ArchiveSummaryColumn[]>([]);
  const [exportState, setExportState] = useState("");
  const [exportStateIsError, setExportStateIsError] = useState(false);
  const [runExportState, setRunExportState] = useState("");
  const [runExportStateIsError, setRunExportStateIsError] = useState(false);
  const exportController = useRef<{ controller: AbortController; identity: string } | null>(null);
  const allRead = useCallback(() => active ? client.savedArchiveGroups({}) : Promise.resolve({ groups: [] }), [active, client]);
  const allGroups = useSavedResource(allRead, revision);
  const groupRead = useCallback(() => active ? client.savedArchiveGroups(filters) : Promise.resolve({ groups: [] }), [active, client, filters]);
  const groups = useSavedResource(groupRead, revision);
  const hierarchy = useMemo(() => groups.state === "loaded" ? groupArchiveVersions(groups.value.groups) : [], [groups]);
  const stableHierarchy = useMemo(() => allGroups.state === "loaded" ? groupArchiveVersions(allGroups.value.groups) : [], [allGroups]);
  const dashboard = folder === null ? undefined : stableHierarchy.find(row => row.key === folder.dashboardKey);
  const workflow = dashboard?.workflows.find(row => row.workflow === folder?.workflow);
  const hasWorkflowExport = !browseInvalid && selection === "" && dashboard !== undefined && workflow !== undefined;
  const selectionIdentity = JSON.stringify({ dashboardKey: folder?.dashboardKey ?? null, workflow: folder?.workflow ?? null,
    dashboardVersion: dashboard?.version ?? null, filters, selection });
  const selectionIdentityRef = useRef(selectionIdentity);
  const abortForSelectionChange = () => exportController.current?.controller.abort(new Error(EXPORT_SELECTION_CHANGED));
  useLayoutEffect(() => {
    selectionIdentityRef.current = selectionIdentity;
    const active = exportController.current;
    if (active !== null && active.identity !== selectionIdentity) active.controller.abort(new Error(EXPORT_SELECTION_CHANGED));
  }, [selectionIdentity]);
  useLayoutEffect(() => {
    setRunExportState("");
    setRunExportStateIsError(false);
  }, [selectionIdentity]);
  useEffect(() => () => {
    exportController.current?.controller.abort();
    exportHandle.current = null;
    runExportHandle.current = null;
    onExportVisibilityChange(false);
    onExportActivityChange(false);
    onRunExportVisibilityChange(false);
  }, [exportHandle, onExportActivityChange, onExportVisibilityChange, onRunExportVisibilityChange, runExportHandle]);
  const reportQuery = useMemo<SavedArchiveQuery | null>(() => workflow === undefined || dashboard === undefined ? null : {
    ...filters, workflow: workflow.workflow, limit: 50,
    ...(dashboard.version === null ? { versionState: "unrecorded" as const } : { dashboardVersion: dashboard.version }),
    ...(after === undefined ? {} : { after }),
  }, [workflow, dashboard, after, filters]);
  const reportsRead = useCallback(() => !active || reportQuery === null ? Promise.resolve({ items: [], next: null }) : client.savedArchiveIndex(reportQuery), [active, client, reportQuery]);
  const reports = useSavedResource(reportsRead, revision);
  const pageSummaryColumns = useMemo(() => reports.state === "loaded" ? archiveSummaryColumns(reports.value.items) : [], [reports]);
  const summaryColumns = useMemo(() => mergeArchiveSummaryColumns(discoveredSummaryColumns, pageSummaryColumns), [discoveredSummaryColumns, pageSummaryColumns]);
  const initialSummaryColumns = useMemo(() => archiveInitialSummaryColumns(summaryColumns), [summaryColumns]);
  const visibleSummaryColumns = selectedSummaryColumns === null
    ? initialSummaryColumns
    : summaryColumns.filter(column => selectedSummaryColumns.includes(column.id));
  const detailRead = useCallback(() => !active || selection === "" ? Promise.resolve(null) : client.savedArchiveReport(selection), [active, client, selection]);
  const detail = useSavedResource(detailRead, revision);
  const selectedReport = detail.state === "loaded" && detail.value?.state === "available" && detail.value.runId === selection ? detail.value : null;
  const hasRunExport = !browseInvalid && selection !== "" && selectedReport !== null;
  const openFolder = (dashboardKey: string, workflowId: string) => { abortForSelectionChange(); onFolder({ dashboardKey, workflow: workflowId }); if (onBrowse === undefined) setLocalBrowse({ filters }); setDiscoveredSummaryColumns([]); setExportState(""); setExportStateIsError(false); };
  const goFolders = () => { abortForSelectionChange(); onFolder(null); if (onBrowse === undefined) setLocalBrowse({ filters }); };
  const selectReport = (runId: string) => { abortForSelectionChange(); onSelection(runId); };
  const startExport = async (format: ArchiveExportFormat) => {
    if (dashboard === undefined || workflow === undefined) return;
    exportController.current?.controller.abort();
    const identity = selectionIdentityRef.current;
    const controller = new AbortController(); exportController.current = { controller, identity };
    const isCurrent = () => selectionIdentityRef.current === identity && exportController.current?.controller === controller;
    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      if (selectionIdentityRef.current !== identity) throw new Error(EXPORT_SELECTION_CHANGED);
      if (exportController.current?.controller !== controller) throw new Error("Workflow export was superseded. Start it again.");
      controller.signal.throwIfAborted();
    };
    setExportState("Preparing workflow export…");
    setExportStateIsError(false);
    onExportActivityChange(true);
    try {
      const query = { ...filters, workflow: workflow.workflow,
        ...(dashboard.version === null ? { versionState: "unrecorded" as const } : { dashboardVersion: dashboard.version }) };
      const records = await readWorkflowExport((page, signal) => client.savedArchiveIndex(page, signal), query,
        controller.signal, format, count => { if (isCurrent()) setExportState(`Reading ${count} saved reports…`); }, isCurrent);
      assertCurrent();
      if (records.length === 0) throw new Error("No saved reports remain in this workflow selection.");
      const blob = archiveExportBlob(records, format);
      assertCurrent();
      if (blob.size > 50_000_000) throw new Error("Archive export exceeds 50 MB. Narrow the search and export each selection.");
      assertCurrent();
      const url = URL.createObjectURL(blob);
      let link: HTMLAnchorElement | null = null;
      let clicked = false;
      try {
        link = document.createElement("a");
        link.href = url;
        link.download = `archive-${workflow.workflow}-${dashboard.key}.${format}`;
        assertCurrent();
        document.body.append(link);
        assertCurrent();
        link.click();
        clicked = true;
      } finally {
        link?.remove();
        if (!clicked) URL.revokeObjectURL(url);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportState(`Downloaded ${records.length} saved reports.`);
      setExportStateIsError(false);
    } catch (error) {
      if (exportController.current?.controller === controller) {
        const reason: unknown = controller.signal.reason;
        const selectionChanged = controller.signal.aborted && reason instanceof Error && reason.message === EXPORT_SELECTION_CHANGED;
        if (controller.signal.aborted) {
          setExportState(selectionChanged ? EXPORT_SELECTION_CHANGED : "Workflow export cancelled.");
          setExportStateIsError(false);
        } else {
          setExportState(error instanceof Error ? error.message : "Workflow export failed.");
          setExportStateIsError(true);
        }
      }
    } finally {
      if (exportController.current?.controller === controller) {
        exportController.current = null;
        onExportActivityChange(false);
      }
    }
  };
  const startRunExport = (format: ArchiveExportFormat) => {
    if (selectedReport === null) return;
    const report = selectedReport;
    const runId = selection;
    const identity = selectionIdentity;
    const assertCurrent = () => {
      if (selectionIdentityRef.current !== identity || selection !== runId
        || runExportHandle.current?.identity !== identity || runExportHandle.current.runId !== runId
        || report.runId !== runId) {
        throw new Error(RUN_EXPORT_SELECTION_CHANGED);
      }
    };
    setRunExportState("Preparing saved report export…");
    setRunExportStateIsError(false);
    try {
      assertCurrent();
      const blob = archiveExportBlob([report], format);
      assertCurrent();
      const url = URL.createObjectURL(blob);
      let link: HTMLAnchorElement | null = null;
      let clicked = false;
      try {
        link = document.createElement("a");
        link.href = url;
        link.download = `archive-${runId}.${format}`;
        assertCurrent();
        document.body.append(link);
        assertCurrent();
        link.click();
        clicked = true;
      } finally {
        link?.remove();
        if (!clicked) URL.revokeObjectURL(url);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setRunExportState(`Downloaded saved report ${runId}.`);
      setRunExportStateIsError(false);
    } catch (error) {
      if (selectionIdentityRef.current === identity) {
        setRunExportState(error instanceof Error ? error.message : "Saved report export failed.");
        setRunExportStateIsError(true);
      }
    }
  };
  exportHandle.current = hasWorkflowExport ? {
    start: format => { void startExport(format); },
    cancel: () => exportController.current?.controller.abort(),
  } : null;
  useLayoutEffect(() => {
    onExportVisibilityChange(hasWorkflowExport);
    if (!hasWorkflowExport) onExportActivityChange(false);
  }, [hasWorkflowExport, onExportActivityChange, onExportVisibilityChange]);
  runExportHandle.current = hasRunExport && selectedReport !== null ? {
    identity: selectionIdentity,
    runId: selectedReport.runId,
    start: format => startRunExport(format),
  } : null;
  useLayoutEffect(() => {
    onRunExportVisibilityChange(hasRunExport);
  }, [hasRunExport, onRunExportVisibilityChange]);
  const workflowLabel = (id: string) => versions.state === "loaded" ? versions.value.workflows.find(row => row.workflowId === id)?.label ?? id : id;
  const detailDashboard = detail.state === "loaded" && detail.value?.state === "available" && detail.value.runId === selection ? archiveVersionLabel(detail.value.runtimeVersion?.dashboard ?? null) : dashboard === undefined ? "Version not recorded" : archiveVersionLabel(dashboard.version);
  const detailWorkflow = detail.state === "loaded" && detail.value?.state === "available" && detail.value.runId === selection ? workflowLabel(detail.value.workflow) : workflow === undefined ? "Workflow" : workflowLabel(workflow.workflow);
  const goRuns = () => { abortForSelectionChange(); const report = detail.state === "loaded" && detail.value?.state === "available" && detail.value.runId === selection ? detail.value : null; if (report !== null && (folder?.workflow !== report.workflow || folder.dashboardKey !== archiveVersionKey(report.runtimeVersion?.dashboard ?? null))) onFolder({ dashboardKey: archiveVersionKey(report.runtimeVersion?.dashboard ?? null), workflow: report.workflow }); else onSelection(""); };
  useEffect(() => { setDiscoveredSummaryColumns([]); }, [folder?.dashboardKey, folder?.workflow]);
  useEffect(() => {
    if (pageSummaryColumns.length === 0) return;
    setDiscoveredSummaryColumns(current => {
      const merged = mergeArchiveSummaryColumns(current, pageSummaryColumns);
      return merged.length === current.length && merged.every((column, index) => {
        const prior = current[index];
        return prior !== undefined && prior.id === column.id && prior.path === column.path && prior.section === column.section
          && prior.sectionOccurrence === column.sectionOccurrence && prior.label === column.label
          && prior.labelOccurrence === column.labelOccurrence && prior.type === column.type;
      }) ? current : merged;
    });
  }, [pageSummaryColumns]);
  const filterControls = <div className="shrink-0"><Popover><PopoverTrigger asChild><Button variant="secondary" size="toolbar" iconAfter={<ChevronDown className={dsIcon.sm} aria-hidden />}>Filters{Object.values(filters).filter(value => value !== undefined).length > 0 ? ` · ${Object.values(filters).filter(value => value !== undefined).length}` : ""}</Button></PopoverTrigger><PopoverContent className="ds-body-scope ds-body-overlay !w-[320px] !max-w-[calc(100vw-var(--ds-space-section))] !bg-[var(--ds-surface-overlay)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto" title="Filter version archives" align="end" width="sm"><div role="group" aria-label="Filter version archives" className="grid gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
      <label className={dsText.meta}>Search all public archive fields<Input maxLength={120} aria-label="Search all public archive fields" value={filters.search ?? ""} onChange={event => { abortForSelectionChange(); setFilters({ ...filters, search: event.target.value.trim() === "" ? undefined : event.target.value }, "replace"); }} /></label>
      <label className={dsText.meta}>Dashboard version<Select value={filters.dashboardVersion === undefined ? "" : JSON.stringify(filters.dashboardVersion)} onChange={event => setFilters({ ...filters, dashboardVersion: event.target.value === "" ? undefined : JSON.parse(event.target.value) as NonNullable<ArchiveGroupQuery["dashboardVersion"]> })}><option value="">All dashboards</option>{stableHierarchy.filter(row => row.version !== null).map(row => <option key={row.key} value={JSON.stringify(row.version)}>{archiveVersionLabel(row.version)}</option>)}</Select></label>
      <label className={dsText.meta}>Workflow<Select value={filters.workflow ?? ""} onChange={event => setFilters({ ...filters, workflow: event.target.value || undefined })}><option value="">All workflows</option>{[...new Set(stableHierarchy.flatMap(row => row.workflows.map(item => item.workflow)))].map(id => <option key={id} value={id}>{workflowLabel(id)}</option>)}</Select></label>
      <label className={dsText.meta}>Completed from<Input type="date" value={filters.from?.slice(0, 10) ?? ""} onChange={event => setFilters({ ...filters, from: event.target.value === "" ? undefined : `${event.target.value}T00:00:00.000Z` })} /></label>
      <label className={dsText.meta}>Completed through<Input type="date" value={filters.to?.slice(0, 10) ?? ""} onChange={event => setFilters({ ...filters, to: event.target.value === "" ? undefined : `${event.target.value}T23:59:59.999Z` })} /></label>
      <Button variant="ghost" onClick={() => setFilters({})}>Clear filters</Button>
    </div></PopoverContent></Popover></div>;
  if (selection !== "") return <DsBodyScope style={{ maxWidth: "none" }} className="w-full min-w-0 space-y-[22px] [&>.ds-page-heading]:!mb-[24px]">
    <ArchiveBreadcrumb items={[{ label: "Archive", onClick: goFolders }, { label: `Dashboard ${detailDashboard}`, onClick: goFolders }, { label: detailWorkflow, onClick: goRuns }, { label: "Saved run" }]} />
    {detail.state === "loading" ? <p role="status">Loading saved report…</p> : detail.state === "error" ? <p role="alert">{detail.message}</p> : detail.value === null ? <p role="status">No report selected.</p>
      : detail.value.runId !== selection ? <p role="alert">Saved report identity does not match selected run {selection}.</p>
        : detail.value.state === "deleted" ? <SavedArchiveDeletionStatus status={detail.value.deletion} onRefresh={onRefresh} />
        : detail.value.state !== "available" ? <p role="status">Report {detail.value.state}: {detail.value.reason}</p>
          : <>{runExportState !== "" && <p role={runExportStateIsError ? "alert" : "status"}>{runExportState}</p>}<PageHeading className="[&_.ds-page-heading-title]:!text-[26px] [&_.ds-page-heading-title]:!leading-[31.2px] [&_.ds-page-heading-description]:!mt-[5px] [&_.ds-page-heading-description]:!text-[12px] [&_.ds-page-heading-description]:!leading-[17.4px]" title={<span className="block min-w-0 break-words [overflow-wrap:anywhere]">{detail.value.title}</span>} description={<span className="break-words [overflow-wrap:anywhere]">{detailWorkflow}{detail.value.runNumber === undefined || detail.value.runNumber === null ? "" : ` · Run ${detail.value.runNumber}`}</span>} />
            <SavedArchiveReport section={browsing.section} onSection={onBrowse === undefined ? undefined : section => updateBrowse({ ...browsing, section })} key={detail.value.runId} report={detail.value} deletion={<SavedArchiveDeletion report={detail.value} actorId={actorId} onChanged={onRefresh} />} /></>}
  </DsBodyScope>;
  if (workflow !== undefined && dashboard !== undefined) {
    return <DsBodyScope style={{ maxWidth: "none" }} className="w-full space-y-[var(--ds-space-page)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--ds-space-base)]"><ArchiveBreadcrumb items={[{ label: "Archive", onClick: goFolders }, { label: `Dashboard ${archiveVersionLabel(dashboard.version)}`, onClick: goFolders }, { label: workflowLabel(workflow.workflow) }]} />{filterControls}</div>
      <PageHeading title={<span className="flex items-center gap-[var(--ds-space-base)]"><span className="flex size-[var(--ds-h-topbar)] shrink-0 items-center justify-center rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-2)] text-[color:var(--ds-fg-muted)]"><Folder className={dsIcon.md} aria-hidden /></span>{workflowLabel(workflow.workflow)}</span>} description="Archived runs and their retained workflow data" />
      <div className={cn(dsText.meta, "flex flex-wrap gap-x-[var(--ds-space-section)] gap-y-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-loose)]")}>
        <span>Dashboard version <strong className="block text-[color:var(--ds-fg)]">{archiveVersionLabel(dashboard.version)}</strong></span>
        <span>Archived runs <strong className="block text-[color:var(--ds-fg)]">{workflow.reportCount}</strong></span>
        <span>Workflow versions <strong className="block text-[color:var(--ds-fg)]">{workflow.versions.map(row => archiveVersionLabel(row.workflowVersion)).join(" · ")}</strong></span>
        <span>Data view <strong className="block text-[color:var(--ds-fg)]">Retained at archive time</strong></span>
      </div>
      <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
        <label className="relative w-[320px] max-w-full shrink"><span className="sr-only">Search all run data</span><Search aria-hidden className={cn(dsIcon.sm, "pointer-events-none absolute left-[var(--ds-space-cozy)] top-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")} /><Input maxLength={120} className="h-[var(--ds-h-lg)] pl-[var(--ds-space-page)]" placeholder="Search names, documents, or any field" value={filters.search ?? ""} onChange={event => { abortForSelectionChange(); setFilters({ ...filters, search: event.target.value.trim() === "" ? undefined : event.target.value }, "replace"); }} /></label>
        <span className={cn(dsText.meta, "ml-auto text-[color:var(--ds-fg-muted)]")}>{reports.state === "loaded" ? `${reports.value.items.length} ${reports.value.items.length === 1 ? "run" : "runs"}` : "Loading"}</span>
        <Popover><PopoverTrigger asChild><Button variant="secondary" size="toolbar" iconAfter={<ChevronDown className={dsIcon.sm} aria-hidden />}>Columns</Button></PopoverTrigger><PopoverContent className="ds-body-scope ds-body-overlay !w-[320px] !max-w-[calc(100vw-var(--ds-space-section))] !bg-[var(--ds-surface-overlay)] [&>header]:shrink-0 [&>div]:flex [&>div]:min-h-0 [&>div]:flex-col [&>div]:overflow-hidden flex max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden" title="Workflow table columns" align="end" width="sm"><p className={cn(dsText.meta, "m-0 shrink-0 px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]")}>Fields from loaded pages. Next reports discovers later fields; exports always include all fields.</p><div className="min-h-0 overflow-y-auto flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
          {summaryColumns.length === 0 ? <p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>No snapshot fields are available.</p> : summaryColumns.map(column => <Checkbox key={column.id} label={archiveSummaryColumnLabel(column, summaryColumns)} checked={visibleSummaryColumns.some(visible => visible.id === column.id)} onCheckedChange={checked => setSelectedSummaryColumns(current => {
            const selected = current ?? initialSummaryColumns.map(item => item.id);
            return checked === true ? [...new Set([...selected, column.id])] : selected.filter(value => value !== column.id);
          })} />)}
        </div></PopoverContent></Popover>
      </div>
      {selectedSummaryColumns !== null && reports.state === "loaded" && selectedSummaryColumns.some(id => !summaryColumns.some(column => column.id === id)) && <p role={after === undefined && reports.value.next === null ? "alert" : "status"} className={dsText.meta}>{after === undefined && reports.value.next === null ? "Saved column selection includes fields unavailable in this scope." : "Some selected columns are unavailable in loaded pages. Other pages may retain these fields."} <Button variant="ghost" size="toolbar" onClick={() => setSelectedSummaryColumns(null)}>Reset columns</Button></p>}
      {filterMessage !== "" && <p role="alert">{filterMessage}</p>}
      {exportState !== "" && <p role={exportStateIsError ? "alert" : "status"}>{exportState}</p>}
      {reports.state === "loading" ? <p role="status">Loading saved reports…</p> : reports.state === "error" ? <p role="alert">{reports.message}</p> : <>
        <Card className="overflow-hidden"><div className="overflow-x-auto"><Table className="min-w-max" label={`${workflowLabel(workflow.workflow)} saved runs`}><THead><TR><TH className="w-[220px] !text-[length:var(--ds-text-ui)] !normal-case !tracking-normal">Run</TH>{visibleSummaryColumns.map(column => <TH key={column.id} align={archiveSummaryColumnAlignment(column)} className="!text-[length:var(--ds-text-ui)] !normal-case !tracking-normal">{archiveSummaryColumnLabel(column, summaryColumns)}</TH>)}<TH align="right" className="!text-[length:var(--ds-text-ui)] !normal-case !tracking-normal">Workflow version</TH><TH align="right" className="!text-[length:var(--ds-text-ui)] !normal-case !tracking-normal">Archived</TH><TH align="right" className="!text-[length:var(--ds-text-ui)] !normal-case !tracking-normal">Files</TH></TR></THead><TBody>{reports.value.items.length === 0 && <TR><TD colSpan={visibleSummaryColumns.length + 4}>No saved reports match this scope. <Button variant="ghost" onClick={() => setFilters({})}>Clear filters</Button></TD></TR>}{reports.value.items.map(report => <TR key={report.runId}><TD><Button variant="ghost" className="h-auto max-w-[200px] min-w-0 justify-start whitespace-normal break-words p-0 text-left font-semibold text-[color:var(--ds-fg)]" onClick={() => selectReport(report.runId)}>{report.title}</Button><span className={cn(dsText.meta, "block break-all text-[color:var(--ds-fg-muted)]")} title={report.runId}>{report.runId.slice(0, 8)}… · Full ID in report</span></TD>{visibleSummaryColumns.map(column => { const align = archiveSummaryColumnAlignment(column); return <TD key={column.id} align={align} numeric={align === "right"} className="whitespace-nowrap">{archiveSummaryValue(report, column)}</TD>; })}<TD align="right" numeric>{report.runtimeVersion === undefined ? "Not recorded" : archiveVersionLabel(report.runtimeVersion.workflow)}</TD><TD align="right">{archiveDisplayDate(report.capturedAt)}</TD><TD align="right" numeric>{report.files.length}</TD></TR>)}</TBody></Table></div><div className={cn(dsText.meta, "flex justify-between border-t border-[color:var(--ds-border)] px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}><span>{reports.value.items.length} loaded {reports.value.items.length === 1 ? "run" : "runs"}{reports.value.next === null ? "" : " · More available"}</span><div className="flex items-center gap-[var(--ds-space-snug)]">{after !== undefined && <Button variant="ghost" size="toolbar" onClick={() => setAfter(undefined)}>First reports</Button>}{reports.value.next !== null && <Button variant="secondary" size="toolbar" onClick={() => setAfter(reports.value.next ?? undefined)}>Next reports</Button>}<span>Open a run for its complete report →</span></div></div></Card>
      </>}
    </DsBodyScope>;
  }
  if (folder !== null) return <DsBodyScope style={{ maxWidth: "none" }} className="w-full space-y-[var(--ds-space-section)]">
    <ArchiveBreadcrumb items={[{ label: "Archive", onClick: goFolders }, { label: "Saved folder" }]} />
    {allGroups.state === "loading" ? <p role="status">Loading saved folder…</p>
      : allGroups.state === "error" ? <p role="alert">{allGroups.message}</p>
        : <div role="alert" className="space-y-[var(--ds-space-base)]"><p className="m-0">Archived dashboard folder {folder.dashboardKey} / {folder.workflow} is unavailable. It was not replaced with another workflow.</p><Button variant="secondary" onClick={goFolders}>Return to version archives</Button></div>}
  </DsBodyScope>;
  return <DsBodyScope style={{ maxWidth: "none" }} className="w-full">
    <div className="flex min-h-[32px] min-w-0 flex-wrap items-start justify-end gap-[11px]">{groups.state === "loaded" && hierarchy[0] !== undefined && <ArchiveDashboardHeading dashboard={hierarchy[0]} />}{filterControls}</div>
    {filterMessage !== "" && <p role="alert">{filterMessage}</p>}
    {versions.state === "error" && <p role="alert">{versions.message}</p>}

    {groups.state === "loading" ? <p role="status">Loading version archives…</p> : groups.state === "error" ? <div><p role="alert">{groups.message}</p><Button variant="secondary" onClick={onRefresh}>Retry version archives</Button></div> : hierarchy.length === 0
      ? <Card className="p-[var(--ds-space-section)]"><h2 className={dsText.title}>{Object.keys(filters).length === 0 ? "No saved reports yet" : "No saved reports match these filters."}</h2><p>{Object.keys(filters).length === 0 ? "Completed runs appear here after a reviewed version change." : "Clear filters to view other archives."}</p></Card>
      : <div className="space-y-[var(--ds-space-section)] pt-[4px]">{hierarchy.map((row, index) => <ArchiveDashboardFolder key={row.key} dashboard={row} workflowLabel={workflowLabel} onOpen={openFolder} hideHeading={index === 0} />)}</div>}
  </DsBodyScope>;
}

function ArchiveBreadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return <nav aria-label="Archive path" className={cn(dsText.meta, "flex min-h-[20px] flex-wrap items-center gap-[var(--ds-space-snug)] !text-[12px] !leading-[20px] text-[color:var(--ds-fg-muted)]")}>
    {items.map((item, index) => <span key={`${index}:${item.label}`} className="flex items-center gap-[var(--ds-space-snug)]">{index > 0 && <span aria-hidden>›</span>}{item.onClick ? <Button variant="ghost" className="h-auto p-0 text-[color:var(--ds-fg-muted)]" onClick={item.onClick}>{item.label}</Button> : <strong className="text-[color:var(--ds-fg)]">{item.label}</strong>}</span>)}
  </nav>;
}

function ArchiveDashboardHeading({ dashboard }: { dashboard: DashboardArchiveGroup }) {
  const latestCapturedAt = dashboard.workflows.flatMap(workflow => workflow.versions).reduce<string | undefined>((latest, group) => group.latestCapturedAt === undefined ? latest : latest === undefined || group.latestCapturedAt > latest ? group.latestCapturedAt : latest, undefined);
  const archiveMoment = dashboard.version === null ? "Historical runs" : latestCapturedAt === undefined ? "Archive date unavailable" : `Latest archived ${archiveDisplayDate(latestCapturedAt)}`;
  return <><Layers3 className={cn(dsIcon.md, "!size-[16px] shrink-0 text-[color:var(--ds-fg-muted)]")} aria-hidden /><h2 className={cn(dsText.section, "m-0 min-w-0 truncate !text-[15px] !leading-[21.75px] font-semibold text-[color:var(--ds-fg)]")}>{dashboard.version === null ? "Version not recorded" : `Dashboard ${archiveVersionLabel(dashboard.version)}`}</h2><span className={cn(dsText.meta, "ml-auto text-[color:var(--ds-fg-muted)]")}>{archiveMoment}</span></>;
}

function ArchiveDashboardFolder({ dashboard, workflowLabel, onOpen, hideHeading }: { hideHeading?: boolean; dashboard: DashboardArchiveGroup; workflowLabel: (id: string) => string; onOpen: (key: string, workflow: string) => void }) {
  return <section className="space-y-[var(--ds-space-base)]">
    {!hideHeading && <header className="flex min-w-0 flex-wrap items-center gap-[11px]"><ArchiveDashboardHeading dashboard={dashboard} /></header>}
    <Panel aria-label={dashboard.version === null ? "Version not recorded archives" : `Dashboard ${archiveVersionLabel(dashboard.version)} archives`}>
      <PanelBody className="overflow-visible p-0"><div className="divide-y divide-[color:var(--ds-border)]">{dashboard.workflows.map(workflow => {
        const label = workflowLabel(workflow.workflow);
        const versions = archiveWorkflowVersionLabels(workflow.versions);
        const versionLabel = versions.length === 1 ? "Workflow version" : "Workflow versions";
        const versionText = versions.length === 1 && versions[0] === "Version not recorded" ? "Workflow version not recorded" : `${versionLabel} ${versions.join(" · ")}`;
        return <Button key={workflow.workflow} variant="ghost" className="min-h-[var(--ds-h-body-row)] w-full justify-start gap-[var(--ds-space-base)] rounded-none px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)] text-left" onClick={() => onOpen(dashboard.key, workflow.workflow)}><span className="flex size-[var(--ds-h-bar)] shrink-0 items-center justify-center rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-2)] text-[color:var(--ds-fg-muted)]"><Folder className={dsIcon.sm} aria-hidden /></span><span className="min-w-0 flex-1"><strong className="block truncate text-[color:var(--ds-fg)]">{label}</strong><small className={cn(dsText.meta, "block truncate text-[color:var(--ds-fg-muted)]")}>{versionText}</small></span><span className={cn(dsText.meta, "shrink-0 text-[color:var(--ds-fg-muted)]")}>{archiveReportCount(workflow.reportCount)}</span><ChevronRight className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)]")} aria-hidden /></Button>;
      })}</div></PanelBody>
    </Panel>
  </section>;
}

function RuntimeBumpPanel({ actorId, contextRunId, contextWorkflowId, versions, onChanged, onCancel }: { onCancel: () => void; actorId: string; contextRunId: string; contextWorkflowId?: string; versions: ReturnType<typeof useSavedResource<SavedRuntimeVersionIndexWire>>; onChanged: () => void }) {
  const client = useArchiveClient();
  const [kind, setKind] = useState<"workflows" | "dashboard">("workflows");
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [activeReview, setActiveReview] = useState<{ changeId: string; scopeKey: string; generation: number; authorityRevision?: number } | null>(null);
  const applyRequests = useRef(new Map<string, unknown>());
  const busyRef = useRef(false);
  const generation = useRef(0);
  const previousScopeKey = useRef<string | null>(null);
  const previousContextKey = useRef(JSON.stringify([contextRunId, contextWorkflowId]));
  const cachedWire = useRef<SavedRuntimeVersionIndexWire | undefined>(undefined);
  const contextRead = useCallback(() => contextRunId === "" ? Promise.resolve(null) : client.savedArchiveReport(contextRunId), [client, contextRunId]);
  const contextReport = useSavedResource(contextRead);
  if (versions.state === "loaded") cachedWire.current = versions.value;
  const wire = versions.state === "error" ? undefined : versions.state === "loaded" ? versions.value : cachedWire.current;
  const eligible = wire?.workflows.map(row => row.workflowId) ?? [];
  const contextWorkflow = contextReport.state === "loaded" && contextReport.value?.state === "available"
    ? contextReport.value.workflow : contextWorkflowId;
  const defaultWorkflow = contextWorkflow === undefined ? eligible[0]
    : eligible.find(id => id === contextWorkflow);
  const contextPending = contextRunId !== "" && selected === null && contextReport.state === "loading";
  const selectedIds = wire === undefined ? [] : selected === null
    ? (defaultWorkflow === undefined ? [] : [defaultWorkflow])
    : selected.filter(id => eligible.some(eligibleId => eligibleId === id));
  const preview = wire === undefined ? null : archiveRuntimeVersionPreview(wire, kind, selectedIds);
  const scope = preview?.scope ?? null;
  const allSelected = scope?.kind === "dashboard";
  const scopeKey = wire === undefined || contextPending ? null : JSON.stringify(scope);

  useLayoutEffect(() => {
    const contextKey = JSON.stringify([contextRunId, contextWorkflowId]);
    if (previousContextKey.current === contextKey) return;
    previousContextKey.current = contextKey;
    setSelected(null);
    setActiveReview(null);
    setMessage("");
  }, [contextRunId, contextWorkflowId]);
  useLayoutEffect(() => {
    if (scopeKey === null) return;
    if (previousScopeKey.current === null) {
      previousScopeKey.current = scopeKey;
      return;
    }
    if (previousScopeKey.current === scopeKey) return;
    previousScopeKey.current = scopeKey;
    generation.current += 1;
    setActiveReview(null);
    setMessage("");
  }, [scopeKey]);
  useLayoutEffect(() => {
    if (activeReview === null || wire === undefined) return;
    if (activeReview.authorityRevision === undefined) {
      if (wire.changes.some(change => change.changeId === activeReview.changeId && change.state === "planned")) {
        setActiveReview({ ...activeReview, authorityRevision: wire.revision });
      }
      return;
    }
    if (activeReview.authorityRevision !== wire.revision) {
      setActiveReview(null);
      setMessage("Review is stale. Review affected runs again.");
    }
  }, [activeReview, wire]);

  const stateBody = (children: ReactNode) => <><DialogBody>{children}</DialogBody><DialogFooter><Button variant="secondary" onClick={onCancel}>Cancel</Button></DialogFooter></>;
  if (versions.state === "error") return stateBody(<p role="alert">{versions.message}</p>);
  if (wire === undefined) return stateBody(<p role="status">Loading runtime versions…</p>);
  if (contextPending) return stateBody(<p role="status">Loading the selected report’s workflow…</p>);
  if (selected === null && contextWorkflow !== undefined && !eligible.some(id => id === contextWorkflow)) return stateBody(<div role="alert" className="space-y-[var(--ds-space-base)]"><p className="m-0">Archived workflow {contextWorkflow} is no longer registered. It was not replaced with another workflow.</p><Button variant="secondary" onClick={() => setSelected([])}>Choose a registered workflow</Button></div>);
  const selectedScopeKey = scopeKey ?? "";
  const reviewMatches = activeReview !== null && activeReview.scopeKey === selectedScopeKey
    && activeReview.generation === generation.current && wire.revision === activeReview.authorityRevision && versions.state === "loaded";
  const submit = (request: unknown, action: "review" | "apply", reviewBasis?: { changeId: string; scopeKey: string; generation: number }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(action === "review" ? "Reviewing affected runs…" : "Applying version change…");
    void client.executeCommand(request).then(result => {
      const settled = settleCommandResult(result);
      if (settled.kind === "applied") {
        if (action === "review" && reviewBasis !== undefined) {
          if (generation.current === reviewBasis.generation && previousScopeKey.current === reviewBasis.scopeKey) {
            setActiveReview(reviewBasis);
            setMessage("Version review updated.");
          } else setMessage("Review is stale because the workflow selection changed. Review affected runs again.");
        } else {
          setActiveReview(null);
          setMessage(settled.replayed ? "Version change was already applied." : "Version change applied.");
        }
      } else {
        const refusal = settled.reason === "rejected" ? `${settled.code}: ${settled.message}` : settled.problem;
        const stale = /stale|membership|version basis/iu.test(refusal);
        if (stale) setActiveReview(null);
        setMessage(stale ? "Review is stale. Review affected runs again." : refusal);
      }
      onChanged();
    }, (error: unknown) => setMessage(error instanceof Error ? error.message : "Version command failed.")).finally(() => {
      busyRef.current = false;
      setBusy(false);
    });
  };
  const review = () => {
    if (scope === null || selectedScopeKey === "" || versions.state !== "loaded") return;
    const request = { ...savedCommandEnvelope(actorId), type: "plan-runtime-version",
      target: { scope } };
    submit(request, "review", { changeId: request.commandId, scopeKey: selectedScopeKey, generation: generation.current });
  };
  const apply = (change: SavedRuntimeVersionIndexWire["changes"][number]) => {
    if (busyRef.current) return;
    if (change.state === "planned" && (!reviewMatches || activeReview.changeId !== change.changeId)) {
      setMessage("Review is stale for the current selection. Review affected runs again.");
      return;
    }
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
    submit(request, "apply");
  };
  const workflowLabel = (id: string) => wire.workflows.find(row => row.workflowId === id)?.label ?? id;
  const currentChange = wire.changes.find(change => change.changeId === wire.applyingChangeId && change.state === "applying")
    ?? wire.changes.find(change => change.state === "applying")
    ?? (reviewMatches ? wire.changes.find(change => change.changeId === activeReview.changeId && change.state === "planned") : undefined);
  const history = wire.changes.filter(change => change.changeId !== currentChange?.changeId);
  const changeSummary = (change: SavedRuntimeVersionIndexWire["changes"][number]) => {
    const affected = change.scope.kind === "dashboard" ? change.before.workflows.map(row => row.workflowId) : change.scope.workflowIds;
    const blockers = change.members.filter(member => member.state !== "terminal");
    return <section key={change.changeId} aria-label={change.state === "applying" ? "Version change applying" : change.state === "applied" ? "Version change applied" : "Reviewed version change"} className="space-y-[var(--ds-space-base)]">
      {change.state === "planned" && change !== currentChange && <p role="status">Review is stale for the current selection. Review affected runs again.</p>}
      {change.state === "applying" && <p role="status">Transfer interrupted or still applying. Resume with the original command request.</p>}
      {change.state === "applied" && <p role="status">{change.completedRunIds.length} {change.completedRunIds.length === 1 ? "run was" : "runs were"} archived.</p>}
      <dl className={cn(dsText.meta, "grid grid-cols-[auto_1fr] gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)]")}>
        <dt>Scope</dt><dd className="m-0 text-right">{affected.map(workflowLabel).join(" · ")}</dd>
        <dt>{"Dashboard "}</dt><dd className="m-0 text-right">{formatRuntimeVersion(change.before.dashboard)} → {formatRuntimeVersion(change.after.dashboard)}</dd>
        <dt>Affected runs</dt><dd className="m-0 text-right">{change.members.length}</dd><dt>Blockers</dt><dd className="m-0 text-right">{blockers.length}</dd><dt>Archived</dt><dd className="m-0 text-right">{change.completedRunIds.length}</dd>
        {affected.map(id => { const before = change.before.workflows.find(row => row.workflowId === id)?.version; const after = change.after.workflows.find(row => row.workflowId === id)?.version; return <div key={id} className="contents"><dt>{`${workflowLabel(id)}: `}</dt><dd className="m-0 text-right">{before === undefined ? "Version unavailable" : formatRuntimeVersion(before)} → {after === undefined ? "Version unavailable" : formatRuntimeVersion(after)}</dd></div>; })}
      </dl>
      {blockers.length > 0 && <p role="status" className={cn(dsText.meta, "m-0")}>Blocked by {blockers.length} active or pending {blockers.length === 1 ? "run" : "runs"}. Finish or resolve these runs before applying.</p>}
      <div className="max-h-[160px] space-y-[var(--ds-space-tight)] overflow-y-auto">{change.members.map(member => <details key={member.runId} className={dsText.meta}><summary className="cursor-pointer" role={member.state === "terminal" ? undefined : "status"}>{workflowLabel(member.workflowId)} · {archiveReviewRunLabel(member.runId, change.members.map(row => row.runId))} · {member.state === "terminal" ? "will be archived" : `Blocked · ${member.state}`}</summary><p className="m-0 break-all">{member.workflowId} · {member.runId} · {member.state === "terminal" ? "will be archived" : `Blocked · ${member.state}`}</p></details>)}</div>
      {change.state === "applying" && change.resumeRequest === undefined && !applyRequests.current.has(change.changeId) && <p role="status">The original apply request is unavailable. No replacement request will be created.</p>}
    </section>;
  };
  return <><DialogBody><section aria-label="Plan a version bump" className="space-y-[var(--ds-space-base)]">
    {versions.state === "loading" && <p role="status">Refreshing runtime versions…</p>}
    <fieldset aria-label="Version bump scope" className="space-y-[var(--ds-space-base)] border-0 p-0">
      <div className={cn("rounded-[var(--ds-radius-md)] border p-[var(--ds-space-cozy)]", kind === "workflows" ? "border-[color:var(--ds-control-border)] bg-[var(--ds-surface-3)]" : "border-[color:var(--ds-border)]") }>
        <label className={cn(dsText.ui, "flex min-h-[32px] cursor-pointer items-center gap-[var(--ds-space-snug)] font-semibold")}><input type="radio" name="archive-bump-scope" checked={kind === "workflows"} disabled={eligible.length === 0} onChange={() => setKind("workflows")} />Selected workflow</label>
        {kind === "workflows" && <div className="ml-[var(--ds-space-section)] mt-[var(--ds-space-base)] space-y-[var(--ds-space-snug)]">
          <label className={cn(dsText.meta, "block text-[color:var(--ds-fg-muted)]")}>Workflow to bump<Select value={selectedIds.length > 1 ? "__multiple" : selectedIds[0] ?? ""} onChange={event => setSelected(event.target.value === "" ? [] : [event.target.value])}><option value="">Choose workflow</option>{selectedIds.length > 1 && <option value="__multiple" disabled>{selectedIds.length} workflows selected</option>}{wire.workflows.map(row => <option key={row.workflowId} value={row.workflowId}>{row.label}</option>)}</Select></label>
          {selectedIds.length > 1 && <p className={cn(dsText.meta, "m-0")}>{selectedIds.length} selected: {selectedIds.map(workflowLabel).join(" · ")}</p>}
          {wire.workflows.length > 1 && <details><summary className={cn(dsText.meta, "cursor-pointer text-[color:var(--ds-fg-secondary)]")}>Select multiple workflows</summary><div className="mt-[var(--ds-space-snug)] grid gap-[var(--ds-space-snug)]">{wire.workflows.map(row => { const after = preview?.transition.after.workflows.find(item => item.workflowId === row.workflowId)?.version ?? row.version; return <Checkbox key={row.workflowId} label={`${row.label} · ${selectedIds.includes(row.workflowId) ? `${formatRuntimeVersion(row.version)} → ${formatRuntimeVersion(after)}` : `Unchanged · ${formatRuntimeVersion(row.version)}`}`} checked={selectedIds.includes(row.workflowId)} onCheckedChange={checked => setSelected(checked ? [...selectedIds, row.workflowId] : selectedIds.filter(id => id !== row.workflowId))} />; })}</div></details>}
          {preview !== null && <p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>{preview.transition.affectedWorkflowIds.map(id => { const before = preview.transition.before.workflows.find(row => row.workflowId === id)?.version; const after = preview.transition.after.workflows.find(row => row.workflowId === id)?.version; return `${workflowLabel(id)} ${before === undefined ? "unavailable" : formatRuntimeVersion(before)} → ${after === undefined ? "unavailable" : formatRuntimeVersion(after)}`; }).join(" · ")} · Dashboard {formatRuntimeVersion(preview.transition.before.dashboard)} → {formatRuntimeVersion(preview.transition.after.dashboard)}</p>}
          {allSelected && <p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-secondary)]")}>All-workflow dashboard version · Every registered workflow selected: dashboard major bump</p>}
        </div>}
      </div>
      <div className={cn("rounded-[var(--ds-radius-md)] border p-[var(--ds-space-cozy)]", kind === "dashboard" ? "border-[color:var(--ds-control-border)] bg-[var(--ds-surface-3)]" : "border-[color:var(--ds-border)]") }>
        <label className={cn(dsText.ui, "flex min-h-[32px] cursor-pointer items-center gap-[var(--ds-space-snug)] font-semibold")}><input type="radio" name="archive-bump-scope" checked={kind === "dashboard"} disabled={eligible.length === 0} onChange={() => setKind("dashboard")} />All workflows</label>
        <p className={cn(dsText.meta, "mb-0 ml-[var(--ds-space-section)] mt-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>Dashboard {formatRuntimeVersion(wire.dashboard)} → {formatRuntimeVersion({ major: wire.dashboard.major + 1, minor: 0 })} · All workflow versions advance together</p>
      </div>
    </fieldset>
    {wire.workflows.length === 0 && <p role="status">No eligible workflows are registered for a version change.</p>}
    <div className="space-y-[var(--ds-space-base)] border-t border-[color:var(--ds-border)] pt-[var(--ds-space-cozy)]"><h3 className={cn(dsText.ui, "m-0 font-semibold")}>Review</h3>{currentChange === undefined ? <p className={cn(dsText.meta, "m-0 text-[color:var(--ds-fg-muted)]")}>Not reviewed. Review the affected runs before applying this change.</p> : changeSummary(currentChange)}</div>
    {wire.applyingChangeId !== undefined && <p role="status">Version change {wire.applyingChangeId} is applying.</p>}
    {history.length > 0 && <details><summary className={cn(dsText.meta, "cursor-pointer")}>Previous version reviews · {history.length}</summary><div className="mt-[var(--ds-space-base)] max-h-[220px] space-y-[var(--ds-space-section)] overflow-y-auto">{history.map(change => <details key={change.changeId}><summary className={cn(dsText.meta, "cursor-pointer")}>{change.state} · {change.reviewedAt}</summary>{changeSummary(change)}</details>)}</div></details>}
    {message !== "" && <p role="status" className={cn(dsText.meta, "m-0")}>{message}</p>}
  </section></DialogBody><DialogFooter><Button variant="secondary" onClick={onCancel}>Cancel</Button>
    {currentChange?.state === "applying" ? (currentChange.resumeRequest === undefined && !applyRequests.current.has(currentChange.changeId) ? null : <Button variant="primary" disabled={busy || versions.state !== "loaded" || (currentChange.resumeRequest === undefined && !applyRequests.current.has(currentChange.changeId))} onClick={() => apply(currentChange)}>Resume version change</Button>)
      : currentChange?.state === "planned" && currentChange.members.every(member => member.state === "terminal") ? <Button variant="primary" disabled={busy || currentChange.members.some(member => member.state !== "terminal") || !reviewMatches} onClick={() => apply(currentChange)}>Apply reviewed change</Button>
        : <Button variant="primary" iconAfter={<ArrowRight className={dsIcon.sm} aria-hidden />} disabled={busy || scope === null || versions.state !== "loaded"} onClick={review}>Review affected runs</Button>}
  </DialogFooter></>;
}
