import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadOnboardingRecordOutputSchema } from "../../../../../src/domain/contracts/crm/read-onboarding-record.js";
import { UcpathCandidateSchema } from "../../../../../src/domain/contracts/ucpath/search-person-org.js";
import { EidSchema } from "../../../../../src/domain/ids.js";
import { directIdentifierDisplay } from "../../../../../src/domain/redaction.js";
import { DataPointSchema } from "../../../../../src/domain/task-provenance.js";
import type { DataPoint } from "../../../../../src/domain/task-provenance.js";
import { readActiveStatusTask } from "../../../../../src/backend/workflow-tasks/person-lookup/tasks/read-active-status.js";

const signal = new AbortController().signal;

const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

const fail = (_code: string, message: string): never => {
  throw new Error(message);
};

const failedTaskDataPoints: DataPoint[] = [];

const recordData = (input: DataPoint | readonly DataPoint[]): void => {
  for (const point of Array.isArray(input) ? input : [input]) {
    failedTaskDataPoints.push(DataPointSchema.parse(point));
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

describe("Phase 1f Person Lookup task implementations", () => {
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
