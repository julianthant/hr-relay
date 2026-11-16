import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { matchSeparationSubjectTask } from "../../../../src/workflows/separations/tasks/match-separation-subject.js";

const { DOCUMENT, EID, NAME, taskContext, nameSelection } = createSeparationTaskFixtures();


describe("separations workflow task wrappers", () => {

  it("records the document EID and refuses an unresolved name-only subject", async () => {
    const success = taskContext();
    const output = await matchSeparationSubjectTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        employeeName: NAME,
        documentEid: { state: "present", value: EID },
        nameSelection,
      },
      ctx: success.ctx,
    });
    const expected = {
      emplId: EID,
      emplIdSource: "document-eid",
      searchedName: NAME,
      candidateCount: 1,
    };
    assert.deepEqual(output, expected);
    const entries = Object.entries(expected);
    assert.deepEqual(success.records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
      direction: "read",
      field,
    })));
    assert.deepEqual(Object.fromEntries(success.records.map(({ field, value }) => [field, value])), expected);

    const refusal = taskContext();
    await assert.rejects(() => matchSeparationSubjectTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        employeeName: NAME,
        documentEid: { state: "absent", reason: "the EID control was empty" },
        nameSelection: {
          status: "not-found",
          selected: null,
          candidateEids: [],
          searchName: NAME,
        },
      },
      ctx: refusal.ctx,
    }), (error: unknown) => error instanceof TaskRefusal && error.code === "subject-not-resolvable");
    assert.deepEqual(refusal.records, []);
  });
});

it("selects the operator-entered EID while preserving the document field", async () => {
  const documentEid = { state: "present" as const, value: EID };
  const context = taskContext();
  const output = await matchSeparationSubjectTask.impl.run({ input: {
    operatorEmployeeId: EidSchema.parse("10800001"), documentNumber: DOCUMENT, employeeName: NAME, documentEid, nameSelection,
  }, ctx: context.ctx });
  assert.equal(output.emplId, "10800001");
  assert.equal(output.emplIdSource, "operator-entered");
  assert.deepEqual(documentEid, { state: "present", value: EID });
});
