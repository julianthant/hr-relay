import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadOnboardingDatesOutputSchema } from "../../../../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../../../../src/domain/contracts/crm/read-onboarding-record.js";
import { UcpathCandidateSchema } from "../../../../../src/domain/contracts/ucpath/search-person-org.js";
import { EidSchema } from "../../../../../src/domain/ids.js";
import { directIdentifierDisplay } from "../../../../../src/domain/redaction.js";
import { DataPointSchema } from "../../../../../src/domain/task-provenance.js";
import type { DataPoint } from "../../../../../src/domain/task-provenance.js";
import { readOnboardingDatesTask } from "../../../../../src/backend/systems/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../../../../src/backend/systems/crm/tasks/read-onboarding-record.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";

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

const crmDates = ReadOnboardingDatesOutputSchema.parse({
  emplId: candidate.emplId,
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
});

describe("Phase 1f Person Lookup task implementations", () => {
  it("fails CRM reads when the displayed subject or extracted output EID differs", async () => {
    const observedWrong = createDeterministicCrmOnboardingDriver({
      record: crmRecord,
      dates: crmDates,
      recordObservedEid: "10001573",
      datesObservedEid: "10001573",
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: candidate.emplId, name: candidate.name },
        ctx: { ...commonCtx, driver: observedWrong },
      }),
      new RegExp(`expected EID ${directIdentifierDisplay("10873698")} but bound ${directIdentifierDisplay("10001573")}`),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: candidate.emplId },
        ctx: { ...commonCtx, driver: observedWrong },
      }),
      new RegExp(`expected EID ${directIdentifierDisplay("10873698")} but bound ${directIdentifierDisplay("10001573")}`),
    );

    const mismatchedOutputs = createDeterministicCrmOnboardingDriver({
      record: {
        state: "absent",
        queriedEid: EidSchema.parse("10001573"),
        reason: "no record for the wrong displayed person",
      },
      dates: { ...crmDates, emplId: EidSchema.parse("10001573") },
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: candidate.emplId, name: candidate.name },
        ctx: { ...commonCtx, driver: mismatchedOutputs },
      }),
      new RegExp(`returned output for ${directIdentifierDisplay("10001573")}`),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: candidate.emplId },
        ctx: { ...commonCtx, driver: mismatchedOutputs },
      }),
      new RegExp(`returned output for ${directIdentifierDisplay("10001573")}`),
    );
  })
});
