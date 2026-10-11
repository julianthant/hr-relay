import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { ReadOnboardingRecordOutputSchema as ReadOnboardingRecordOutputSchema_m1 } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { UcpathCandidateSchema as UcpathCandidateSchema_m1 } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { EidSchema as EidSchema_m0,EidSchema as EidSchema_m1 } from "../../../../src/rules/identity/ids.js";
import { directIdentifierDisplay as directIdentifierDisplay_m1 } from "../../../../src/rules/redaction/redaction.js";
import type { DataPoint as DataPoint_m1 } from "../../../../src/rules/workflow/task-provenance.js";
import { DataPointSchema as DataPointSchema_m1 } from "../../../../src/rules/workflow/task-provenance.js";
import { readActiveStatusTask as readActiveStatusTask_m0,readActiveStatusTask as readActiveStatusTask_m1 } from "../../../../src/workflows/person-lookup/tasks/read-active-status.js";


{


class TaskRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

it_m0("names inconsistent UCPath and CRM identities without recording output facts", async () => {
  const expectedEid = EidSchema_m0.parse("10873698");
  const otherEid = EidSchema_m0.parse("10001573");
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

  await assert_m0.rejects(readActiveStatusTask_m0.impl.run({
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

  assert_m0.deepEqual(refusals, [new TaskRefusal(
    "inconsistent-inputs",
    `person-lookup active-status received UCPath EID ${expectedEid} but CRM EID ${otherEid}`,
  )]);
  assert_m0.deepEqual(records, []);
});
}

{


const signal = new AbortController().signal;

const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

const fail = (_code: string, message: string): never => {
  throw new Error(message);
};

const failedTaskDataPoints: DataPoint_m1[] = [];

const recordData = (input: DataPoint_m1 | readonly DataPoint_m1[]): void => {
  for (const point of Array.isArray(input) ? input : [input]) {
    failedTaskDataPoints.push(DataPointSchema_m1.parse(point));
  }
};

const commonCtx = { signal, log, fail, recordData };

const candidate = UcpathCandidateSchema_m1.parse({
  emplId: "10873698",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active" as const,
  hdh: true,
});

const crmRecord = ReadOnboardingRecordOutputSchema_m1.parse({
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: candidate.emplId,
    fullName: candidate.name,
    rawStage: "Completed",
  },
});

if (crmRecord.state !== "found") throw new Error("CRM found-record fixture did not parse as found");

describe_m1("Person Lookup task implementations", () => {
  it_m1("keeps genuine unresolved and inactive outcomes distinct", async () => {
    const unresolved = await readActiveStatusTask_m1.impl.run({
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
    assert_m1.equal(unresolved.state, "undetermined");

    const terminated = UcpathCandidateSchema_m1.parse({ ...candidate, employeeStatus: "terminated" });
    const inactive = await readActiveStatusTask_m1.impl.run({
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
    assert_m1.equal(inactive.state, "inactive");
  })

  it_m1("checks an absent CRM EID before returning the non-HDH outcome", async () => {
    const nonHdh = UcpathCandidateSchema_m1.parse({ ...candidate, hdh: false });
    await assert_m1.rejects(
      readActiveStatusTask_m1.impl.run({
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
            queriedEid: EidSchema_m1.parse("10001573"),
            reason: "no record for the wrong person",
          },
          keepNonHdh: false,
        },
        ctx: commonCtx,
      }),
      new RegExp(`UCPath EID ${directIdentifierDisplay_m1("10873698")} but CRM EID ${directIdentifierDisplay_m1("10001573")}`),
    );
  })
});
}
