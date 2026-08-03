import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../src/domain/ids.js";
import type { Eid } from "../../src/domain/ids.js";
import {
  buildLastFirstSearchNames,
  buildPersonOrgNameSearchAttempts,
  deriveAssignmentDetailsFromCells,
  parsePersonOrgGridRows,
  searchPersonOrgWithPagePort,
  selectPreferredAssignmentDetails,
} from "../../src/stores/ucpath/driver/person-org-operation.js";
import type {
  PersonOrgAssignmentDetails,
  PersonOrgDetail,
  PersonOrgPagePort,
  PersonOrgSearchPageOutcome,
} from "../../src/stores/ucpath/driver/person-org-operation.js";

const EID_A = EidSchema.parse("10873698");
const EID_B = EidSchema.parse("10001573");

function assignment(overrides: Partial<PersonOrgAssignmentDetails> = {}): PersonOrgAssignmentDetails {
  return {
    emplRecord: "0",
    effectiveDate: "08/01/2026",
    hrStatus: "Active",
    businessUnit: "SDCMP",
    positionNumber: "40000000",
    deptId: "000412",
    department: "HOUSING/DINING/HOSPITALITY",
    jobCode: "004921",
    jobCodeDescription: "Dining Assistant",
    expectedJobEndDate: "",
    fte: "0.50",
    emplClass: "Student",
    ...overrides,
  };
}

function detail(
  observedEid: Eid,
  displayedName: string,
  overrides: Partial<PersonOrgAssignmentDetails> = {},
): PersonOrgDetail {
  return { observedEid, displayedName, assignment: assignment(overrides) };
}

function pageHarness(input: Readonly<{
  outcomes: readonly PersonOrgSearchPageOutcome[];
  details?: Readonly<Record<number, PersonOrgDetail>>;
}>): Readonly<{
  port: PersonOrgPagePort;
  calls: readonly string[];
}> {
  const outcomes = [...input.outcomes];
  const calls: string[] = [];
  return {
    calls,
    port: {
      async search(query) {
        calls.push(query.kind === "by-eid"
          ? `eid:${query.eid}`
          : `name:${query.lastName},${query.givenName}`);
        const outcome = outcomes.shift();
        if (outcome === undefined) throw new Error("fixture has no queued Person Org outcome");
        return outcome;
      },
      async drill(rowIndex) {
        calls.push(`drill:${String(rowIndex)}`);
        const value = input.details?.[rowIndex];
        if (value === undefined) throw new Error(`fixture drill ${String(rowIndex)} failed`);
        return value;
      },
      async returnToResults() {
        calls.push("return");
      },
    },
  };
}

