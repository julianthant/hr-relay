import { randomBytes } from "node:crypto";
import { successfulActivityTiming } from "./activity-timing.js";
import { ActivityPopulationRangeSchema, ActivityPopulationIdentitySchema, ActivityPopulationSelectionSchema, ActivityPopulationBrowseSchema, ActivityPopulationBrowseResultSchema, ActivityPopulationSelectedReadSchema, ActivityPopulationExportSchema, type ActivityPopulationRun, type ActivityPopulationSelection, type ActivityPopulationBrowseResult, type ActivityPopulationSelectedRead, type ActivityPopulationExport } from "../../../models/dashboard/activity-population.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { spreadsheetCsvRow } from "../exports/spreadsheet-csv.js";
import { activityReportCsv, activityReportCsvFileName } from "./activity-export.js";
import { ACTIVITY_SNAPSHOT_LIFETIME_MS, createActivitySelectionService, createActivitySnapshotSigner } from "./activity-selection.js";
import { queryActivitySummaries } from "./activity-summaries.js";
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
  database: AuthorityDatabase; clock: Pick<Clock, "now" | "nowMs">;
  /** One key signs both the report and the population tokens, so a read lane can issue and validate them for this runtime. */
  signingKey?: Uint8Array;
  sourceIdentity?: string;
  descriptors: Parameters<typeof queryActivitySummaries>[2]["descriptors"];
  ledger: Parameters<typeof queryActivitySummaries>[2]["ledger"];
}) {
  const { database, clock } = input;
  const signingKey = input.signingKey ?? randomBytes(32);
  type VisitSummary = NonNullable<Parameters<typeof queryActivitySummaries>[3]>;
  const reports = createActivitySelectionService<VisitSummary>({ database, clock, signingKey,
    ...(input.sourceIdentity === undefined ? {} : { sourceIdentity: input.sourceIdentity }),
    read: (from, to, generatedAt, visit) => queryActivitySummaries(database, { from, to, generatedAt }, input, visit) });
  const signer = createActivitySnapshotSigner(ActivityPopulationIdentitySchema, "ap1", clock, signingKey);
  const retained = new Map<string, ActivityPopulationSelection>();
  let retainedPosition: ReturnType<AuthorityDatabase["runSummaryReadPosition"]>;
  const read = (rangeInput: unknown, token?: { encoded: unknown }): ActivityPopulationSelection => {
    const selected = token === undefined ? undefined : signer.decode(token.encoded);
    const bounds = ActivityPopulationRangeSchema.safeParse(rangeInput);
    if (!bounds.success) throw new ActivityPopulationError("ACTIVITY_POPULATION_RANGE_INVALID");
    const { from, to } = bounds.data;
    return database.withAuthorityReadSnapshot(() => {
      const position = database.runSummaryReadPosition();
      if (retainedPosition?.authorityGeneration !== position?.authorityGeneration
        || retainedPosition?.searchState !== position?.searchState
        || retainedPosition?.schemaCookie !== position?.schemaCookie
        || retainedPosition?.changeLogSeq !== position?.changeLogSeq) {
        retainedPosition = position;
        retained.clear();
      }
      const range = `${from}/${to}`;
      const cached = retained.get(range);
      const minimumLifeMs = token === undefined ? ACTIVITY_SNAPSHOT_LIFETIME_MS / 2 : 0;
      if (cached !== undefined && Date.parse(cached.snapshot.expiresAt) > clock.nowMs() + minimumLifeMs
        && (token === undefined || token.encoded === cached.snapshot.token)
        && cached.snapshot.sourceIdentity === (input.sourceIdentity ?? database.getSourceDatabaseIdentity())) return cached;

      const population: ActivityPopulationRun[] = [];
      const addToPopulation: VisitSummary = row => {
        if (row.shape === "operation-member") throw new ActivityPopulationError("ACTIVITY_POPULATION_SOURCE_MISMATCH");
        population.push({ ...row, shape: row.shape });
      };
      const report = selected === undefined ? reports.read(from, to, addToPopulation)
        : reports.readSelected(from, to, selected.reportToken, addToPopulation);
      if (population.length !== report.totalRuns || new Set(population.map(row => row.runId)).size !== population.length) throw new ActivityPopulationError("ACTIVITY_POPULATION_SOURCE_MISMATCH");
      const successfulTiming = report.workflows.map(workflow => successfulActivityTiming(workflow.workflowId, population));
      const populationDigest = sha256Hex(canonicalJsonStringify({ population, successfulTiming }));
      if (selected !== undefined && populationDigest !== selected.populationDigest) throw new ActivityPopulationError("ACTIVITY_POPULATION_CONTENT_MISMATCH");
      const { token: reportToken, ...reportIdentity } = report.snapshot;
      const identity = ActivityPopulationIdentitySchema.parse({ ...reportIdentity, reportToken, populationDigest });
      const selection = ActivityPopulationSelectionSchema.parse({ report, population, successfulTiming, snapshot: { ...identity, token: signer.encode(identity) } });
      if (position !== undefined && selected === undefined) {
        retained.delete(range);
        if (retained.size === 4) {
          const oldest = retained.keys().next();
          if (!oldest.done) retained.delete(oldest.value);
        }
        retained.set(range, deepFreeze(selection));
      }
      return selection;
    });
  };
  return Object.freeze({
    reports,
    read: (range: unknown) => read(range),
    readSelected: (range: unknown, token: unknown, browse?: unknown): ActivityPopulationSelectedRead => {
      const selection = read(range, { encoded: token });
      return ActivityPopulationSelectedReadSchema.parse({ selection, browse: browse === undefined ? null : browseSelection(selection, browse) });
    },
    exportSelected: (range: unknown, token: unknown): ActivityPopulationExport => {
      const selection = read(range, { encoded: token });
      const rows = [spreadsheetCsvRow(["Complete selected run population"]), spreadsheetCsvRow(["Population digest", selection.snapshot.populationDigest]), spreadsheetCsvRow(["Run id", "Workflow id", "Title", "Attempt", "Day", "Queue status", "Terminal", "Duration (ms)", "Read back", "Parent run id", "Shape", "Receipt result", "Warning count"]),
        ...selection.population.map(row => spreadsheetCsvRow([row.runId, row.workflowId, row.title, row.attempt, row.day, row.status, row.terminal, row.durationMs === null ? "Unavailable" : row.durationMs, row.readback === null ? "Unavailable" : row.readback, row.parentRunId === null ? "" : row.parentRunId, row.shape, row.receiptResult === null ? "Unavailable" : row.receiptResult, row.warningCount === null ? "Unavailable" : row.warningCount]))];
      const timing = [spreadsheetCsvRow(["Successful run timing"]), spreadsheetCsvRow(["Workflow id", "Total (ms)", "Measured", "Unmeasured"]),
        ...selection.successfulTiming.map(row => spreadsheetCsvRow([row.workflowId, row.totalMs === null ? "Unavailable" : row.totalMs, row.measured, row.unmeasured]))];
      return ActivityPopulationExportSchema.parse({ selection, filename: activityReportCsvFileName(selection.report), mediaType: "text/csv; charset=utf-8", csv: `${activityReportCsv(selection.report)}\r\n${rows.join("\r\n")}\r\n\r\n${timing.join("\r\n")}\r\n` });
    },
  });
}
type Awaitable<T> = T | Promise<T>;
/** What the population routes serve: answered now on the request thread, or later from a read lane. */
export interface ActivityPopulationService {
  /** A lane answers the two reads with the served body, built and validated there. */
  read(range: unknown): ActivityPopulationSelection | Promise<string>;
  readSelected(range: unknown, token: unknown, browse?: unknown): ActivityPopulationSelectedRead | Promise<string>;
  exportSelected(range: unknown, token: unknown): Awaitable<ActivityPopulationExport>;
}
