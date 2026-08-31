import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadOnboardingDatesOutputSchema } from "../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../src/domain/contracts/crm/read-onboarding-record.js";
import { EidSchema } from "../../src/domain/ids.js";
import { directIdentifierDigestReference } from "../../src/domain/redaction.js";
import { DataPointSchema } from "../../src/domain/task-provenance.js";
import type { DataPoint } from "../../src/domain/task-provenance.js";
import { createDeterministicCrmOnboardingDriver } from "../../src/stores/crm/driver/fake.js";
import { chooseExactCrmRecord } from "../../src/stores/crm/driver/interpreter.js";
import { readOnboardingDatesTask } from "../../src/stores/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../src/stores/crm/tasks/read-onboarding-record.js";
import {
  parsePersonOrgGridRows,
  searchPersonOrgWithPagePort,
} from "../../src/stores/ucpath/driver/person-org-operation.js";
import type {
  PersonOrgDetail,
  PersonOrgPagePort,
} from "../../src/stores/ucpath/driver/person-org-operation.js";

const signal = new AbortController().signal;
const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});
const fail = (_code: string, message: string): never => {
  throw new Error(message);
};
const dataPoints: DataPoint[] = [];
const recordData = (input: DataPoint | readonly DataPoint[]): void => {
  for (const point of Array.isArray(input) ? input : [input]) {
    dataPoints.push(DataPointSchema.parse(point));
  }
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
        ctx: { signal, log, driver, fail, recordData },
      }),
      new RegExp(`expected EID ${directIdentifierDigestReference(EID)} but bound ${directIdentifierDigestReference("10001573")}`),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: EID },
        ctx: { signal, log, driver, fail, recordData },
      }),
      new RegExp(`expected EID ${directIdentifierDigestReference(EID)} but bound ${directIdentifierDigestReference("10001573")}`),
    );

    const exact = {
      fullName: "Fixture, Person",
      rawStage: "Completed",
      recordId: "ONB-40213",
      recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-40213",
      observedEid: EID,
      firstName: "Person",
      lastName: "Fixture",
      firstDayOfService: "7/15/2026",
    };
    assert.throws(
      () => chooseExactCrmRecord([exact, { ...exact, recordId: "ONB-40214" }], EID),
      /resolved 2 exact displayed-EID records/,
    );
  });

  it("person-lookup/ucpath-drill-subject-mismatch — a stale detail never becomes a candidate", async () => {
    const wrongEid = EidSchema.parse("10001573");
    const rows = parsePersonOrgGridRows([
      [EID, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Battistessa", "Johnnie Battistessa"],
    ]);
    const staleDetail: PersonOrgDetail = {
      observedEid: wrongEid,
      displayedName: "Different Person",
      cells: [[
        "0", "08/01/2026", "Active", "SDCMP", "40000000", "000412",
        "HOUSING/DINING/HOSPITALITY", "004921", "Dining Assistant", "", "0.50", "Student",
      ]],
      employmentInstances: "already-complete",
    };
    const page: PersonOrgPagePort = {
      search: async () => ({ kind: "grid", rows }),
      drill: async () => staleDetail,
      returnToResults: async () => undefined,
    };

    await assert.rejects(
      searchPersonOrgWithPagePort(page, {
        kind: "by-name",
        name: "Battistessa, Johnnie",
        keepNonHdh: true,
      }),
      new RegExp(`expected EID ${directIdentifierDigestReference(EID)} but displayed ${directIdentifierDigestReference(wrongEid)}`),
    );
  });
});
