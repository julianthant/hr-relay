import assert from "node:assert/strict";
import { it } from "vitest";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { readActiveStatusTask } from "../../../../../src/workflows/person-lookup/tasks/read-active-status.js";

class TaskRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

it("names inconsistent UCPath and CRM identities without recording output facts", async () => {
  const expectedEid = EidSchema.parse("10873698");
  const otherEid = EidSchema.parse("10001573");
  const records: unknown[] = [];
  const refusals: TaskRefusal[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    fail: (code: string, message: string): never => {
      const refusal = new TaskRefusal(code, message);
      refusals.push(refusal);
      throw refusal;
    },
    recordData: (input: unknown): void => { records.push(input); },
  };

  await assert.rejects(readActiveStatusTask.impl.run({
    input: {
      person: {
        results: [{
          emplId: expectedEid,
          name: "Person, Deterministic",
          department: "Housing Dining Hospitality",
          jobTitle: "Dining Assistant",
          employeeStatus: "active",
          hdh: false,
        }],
        selection: {
          status: "resolved",
          selected: {
            emplId: expectedEid,
            name: "Person, Deterministic",
            department: "Housing Dining Hospitality",
            jobTitle: "Dining Assistant",
            employeeStatus: "active",
            hdh: false,
          },
          candidateEids: [expectedEid],
        },
      },
      crm: {
        state: "absent",
        queriedEid: otherEid,
        reason: "no matching CRM record",
      },
      keepNonHdh: false,
    },
    ctx,
  }), (error: unknown) => error instanceof TaskRefusal && error.code === "inconsistent-inputs");

  assert.deepEqual(refusals, [new TaskRefusal(
    "inconsistent-inputs",
    `person-lookup active-status received UCPath EID ${expectedEid} but CRM EID ${otherEid}`,
  )]);
  assert.deepEqual(records, []);
});
