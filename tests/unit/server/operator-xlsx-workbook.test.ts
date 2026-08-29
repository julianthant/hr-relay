import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it, vi } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { ActivityReportWireSchema } from "../../../src/domain/dashboard/activity.js";
import {
  OPERATOR_XLSX_MEDIA_TYPE,
  OPERATOR_XLSX_ACTIVITY_SHEETS,
  OPERATOR_XLSX_SEARCH_COLUMNS,
  composeOperatorXlsxWorkbook,
} from "../../../src/server/dashboard/exports/operator-xlsx-workbook.js";

const SEARCH_RUN_ID = "00010001-0001-4001-8001-000100010001";
const SEARCH_TRACE_ID = "sp-150000-0001";
const SECOND_RUN_ID = "00010001-0001-4001-8001-000100010002";
const SECOND_TRACE_ID = "sp-140000-0002";

const SEARCH_DOCUMENT = Object.freeze({
  selection: {
    kind: "search",
    query: {
      q: SEARCH_RUN_ID,
      scope: "run",
      facets: { day: "2026-08-28", dryRun: true },
      limit: 20,
    },
    snapshot: {
      generatedAt: "2026-08-28T16:00:00.000Z",
      sourceIdentity: "a".repeat(64),
      authorityGeneration: 19,
      order: "match-strength/enqueued-desc/run-id-asc:v1",
      totalMatches: 2,
    },
  },
  results: [{
    runId: SEARCH_RUN_ID,
    traceId: SEARCH_TRACE_ID,
    workflowId: "separations",
    registration: {
      state: "registered",
      label: "Separations",
      code: "sp",
      categoryId: "separation",
    },
    partitionDay: "2026-08-28",
    state: "failed",
    shape: "single",
    dryRun: true,
    priority: "interactive",
    systems: ["kuali", "new-kronos", "ucpath"],
    runNumber: { state: "present", value: 7 },
    retryOf: { state: "absent", reason: "this run is not a retry" },
    enqueuedAt: "2026-08-28T15:00:00.000Z",
    endedAt: { state: "present", value: "2026-08-28T15:05:00.000Z" },
    match: { field: "run", strength: "exact" },
  }, {
    runId: SECOND_RUN_ID,
    traceId: SECOND_TRACE_ID,
    workflowId: "separations",
    registration: {
      state: "registered",
      label: "Separations",
      code: "sp",
      categoryId: "separation",
    },
    partitionDay: "2026-08-28",
    state: "parked-gate",
    shape: "single",
    dryRun: true,
    priority: "interactive",
    systems: ["kuali", "new-kronos", "ucpath"],
    runNumber: { state: "present", value: 8 },
    retryOf: { state: "present", value: SEARCH_RUN_ID },
    enqueuedAt: "2026-08-28T14:00:00.000Z",
    endedAt: { state: "absent", reason: `run ${SECOND_RUN_ID} is parked-gate, not terminal` },
    match: { field: "run", strength: "contains" },
  }],
});

const ACTIVITY_REPORT = ActivityReportWireSchema.parse({
  wireVersion: 1,
  from: "2026-08-01",
  to: "2026-08-28",
  generatedAt: "2026-08-28T16:00:00.000Z",
  totalRuns: 3,
  terminalRuns: 2,
  inFlightRuns: 1,
  people: { state: "present", distinct: 2, evidenceRows: 3 },
  completion: { readBack: 1, warnings: 0, warningsUnknown: 0 },
  days: [{ day: "2026-08-03", runs: 3 }],
  workflows: [{
    workflowId: "retired-workflow",
    registration: { state: "unregistered", reason: "workflow registration is unavailable" },
    runs: 3,
    completion: { readBack: 1, warnings: 0, warningsUnknown: 0 },
    failed: 1,
    cancelled: 0,
    partial: 0,
    open: 1,
  }],
  categories: [{
    category: { state: "unregistered", reason: "category registration is unavailable" },
    runs: 3,
  }],
  statuses: [
    { status: "done", runs: 1, sample: [] },
    { status: "failed", runs: 1, sample: [] },
    { status: "running", runs: 1, sample: [SECOND_RUN_ID] },
  ],
  outcomes: [{ outcome: "done", runs: 1 }, { outcome: "failed", runs: 1 }],
  failures: [{ code: "SESSION_LOST", runs: 1, transient: 1, sample: [SEARCH_RUN_ID] }],
  durations: {
    measuredRuns: 2,
    unmeasuredRuns: 0,
    medianMs: { state: "present", value: 12_000 },
    longestMs: { state: "present", value: 30_000, runId: SEARCH_RUN_ID },
    totalMs: 42_000,
  },
  ledger: {
    systems: [
      { system: "ucpath", entries: 4, prod: 3, test: 1 },
      { system: "kuali", entries: 1, prod: 1, test: 0 },
    ],
  },
});

function allCellText(
  workbook: Awaited<ReturnType<typeof readXlsxFile>>,
): string {
  return workbook.flatMap((sheet) => sheet.data.flat()).map(String).join("\n");
}

