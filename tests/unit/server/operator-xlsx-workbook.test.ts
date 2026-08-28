import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import {
  OPERATOR_XLSX_MEDIA_TYPE,
  OPERATOR_XLSX_SEARCH_COLUMNS,
  composeOperatorXlsxWorkbook,
} from "../../../src/server/dashboard/exports/operator-xlsx-workbook.js";

const SEARCH_DOCUMENT = Object.freeze({
  selection: {
    kind: "search",
    query: {
      q: "separations",
      scope: "workflow",
      facets: { day: "2026-08-28", dryRun: true },
      limit: 20,
    },
    snapshot: {
      generatedAt: "2026-08-28T16:00:00.000Z",
      authorityGeneration: 19,
      order: "match-strength/enqueued-desc/run-id-asc:v1",
      totalMatches: 1,
    },
  },
  results: [{
    runId: "00010001-0001-4001-8001-000100010001",
    traceId: "sp-160000-0001",
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
    match: { field: "workflow", strength: "exact" },
  }],
});

describe("operator XLSX workbook", () => {
  it("composes deterministic search bytes behind one exact redacted column contract", async () => {
    const first = await composeOperatorXlsxWorkbook(SEARCH_DOCUMENT);
    const second = await composeOperatorXlsxWorkbook(SEARCH_DOCUMENT);

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
  });
});
