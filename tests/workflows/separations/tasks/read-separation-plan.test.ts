import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DateOnlySchema } from "../../../../src/rules/identity/ids.js";
import { readSeparationPlanTask } from "../../../../src/workflows/separations/tasks/read-separation-plan.js";

const { DOCUMENT, NAME, NOW, taskContext } = createSeparationTaskFixtures();


function formDate(raw: string) {
  const [month, day, year] = raw.split("/");
  return {
    state: "present" as const,
    raw,
    value: DateOnlySchema.parse(year + "-" + month + "-" + day),
  };
}

describe("separations workflow task wrappers", () => {

  it("records the form plan and refuses a missing employee name", async () => {
    const input = {
      documentNumber: DOCUMENT,
      employeeName: { state: "present" as const, value: NAME },
      lastDayWorked: formDate("06/12/2026"),
      separationDate: formDate("06/12/2026"),
      observedAt: NOW,
    };
    const success = taskContext();
    const output = await readSeparationPlanTask.impl.run({ input, ctx: success.ctx });
    const expected = {
      documentNumber: DOCUMENT,
      employeeName: NAME,
      kualiLastDayWorked: "06/12/2026",
      kualiSeparationDate: "06/12/2026",
      asOfDate: "08/14/2026",
      timecardWindow: { start: "05/12/2026", end: "07/12/2026" },
    };
    assert.deepEqual(output, expected);
    const entries = Object.entries(expected);
    assert.deepEqual(success.records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
      direction: "read",
      field,
    })));
    assert.deepEqual(Object.fromEntries(success.records.map(({ field, value }) => [field, value])), expected);

    const refusal = taskContext();
    await assert.rejects(() => readSeparationPlanTask.impl.run({
      input: { ...input, employeeName: { state: "absent", reason: "the control was empty" } },
      ctx: refusal.ctx,
    }), (error: unknown) => error instanceof TaskRefusal && error.code === "employee-name-absent");
    assert.deepEqual(refusal.records, []);
  });
});
