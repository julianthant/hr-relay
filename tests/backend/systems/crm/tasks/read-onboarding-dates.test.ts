import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
import { readOnboardingDatesTask } from "../../../../../src/backend/systems/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../../../../src/backend/systems/crm/tasks/read-onboarding-record.js";
import { ReadOnboardingDatesOutputSchema, PersonLookupCrmDatesCheckError } from "../../../../../src/models/systems/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../../../../src/models/systems/crm/read-onboarding-record.js";
import { UcpathCandidateSchema } from "../../../../../src/models/systems/ucpath/search-person-org.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../../src/rules/redaction/redaction.js";
import type { DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";
import { DataPointSchema } from "../../../../../src/rules/workflow/task-provenance.js";

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

const commonCtx = { captureScreenshot: async () => {}, signal, log, fail, recordData };

const candidate = UcpathCandidateSchema.parse({
  emplId: "10873698",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active" as const,
  hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
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
  state: "read", employmentDate: "2026-07-15", oathDate: null, reason: "",
});

describe("Person Lookup task implementations", () => {
  it("returns the named date check failure without failing the task", async () => {
    const failure = new PersonLookupCrmDatesCheckError(new Error("selector missing"));
    const dates = ReadOnboardingDatesOutputSchema.parse({ emplId: candidate.emplId, state: "check-failed", code: failure.code,
      employmentDate: null, oathDate: null, reason: failure.message });
    const driver = createDeterministicCrmOnboardingDriver({ record: crmRecord, dates, datesBindingState: "absent-query" });
    const output = await readOnboardingDatesTask.impl.run({ input: { eid: candidate.emplId, name: candidate.name }, ctx: { ...commonCtx, driver } });
    assert.deepEqual(output, dates);
    assert.ok(failedTaskDataPoints.some(point => point.field === "code" && point.value === failure.code));
  });
  it("fails CRM reads when the displayed subject or extracted output EID differs", async () => {
    const observedWrong = createDeterministicCrmOnboardingDriver({
      record: crmRecord,
      dates: crmDates,
      recordObservedEid: "10101010",
      datesObservedEid: "10101010",
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: candidate.emplId, name: candidate.name },
        ctx: { ...commonCtx, driver: observedWrong },
      }),
      new RegExp(`expected EID ${directIdentifierDisplay("10873698")} but bound ${directIdentifierDisplay("10101010")}`),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: candidate.emplId, name: candidate.name },
        ctx: { ...commonCtx, driver: observedWrong },
      }),
      /CRM dates subject binding is invalid/,
    );

    const mismatchedOutputs = createDeterministicCrmOnboardingDriver({
      record: {
        state: "absent",
        queriedEid: EidSchema.parse("10101010"),
        reason: "no record for the wrong displayed person",
      },
      dates: { ...crmDates, emplId: EidSchema.parse("10101010") },
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: candidate.emplId, name: candidate.name },
        ctx: { ...commonCtx, driver: mismatchedOutputs },
      }),
      new RegExp(`returned output for ${directIdentifierDisplay("10101010")}`),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: candidate.emplId, name: candidate.name },
        ctx: { ...commonCtx, driver: mismatchedOutputs },
      }),
      /CRM dates subject binding is invalid/,
    );
  })
  it("admits dates not-read only for an unavailable name with no observed dates", async () => {
    const base = createDeterministicCrmOnboardingDriver({ record: crmRecord, dates: crmDates });
    const absent = { emplId: candidate.emplId, state: "no-confident-record" as const, employmentDate: null, oathDate: null, reason: "No confident CRM record" };
    const driver = { ...base, async readOnboardingDates() { return { binding: { state: "not-read" as const, expectedEid: candidate.emplId }, output: absent }; } };
    assert.deepEqual(await readOnboardingDatesTask.impl.run({ input: { eid: candidate.emplId }, ctx: { ...commonCtx, driver } }), absent);
    await assert.rejects(readOnboardingDatesTask.impl.run({ input: { eid: candidate.emplId, name: candidate.name }, ctx: { ...commonCtx, driver } }), /CRM dates subject binding is invalid/);
    const populated = { ...driver, async readOnboardingDates() { return { binding: { state: "not-read" as const, expectedEid: candidate.emplId }, output: { ...absent, employmentDate: crmDates.employmentDate } }; } };
    await assert.rejects(readOnboardingDatesTask.impl.run({ input: { eid: candidate.emplId }, ctx: { ...commonCtx, driver: populated } }), /CRM dates subject binding is invalid/);
  });
});
