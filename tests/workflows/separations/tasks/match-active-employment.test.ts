import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { matchActiveEmploymentTask } from "../../../../src/workflows/separations/tasks/match-active-employment.js";

const { DOCUMENT, taskContext, cell, jobRow, jobSummary } = createSeparationTaskFixtures();


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
