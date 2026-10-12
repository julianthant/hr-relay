import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { KUALI_TERMINATION_TYPE_OPTIONS } from "../../../../src/rules/separations/termination-type.js";
import { matchTerminationTypeTask } from "../../../../src/workflows/separations/tasks/match-termination-type.js";

const { DOCUMENT, taskContext } = createSeparationTaskFixtures();


describe("separations workflow task wrappers", () => {

  it("records the termination mapping and refuses a blank selected type", async () => {
    const success = taskContext();
    const output = await matchTerminationTypeTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        terminationType: { state: "present", value: "Graduated/No longer a Student" },
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
      },
      ctx: success.ctx,
    });
    const expected = {
      terminationType: "Graduated/No longer a Student",
      classification: "involuntary",
      template: "UC_INVOL_TERM",
      reasonCode: "No Longer Student",
      observedOptionCount: 17,
    };
    assert.deepEqual(output, expected);
    const entries = Object.entries(expected);
    assert.deepEqual(success.records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
      direction: "read",
      field,
    })));
    assert.deepEqual(Object.fromEntries(success.records.map(({ field, value }) => [field, value])), expected);

    const refusal = taskContext();
    await assert.rejects(() => matchTerminationTypeTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        terminationType: { state: "absent", reason: "the control was empty" },
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
      },
      ctx: refusal.ctx,
    }), (error: unknown) => error instanceof TaskRefusal && error.code === "blank-termination-type");
    assert.deepEqual(refusal.records, []);
  });
});
