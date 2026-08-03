import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadOnboardingDatesOutputSchema } from "../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../src/domain/contracts/crm/read-onboarding-record.js";
import {
  SearchPersonOrgOutputSchema,
  UcpathCandidateSchema,
} from "../../src/domain/contracts/ucpath/search-person-org.js";
import { EidSchema } from "../../src/domain/ids.js";
import { readOnboardingDatesTask } from "../../src/stores/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../src/stores/crm/tasks/read-onboarding-record.js";
import { readActiveStatusTask } from "../../src/stores/person-lookup/read-active-status.js";
import { searchPersonOrgTask } from "../../src/stores/ucpath/tasks/search-person-org.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { createDeterministicCrmOnboardingDriver } from "../../src/stores/crm/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../src/stores/ucpath/driver/fake.js";

const signal = new AbortController().signal;
const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

const candidate = UcpathCandidateSchema.parse({
  emplId: "10873698",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active" as const,
  hdh: true,
});
const person = SearchPersonOrgOutputSchema.parse({
  results: [candidate],
  selection: { status: "resolved", selected: candidate, candidateEids: [candidate.emplId] },
});
const crmRecord = ReadOnboardingRecordOutputSchema.parse({
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: candidate.emplId,
    fullName: candidate.name,
    stage: "complete",
    updatedAt: "2026-07-30T18:12:00.000Z",
  },
});
if (crmRecord.state !== "found") throw new Error("CRM found-record fixture did not parse as found");
const crmDates = ReadOnboardingDatesOutputSchema.parse({
  emplId: candidate.emplId,
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "not yet completed" },
});

describe("Phase 1f Person Lookup task implementations", () => {
  it("binds every descriptor task into the one runtime task-store index", () => {
    assert.deepEqual(
      taskStoreRegistry.stores
        .flatMap((store) => Object.values(store.tasks).map((task) => String(task.contract.id)))
        .sort(),
      [
        "crm/read-onboarding-dates",
        "crm/read-onboarding-record",
        "ucpath/search-person-org",
        "workflow:person-lookup/read-active-status",
      ],
    );
  });

  it("executes UCPath and CRM reads only through their typed semantic drivers", async () => {
    const ucpath = createDeterministicUcpathPersonOrgDriver(person);
    const crm = createDeterministicCrmOnboardingDriver({ record: crmRecord, dates: crmDates });
    const searched = await searchPersonOrgTask.impl.run({
      input: { kind: "by-eid", emplId: candidate.emplId },
      ctx: { signal, log, driver: ucpath, fail: () => { throw new Error("unexpected fail"); } },
    });
    assert.deepEqual(searched, person);
    const record = await readOnboardingRecordTask.impl.run({
      input: { eid: candidate.emplId, name: candidate.name },
      ctx: { signal, log, driver: crm, fail: () => { throw new Error("unexpected fail"); } },
    });
    assert.deepEqual(record, crmRecord);
    const dates = await readOnboardingDatesTask.impl.run({
      input: { eid: candidate.emplId },
      ctx: { signal, log, driver: crm, fail: () => { throw new Error("unexpected fail"); } },
    });
    assert.deepEqual(dates, crmDates);
  });

  it("derives active status and fails loud when UCPath and CRM identities disagree", async () => {
    const active = await readActiveStatusTask.impl.run({
      input: { person, crm: crmRecord, keepNonHdh: false },
      ctx: { signal, log, fail: () => { throw new Error("unexpected fail"); } },
    });
    assert.equal(active.state, "active");
    await assert.rejects(
      readActiveStatusTask.impl.run({
        input: {
          person,
          crm: {
            ...crmRecord,
            record: { ...crmRecord.record, emplId: EidSchema.parse("10001573") },
          },
          keepNonHdh: false,
        },
        ctx: { signal, log, fail: () => { throw new Error("unexpected fail"); } },
      }),
      /UCPath EID 10873698 but CRM EID 10001573/,
    );
  });

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
      ctx: { signal, log, fail: () => { throw new Error("unexpected fail"); } },
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
      ctx: { signal, log, fail: () => { throw new Error("unexpected fail"); } },
    });
    assert.equal(inactive.state, "inactive");
  });
});
