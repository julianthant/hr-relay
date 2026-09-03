/**
 * Executable scenarios for person-lookup (ref workflow-model §8; ref operator-trust §3.2).
 *
 * The graph cases walk the real descriptor's bind/when/derive functions along
 * one path, re-parsing every value through the schema that owns it. The two
 * subject-mismatch cases run the real task or driver interpreter against
 * deterministic system seams, because that refusal lives inside the operation
 * and cannot be proved by supplying an already-shaped graph output.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadOnboardingDatesOutputSchema } from "../../../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../../../src/domain/contracts/crm/read-onboarding-record.js";
import { EidSchema } from "../../../../src/domain/ids.js";
import { directIdentifierDigestReference } from "../../../../src/domain/redaction.js";
import { DataPointSchema } from "../../../../src/domain/task-provenance.js";
import type { DataPoint } from "../../../../src/domain/task-provenance.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../src/stores/crm/driver/fake.js";
import { chooseExactCrmRecord } from "../../../../src/stores/crm/driver/interpreter.js";
import { readOnboardingDatesTask } from "../../../../src/stores/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../../../src/stores/crm/tasks/read-onboarding-record.js";
import {
  parsePersonOrgGridRows,
  searchPersonOrgWithPagePort,
} from "../../../../src/stores/ucpath/driver/person-org-operation.js";
import type {
  PersonOrgDetail,
  PersonOrgPagePort,
} from "../../../../src/stores/ucpath/driver/person-org-operation.js";
import { personLookupDescriptor } from "../../../../src/workflows/person-lookup/descriptor.js";
import { walkDescriptor } from "../../helpers/pure-walk.js";

const RESOLVED_CANDIDATE = {
  emplId: "10800000",
  name: "Fixture, Primary",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active",
  hdh: true,
};

const SEARCH_RESOLVED = {
  results: [RESOLVED_CANDIDATE],
  selection: { status: "resolved", selected: RESOLVED_CANDIDATE, candidateEids: ["10800000"] },
};

const CRM_FOUND = {
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: "10800000",
    fullName: "Fixture, Primary",
    rawStage: "Completed",
  },
};

const ACTIVE = {
  state: "active",
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};

const CRM_DATES = {
  emplId: "10800000",
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
};

const runtimeSignal = new AbortController().signal;
const runtimeLog = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});
const runtimeFail = (_code: string, message: string): never => {
  throw new Error(message);
};
const runtimeDataPoints: DataPoint[] = [];
const recordRuntimeData = (input: DataPoint | readonly DataPoint[]): void => {
  for (const point of Array.isArray(input) ? input : [input]) {
    runtimeDataPoints.push(DataPointSchema.parse(point));
  }
};
const RUNTIME_EID = EidSchema.parse("10800000");
const RUNTIME_RECORD = ReadOnboardingRecordOutputSchema.parse({
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: RUNTIME_EID,
    fullName: "Fixture, Primary",
    rawStage: "Completed",
  },
});
const RUNTIME_DATES = ReadOnboardingDatesOutputSchema.parse({
  emplId: RUNTIME_EID,
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
});

describe("person-lookup scenarios", () => {
  it("person-lookup/happy-by-eid — resolves, cross-verifies, and skips the optional dates step", () => {
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10800000" }, {
      outputs: {
        searching: SEARCH_RESOLVED,
        "cross-verify": CRM_FOUND,
        "active-status": ACTIVE,
      },
    });
    assert.deepEqual(walk.visited, ["searching", "cross-verify", "active-status"]);
    // `when` is false, so the node produces `undefined` rather than a fabricated value.
    assert.deepEqual(walk.skipped, ["crm-dates"]);
    assert.deepEqual(walk.result, { activeStatus: ACTIVE, crmDates: { state: "not-requested" } });
  });

  it("person-lookup/happy-by-eid-with-dates — the conditional node runs and reaches the result", () => {
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10800000", includeCrmDates: true }, {
      outputs: {
        searching: SEARCH_RESOLVED,
        "cross-verify": CRM_FOUND,
        "active-status": ACTIVE,
        "crm-dates": CRM_DATES,
      },
    });
    assert.deepEqual(walk.visited, ["searching", "cross-verify", "active-status", "crm-dates"]);
    assert.deepEqual(walk.skipped, []);
    assert.deepEqual(walk.result, { activeStatus: ACTIVE, crmDates: { state: "included", dates: CRM_DATES } });
  });

  it("person-lookup/ambiguous-name — a bind that needs a selection fails loud instead of guessing", () => {
    // Two candidates and no selection is a real outcome of a correct search. The
    // charter's rule is that the next step must NOT pick one.
    assert.throws(
      () => walkDescriptor(personLookupDescriptor, { name: "Fixture" }, {
        outputs: {
          searching: {
            results: [RESOLVED_CANDIDATE, { ...RESOLVED_CANDIDATE, emplId: "10800001" }],
            selection: {
              status: "ambiguous",
              selected: null,
              candidateEids: ["10800000", "10800001"],
              searchName: "Fixture",
            },
          },
        },
      }),
      /requires searching\.selection\.selected, which is null/,
    );
  });

  it("person-lookup/not-found — the same refusal, from the other absent outcome", () => {
    assert.throws(
      () => walkDescriptor(personLookupDescriptor, { name: "Nobody, At All" }, {
        outputs: {
          searching: {
            results: [],
            selection: {
              status: "not-found",
              selected: null,
              candidateEids: [],
              searchName: "Nobody, At All",
            },
          },
        },
      }),
      /requires searching\.selection\.selected, which is null/,
    );
  });

  it("person-lookup/crm-failure-retry — a replayed search feeds a fresh cross-verification", () => {
    // The retry shape from ref workflow-model §8: `searching` replays from its checkpoint,
    // `cross-verify` runs again, and `active-status` (always-rerun) folds both.
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10800000" }, {
      outputs: {
        searching: SEARCH_RESOLVED,
        "cross-verify": { state: "absent", queriedEid: "10800000", reason: "no onboarding record for this EID" },
        "active-status": { state: "undetermined", reason: "CRM has no onboarding record to cross-verify" },
      },
    });
    assert.equal(walk.result !== null && typeof walk.result === "object", true);
    assert.deepEqual(walk.result, {
      activeStatus: { state: "undetermined", reason: "CRM has no onboarding record to cross-verify" },
      crmDates: { state: "not-requested" },
    });
  });

  it("rejects a supplied output the producing contract's own schema refuses", () => {
    assert.throws(
      () => walkDescriptor(personLookupDescriptor, { emplId: "10800000" }, {
        outputs: {
          searching: {
            results: [],
            // `resolved` with nobody selected is unspellable — that is the point
            // of the three-arm union.
            selection: { status: "resolved", selected: null, candidateEids: ["10800000"] },
          },
        },
      }),
      /invalid|expected/i,
    );
  });

  it("person-lookup/crm-subject-mismatch — stale CRM identity refuses both reads", async () => {
    const driver = createDeterministicCrmOnboardingDriver({
      record: RUNTIME_RECORD,
      dates: RUNTIME_DATES,
      recordObservedEid: "10800001",
      datesObservedEid: "10800001",
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: RUNTIME_EID, name: "Fixture, Primary" },
        ctx: {
          signal: runtimeSignal,
          log: runtimeLog,
          driver,
          fail: runtimeFail,
          recordData: recordRuntimeData,
        },
      }),
      new RegExp(
        `expected EID ${directIdentifierDigestReference(RUNTIME_EID)} but bound ${directIdentifierDigestReference("10800001")}`,
      ),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: RUNTIME_EID },
        ctx: {
          signal: runtimeSignal,
          log: runtimeLog,
          driver,
          fail: runtimeFail,
          recordData: recordRuntimeData,
        },
      }),
      new RegExp(
        `expected EID ${directIdentifierDigestReference(RUNTIME_EID)} but bound ${directIdentifierDigestReference("10800001")}`,
      ),
    );

    const exact = {
      fullName: "Fixture, Person",
      rawStage: "Completed",
      recordId: "ONB-40213",
      recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-40213",
      observedEid: RUNTIME_EID,
      firstName: "Person",
      lastName: "Fixture",
      firstDayOfService: "7/15/2026",
    };
    assert.throws(
      () => chooseExactCrmRecord([exact, { ...exact, recordId: "ONB-40214" }], RUNTIME_EID),
      /resolved 2 exact displayed-EID records/,
    );
  });

  it("person-lookup/ucpath-drill-subject-mismatch — a stale detail never becomes a candidate", async () => {
    const wrongEid = EidSchema.parse("10800001");
    const rows = parsePersonOrgGridRows([
      [
        RUNTIME_EID,
        "0",
        "Active",
        "SDCMP",
        "004921",
        "Dining Assistant",
        "Fixture",
        "Primary Fixture",
      ],
    ]);
    const staleDetail: PersonOrgDetail = {
      observedEid: wrongEid,
      displayedName: "Different Person",
      cells: [[
        "0",
        "08/01/2026",
        "Active",
        "SDCMP",
        "40000000",
        "000412",
        "HOUSING/DINING/HOSPITALITY",
        "004921",
        "Dining Assistant",
        "",
        "0.50",
        "Student",
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
        name: "Fixture, Primary",
        keepNonHdh: true,
      }),
      new RegExp(
        `expected EID ${directIdentifierDigestReference(RUNTIME_EID)} but displayed ${directIdentifierDigestReference(wrongEid)}`,
      ),
    );
  });
});
