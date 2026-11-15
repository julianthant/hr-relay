import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { UcpathPayPathReadSchema } from "../../../src/models/ui/ucpath-paypath.js";
import { WorkStudyInput } from "../../../src/models/workflows/work-study/input.js";
import { WorkStudyPlanSchema } from "../../../src/models/workflows/work-study/read-transaction-plan.js";
import { planWorkStudyTransaction, workStudyComments, workStudyUsDate, WorkStudyPlanRefusedError } from "../../../src/rules/work-study/plan.js";

const read = UcpathPayPathReadSchema.parse({
  pageStateId: "ucpath.paypath.position-data-ready", observedAt: "2026-08-01T12:00:00.000Z", emplId: "10000001", displayedName: "Lee, Jordan",
  position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
});

describe("work-study plan", () => {
  it("formats the effective date and comments", () => {
    assert.equal(workStudyUsDate("2026-08-03"), "08/03/2026");
    assert.equal(workStudyComments("2026-08-03"), "Updated pool id to F per work study award 08/03/2026");
  });

  it("plans the JRL / pool F transaction from the read", () => {
    const plan = planWorkStudyTransaction(WorkStudyInput.parse({ emplId: "10000001", effectiveDate: "2026-08-03" }), read);
    assert.deepEqual(plan, {
      emplId: "10000001", name: "Lee, Jordan", effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F",
      comments: "Updated pool id to F per work study award 08/03/2026",
      current: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
    });
    WorkStudyPlanSchema.parse(plan);
  });

  it("refuses a read for another employee", () => {
    assert.throws(() => planWorkStudyTransaction(WorkStudyInput.parse({ emplId: "10000002", effectiveDate: "2026-08-03" }), read), WorkStudyPlanRefusedError);
  });
});
