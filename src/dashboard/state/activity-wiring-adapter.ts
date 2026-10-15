import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityPopulationBrowseSchema, type ActivityPopulationSelection, type ActivityPopulationBrowseResult, type ActivityPopulationRun } from "../../models/dashboard/activity-population.js";
import { ERROR_CATALOG, ErrorCatalogCodeSchema } from "../../models/failures/error-catalog.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { DashboardClientError } from "../client/errors.js";
import type { DashboardClient } from "../client/index.js";
import type { ActivityBrowse, ActivityDrilldownData, ActivityRunRecord } from "../surfaces/activity/activity-drilldown-model.js";
import type { ActivitySummary, ActivityViewState } from "../surfaces/activity/activity-view-model.js";
import type { ActivityDateRange } from "../surfaces/activity/activity-model.js";
import type { WorkflowSourcePolicy } from "../app/workflow-sources.js";
import { readRunLogs, projectRunLogs } from "./run-wiring-adapter.js";

export type ActivityClient = Pick<DashboardClient, "activityPopulation" | "readActivityPopulation" | "exportActivityPopulationCsv" | "dashboardDay" | "runDetail" | "runSection" | "artifactUrl">;
const outstanding = new Set(["queued", "running", "cancelling", "blocked", "awaiting-approval"]);
function failureText(error: unknown): string {
  const code = ErrorCatalogCodeSchema.safeParse(error instanceof DashboardClientError ? error.code : undefined);
  return ERROR_CATALOG[code.success ? code.data : "DASHBOARD_READ_FAILED"].text;
}
function refused(): DashboardClientError {
  return new DashboardClientError({ kind: "protocol", code: "ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH", message: ERROR_CATALOG.ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH.text });
}
function runRecord(row: ActivityPopulationRun, selection: ActivityPopulationSelection): ActivityRunRecord {
  const registration = selection.report.workflows.find(workflow => workflow.workflowId === row.workflowId)?.registration;
  return { id: row.runId, displayId: row.runId, subject: row.title, day: row.day, workflowId: row.workflowId,
    workflowLabel: registration?.state === "registered" ? registration.label : row.workflowId,
    status: row.status === "done" ? "completed" : row.status,
    seconds: row.durationMs === null ? null : row.durationMs / 1000, attempt: row.attempt, readback: row.readback };
}

export function projectActivityPopulation(selection: ActivityPopulationSelection): ActivitySummary {
  const { report, population } = selection;
  const completed = population.filter(row => row.status === "done");
  const workflows = report.workflows.map(workflow => {
    const timing = selection.successfulTiming.find(row => row.workflowId === workflow.workflowId);
    if (timing === undefined) throw new Error(ERROR_CATALOG.ACTIVITY_POPULATION_SOURCE_MISMATCH.text);
    return { id: workflow.workflowId, label: workflow.registration.state === "registered" ? workflow.registration.label : workflow.workflowId,
      completed: population.filter(row => row.workflowId === workflow.workflowId && row.status === "done").length,
      outstanding: population.filter(row => row.workflowId === workflow.workflowId && outstanding.has(row.status)).length,
      failed: workflow.failed, total: workflow.runs,
      successfulTiming: { totalSeconds: timing.totalMs === null ? null : timing.totalMs / 1000, measured: timing.measured, unmeasured: timing.unmeasured } };
  });
  const knownReadback = completed.every(row => row.readback !== null);
  return { runs: population.map(row => runRecord(row, selection)), range: { from: report.from, to: report.to }, timeZone: report.volume.timeZone,
    total: population.length, completed: completed.length, outstanding: population.filter(row => outstanding.has(row.status)).length,
    running: population.filter(row => row.status === "running" || row.status === "cancelling").length,
    waiting: population.filter(row => ["queued", "blocked", "awaiting-approval"].includes(row.status)).length,
    failed: population.filter(row => row.status === "failed").length, terminal: report.terminalRuns,
    duration: { medianSeconds: report.durations.medianMs.state === "present" ? report.durations.medianMs.value / 1000 : null,
      longestSeconds: report.durations.longestMs.state === "present" ? report.durations.longestMs.value / 1000 : null,
      totalSeconds: report.durations.measuredRuns === 0 && report.durations.unmeasuredRuns > 0 ? null : report.durations.totalMs / 1000, measured: report.durations.measuredRuns, unmeasured: report.durations.unmeasuredRuns },
    failures: report.failures.map(row => ({ label: row.code, runs: row.runs })),
    evidence: { verified: knownReadback ? completed.filter(row => row.readback === true).length : null, unread: knownReadback ? completed.filter(row => row.readback === false).length : null },
    workflows, durationWorkflows: workflows.map(row => ({ ...row, completed: row.successfulTiming.measured + row.successfulTiming.unmeasured })),
    transactions: report.ledger.systems.flatMap(row => ([{ id: `${row.system}:prod`, label: row.system, count: row.prod, environment: "production" as const }, { id: `${row.system}:test`, label: row.system, count: row.test, environment: "test" as const }])),
    volume: report.volume };
}

