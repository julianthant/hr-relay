import type { z } from "zod";
import { ActivityPopulationRangeSchema, ActivityPopulationRunSchema, ActivitySuccessfulTimingSchema, ActivityPopulationIdentitySchema, ActivityPopulationSelectionSchema, ActivityPopulationBrowseSchema, ActivityPopulationBrowseResultSchema, ActivityPopulationSelectedReadSchema, ActivityPopulationExportSchema, type ActivityPopulationRun, type ActivityPopulationSelection, type ActivityPopulationBrowseResult, type ActivityPopulationSelectedRead, type ActivityPopulationExport } from "../../../models/dashboard/activity-population.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { spreadsheetCsvRow } from "../exports/spreadsheet-csv.js";
import { deriveRunStatus } from "../lifecycle/run-status.js";
import { activityReportCsv, activityReportCsvFileName } from "./activity-export.js";
import { createActivitySelectionService, createActivitySnapshotSigner } from "./activity-selection.js";
import { queryActivitySummaries, visitActivitySummaryRange } from "./activity-summaries.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { Clock } from "../../../rules/time/clock.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";

export class ActivityPopulationError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, `ACTIVITY_POPULATION_${string}`>) {
    super(ERROR_CATALOG[code].text);
    this.name = "ActivityPopulationError";
  }
}

const nameOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
function browseSelection(selection: ActivityPopulationSelection, input: unknown): ActivityPopulationBrowseResult {
  const parsed = ActivityPopulationBrowseSchema.safeParse(input);
  if (!parsed.success) throw new ActivityPopulationError("ACTIVITY_POPULATION_BROWSE_INVALID");
  const browse = parsed.data;
  if (browse.workflow !== undefined && !selection.population.some(row => row.workflowId === browse.workflow)) throw new ActivityPopulationError("ACTIVITY_POPULATION_WORKFLOW_UNAVAILABLE");
  const population = selection.population.filter(row => (browse.workflow === undefined || row.workflowId === browse.workflow) &&
    (browse.metric === "completed" ? row.status === "done" : browse.metric === "failed" ? row.status === "failed" : browse.metric === "timed" ? row.status === "done" && row.parentRunId === null && row.durationMs !== null : ["queued", "running", "cancelling", "blocked", "awaiting-approval"].includes(row.status)));
  const terms = browse.query?.trim().toLocaleLowerCase("en").split(/\s+/u).filter(Boolean) ?? [];
  const matches = population.filter(row => {
    const text = `${row.title} ${row.runId}`.toLocaleLowerCase("en");
    return terms.every(term => text.includes(term));
  });
  const sort = browse.sort;
  if (sort !== undefined) matches.sort((a, b) => {
    if (sort.column === "duration") {
      if (a.durationMs === null && b.durationMs !== null) return 1;
      if (b.durationMs === null && a.durationMs !== null) return -1;
    }
    const order = sort.column === "name" ? nameOrder.compare(a.title, b.title) : a.durationMs === null || b.durationMs === null ? 0 : a.durationMs - b.durationMs;
    return (sort.direction === "ascending" ? order : -order) || nameOrder.compare(a.runId, b.runId);
  });
  if (browse.page > Math.max(0, Math.ceil(matches.length / 20) - 1)) throw new ActivityPopulationError("ACTIVITY_POPULATION_PAGE_UNAVAILABLE");
  const run = browse.run === undefined ? null : matches.find(row => row.runId === browse.run);
  if (run === undefined) throw new ActivityPopulationError("ACTIVITY_POPULATION_RUN_UNAVAILABLE");
  const identity = { from: selection.report.from, to: selection.report.to, token: selection.snapshot.token, browse };
  const start = browse.page * 20;
  return ActivityPopulationBrowseResultSchema.parse({ identity: { ...identity, digest: sha256Hex(canonicalJsonStringify(identity)) }, total: population.length, totalMatches: matches.length, start, rows: matches.slice(start, start + 20), run });
}