describe("operator XLSX workbook", () => {
  it("refuses search rows outside the selected DCR3 authority order", async () => {
    await assert.rejects(
      composeOperatorXlsxWorkbook({
        ...SEARCH_DOCUMENT,
        results: [...SEARCH_DOCUMENT.results].reverse(),
      }),
      /workbook rows are not ordered by match-strength\/enqueued-desc\/run-id-asc:v1/,
    );
  });

  it("composes deterministic search bytes behind one exact redacted column contract", async () => {
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-28T16:00:00.000Z"));
    const first = await composeOperatorXlsxWorkbook(SEARCH_DOCUMENT);
    wallClock.mockReturnValue(Date.parse("2026-08-28T16:09:58.000Z"));
    const second = await composeOperatorXlsxWorkbook(SEARCH_DOCUMENT);
    wallClock.mockRestore();

    assert.equal(first.mediaType, OPERATOR_XLSX_MEDIA_TYPE);
    assert.deepEqual(first.sheetNames, ["Read Me", "Runs"]);
    assert.deepEqual(OPERATOR_XLSX_SEARCH_COLUMNS, [
      "Run number",
      "Workflow",
      "Workflow code",
      "Category",
      "Partition day",
      "State",
      "Shape",
      "Dry run",
      "Priority",
      "Systems",
      "Enqueued at",
      "Ended at",
      "End note",
      "Retry",
      "Match field",
      "Match strength",
    ]);
    assert.deepEqual(first.bytes, second.bytes);
    assert.equal(first.bytes[0], 0x50);
    assert.equal(first.bytes[1], 0x4b);
    assert.equal(
      createHash("sha256").update(first.bytes).digest("hex"),
      createHash("sha256").update(second.bytes).digest("hex"),
    );

    const workbook = await readXlsxFile(first.bytes);
    assert.deepEqual(workbook.map(({ sheet }) => sheet), ["Read Me", "Runs"]);
    const runs = workbook[1];
    assert.ok(runs !== undefined);
    assert.deepEqual(runs.data[0], OPERATOR_XLSX_SEARCH_COLUMNS);
    assert.deepEqual(runs.data.slice(1).map((row) => row[0]), [7, 8]);
    assert.deepEqual(runs.data.slice(1).map((row) => row[14]), ["run", "run"]);
    assert.deepEqual(runs.data.slice(1).map((row) => row[15]), ["exact", "contains"]);
    assert.ok(runs.data[1]?.[4] instanceof Date);
    assert.ok(runs.data[1]?.[10] instanceof Date);
    assert.ok(runs.data[1]?.[11] instanceof Date);
    assert.ok(runs.data[2]?.[4] instanceof Date);
    assert.ok(runs.data[2]?.[10] instanceof Date);
    assert.equal(runs.data[2]?.[11], null);
    assert.equal(runs.data[2]?.[12], "Not terminal — parked-gate");
    assert.equal(runs.data[2]?.[13], "Yes — source identifier omitted");
    const text = allCellText(workbook);
    for (const forbidden of [SEARCH_RUN_ID, SEARCH_TRACE_ID, SECOND_RUN_ID, SECOND_TRACE_ID]) {
      assert.equal(text.includes(forbidden), false, `workbook must omit ${forbidden}`);
    }
  });

  it("composes a caveat-first Activity workbook over the exact served report axes", async () => {
    const activityDocument = {
      selection: {
        kind: "activity",
        snapshot: {
          from: "2026-08-01",
          to: "2026-08-28",
          generatedAt: "2026-08-28T16:00:00.000Z",
          sourceIdentity: "a".repeat(64),
          totalRuns: ACTIVITY_REPORT.totalRuns,
        },
      },
      report: ACTIVITY_REPORT,
    };

    const first = await composeOperatorXlsxWorkbook(activityDocument);
    const second = await composeOperatorXlsxWorkbook(activityDocument);

    assert.deepEqual(first.sheetNames, OPERATOR_XLSX_ACTIVITY_SHEETS);
    assert.deepEqual(OPERATOR_XLSX_ACTIVITY_SHEETS, [
      "Read Me",
      "Summary",
      "By Day",
      "By Workflow",
      "By Category",
      "By Status",
      "By Outcome",
      "Failures",
      "Ledger",
    ]);
    assert.deepEqual(first.bytes, second.bytes);

    const workbook = await readXlsxFile(first.bytes);
    assert.deepEqual(workbook.map(({ sheet }) => sheet), OPERATOR_XLSX_ACTIVITY_SHEETS);
    const exactHeaders = new Map<string, readonly string[]>([
      ["Summary", ["Metric", "Value", "Unit", "Note"]],
      ["By Day", ["Day", "Runs"]],
      ["By Workflow", ["Workflow", "Code", "Category", "Runs", "Read back", "Warnings", "Warnings unread", "Failed", "Cancelled", "Partial", "Open", "Registration note"]],
      ["By Category", ["Category", "Runs", "Registration note"]],
      ["By Status", ["Status", "Runs", "Sampled identifiers omitted"]],
      ["By Outcome", ["Outcome", "Runs"]],
      ["Failures", ["Failure code", "Runs", "Transient", "Sampled identifiers omitted"]],
      ["Ledger", ["System", "Entries", "Production", "Test"]],
    ]);
    for (const sheet of workbook) {
      assert.ok(sheet.data.length > 0, `${sheet.sheet} must contain visible cells`);
      const expected = exactHeaders.get(sheet.sheet);
      if (expected !== undefined) assert.deepEqual(sheet.data[0], expected, sheet.sheet);
    }
    const readMe = workbook[0];
    const byDay = workbook[2];
    assert.ok(readMe !== undefined && byDay !== undefined);
    assert.equal(readMe.data[0]?.[0], "Read this before using the numbers");
    assert.ok(readMe.data[4]?.[1] instanceof Date);
    assert.ok(byDay.data[1]?.[0] instanceof Date);
    const text = allCellText(workbook);
    assert.equal(text.includes("Who column"), false);
    for (const forbidden of [SEARCH_RUN_ID, SECOND_RUN_ID]) {
      assert.equal(text.includes(forbidden), false, `Activity workbook must omit ${forbidden}`);
    }
  });
});
