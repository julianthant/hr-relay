import assert from "node:assert/strict";
import type { Locator,Page } from "playwright";
import { describe,it } from "vitest";
import type {
ExactCrmOnboardingRecord,
} from "../../../../../src/backend/systems/crm/driver/interpreter.js";
import {
chooseExactCrmRecord,
createCrmOnboardingDriver,
parseCrmDateOnly,
} from "../../../../../src/backend/systems/crm/driver/interpreter.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";

type FixtureNode = Readonly<{
  text: string | null;
  attributes?: Readonly<Record<string, string>>;
  children?: Readonly<Record<string, readonly FixtureNode[]>>;
}>;

class FixtureLocator {
  readonly #nodes: readonly FixtureNode[];

  constructor(nodes: readonly FixtureNode[]) {
    this.#nodes = nodes;
  }

  async count(): Promise<number> {
    return this.#nodes.length;
  }

  nth(index: number): Locator {
    const node = this.#nodes[index];
    return new FixtureLocator(node === undefined ? [] : [node]) as unknown as Locator;
  }

  first(): Locator {
    return this.nth(0);
  }

  async waitFor(): Promise<void> {
    if (this.#nodes.length === 0) throw new Error("fixture locator did not resolve");
  }

  async textContent(): Promise<string | null> {
    const node = this.#nodes[0];
    if (node === undefined) throw new Error("fixture locator did not resolve");
    return node.text;
  }

  async getAttribute(name: string): Promise<string | null> {
    const node = this.#nodes[0];
    if (node === undefined) throw new Error("fixture locator did not resolve");
    const value = node.attributes?.[name];
    return value === undefined ? null : value;
  }

  locator(selector: string): Locator {
    return new FixtureLocator(this.#nodes.flatMap((node) => node.children?.[selector] ?? [])) as unknown as Locator;
  }

  filter(options: Readonly<{ hasText?: string | RegExp }>): Locator {
    const expected = options.hasText;
    return new FixtureLocator(this.#nodes.filter((node) => {
      if (expected === undefined || node.text === null) return false;
      return typeof expected === "string" ? node.text.includes(expected) : expected.test(node.text);
    })) as unknown as Locator;
  }
}

type SearchFixtureRow = Readonly<{
  fullName: string;
  rawStage: string;
  recordId: string;
  cellCount?: number;
  linkCount?: number;
}>;

type RecordFixture = Readonly<{
  eid: string;
  firstName: string;
  lastName: string;
  firstDayOfService: string;
  dateSigned?: string;
  departmentHrRepName?: string;
}>;

type HistoryFixtureRow = readonly [string, string, string, string, string];

function textNode(text: string): FixtureNode {
  return { text };
}

function searchRowNode(row: SearchFixtureRow): FixtureNode {
  const values = [row.fullName, "6/1/2026", "", "", row.rawStage];
  const cellCount = row.cellCount ?? values.length;
  const cells = values.slice(0, cellCount).map(textNode);
  const href = `/hr/ONB_ViewOnboarding?id=${row.recordId}`;
  const links = Array.from({ length: row.linkCount ?? 1 }, () => ({
    text: row.fullName,
    attributes: { href },
  }));
  return {
    text: row.fullName,
    children: {
      ":scope > td": cells,
      ":scope > td:first-child a": links,
    },
  };
}

function recordFieldNodes(record: RecordFixture): readonly FixtureNode[] {
  const fields = new Map<string, string>([
    ["UCPath Employee ID", record.eid],
    ["Employee First Name", record.firstName],
    ["Employee Last Name", record.lastName],
    ["First Day of Service (Effective Date)", record.firstDayOfService],
    ["Department", "Housing"],
    ["Date Signed", record.dateSigned ?? "6/25/2026"],
  ]);
  if (record.departmentHrRepName !== undefined) fields.set("Department HR Rep Name", record.departmentHrRepName);
  return [...fields].map(([label, value]) => ({
    text: label,
    children: { "xpath=following-sibling::td[1]": [textNode(value)] },
  }));
}