export async function projectActivityBrowse(client: ActivityClient, selection: ActivityPopulationSelection, result: ActivityPopulationBrowseResult, sources: WorkflowSourcePolicy, signal: AbortSignal): Promise<ActivityDrilldownData> {
  signal.throwIfAborted();
  const rows = result.rows.map(row => runRecord(row, selection));
  const selected = result.run;
  let run: ActivityRunRecord | undefined;
  if (selected !== null) {
    if (sources[selected.workflowId] !== "served") return { state: "unavailable", reason: ERROR_CATALOG.LOGS_UNAVAILABLE_TITLE.text };
    const day = await client.dashboardDay(selected.day);
    signal.throwIfAborted();
    const row = day.queueSurfaces.find(row => row.runId === selected.runId);
    if (row === undefined || row.workflowId !== selected.workflowId || row.attempt !== selected.attempt) throw refused();
    const metadata = runRecord(selected, selection);
    const logs = await readRunLogs(client, { row, workflowLabel: metadata.workflowLabel }, signal);
    run = { ...metadata, ...projectRunLogs(logs, client) };
  }
  const workflowId = result.identity.browse.workflow;
  const registration = selection.report.workflows.find(row => row.workflowId === workflowId)?.registration;
  return { state: "loaded", total: result.total, totalMatches: result.totalMatches, start: result.start, rows, run,
    workflowLabel: workflowId === undefined ? undefined : registration?.state === "registered" ? registration.label : workflowId };
}

export function useActivityWiring(client: ActivityClient | undefined, range: ActivityDateRange, browse: ActivityBrowse | null, sources: WorkflowSourcePolicy, enabled: boolean) {
  const request = useMemo(() => ({ client, from: range.from, to: range.to, enabled }), [client, range.from, range.to, enabled]);
  const [base, setBase] = useState<{ request: typeof request; selection?: ActivityPopulationSelection; error?: unknown }>();
  const selection = base?.request === request ? base.selection : undefined;
  const browseKey = canonicalJsonStringify(browse === null ? null : JSON.parse(JSON.stringify(browse)));
  const browseInput = useMemo(() => enabled && browseKey !== "null" ? ActivityPopulationBrowseSchema.safeParse(JSON.parse(browseKey)) : undefined, [enabled, browseKey]);
  const browseRequest = useMemo(() => ({ request, selection, browse: browseKey, sources }), [request, selection, browseKey, sources]);
  const [settled, setSettled] = useState<{ request: typeof browseRequest; result?: ActivityDrilldownData; error?: unknown }>();
  useEffect(() => {
    if (!enabled || client === undefined) return;
    const controller = new AbortController();
    void client.activityPopulation(request.from, request.to, controller.signal).then(value => {
      if (!controller.signal.aborted) setBase({ request, selection: value });
    }, error => { if (!controller.signal.aborted) setBase({ request, error }); });
    return () => controller.abort();
  }, [client, enabled, request]);
  useEffect(() => {
    if (!enabled || client === undefined || selection === undefined || browseInput?.success !== true) return;
    const controller = new AbortController();
    void client.readActivityPopulation(selection, browseInput.data, controller.signal).then(async read => {
      if (read.browse === null) throw refused();
      return projectActivityBrowse(client, selection, read.browse, sources, controller.signal);
    }).then(result => { if (!controller.signal.aborted) setSettled({ request: browseRequest, result }); }, error => {
      if (!controller.signal.aborted) setSettled({ request: browseRequest, error });
    });
    return () => controller.abort();
  }, [client, enabled, selection, browseInput, browseRequest, sources]);
  const current = settled?.request === browseRequest;
  const previousBrowse = settled?.request.browse === undefined ? null : JSON.parse(settled.request.browse) as ActivityBrowse | null;
  const retain = !current && settled?.result !== undefined && selection !== undefined && settled?.request.selection === selection && browse !== null && previousBrowse !== null
    && browse.run === undefined && previousBrowse.run === undefined && browse.metric === previousBrowse.metric && browse.workflow === previousBrowse.workflow;
  const invalidBrowse = browseInput?.success === false;
  const pending = browse !== null && !invalidBrowse && !current;
  const projected = useMemo(() => selection === undefined ? undefined : projectActivityPopulation(selection), [selection]);
  const data: ActivityViewState = base?.request === request && "error" in base ? { state: "unavailable", reason: failureText(base.error) }
    : !enabled || client === undefined ? { state: "unavailable", reason: ERROR_CATALOG.DASHBOARD_READ_FAILED.text }
    : projected === undefined || pending && !retain ? { state: "loading" } : { state: "loaded", report: projected };
  const browseData = invalidBrowse ? { state: "unavailable" as const, reason: ERROR_CATALOG.ACTIVITY_POPULATION_BROWSE_INVALID.text } : current && "error" in settled ? { state: "unavailable" as const, reason: failureText(settled.error) } : current || retain ? settled?.result : undefined;
  const blocked = pending || invalidBrowse || current && "error" in settled;
  const latest = useRef({ request, blocked }); latest.current = { request, blocked };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const exportCsv = useCallback(async (signal?: AbortSignal) => {
    if (selection === undefined || client === undefined || !mounted.current || latest.current.request !== request || latest.current.blocked) throw refused();
    const download = await client.exportActivityPopulationCsv(selection, signal);
    if (!mounted.current || latest.current.request !== request || latest.current.blocked || signal?.aborted) throw refused();
    return download;
  }, [client, request, selection]);
  return { data, browse: browseData, pending, notice: pending && retain ? "Refreshing Analytics selection…" : "", exportCsv };
}
