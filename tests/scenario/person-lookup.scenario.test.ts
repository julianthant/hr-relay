/**
 * Executable scenarios for person-lookup (doc 02 §8; doc 12 §3.2).
 *
 * Each one walks the real descriptor's real bind/when/derive functions along one
 * path, re-parsing every value through the schema that owns it. There is no
 * executor yet — that lands in 1f — so what a scenario cannot do is run a task;
 * what it CAN do, and does here, is prove that the path's decisions typecheck,
 * parse, and produce the terminal value the workflow claims.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { personLookupDescriptor } from "../../src/workflows/person-lookup/descriptor.js";
import { walkDescriptor } from "./helpers/pure-walk.js";

const RESOLVED_CANDIDATE = {
  emplId: "10873698",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active",
  hdh: true,
};

const SEARCH_RESOLVED = {
  results: [RESOLVED_CANDIDATE],
  selection: { status: "resolved", selected: RESOLVED_CANDIDATE, candidateEids: ["10873698"] },
};

const CRM_FOUND = {
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: "10873698",
    fullName: "Battistessa, Johnnie",
    rawStage: "Completed",
  },
};

const ACTIVE = {
  state: "active",
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};

const CRM_DATES = {
  emplId: "10873698",
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
};

describe("person-lookup scenarios", () => {
  it("person-lookup/happy-by-eid — resolves, cross-verifies, and skips the optional dates step", () => {
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10873698" }, {
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
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10873698", includeCrmDates: true }, {
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
      () => walkDescriptor(personLookupDescriptor, { name: "Battistessa" }, {
        outputs: {
          searching: {
            results: [RESOLVED_CANDIDATE, { ...RESOLVED_CANDIDATE, emplId: "10001573" }],
            selection: {
              status: "ambiguous",
              selected: null,
              candidateEids: ["10873698", "10001573"],
              searchName: "Battistessa",
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
    // The retry shape from doc 02 §8: `searching` replays from its checkpoint,
    // `cross-verify` runs again, and `active-status` (always-rerun) folds both.
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10873698" }, {
      outputs: {
        searching: SEARCH_RESOLVED,
        "cross-verify": { state: "absent", queriedEid: "10873698", reason: "no onboarding record for this EID" },
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
      () => walkDescriptor(personLookupDescriptor, { emplId: "10873698" }, {
        outputs: {
          searching: {
            results: [],
            // `resolved` with nobody selected is unspellable — that is the point
            // of the three-arm union.
            selection: { status: "resolved", selected: null, candidateEids: ["10873698"] },
          },
        },
      }),
      /invalid|expected/i,
    );
  });
});
