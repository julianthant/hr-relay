import assert from "node:assert/strict";
import { it } from "vitest";
import { WorkStudyReadTransactionPlan } from "../../../../src/models/workflows/work-study/read-transaction-plan.js";
import { readWorkStudyTransactionPlanTask } from "../../../../src/workflows/work-study/tasks/read-transaction-plan.js";
import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";

const read = {
  pageStateId: "ucpath.paypath.position-data-ready", observedAt: "2026-08-01T12:00:00.000Z", emplId: "10000001", displayedName: "Lee, Jordan",
  position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
};
const input = (emplId: string) => WorkStudyReadTransactionPlan.input.parse({ input: { emplId, effectiveDate: "2026-08-03" }, read });

it("returns the plan and records every output leaf as a read", async () => {
  const f = createSeparationTaskFixtures().taskContext();
  const output = await readWorkStudyTransactionPlanTask.impl.run({ input: input("10000001"), ctx: f.ctx });
  assert.equal(output.effectiveDate, "08/03/2026");
  assert.equal(output.comments, "Updated pool id to F per work study award 08/03/2026");
  assert.deepEqual(f.records.map(point => [point.field, point.value, point.direction]), [
    ["comments", "Updated pool id to F per work study award 08/03/2026", "read"],
    ["current.effectiveDate", "07/01/2026", "read"], ["current.positionChangeReason", "", "read"],
    ["current.positionNumber", "40012345", "read"], ["current.positionPool", "", "read"],
    ["effectiveDate", "08/03/2026", "read"], ["emplId", "10000001", "read"], ["name", "Lee, Jordan", "read"],
    ["positionChangeReason", "JRL", "read"], ["positionPool", "F", "read"],
  ]);
});

it("fails INCONSISTENT_INPUTS when the read is for another employee", async () => {
  const f = createSeparationTaskFixtures().taskContext();
  await assert.rejects(readWorkStudyTransactionPlanTask.impl.run({ input: input("10000002"), ctx: f.ctx }),
    error => error instanceof TaskRefusal && error.code === "INCONSISTENT_INPUTS");
  assert.deepEqual(f.records, []);
});
