import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadOnboardingDatesOutputSchema } from "../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../src/domain/contracts/crm/read-onboarding-record.js";
import { EidSchema } from "../../src/domain/ids.js";
import { createDeterministicCrmOnboardingDriver } from "../../src/stores/crm/driver/fake.js";
import { readOnboardingDatesTask } from "../../src/stores/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../src/stores/crm/tasks/read-onboarding-record.js";

const signal = new AbortController().signal;
const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});
const fail = (_code: string, message: string): never => {
  throw new Error(message);
};
const EID = EidSchema.parse("10873698");
const record = ReadOnboardingRecordOutputSchema.parse({
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: EID,
    fullName: "Battistessa, Johnnie",
    rawStage: "Completed",
  },
});
const dates = ReadOnboardingDatesOutputSchema.parse({
  emplId: EID,
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
});

describe("person-lookup runtime scenarios", () => {
  it("person-lookup/crm-subject-mismatch — stale CRM identity refuses both reads", async () => {
    const driver = createDeterministicCrmOnboardingDriver({
      record,
      dates,
      recordObservedEid: "10001573",
      datesObservedEid: "10001573",
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: EID, name: "Battistessa, Johnnie" },
        ctx: { signal, log, driver, fail },
      }),
      /expected EID 10873698 but bound 10001573/,
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: EID },
        ctx: { signal, log, driver, fail },
      }),
      /expected EID 10873698 but bound 10001573/,
    );
  });
});
