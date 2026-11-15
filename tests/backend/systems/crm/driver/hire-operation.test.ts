// @vitest-environment jsdom
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { chooseLatestHireRecord, readCrmHireDataOnPage } from "../../../../../src/backend/systems/crm/driver/hire-operation.js";
import { CrmReadHireData } from "../../../../../src/models/systems/crm/read-hire-data.js";
import { createCrmHireFixturePage } from "../../../../support/helpers/browser/crm-hire-page.js";

const EMAIL = "hire@example.test";
const row = (id: string, date = "08/01/2026", stage = "Campus Forms Pending") => ({
  recordId: id, recordUrl: `https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=${id}`, offerSentOn: date, processStage: stage,
});
const record = (email = EMAIL) => `<table><tbody>
  <tr><th>Employee First Name</th><td>Fixture</td></tr><tr><td>Employee Last Name:</td><td>Hire</td></tr>
  <tr><th>Personal Email Address</th><td>${email}</td></tr><tr><th>UCSD Email Address</th><td></td></tr>
  <tr><th>Department</th><td>Dining (000412)</td></tr><tr><th>Recruitment Number</th><td>R123</td></tr>
</tbody></table>`;
const sheet = `<table><tbody>
  <tr><th>Position Number:</th><td>12345678</td><th>First Name</th><td>Fixture</td></tr>
  <tr><td>Last Name:</td><td>Hire</td></tr><tr><th>Middle Name</th><td></td></tr>
  <tr><th>SSN (National ID)</th><td></td></tr><tr><th>Address Line 1</th><td>123 Example St</td></tr>
  <tr><th>Address Line 2</th><td></td></tr><tr><th>City</th><td>San Diego</td></tr>
  <tr><th>State</th><td>CA</td></tr><tr><th>Postal Code</th><td>92093</td></tr>
  <tr><th>Compensation rate</th><td>$17.75 per hour</td></tr><tr><th>Date of Birth</th><td>01/14/2000</td></tr>
  <tr><th>Cell Phone Number</th><td></td></tr><tr><th>Personal Email Address</th><td>${EMAIL}</td></tr>
  <tr><th>Type of Appointment (Employee Classification)</th><td>5 Student: Casual/Restricted</td></tr>
  <tr><th>First Day of Service (Effective Date)</th><td>09/11/2026</td></tr>
  <tr><th>Expected Job End Date (if applicable)</th><td>06/30/2027</td></tr>
</tbody></table>`;

function fixture(options: {
  rows?: readonly ReturnType<typeof row>[]; sheet?: string; record?: string; redirect?: string; changedOnReopen?: boolean; extraSearchRow?: string;
} = {}) {
  const rows = options.rows === undefined ? [row("fixture-hire")] : options.rows;
  return createCrmHireFixturePage((url, visit) => {
    if (url.pathname.endsWith("SearchOnboardings")) return { html: `<h1>Search Results</h1>
      ${rows.length === 0 ? "<h2>No search results were found.</h2>" : ""}<table><tbody>
      <tr><td>Search Results</td><td></td></tr>${rows.map(value => `<tr><td><a href="${value.recordUrl}">Fixture Hire</a></td>
      <td>${value.offerSentOn}</td><td></td><td></td><td>${value.processStage}</td></tr>`).join("")}
      ${options.extraSearchRow === undefined ? "" : options.extraSearchRow}</tbody></table>` };
    if (url.pathname.endsWith("ViewOnboarding")) return {
      html: options.record === undefined
        ? record(url.searchParams.get("id") === "wrong" || options.changedOnReopen && visit > 1 ? "other@example.test" : EMAIL)
        : options.record,
      ...(options.redirect === undefined ? {} : { url: options.redirect }),
    };
    if (url.pathname.endsWith("PPSEntrySheet")) return { html: options.sheet === undefined ? sheet : options.sheet };
    throw new Error("unexpected fixture route");
  });
}

