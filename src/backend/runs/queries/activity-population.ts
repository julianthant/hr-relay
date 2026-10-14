import { z } from "zod";
import { ActivityReportSelectionSchema, ActivitySnapshotIdentitySchema, ActivitySnapshotTokenSchema } from "../../../models/dashboard/activity-selection.js";
import { QueueStatusSchema } from "../../../models/dashboard/projection.js";
import { FingerprintSchema, RunIdSchema } from "../../../rules/identity/ids.js";
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

const RangeSchema = z.strictObject({ from: z.iso.date(), to: z.iso.date() }).refine(range => range.from <= range.to);
const RunSchema = z.strictObject({
  runId: RunIdSchema, workflowId: z.string().min(1), title: z.string().min(1), attempt: z.number().int().positive(),
  parentRunId: RunIdSchema.nullable(), shape: z.enum(["single", "preview", "operation"]),
  day: z.iso.date(), status: QueueStatusSchema, terminal: z.boolean(), durationMs: z.number().nonnegative().nullable(),
  readback: z.boolean().nullable(), receiptResult: z.enum(["verified-done", "done-with-warnings", "failed", "cancelled", "partial"]).nullable(), warningCount: z.number().int().nonnegative().nullable(),
});
const TimingSchema = z.strictObject({ workflowId: z.string().min(1), totalMs: z.number().nonnegative().nullable(), measured: z.number().int().nonnegative(), unmeasured: z.number().int().nonnegative() });
const TokenSchema = z.string().regex(/^ap1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u).max(4096);
const IdentitySchema = ActivitySnapshotIdentitySchema.extend({ reportToken: ActivitySnapshotTokenSchema, populationDigest: FingerprintSchema });
const SelectionSchema = z.strictObject({
  report: ActivityReportSelectionSchema, population: z.array(RunSchema), successfulTiming: z.array(TimingSchema),
  snapshot: IdentitySchema.extend({ token: TokenSchema }),
});
const BrowseSchema = z.strictObject({
  metric: z.enum(["completed", "outstanding", "failed", "timed"]), workflow: z.string().min(1).optional(),
  query: z.string().optional(), sort: z.strictObject({ column: z.enum(["name", "duration"]), direction: z.enum(["ascending", "descending"]) }).optional(),
  page: z.number().int().nonnegative(), run: RunIdSchema.optional(),
});
const BrowseResultSchema = z.strictObject({
  identity: z.strictObject({ from: z.iso.date(), to: z.iso.date(), token: TokenSchema, browse: BrowseSchema, digest: FingerprintSchema }),
  total: z.number().int().nonnegative(), totalMatches: z.number().int().nonnegative(), start: z.number().int().nonnegative(),
  rows: z.array(RunSchema), run: RunSchema.nullable(),
});
const SelectedReadSchema = z.strictObject({ selection: SelectionSchema, browse: BrowseResultSchema.nullable() });
const ExportSchema = z.strictObject({ selection: SelectionSchema, filename: z.string(), mediaType: z.literal("text/csv; charset=utf-8"), csv: z.string() });

export type ActivityPopulationRange = z.infer<typeof RangeSchema>;
export type ActivityPopulationRun = z.infer<typeof RunSchema>;
export type ActivityPopulationSelection = z.infer<typeof SelectionSchema>;
export type ActivityPopulationBrowse = z.infer<typeof BrowseSchema>;
export type ActivityPopulationBrowseResult = z.infer<typeof BrowseResultSchema>;
export type ActivityPopulationSelectedRead = z.infer<typeof SelectedReadSchema>;
export type ActivityPopulationExport = z.infer<typeof ExportSchema>;
export type ActivitySuccessfulTiming = z.infer<typeof TimingSchema>;

export class ActivityPopulationError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, `ACTIVITY_POPULATION_${string}`>) {
    super(ERROR_CATALOG[code].text);
    this.name = "ActivityPopulationError";
  }
}

const nameOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
function browseSelection(selection: ActivityPopulationSelection, input: unknown): ActivityPopulationBrowseResult {
  const parsed = BrowseSchema.safeParse(input);
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
  return BrowseResultSchema.parse({ identity: { ...identity, digest: sha256Hex(canonicalJsonStringify(identity)) }, total: population.length, totalMatches: matches.length, start, rows: matches.slice(start, start + 20), run });
}

