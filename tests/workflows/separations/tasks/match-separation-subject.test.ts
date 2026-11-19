import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { matchSeparationSubjectTask } from "../../../../src/workflows/separations/tasks/match-separation-subject.js";

const { DOCUMENT, EID, taskContext, nameSelection: searchSelection } = createSeparationTaskFixtures();


describe("separations workflow task wrappers", () => {

  it("records the exact Employee ID searched and refuses a document without one", async () => {
    const success = taskContext();
    const output = await matchSeparationSubjectTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        documentEid: { state: "present", value: EID },
        searchSelection,
      },
      ctx: success.ctx,
    });
    const expected = {
      emplId: EID,
      emplIdSource: "document-eid",
      searchedEmployeeId: EID,
      candidateCount: 1,
    };
    assert.deepEqual(output, expected);
    assert.ok(success.records.every(({ direction }) => direction === "read"));
    assert.deepEqual(success.records.map(({ field }) => field), ["searchedEmployeeId", "emplId", "emplIdSource", "candidateCount"]);
    assert.deepEqual(Object.fromEntries(success.records.map(({ field, value }) => [field, value])), expected);

    const refusal = taskContext();
    await assert.rejects(() => matchSeparationSubjectTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        documentEid: { state: "absent", reason: "the EID control was empty" },
      },
      ctx: refusal.ctx,
    }), (error: unknown) => error instanceof TaskRefusal && error.code === "employee-id-absent");
    assert.deepEqual(refusal.records, []);
  });
});

it("selects the operator-entered EID while preserving the document field", async () => {
  const documentEid = { state: "present" as const, value: EID };
  const context = taskContext();
  const output = await matchSeparationSubjectTask.impl.run({ input: {
    operatorEmployeeId: EidSchema.parse("10800001"), documentNumber: DOCUMENT, documentEid, searchSelection,
  }, ctx: context.ctx });
  assert.equal(output.emplId, "10800001");
  assert.equal(output.emplIdSource, "operator-entered");
  assert.equal(output.searchedEmployeeId, EID);
  assert.deepEqual(documentEid, { state: "present", value: EID });
});
