import { withBrowserActionNotes, recordBrowserAction } from "../../../../../src/backend/systems/browser-shared/action-notes.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type {
PersonOrgAssignmentDetails,
PersonOrgDetail,
PersonOrgPagePort,
PersonOrgSearchPageOutcome,
PersonOrgViewTogglePort,
} from "../../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import {
assignmentDetailsToCells,
buildLastFirstSearchNames,
buildPersonOrgNameSearchAttempts,
classifyPersonOrgSearchOutcome,
deriveAssignmentDetailsFromCells,
ensurePersonOrgViewAllExpanded,
parsePersonOrgGridRows,
searchPersonOrgWithPagePort,
selectPreferredAssignmentDetails,
} from "../../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import type { Eid } from "../../../../../src/rules/identity/ids.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../../src/rules/redaction/redaction.js";

const EID_A = EidSchema.parse("10873698");
const EID_B = EidSchema.parse("10101010");

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
  return {
    observedEid,
    displayedName,
    cells: [[...assignmentDetailsToCells(assignment(overrides))]],
    employmentInstances: "already-complete",
    startDate: "", terminationDate: "", terminationReason: "",
  };
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
  let rows: readonly import("../../../../../src/backend/systems/ucpath/driver/person-org-operation.js").PersonOrgResultGridRow[] = [];
  return {
    calls,
    port: {
      async search(query) {
        calls.push(query.kind === "by-eid"
          ? `eid:${query.eid}`
          : `name:${query.lastName},${query.givenName}`);
        const outcome = outcomes.shift();
        if (outcome === undefined) throw new Error("fixture has no queued Person Org outcome");
        if (outcome.kind === "grid") rows = outcome.rows;
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
        return rows;
      },
    },
  };
}

function viewToggleHarness(input: Readonly<{
  count?: number;
  text: string;
  href: string | null;
  afterText?: string;
  clickError?: Error;
  waitError?: Error;
}>): Readonly<{ port: PersonOrgViewTogglePort; clicks: readonly string[] }> {
  let text = input.text;
  const clicks: string[] = [];
  return {
    clicks,
    port: {
      count: async () => input.count ?? 1,
      readText: async () => text,
      readHref: async () => input.href,
      async click() {
        clicks.push("click");
        if (input.clickError !== undefined) throw input.clickError;
        if (input.afterText !== undefined) text = input.afterText;
      },
      async waitForExpanded() {
        if (input.waitError !== undefined) throw input.waitError;
      },
    },
  };
}