export function createActivityPopulationService(input: {
  database: AuthorityDatabase; clock: Clock;
  descriptors: Parameters<typeof queryActivitySummaries>[2]["descriptors"];
  ledger: Parameters<typeof queryActivitySummaries>[2]["ledger"];
  timeZone?: string;
}) {
  const { database, clock } = input;
  const reports = createActivitySelectionService({ database, clock, read: (from, to, generatedAt) => queryActivitySummaries(database, { from, to, generatedAt }, input) });
  const signer = createActivitySnapshotSigner(IdentitySchema, "ap1", clock);
  const read = (rangeInput: unknown, selected?: z.infer<typeof IdentitySchema>): ActivityPopulationSelection => {
    const bounds = RangeSchema.safeParse(rangeInput);
    if (!bounds.success) throw new ActivityPopulationError("ACTIVITY_POPULATION_RANGE_INVALID");
    const { from, to } = bounds.data;
    return database.withAuthorityReadSnapshot(() => {
      const report = selected === undefined ? reports.read(from, to) : reports.readSelected(from, to, selected.reportToken);
      const population: ActivityPopulationRun[] = [];
      visitActivitySummaryRange(database, from, to, report.volume.timeZone, row => {
        if (row.shape === "operation-member") return;
        population.push(RunSchema.parse({ runId: row.runId, workflowId: row.workflow, title: row.title, attempt: row.attempt, day: row.localDay, parentRunId: row.parentRunId, shape: row.shape,
          status: deriveRunStatus(row), terminal: row.lifecycle.state === "terminal", durationMs: row.durationMs,
          receiptResult: row.receiptResult, warningCount: row.warningCount, readback: row.receiptResult === null ? null : row.receiptResult === "verified-done" }));
      });
      if (population.length !== report.totalRuns || new Set(population.map(row => row.runId)).size !== population.length) throw new ActivityPopulationError("ACTIVITY_POPULATION_SOURCE_MISMATCH");
      const successfulTiming = report.workflows.map(workflow => {
        const successful = population.filter(row => row.workflowId === workflow.workflowId && row.status === "done" && row.parentRunId === null);
        const measured = successful.flatMap(row => row.durationMs === null ? [] : [row.durationMs]);
        return TimingSchema.parse({ workflowId: workflow.workflowId, measured: measured.length, unmeasured: successful.length - measured.length,
          totalMs: measured.length === 0 ? null : measured.reduce((sum, duration) => sum + duration, 0) });
      });
      const populationDigest = sha256Hex(canonicalJsonStringify({ population, successfulTiming }));
      if (selected !== undefined && populationDigest !== selected.populationDigest) throw new ActivityPopulationError("ACTIVITY_POPULATION_CONTENT_MISMATCH");
      const { token: reportToken, ...reportIdentity } = report.snapshot;
      const identity = IdentitySchema.parse({ ...reportIdentity, reportToken, populationDigest });
      return SelectionSchema.parse({ report, population, successfulTiming, snapshot: { ...identity, token: signer.encode(identity) } });
    });
  };
  return Object.freeze({
    read: (range: unknown) => read(range),
    readSelected: (range: unknown, token: unknown, browse?: unknown): ActivityPopulationSelectedRead => {
      const selection = read(range, signer.decode(token));
      return SelectedReadSchema.parse({ selection, browse: browse === undefined ? null : browseSelection(selection, browse) });
    },
    exportSelected: (range: unknown, token: unknown): ActivityPopulationExport => {
      const selection = read(range, signer.decode(token));
      const rows = [spreadsheetCsvRow(["Complete selected run population"]), spreadsheetCsvRow(["Population digest", selection.snapshot.populationDigest]), spreadsheetCsvRow(["Run id", "Workflow id", "Title", "Attempt", "Day", "Queue status", "Terminal", "Duration (ms)", "Read back", "Parent run id", "Shape", "Receipt result", "Warning count"]),
        ...selection.population.map(row => spreadsheetCsvRow([row.runId, row.workflowId, row.title, row.attempt, row.day, row.status, row.terminal, row.durationMs === null ? "Unavailable" : row.durationMs, row.readback === null ? "Unavailable" : row.readback, row.parentRunId === null ? "" : row.parentRunId, row.shape, row.receiptResult === null ? "Unavailable" : row.receiptResult, row.warningCount === null ? "Unavailable" : row.warningCount]))];
      const timing = [spreadsheetCsvRow(["Successful run timing"]), spreadsheetCsvRow(["Workflow id", "Total (ms)", "Measured", "Unmeasured"]),
        ...selection.successfulTiming.map(row => spreadsheetCsvRow([row.workflowId, row.totalMs === null ? "Unavailable" : row.totalMs, row.measured, row.unmeasured]))];
      return ExportSchema.parse({ selection, filename: activityReportCsvFileName(selection.report), mediaType: "text/csv; charset=utf-8", csv: `${activityReportCsv(selection.report)}\r\n${rows.join("\r\n")}\r\n\r\n${timing.join("\r\n")}\r\n` });
    },
  });
}
export type ActivityPopulationService = ReturnType<typeof createActivityPopulationService>;
