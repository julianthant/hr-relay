import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { UcpathPersonSelection } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { matchSeparationSubjectTask } from "../../../../src/workflows/separations/tasks/match-separation-subject.js";

const DOCUMENT = "4444";
const EID = EidSchema.parse("10800000");
const NAME = "Person, Deterministic";

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

const nameSelection: UcpathPersonSelection = {
  status: "resolved",
  selected: {
    emplId: EID,
    name: NAME,
    department: "Housing Dining Hospitality",
    jobTitle: "STDT 2",
    employeeStatus: "active",
    hdh: true,
  },
  candidateEids: [EID],
};

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
