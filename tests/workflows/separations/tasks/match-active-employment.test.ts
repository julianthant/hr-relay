import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { UcpathJobRow, UcpathJobSummary } from "../../../../src/models/ui/ucpath-job-summary.js";
import { UcpathJobSummarySchema } from "../../../../src/models/ui/ucpath-job-summary.js";
import { EidSchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { matchActiveEmploymentTask } from "../../../../src/workflows/separations/tasks/match-active-employment.js";

const DOCUMENT = "4444";
const EID = EidSchema.parse("10800000");
const NAME = "Person, Deterministic";
const NOW = IsoInstantSchema.parse("2026-08-14T19:00:00.000Z");

class TaskRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function taskContext() {
  const records: DataPoint[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    fail: (code: string, message: string): never => {
      throw new TaskRefusal(code, message);
    },
    recordData(input: DataPoint | readonly DataPoint[]): void {
      records.push(...(Array.isArray(input) ? input : [input]) as DataPoint[]);
    },
  };
  return { ctx: ctx as never, records };
}

function cell(value: string) {
  return { state: "present" as const, value };
}

function absentCell(reason: string) {
  return { state: "absent" as const, reason };
}

function jobRow(overrides: Partial<UcpathJobRow> = {}): UcpathJobRow {
  return {
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    businessUnit: "SDCMP",
    effectiveDate: cell("07/01/2025"),
    positionNumber: cell("40012345"),
    deptId: cell("000412"),
    department: cell("HOUSING/DINING/HOSPITALITY"),
    jobCode: cell("004921"),
    jobTitle: cell("STDT 2"),
    expectedJobEndDate: absentCell("the grid rendered this cell empty"),
    fte: cell("0.500000"),
    emplClass: cell("Student"),
    ...overrides,
  };
}

function jobSummary(rows: readonly UcpathJobRow[] = [jobRow()], emplId = EID): UcpathJobSummary {
  return UcpathJobSummarySchema.parse({
    pageStateId: "ucpath.person-org.detail-ready",
    emplId,
    displayedName: NAME,
    jobRows: [...rows],
    rowCount: rows.length,
    renderContext: {
      entry: "auto-detail",
      searchResultRows: 0,
      employmentInstances: "already-complete",
    },
    observedAt: NOW,
  });
}

describe("separations workflow task wrappers", () => {
  it("records selected employment facts and keeps the named refusal", async () => {
    const success = taskContext();
    const output = await matchActiveEmploymentTask.impl.run({
      input: { documentNumber: DOCUMENT, jobSummary: jobSummary() },
      ctx: success.ctx,
    });
    const expected = {
      rowIndex: 0,
      emplRecord: "0",
      hrStatus: "Active",
      businessUnit: "SDCMP",
      deptId: cell("000412"),
      department: cell("HOUSING/DINING/HOSPITALITY"),
      payrollTitleCode: "004921",
      payrollTitle: "STDT 2",
      effectiveDate: cell("07/01/2025"),
      rowCount: 1,
    };
    assert.deepEqual(output, expected);
    const entries = Object.entries(expected);
    assert.deepEqual(success.records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
      direction: "read",
      field,
    })));
    assert.deepEqual(Object.fromEntries(success.records.map(({ field, value }) => [field, value])), expected);

    const refusal = taskContext();
    await assert.rejects(() => matchActiveEmploymentTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        jobSummary: jobSummary([jobRow({ hrStatus: "Terminated" })]),
      },
      ctx: refusal.ctx,
    }), (error: unknown) => error instanceof TaskRefusal && error.code === "no-active-employment");
    assert.deepEqual(refusal.records, []);
  });
});