function historyNodes(rows: readonly HistoryFixtureRow[]): readonly FixtureNode[] {
  return [
    { text: "wrapper", children: { ":scope > td": [textNode("wrapper")], ":scope > th": [] } },
    {
      text: "header",
      children: {
        ":scope > td": [],
        ":scope > th": ["Date", "Created By", "Field", "Old Value", "New Value"].map(textNode),
      },
    },
    ...rows.map((row) => ({
      text: row.join(" "),
      children: { ":scope > td": row.map(textNode), ":scope > th": [] },
    })),
  ];
}

function fixturePage(input: Readonly<{
  searches: Readonly<Record<string, readonly SearchFixtureRow[]>>;
  records: Readonly<Record<string, RecordFixture>>;
  histories?: Readonly<Record<string, readonly HistoryFixtureRow[]>>;
}>): Page {
  let currentUrl = "https://act-crm.my.site.com/hr/ONB_HomePage";
  let mode: "home" | "search" | "record" | "history" = "home";
  let query = "";
  let recordId = "";
  const page = {
    async goto(rawUrl: string) {
      const url = new URL(rawUrl);
      currentUrl = url.href;
      if (url.pathname === "/hr/ONB_SearchOnboardings") {
        mode = "search";
        query = url.searchParams.get("q") ?? "";
      } else if (url.pathname === "/hr/ONB_ViewOnboarding") {
        mode = "record";
        recordId = url.searchParams.get("id") ?? "";
      } else if (url.pathname === "/hr/ONB_ShowOnboardingHistory") {
        mode = "history";
        recordId = url.searchParams.get("id") ?? "";
      }
      return null;
    },
    url() {
      return currentUrl;
    },
    getByRole(role: string, options: Readonly<{ name?: string }>) {
      if (role !== "heading" || mode !== "search") return new FixtureLocator([]);
      if (options.name === "Search Results") return new FixtureLocator([textNode("Search Results")]);
      const rows = input.searches[query];
      if (options.name === "No search results were found." && rows !== undefined && rows.length === 0) {
        return new FixtureLocator([textNode("No search results were found.")]);
      }
      return new FixtureLocator([]);
    },
    locator(selector: string) {
      if (mode === "search" && selector === "table tbody tr") {
        const rows = input.searches[query];
        if (rows === undefined) throw new Error(`fixture has no search response for ${query}`);
        const auxiliary: FixtureNode = {
          text: "search controls",
          children: {
            ":scope > td": [textNode("query"), textNode("controls")],
            ":scope > td:first-child a": [],
          },
        };
        return new FixtureLocator(rows.length === 0 ? [] : [auxiliary, ...rows.map(searchRowNode)]);
      }
      if (mode === "record" && selector === "th") {
        const record = input.records[recordId];
        if (record === undefined) throw new Error(`fixture has no record ${recordId}`);
        return new FixtureLocator(recordFieldNodes(record));
      }
      if (mode === "history" && selector === "table.detailList tr") {
        const rows = input.histories?.[recordId];
        if (rows === undefined) throw new Error(`fixture has no history ${recordId}`);
        return new FixtureLocator(historyNodes(rows));
      }
      return new FixtureLocator([]);
    },
  };
  return page as unknown as Page;
}

const EID = EidSchema.parse("10873698");
const OTHER_EID = EidSchema.parse("10101010");

function exactRecord(overrides: Partial<ExactCrmOnboardingRecord> = {}): ExactCrmOnboardingRecord {
  return {
    fullName: "Fixture, Person",
    rawStage: "Completed",
    recordId: "record-1",
    recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=record-1",
    observedEid: EID,
    firstName: "Person",
    lastName: "Fixture",
    firstDayOfService: "7/15/2026",
    department: "Housing", dateSigned: "6/25/2026",
    ...overrides,
  };
}

