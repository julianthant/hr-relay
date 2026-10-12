import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SeparationsReadSeparationDates } from "../../../../src/models/workflows/separations/read-separation-dates.js";
import { readSeparationDatesTask } from "../../../../src/workflows/separations/tasks/read-separation-dates.js";
import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";

const { taskContext } = createSeparationTaskFixtures();

describe("separation date reconciliation refusal", () => {
  it("declares and propagates the future-date refusal without recording filing dates", async () => {
    assert.ok(SeparationsReadSeparationDates.errorCodes.includes("separation-date-in-future"));
    const input = SeparationsReadSeparationDates.input.parse({
      plan: {
        documentNumber: "4444", employeeName: "Person, Deterministic",
        kualiLastDayWorked: "10/01/2026", kualiSeparationDate: "10/01/2026", asOfDate: "10/12/2026",
        timecardWindow: { start: "09/01/2026", end: "11/01/2026" },
      },
      timekeeperName: "Julian Zaw", lastPunchDate: "10/01/2026", sickDates: [],
      holidayDates: ["10/31/2026"], unclassifiedPayCodes: [],
      observedWindow: { start: "09/01/2026", end: "11/01/2026" },
    });
    const refusal = taskContext();
    await assert.rejects(readSeparationDatesTask.impl.run({ input, ctx: refusal.ctx }), (error: unknown) => {
      assert.ok(error instanceof TaskRefusal);
      assert.equal(error.code, "separation-date-in-future");
      assert.match(error.message, /10\/31\/2026 is after 10\/12\/2026/u);
      assert.match(error.message, /not yet separated/u);
      return true;
    });
    assert.deepEqual(refusal.records, []);
  });
});