describe("CRM hire extraction", () => {
  it("extracts both Visualforce label forms, including proved blanks, without choosing a fuzzy result", async () => {
    const { page, navigations } = fixture({ rows: [row("wrong", "10/01/2026"), row("fixture-hire"), row("dead", "11/01/2026", "Offer Rescinded")] });
    const result = await readCrmHireDataOnPage(() => {}, page, EMAIL);
    assert.deepEqual(result, CrmReadHireData.example);
    assert.equal(navigations.some(url => url.includes("id=dead")), false);
    assert.ok(navigations.at(-1)?.endsWith("ONB_PPSEntrySheet?id=fixture-hire"));
  });

  it("reads a populated cell phone from the live label", async () => {
    const populated = sheet.replace("<th>Cell Phone Number</th><td></td>", "<th>Cell Phone Number</th><td>(202) 555-0101</td>");
    const result = await readCrmHireDataOnPage(() => {}, fixture({ sheet: populated }).page, EMAIL);
    assert.deepEqual(result, { ...CrmReadHireData.example, fields: { ...CrmReadHireData.example.fields, phone: "(202) 555-0101" } });
  });

  it.each([
    ["Cell Phone Number", ""], ["Personal Email Address", EMAIL], ["Type of Appointment (Employee Classification)", "5 Student: Casual/Restricted"],
  ] as const)("refuses a missing, duplicated or valueless %s row", async (label, value) => {
    const cells = `<th>${label}</th><td>${value}</td>`;
    assert.ok(sheet.includes(cells));
    for (const changed of [sheet.replace(cells, "<th>Other</th><td></td>"), sheet.replace("</tbody>", `<tr>${cells}</tr></tbody>`),
      sheet.replace(cells, `<th>${label}</th>`)]) {
      await assert.rejects(readCrmHireDataOnPage(() => {}, fixture({ sheet: changed }).page, EMAIL));
    }
  });

  it("chooses the newest active exact-email offer and refuses ties or unreadable competing dates", () => {
    assert.equal(chooseLatestHireRecord([row("older"), row("newer", "09/01/2026")]).recordId, "newer");
    for (const rows of [[], [row("dead", "", "Withdrawn")], [row("one"), row("two")], [row("one"), row("bad", "not a date")]]) {
      assert.throws(() => chooseLatestHireRecord(rows));
    }
    assert.equal(chooseLatestHireRecord([row("single", "")]).recordId, "single");
    assert.equal(chooseLatestHireRecord([row("morning", "08/01/2026 9:00 AM"), row("afternoon", "08/01/2026 1:00 PM")]).recordId, "afternoon");
    assert.throws(() => chooseLatestHireRecord([row("one"), row("bad-time", "08/01/2026 13:00 AM")]));
  });

  it.each([
    ["no exact email", { rows: [row("wrong")] }],
    ["explicit no results", { rows: [] }],
    ["changed identity", { changedOnReopen: true }],
    ["authentication redirect", { redirect: "https://login.example.test/" }],
    ["missing optional selector", { sheet: sheet.replace("<tr><th>Middle Name</th><td></td></tr>", "") }],
    ["missing value cell before another field", { sheet: sheet.replace("<th>Position Number:</th><td>12345678</td>", "<th>Position Number:</th>") }],
    ["ambiguous selector", { sheet: sheet.replace("</tbody>", "<tr><th>First Name</th><td>Other</td></tr></tbody>") }],
    ["entry-sheet name mismatch", { sheet: sheet.replace("<td>Fixture</td>", "<td>Other</td>") }],
    ["entry-sheet email mismatch", { sheet: sheet.replace(EMAIL, "other@example.test") }],
    ["changed row shape", { extraSearchRow: "<tr><td>one</td><td>two</td><td>three</td></tr>" }],
  ] as const)("refuses %s", async (_label, options) => {
    await assert.rejects(readCrmHireDataOnPage(() => {}, fixture(options).page, EMAIL));
  });

  it("propagates a stale lease before navigation", async () => {
    const { page, navigations } = fixture();
    await assert.rejects(readCrmHireDataOnPage(() => { throw new Error("stale lease"); }, page, EMAIL), /stale lease/u);
    assert.deepEqual(navigations, []);
  });
});