describe("strict UCPath Person Org operation", () => {
  it("ports the legacy outer normalization and inner name-attempt ordering", () => {
    assert.deepEqual(buildLastFirstSearchNames("John M Smith"), [
      "Smith, John M",
      "John, M Smith",
    ]);
    assert.deepEqual(buildPersonOrgNameSearchAttempts({
      lastName: "De La Cruz",
      first: "Ana",
      middle: "Maria",
    }), [
      { lastName: "De La Cruz", name: "Ana Maria" },
      { lastName: "De La Cruz", name: "Ana" },
      { lastName: "De La Cruz", name: "Maria" },
      { lastName: "De", name: "Ana" },
      { lastName: "La", name: "Ana" },
      { lastName: "Cruz", name: "Ana" },
    ]);
  });

  it("selects active, then HDH, then highest employment record", () => {
    const selected = selectPreferredAssignmentDetails([
      assignment({ emplRecord: "9", hrStatus: "Inactive" }),
      assignment({ emplRecord: "1", department: "CHEMISTRY" }),
      assignment({ emplRecord: "2" }),
      assignment({ emplRecord: "4" }),
    ]);
    assert.equal(selected.emplRecord, "4");
  });

  it("resolves an EID only from the observed detail subject", async () => {
    const harness = pageHarness({ outcomes: [{ kind: "detail", detail: detail(EID_A, "Johnnie Battistessa") }] });
    const output = await searchPersonOrgWithPagePort(harness.port, { kind: "by-eid", emplId: EID_A });
    assert.equal(output.selection.status, "resolved");
    assert.equal(output.selection.selected?.emplId, EID_A);
    assert.equal(output.selection.selected?.name, "Battistessa, Johnnie");
    assert.deepEqual(harness.calls, [`eid:${EID_A}`]);
  });

  it("never overwrites a mismatched observed EID with the query", async () => {
    const harness = pageHarness({ outcomes: [{ kind: "detail", detail: detail(EID_B, "Wrong Person") }] });
    await assert.rejects(
      searchPersonOrgWithPagePort(harness.port, { kind: "by-eid", emplId: EID_A }),
      /expected 10873698 but observed 10001573/,
    );
  });

  it("drills every SDCMP result, proves row-to-detail subjects, and preserves ambiguity", async () => {
    const rows = parsePersonOrgGridRows([
      [EID_A, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Smith", "John Smith", ""],
      [EID_B, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Smith", "Jane Smith", ""],
    ]);
    const harness = pageHarness({
      outcomes: [{ kind: "grid", rows }],
      details: {
        0: detail(EID_A, "John Smith"),
        1: detail(EID_B, "Jane Smith"),
      },
    });
    const output = await searchPersonOrgWithPagePort(harness.port, {
      kind: "by-name",
      name: "Smith, John",
      keepNonHdh: false,
    });
    assert.equal(output.selection.status, "ambiguous");
    assert.deepEqual(output.selection.candidateEids, [EID_A, EID_B]);
    assert.deepEqual(harness.calls, ["name:Smith,John", "drill:0", "return", "drill:1"]);
  });

  it("keeps the reviewed non-HDH option explicit", async () => {
    const nonHdh = detail(EID_A, "Crithe Cleckoa", { department: "CHEMISTRY" });
    const filtered = pageHarness({ outcomes: [{ kind: "detail", detail: nonHdh }] });
    const absent = await searchPersonOrgWithPagePort(filtered.port, {
      kind: "by-name",
      name: "Cleckoa, Crithe",
      keepNonHdh: false,
    });
    assert.equal(absent.selection.status, "not-found");

    const retained = pageHarness({ outcomes: [{ kind: "detail", detail: nonHdh }] });
    const found = await searchPersonOrgWithPagePort(retained.port, {
      kind: "by-name",
      name: "Cleckoa, Crithe",
      keepNonHdh: true,
    });
    assert.equal(found.selection.status, "resolved");
    assert.equal(found.selection.selected?.hdh, false);
  });

  it("turns missing/malformed grids and assignment rows into errors, never not-found", () => {
    assert.throws(() => parsePersonOrgGridRows([]), /refusing to report not-found/);
    assert.throws(() => parsePersonOrgGridRows([[EID_A, "0"]]), /expected at least 8/);
    assert.throws(() => deriveAssignmentDetailsFromCells(["0", "date"]), /expected at least 12/);
    assert.throws(() => deriveAssignmentDetailsFromCells([
      "0", "date", "Active", "SDCMP", "position", "dept", "Department Description",
      "job", "title", "", "", "",
    ]), /header row/);
  });

  it("propagates search, drill, and subject failures instead of converting them to empty results", async () => {
    const searchFailure: PersonOrgPagePort = {
      search: () => Promise.reject(new Error("results extraction failed")),
      drill: () => Promise.reject(new Error("unused")),
      returnToResults: () => Promise.reject(new Error("unused")),
    };
    await assert.rejects(
      searchPersonOrgWithPagePort(searchFailure, { kind: "by-eid", emplId: EID_A }),
      /results extraction failed/,
    );

    const rows = parsePersonOrgGridRows([
      [EID_A, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Smith", "John Smith", ""],
    ]);
    const drillFailure = pageHarness({ outcomes: [{ kind: "grid", rows }] });
    await assert.rejects(
      searchPersonOrgWithPagePort(drillFailure.port, {
        kind: "by-name",
        name: "Smith, John",
        keepNonHdh: true,
      }),
      /fixture drill 0 failed/,
    );

    const wrongDetail = pageHarness({
      outcomes: [{ kind: "grid", rows }],
      details: { 0: detail(EID_B, "John Smith") },
    });
    await assert.rejects(
      searchPersonOrgWithPagePort(wrongDetail.port, {
        kind: "by-name",
        name: "Smith, John",
        keepNonHdh: true,
      }),
      /expected EID 10873698 but displayed 10001573/,
    );
  });
});