describe("strict UCPath Person Org operation", () => {
  it("expands enabled View All and accepts only verified complete toggle states", async () => {
    const enabled = viewToggleHarness({
      text: "View All",
      href: "javascript:submitAction_win0(document.win0,'grid');",
      afterText: "View 100",
    });
    await ensurePersonOrgViewAllExpanded(enabled.port, "results");
    assert.deepEqual(enabled.clicks, ["click"]);

    const disabledComplete = viewToggleHarness({ text: "View All", href: null });
    await ensurePersonOrgViewAllExpanded(disabledComplete.port, "results");
    assert.deepEqual(disabledComplete.clicks, []);

    const toggledComplete = viewToggleHarness({
      text: "View 10",
      href: "javascript:submitAction_win0(document.win0,'grid');",
    });
    await ensurePersonOrgViewAllExpanded(toggledComplete.port, "employment");
    assert.deepEqual(toggledComplete.clicks, []);
  });

  it("fails loud when pagination is absent, ambiguous, stuck, malformed, or unclickable", async () => {
    await assert.rejects(
      ensurePersonOrgViewAllExpanded(
        viewToggleHarness({ count: 0, text: "View All", href: null }).port,
        "results",
      ),
      /exactly one View All state control; found 0/,
    );
    await assert.rejects(
      ensurePersonOrgViewAllExpanded(
        viewToggleHarness({ count: 2, text: "View All", href: null }).port,
        "results",
      ),
      /found 2/,
    );
    await assert.rejects(
      ensurePersonOrgViewAllExpanded(
        viewToggleHarness({ text: "Unknown", href: null }).port,
        "results",
      ),
      /unknown View All state/,
    );
    await assert.rejects(
      ensurePersonOrgViewAllExpanded(
        viewToggleHarness({ text: "View All", href: "https://example.invalid/not-peoplesoft" }).port,
        "results",
      ),
      /unexpected href/,
    );
    await assert.rejects(
      ensurePersonOrgViewAllExpanded(
        viewToggleHarness({ text: "View 100", href: null }).port,
        "results",
      ),
      /unexpected href/,
    );
    await assert.rejects(
      ensurePersonOrgViewAllExpanded(viewToggleHarness({
        text: "View All",
        href: "javascript:submitAction_win0(document.win0,'grid');",
      }).port, "results"),
      /did not transition/,
    );
    await assert.rejects(
      ensurePersonOrgViewAllExpanded(viewToggleHarness({
        text: "View All",
        href: "javascript:submitAction_win0(document.win0,'grid');",
        clickError: new Error("expansion failed"),
      }).port, "results"),
      /expansion failed/,
    );
  });

  it("cannot choose a visible assignment until hidden Employment Instances are expanded", async () => {
    let assignments = [assignment({ emplRecord: "0", department: "CHEMISTRY" })];
    const toggle = viewToggleHarness({
      text: "View All",
      href: "javascript:submitAction_win0(document.win0,'employment');",
      afterText: "View 1",
    });
    const port: PersonOrgViewTogglePort = {
      ...toggle.port,
      async click() {
        await toggle.port.click();
        assignments = [...assignments, assignment({ emplRecord: "9" })];
      },
    };
    await ensurePersonOrgViewAllExpanded(port, "employment");
    assert.equal(selectPreferredAssignmentDetails(assignments).emplRecord, "9");
  });

  it("cannot falsely resolve a visible result while View All hides another candidate", async () => {
    let rows = parsePersonOrgGridRows([
      [EID_A, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Smith", "John Smith"],
    ]);
    const toggle = viewToggleHarness({
      text: "View All",
      href: "javascript:submitAction_win0(document.win0,'results');",
      afterText: "View 100",
    });
    const port: PersonOrgViewTogglePort = {
      ...toggle.port,
      async click() {
        await toggle.port.click();
        rows = parsePersonOrgGridRows([
          [EID_A, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Smith", "John Smith"],
          [EID_B, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Smith", "Jane Smith"],
        ]);
      },
    };
    await ensurePersonOrgViewAllExpanded(port, "results");
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
      keepNonHdh: true,
    });
    assert.equal(output.selection.status, "ambiguous");
  });

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
      new RegExp(`expected ${directIdentifierDisplay(EID_A)} but observed ${directIdentifierDisplay(EID_B)}`),
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
    assert.deepEqual(harness.calls, ["name:Smith,John", "drill:0", "return", "drill:1", "return"]);
  });

  it("restores the verified grid and reopens only the selected person before capture", async () => {
    const rows = parsePersonOrgGridRows([
      [EID_A, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Smith", "John Smith"],
      [EID_B, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Smith", "Jane Smith"],
    ]);
    for (const departments of [["HOUSING/DINING/HOSPITALITY", "CHEMISTRY"], ["CHEMISTRY", "CHEMISTRY"], ["HOUSING/DINING/HOSPITALITY", "HOUSING/DINING/HOSPITALITY"]]) {
      let surface = "results";
      const actions: string[] = [];
      const port: PersonOrgPagePort = {
        search: async () => { surface = "results"; return { kind: "grid", rows }; },
        drill: async index => { surface = `detail:${index}`; recordBrowserAction("clicked", "fixture.drill");
          return detail(index === 0 ? EID_A : EID_B, index === 0 ? "John Smith" : "Jane Smith", { department: departments[index] }); },
        returnToResults: async () => { surface = "results"; return rows; },
      };
      const output = await withBrowserActionNotes(manualClock(new Date("2026-10-12T00:00:00Z")), () => searchPersonOrgWithPagePort(port, { kind: "by-name", name: "Smith, John", keepNonHdh: false }), notes => { actions.push(...notes.map(note => note.targetId)); });
      assert.equal(surface, output.selection.selected === null ? "results" : "detail:0");
      assert.equal(output.selection.status, departments[0] === "CHEMISTRY" ? "not-found" : departments[1] === "CHEMISTRY" ? "resolved" : "ambiguous");
      assert.ok(actions.indexOf("ucpath.person-org.search-results") < actions.indexOf("fixture.drill"));
    }
    const base: PersonOrgPagePort = { search: async () => ({ kind: "grid", rows }), drill: async index => detail(index === 0 ? EID_A : EID_B, index === 0 ? "John Smith" : "Jane Smith", { department: index === 0 ? "HOUSING/DINING/HOSPITALITY" : "CHEMISTRY" }), returnToResults: async () => rows };
    await assert.rejects(searchPersonOrgWithPagePort({ ...base, returnToResults: async () => [rows[0]] }, { kind: "by-name", name: "Smith, John", keepNonHdh: false }), /results changed/);
    let drills = 0;
    await assert.rejects(searchPersonOrgWithPagePort({ ...base, drill: async index => { drills++; return { ...await base.drill(index), startDate: drills === 3 ? "10/01/2026" : "" }; } }, { kind: "by-name", name: "Smith, John", keepNonHdh: false }), /selected detail changed/);
  });

  it("keeps the reviewed non-HDH option explicit", async () => {
    const nonHdh = detail(EID_A, "Bea Morrow", { department: "CHEMISTRY" });
    const filtered = pageHarness({ outcomes: [{ kind: "detail", detail: nonHdh }] });
    const absent = await searchPersonOrgWithPagePort(filtered.port, {
      kind: "by-name",
      name: "Morrow, Bea",
      keepNonHdh: false,
    });
    assert.equal(absent.selection.status, "not-found");

    const retained = pageHarness({ outcomes: [{ kind: "detail", detail: nonHdh }] });
    const found = await searchPersonOrgWithPagePort(retained.port, {
      kind: "by-name",
      name: "Morrow, Bea",
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
      new RegExp(`expected EID ${directIdentifierDisplay(EID_A)} but displayed ${directIdentifierDisplay(EID_B)}`),
    );
  });


  it("reads the criteria banner as a list marker, never as a verdict", () => {

    assert.deepEqual(
      classifyPersonOrgSearchOutcome({
        bannerVisible: true,
        detailVisible: false,
        gridVisible: true,
        bannerText: "4 results   -   Last Name \"Ezeunala\"   Name \"Chim\"",
      }),
      { kind: "grid" },
    );
    // A grid with no banner is still a grid; the banner is not load-bearing here.
    assert.deepEqual(
      classifyPersonOrgSearchOutcome({
        bannerVisible: false, detailVisible: false, gridVisible: true, bannerText: undefined,
      }),
      { kind: "grid" },
    );
    // The one and only not-found: the banner alone, carrying PeopleSoft's text.
    assert.deepEqual(
      classifyPersonOrgSearchOutcome({
        bannerVisible: true,
        detailVisible: false,
        gridVisible: false,
        bannerText: "No matching values were found",
      }),
      { kind: "not-found", marker: "No matching values were found" },
    );
    // The single-match page UCPath auto-drills to.
    assert.deepEqual(
      classifyPersonOrgSearchOutcome({
        bannerVisible: false, detailVisible: true, gridVisible: false, bannerText: undefined,
      }),
      { kind: "detail" },
    );
  });

  it("refuses every page shape it cannot name, and never calls a count 'nobody matched'", () => {

    assert.throws(
      () => classifyPersonOrgSearchOutcome({
        bannerVisible: true, detailVisible: false, gridVisible: false, bannerText: "4 results",
      }),
      /only "No matching values were found" means nobody matched/,
    );
    // Genuinely contradictory: one page cannot be a detail AND a list.
    assert.throws(
      () => classifyPersonOrgSearchOutcome({
        bannerVisible: false, detailVisible: true, gridVisible: true, bannerText: undefined,
      }),
      /cannot be both/,
    );
    // Nothing settled at all.
    assert.throws(
      () => classifyPersonOrgSearchOutcome({
        bannerVisible: false, detailVisible: false, gridVisible: false, bannerText: undefined,
      }),
      /cannot say what the page is/,
    );
    // A visible banner that rendered no text is an unreadable page, not an empty one.
    assert.throws(
      () => classifyPersonOrgSearchOutcome({
        bannerVisible: true, detailVisible: false, gridVisible: false, bannerText: undefined,
      }),
      /rendered no text/,
    );
  });
});
