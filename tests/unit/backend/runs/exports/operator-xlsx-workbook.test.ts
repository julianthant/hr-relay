import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it, vi } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { ActivityReportWireSchema } from "../../../../../src/domain/dashboard/activity.js";
import {
  OPERATOR_XLSX_MEDIA_TYPE,
  OPERATOR_XLSX_ACTIVITY_SHEETS,
  OPERATOR_XLSX_SEARCH_COLUMNS,
  composeOperatorXlsxWorkbook,
} from "../../../../../src/backend/runs/exports/operator-xlsx-workbook.js";

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
      order: "match-strength/enqueued-desc/run-id-asc:v2",
      totalMatches: 2,
      coverage:{matched:2,subjectUnavailable:2,actorUnavailable:2,candidateLimit:10000},
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
      metadata: { subject:{state:"unavailable",reason:"declaration-unavailable"}, actor:{state:"unavailable",reason:"not-recorded"},version:1,failureCode:null,evidence:{receipt:false,failure:false,diagnostic:false} },
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
      metadata: { subject:{state:"unavailable",reason:"declaration-unavailable"}, actor:{state:"unavailable",reason:"not-recorded"},version:1,failureCode:null,evidence:{receipt:false,failure:false,diagnostic:false} },
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
      /workbook rows are not ordered by match-strength\/enqueued-desc\/run-id-asc:v2/,
    );
  });

  it("composes deterministic search bytes behind one exact complete column contract", async () => {
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
      "Version", "Failure code", "Subject coverage", "Actor coverage", "Receipt", "Failure", "Diagnostic", "Run id", "Trace id", "Subject", "Actor",
      "Workflow id", "Registration state", "Registration reason", "Run number state", "Ended at state", "Retry state", "Subject state", "Actor state",
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
    const header = runs.data[0];
    assert.ok(header);
    for (const [index, result] of SEARCH_DOCUMENT.results.entries()) {
      const row = runs.data[index + 1];
      assert.ok(row);
      assert.equal(row[header.indexOf("Workflow id")], result.workflowId);
      assert.equal(row[header.indexOf("Workflow")], result.registration.label);
      assert.equal(row[header.indexOf("Workflow code")], result.registration.code);
      assert.equal(row[header.indexOf("Category")], result.registration.categoryId);
      assert.equal(row[header.indexOf("Registration state")], result.registration.state);
      assert.equal(row[header.indexOf("Run number state")], result.runNumber.state);
      assert.equal(row[header.indexOf("Ended at state")], result.endedAt.state);
      assert.equal(row[header.indexOf("Retry state")], result.retryOf.state);
    }
    assert.deepEqual(runs.data.slice(1).map((row) => row[0]), [7, 8]);
    assert.deepEqual(runs.data.slice(1).map((row) => row[14]), ["run", "run"]);
    assert.deepEqual(runs.data.slice(1).map((row) => row[15]), ["exact", "contains"]);
    assert.ok(runs.data[1]?.[4] instanceof Date);
    assert.ok(runs.data[1]?.[10] instanceof Date);
    assert.ok(runs.data[1]?.[11] instanceof Date);
    assert.ok(runs.data[2]?.[4] instanceof Date);
    assert.ok(runs.data[2]?.[10] instanceof Date);
    assert.equal(runs.data[2]?.[11], null);
    assert.equal(runs.data[2]?.[12], SEARCH_DOCUMENT.results[1]?.endedAt.reason);
    assert.equal(runs.data[2]?.[13], SEARCH_DOCUMENT.results[1]?.retryOf.value);
    const text = allCellText(workbook);
    for (const supplied of [SEARCH_RUN_ID, SEARCH_TRACE_ID, SECOND_RUN_ID, SECOND_TRACE_ID]) {
      assert.equal(text.includes(supplied), true, `workbook must retain ${supplied}`);
    }
  });

  it("retains supplied query, filters, subjects and actors as spreadsheet text", async () => {
    const subject = "=HYPERLINK(\"https://example.invalid\") 10123456";
    const document = {
      ...SEARCH_DOCUMENT,
      selection: {
        ...SEARCH_DOCUMENT.selection,
        query: { ...SEARCH_DOCUMENT.selection.query, q: subject, facets: { subject } },
      },
      results: SEARCH_DOCUMENT.results.map(result => ({
        ...result,
        metadata: { ...result.metadata, subject: { state: "available", value: subject }, actor: { state: "available", value: "local-operator" } },
      })),
    };
    const workbook = await readXlsxFile((await composeOperatorXlsxWorkbook(document)).bytes);
    const readMe = workbook[0];
    const runs = workbook[1];
    assert.equal(readMe?.data.find(row => row[0] === "Search query")?.[1], subject);
    assert.equal(readMe?.data.find(row => row[0] === "Search filters")?.[1], JSON.stringify({ subject }));
    assert.equal(runs?.data[1]?.[25], subject);
    assert.equal(runs?.data[1]?.[26], "local-operator");
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
          authorityGeneration:1,reportDigest:"a".repeat(64),
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
      ["By Status", ["Status", "Runs", "Sampled run identifiers"]],
      ["By Outcome", ["Outcome", "Runs"]],
      ["Failures", ["Failure code", "Runs", "Transient", "Sampled run identifiers"]],
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
    for (const supplied of [SEARCH_RUN_ID, SECOND_RUN_ID]) {
      assert.equal(text.includes(supplied), true, `Activity workbook must retain ${supplied}`);
    }
    assert.equal(workbook.find(sheet => sheet.sheet === "By Status")?.data[3]?.[2], SECOND_RUN_ID);
    assert.equal(workbook.find(sheet => sheet.sheet === "Failures")?.data[1]?.[3], SEARCH_RUN_ID);
    assert.equal(workbook.find(sheet => sheet.sheet === "Summary")?.data.find(row => row[0] === "Longest duration")?.[3], SEARCH_RUN_ID);
  });
});