describe("CRM onboarding selector-backed driver", () => {

  it("accepts exactly one displayed-EID match and rejects duplicate exact records", () => {
    assert.equal(chooseExactCrmRecord([exactRecord({ observedEid: OTHER_EID })], EID).state, "absent");
    assert.equal(chooseExactCrmRecord([exactRecord()], EID).state, "found");
    assert.throws(
      () => chooseExactCrmRecord([exactRecord(), exactRecord({ recordId: "record-2" })], EID),
      /resolved 2 exact displayed-EID records/,
    );
  });

  it("parses CRM dates strictly and rejects impossible or locale-drifted values", () => {
    assert.equal(parseCrmDateOnly("7/5/2026 1:22 PM", "history"), "2026-07-05");
    assert.throws(() => parseCrmDateOnly("2/30/2026", "history"), /not a real calendar date/);
    assert.throws(() => parseCrmDateOnly("2026-07-05", "history"), /is not M\/D\/YYYY/);
  });

  it("uses an optional name fallback but still requires the exact displayed EID", async () => {
    const page = fixturePage({
      searches: {
        [EID]: [{ fullName: "Wrong, Person", rawStage: "Started", recordId: "wrong" }],
        Fixture: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact" }],
        Person: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact" }],
      },
      records: {
        wrong: { eid: OTHER_EID, firstName: "Person", lastName: "Wrong", firstDayOfService: "" },
        exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/15/2026" },
      },
    });
    const result = await createCrmOnboardingDriver(page).readOnboardingRecord({
      eid: EID,
      name: "Fixture, Person",
    });
    assert.equal(result.binding.state, "displayed-record");
    assert.deepEqual(result.output, {
      state: "found",
      record: {
        recordId: "exact",
        emplId: EID,
        fullName: "Fixture, Person",
        rawStage: "Completed",
      },
    });
  });

  it("audits every distinct name-fallback record before rejecting duplicate exact EIDs", async () => {
    const page = fixturePage({
      searches: {
        [EID]: [{ fullName: "Wrong, Person", rawStage: "Started", recordId: "wrong" }],
        Fixture: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact-1" }],
        Person: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact-2" }],
      },
      records: {
        wrong: { eid: OTHER_EID, firstName: "Person", lastName: "Wrong", firstDayOfService: "" },
        "exact-1": { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/15/2026" },
        "exact-2": { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/15/2026" },
      },
    });
    await assert.rejects(
      createCrmOnboardingDriver(page).readOnboardingRecord({ eid: EID, name: "Fixture, Person" }),
      /resolved 2 exact displayed-EID records/,
    );
  });

  it("restores exact discovery results before capture and refuses changed rows", async () => {
    const rows = [
      { fullName: "Fixture, Person", rawStage: "Completed", recordId: "first" },
      { fullName: "Fixture, Person", rawStage: "Started", recordId: "last" },
    ];
    const records = {
      first: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/1/2026" },
      last: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/2/2026" },
    };
    const page = fixturePage({ searches: { [EID]: rows }, records });
    const found = await createCrmOnboardingDriver(page).searchOnboardingRecords({ eid: EID });
    assert.deepEqual(found.map(record => record.recordId), ["first", "last"]);
    assert.equal(new URL(page.url()).pathname, "/hr/ONB_SearchOnboardings");
    assert.equal(new URL(page.url()).searchParams.get("q"), EID);
    const changing = fixturePage({ searches: { [EID]: rows }, records });
    const goto = changing.goto.bind(changing);
    let searches = 0;
    changing.goto = async (...args) => {
      if (new URL(args[0]).pathname === "/hr/ONB_SearchOnboardings" && ++searches === 2) rows.pop();
      return goto(...args);
    };
    await assert.rejects(createCrmOnboardingDriver(changing).searchOnboardingRecords({ eid: EID }),
      /discovery results changed before capture/u);
  });

  it("reads Department beside Department HR Rep Name using the complete label", async () => {
    const page = fixturePage({
      searches: { [EID]: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact" }] },
      records: { exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/1/2026", departmentHrRepName: "Representative, Example" } },
    });
    const records = await createCrmOnboardingDriver(page).searchOnboardingRecords({ eid: EID });
    assert.equal(records.length, 1);
    assert.equal(records[0].department, "Housing");
    assert.equal(records[0].firstDayOfService, "7/1/2026");
  });

  it("validates both nonblank dates at the actual discovery record reader", async () => {
    for (const invalid of [{ firstDayOfService: "2/30/2026" }, { dateSigned: "2/30/2026" }]) {
      const page = fixturePage({ searches: { [EID]: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact" }] },
        records: { exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "", ...invalid } },
      });
      await assert.rejects(createCrmOnboardingDriver(page).searchOnboardingRecords({ eid: EID }), /not a real calendar date/u);
    }
    const blank = fixturePage({ searches: { [EID]: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact" }] },
      records: { exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "", dateSigned: "" } },
    });
    const found = await createCrmOnboardingDriver(blank).searchOnboardingRecords({ eid: EID });
    assert.equal(found[0].firstDayOfService, "");
    assert.equal(found[0].dateSigned, "");
  });

  it("reopens the selected record, refreshes its dates and refuses changed identity", async () => {
    const selected = { recordId: "exact", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=exact", emplId: EID, name: "Fixture, Person", department: "Housing", firstDayOfService: "7/1/2026", dateSigned: "" };
    const driver = createCrmOnboardingDriver(fixturePage({ searches: {}, records: { exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/2/2026" } } }));
    assert.equal((await driver.verifyOnboardingRecord(selected)).firstDayOfService, "7/2/2026");
    for (const eid of [OTHER_EID]) {
      await assert.rejects(createCrmOnboardingDriver(fixturePage({ searches: {}, records: { exact: { eid, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/2/2026" } } })).verifyOnboardingRecord(selected), /identity changed/);
    }
  });

  it("maps employment and oath only from First Day and Date Signed", async () => {
    const page = fixturePage({
      searches: { Fixture: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact" }] },
      records: {
        exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/15/2026" },
      },
      histories: {
        exact: [
          ["6/1/2026 9:00 AM", "Fixture", "ProcessStageText", "Draft", "Offer Letter Sent"],
          ["6/2/2026 9:00 AM", "Fixture", "Date Signed", "", "1/1/1999"],
          ["7/20/2026 2:00 PM", "Fixture", "ProcessStageText", "Started", "Completed"],
        ],
      },
    });
    const result = await createCrmOnboardingDriver(page).readOnboardingDates({ eid: EID, name: "Fixture, Person" });
    assert.equal(result.binding.state, "displayed-record");
    assert.deepEqual(result.output, {
      emplId: EID,
      state: "read", employmentDate: "2026-07-15", oathDate: "2026-06-25", reason: "",
    });
  });

  it("returns absence only after valid fuzzy candidates fail the exact displayed-EID gate", async () => {
    const page = fixturePage({
      searches: { Fixture: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "wrong" }], Person: [] },
      records: {
        wrong: { eid: OTHER_EID, firstName: "Person", lastName: "Wrong", firstDayOfService: "7/15/2026" },
      },
    });
    const result = await createCrmOnboardingDriver(page).readOnboardingDates({ eid: EID, name: "Fixture, Person" });
    assert.equal(result.binding.state, "absent-query");
    assert.equal(result.output.state, "no-confident-record");
    assert.equal(result.output.employmentDate, null);
    assert.equal(result.output.oathDate, null);
    assert.equal(new URL(page.url()).pathname, "/hr/ONB_SearchOnboardings");
    assert.equal(new URL(page.url()).searchParams.get("q"), "Person");
  });

  it("finishes dates on the freshly verified selected form after a fuzzy nonmatch", async () => {
    const selected = { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/15/2026" };
    const page = fixturePage({ searches: { Fixture: [
      { fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact" },
      { fullName: "Fixture, Person", rawStage: "Started", recordId: "wrong" },
    ] }, records: { exact: selected,
      wrong: { eid: OTHER_EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/1/2026" } },
    });
    const goto = page.goto.bind(page);
    let selectedOpens = 0;
    page.goto = async (...args) => {
      if (new URL(args[0]).searchParams.get("id") === "exact" && ++selectedOpens === 2) selected.firstDayOfService = "7/16/2026";
      return goto(...args);
    };
    const result = await createCrmOnboardingDriver(page).readOnboardingDates({ eid: EID, name: "Fixture, Person" });
    assert.equal(result.binding.state, "displayed-record");
    assert.equal(result.output.state, "read");
    assert.equal(result.output.employmentDate, "2026-07-16", "dates come from the final fresh read");
    assert.equal(selectedOpens, 2);
    assert.equal(new URL(page.url()).pathname, "/hr/ONB_ViewOnboarding");
    assert.equal(new URL(page.url()).searchParams.get("id"), "exact");
  });

  it("finishes ambiguous date forms on freshly verified complete query results", async () => {
    const rows = ["first", "last"].map(recordId => ({ fullName: "Fixture, Person", rawStage: "Completed", recordId }));
    const records = Object.fromEntries(rows.map(row => [row.recordId,
      { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/15/2026" }]));
    const page = fixturePage({ searches: { Fixture: rows }, records });
    const result = await createCrmOnboardingDriver(page).readOnboardingDates({ eid: EID, name: "Fixture, Person" });
    assert.equal(result.output.state, "no-confident-record");
    assert.equal(result.output.employmentDate, null);
    assert.equal(new URL(page.url()).pathname, "/hr/ONB_SearchOnboardings");
    assert.equal(new URL(page.url()).searchParams.get("q"), "Fixture");
    const changing = fixturePage({ searches: { Fixture: rows }, records });
    const goto = changing.goto.bind(changing);
    let searches = 0;
    changing.goto = async (...args) => {
      if (new URL(args[0]).pathname === "/hr/ONB_SearchOnboardings" && ++searches === 2) rows.pop();
      return goto(...args);
    };
    const refused = await createCrmOnboardingDriver(changing).readOnboardingDates({ eid: EID, name: "Fixture, Person" });
    assert.equal(refused.output.state, "check-failed", "restoration drift remains a best-effort failure");
  });

  it("reports failed date acquisition instead of converting selector drift into absence", async () => {
    const page = fixturePage({
      searches: { Fixture: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "bad", cellCount: 4 }] },
      records: {},
    });
    const output = (await createCrmOnboardingDriver(page).readOnboardingDates({ eid: EID, name: "Fixture, Person" })).output;
    assert.equal(output.state, "check-failed");
    assert.ok(output.state === "check-failed");
    assert.equal(output.code, "PERSON_LOOKUP_CRM_DATES_CHECK_FAILED");
    assert.equal(output.reason, "CRM dates check failed.");
  });

  it("allows a blank First Day only after exact identity, while malformed dates fail the check", async () => {
    const base = {
      searches: { Fixture: [{ fullName: "Fixture, Person", rawStage: "Completed", recordId: "exact" }] },
      histories: {
        exact: [["6/1/2026 9:00 AM", "Fixture", "ProcessStageText", "Draft", "Offer Letter Sent"]] as const,
      },
    };
    const blank = fixturePage({
      ...base,
      records: { exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "" } },
    });
    const blankResult = await createCrmOnboardingDriver(blank).readOnboardingDates({ eid: EID, name: "Fixture, Person" });
    assert.equal(blankResult.output.employmentDate, null);

    const malformed = fixturePage({
      ...base,
      records: { exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "tomorrow" } },
    });
    assert.equal((await createCrmOnboardingDriver(malformed).readOnboardingDates({ eid: EID, name: "Fixture, Person" })).output.state, "check-failed");
  });

  it("keeps actual record dates independent of empty history", async () => {
    const page = fixturePage({
      searches: { Fixture: [{ fullName: "Fixture, Person", rawStage: "Started", recordId: "exact" }] },
      records: {
        exact: { eid: EID, firstName: "Person", lastName: "Fixture", firstDayOfService: "7/15/2026" },
      },
      histories: { exact: [] },
    });
    const result = await createCrmOnboardingDriver(page).readOnboardingDates({ eid: EID, name: "Fixture, Person" });
    assert.equal(result.binding.state, "displayed-record");
    assert.equal(result.output.state, "read");
    assert.equal(result.output.employmentDate, "2026-07-15");
    assert.equal(result.output.oathDate, "2026-06-25");
  });
});