export function createActivityPopulationService(input: {
  database: AuthorityDatabase; clock: Clock;
  descriptors: Parameters<typeof queryActivitySummaries>[2]["descriptors"];
  ledger: Parameters<typeof queryActivitySummaries>[2]["ledger"];
  timeZone?: string;
}) {
  const { database, clock } = input;
  const reports = createActivitySelectionService({ database, clock, read: (from, to, generatedAt) => queryActivitySummaries(database, { from, to, generatedAt }, input) });
  const signer = createActivitySnapshotSigner(ActivityPopulationIdentitySchema, "ap1", clock);
  const read = (rangeInput: unknown, selected?: z.infer<typeof ActivityPopulationIdentitySchema>): ActivityPopulationSelection => {
    const bounds = ActivityPopulationRangeSchema.safeParse(rangeInput);
    if (!bounds.success) throw new ActivityPopulationError("ACTIVITY_POPULATION_RANGE_INVALID");
    const { from, to } = bounds.data;
    return database.withAuthorityReadSnapshot(() => {
      const report = selected === undefined ? reports.read(from, to) : reports.readSelected(from, to, selected.reportToken);
      const population: ActivityPopulationRun[] = [];
      visitActivitySummaryRange(database, from, to, report.volume.timeZone, row => {
        if (row.shape === "operation-member") return;
        population.push(ActivityPopulationRunSchema.parse({ runId: row.runId, workflowId: row.workflow, title: row.title, attempt: row.attempt, day: row.localDay, parentRunId: row.parentRunId, shape: row.shape,
          status: deriveRunStatus(row), terminal: row.lifecycle.state === "terminal", durationMs: row.durationMs,
          receiptResult: row.receiptResult, warningCount: row.warningCount, readback: row.receiptResult === null ? null : row.receiptResult === "verified-done" }));
      });
      if (population.length !== report.totalRuns || new Set(population.map(row => row.runId)).size !== population.length) throw new ActivityPopulationError("ACTIVITY_POPULATION_SOURCE_MISMATCH");
      const successfulTiming = report.workflows.map(workflow => {
        const successful = population.filter(row => row.workflowId === workflow.workflowId && row.status === "done" && row.parentRunId === null);
        const measured = successful.flatMap(row => row.durationMs === null ? [] : [row.durationMs]);
        return ActivitySuccessfulTimingSchema.parse({ workflowId: workflow.workflowId, measured: measured.length, unmeasured: successful.length - measured.length,
          totalMs: measured.length === 0 ? null : measured.reduce((sum, duration) => sum + duration, 0) });
      });
      const populationDigest = sha256Hex(canonicalJsonStringify({ population, successfulTiming }));
      if (selected !== undefined && populationDigest !== selected.populationDigest) throw new ActivityPopulationError("ACTIVITY_POPULATION_CONTENT_MISMATCH");
      const { token: reportToken, ...reportIdentity } = report.snapshot;
      const identity = ActivityPopulationIdentitySchema.parse({ ...reportIdentity, reportToken, populationDigest });
      return ActivityPopulationSelectionSchema.parse({ report, population, successfulTiming, snapshot: { ...identity, token: signer.encode(identity) } });
    });
  };
  return Object.freeze({
    reports,
    read: (range: unknown) => read(range),
    readSelected: (range: unknown, token: unknown, browse?: unknown): ActivityPopulationSelectedRead => {
      const selection = read(range, signer.decode(token));
      return ActivityPopulationSelectedReadSchema.parse({ selection, browse: browse === undefined ? null : browseSelection(selection, browse) });
    },
    exportSelected: (range: unknown, token: unknown): ActivityPopulationExport => {
      const selection = read(range, signer.decode(token));
      const rows = [spreadsheetCsvRow(["Complete selected run population"]), spreadsheetCsvRow(["Population digest", selection.snapshot.populationDigest]), spreadsheetCsvRow(["Run id", "Workflow id", "Title", "Attempt", "Day", "Queue status", "Terminal", "Duration (ms)", "Read back", "Parent run id", "Shape", "Receipt result", "Warning count"]),
        ...selection.population.map(row => spreadsheetCsvRow([row.runId, row.workflowId, row.title, row.attempt, row.day, row.status, row.terminal, row.durationMs === null ? "Unavailable" : row.durationMs, row.readback === null ? "Unavailable" : row.readback, row.parentRunId === null ? "" : row.parentRunId, row.shape, row.receiptResult === null ? "Unavailable" : row.receiptResult, row.warningCount === null ? "Unavailable" : row.warningCount]))];
      const timing = [spreadsheetCsvRow(["Successful run timing"]), spreadsheetCsvRow(["Workflow id", "Total (ms)", "Measured", "Unmeasured"]),
        ...selection.successfulTiming.map(row => spreadsheetCsvRow([row.workflowId, row.totalMs === null ? "Unavailable" : row.totalMs, row.measured, row.unmeasured]))];
      return ActivityPopulationExportSchema.parse({ selection, filename: activityReportCsvFileName(selection.report), mediaType: "text/csv; charset=utf-8", csv: `${activityReportCsv(selection.report)}\r\n${rows.join("\r\n")}\r\n\r\n${timing.join("\r\n")}\r\n` });
    },
  });
}
export type ActivityPopulationService = ReturnType<typeof createActivityPopulationService>;
