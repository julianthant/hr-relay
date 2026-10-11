import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadOnboardingRecordOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { UcpathCandidateSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../src/rules/redaction/redaction.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { DataPointSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { readActiveStatusTask } from "../../../../src/workflows/person-lookup/tasks/read-active-status.js";

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

const signal = new AbortController().signal;

const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

const fail = (_code: string, message: string): never => {
  throw new Error(message);
};

const recordData = (input: DataPoint | readonly DataPoint[]): void => {
  for (const point of Array.isArray(input) ? input : [input]) {
    DataPointSchema.parse(point);
  }
};

const commonCtx = { signal, log, fail, recordData };

const candidate = UcpathCandidateSchema.parse({
  emplId: "10873698",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active" as const,
  hdh: true,
});

const crmRecord = ReadOnboardingRecordOutputSchema.parse({
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: candidate.emplId,
    fullName: candidate.name,
    rawStage: "Completed",
  },
});

if (crmRecord.state !== "found") throw new Error("CRM found-record fixture did not parse as found");

describe("Person Lookup task implementations", () => {
  it("keeps genuine unresolved and inactive outcomes distinct", async () => {
    const unresolved = await readActiveStatusTask.impl.run({
      input: {
        person: {
          results: [],
          selection: {
            status: "not-found",
            selected: null,
            candidateEids: [],
            searchName: "Nobody, Missing",
          },
        },
        crm: { state: "absent", queriedEid: candidate.emplId, reason: "no matching record" },
        keepNonHdh: false,
      },
      ctx: commonCtx,
    });
    assert.equal(unresolved.state, "undetermined");

    const terminated = UcpathCandidateSchema.parse({ ...candidate, employeeStatus: "terminated" });
    const inactive = await readActiveStatusTask.impl.run({
      input: {
        person: {
          results: [terminated],
          selection: {
            status: "resolved",
            selected: terminated,
            candidateEids: [candidate.emplId],
          },
        },
        crm: crmRecord,
        keepNonHdh: false,
      },
      ctx: commonCtx,
    });
    assert.equal(inactive.state, "inactive");
  })

  it("checks an absent CRM EID before returning the non-HDH outcome", async () => {
    const nonHdh = UcpathCandidateSchema.parse({ ...candidate, hdh: false });
    await assert.rejects(
      readActiveStatusTask.impl.run({
        input: {
          person: {
            results: [nonHdh],
            selection: {
              status: "resolved",
              selected: nonHdh,
              candidateEids: [nonHdh.emplId],
            },
          },
          crm: {
            state: "absent",
            queriedEid: EidSchema.parse("10001573"),
            reason: "no record for the wrong person",
          },
          keepNonHdh: false,
        },
        ctx: commonCtx,
      }),
      new RegExp(`UCPath EID ${directIdentifierDisplay("10873698")} but CRM EID ${directIdentifierDisplay("10001573")}`),
    );
  })
});
