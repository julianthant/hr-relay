// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "vitest";
import { findCrmDocumentRecordOnPage, readCrmIdocsOnPage } from "../../../../../src/backend/systems/crm/driver/idocs-operation.js";
import { createCrmIdocsFixturePage } from "../../../../support/helpers/browser/crm-idocs-page.js";
import { createCrmHireFixturePage } from "../../../../support/helpers/browser/crm-hire-page.js";
const subject = { recordId: "fixture-record", subject: { kind: "eid", value: "10000001" } } as const;

function searchFixture(drift = false, tie = false, allWrong = false) {
  return createCrmHireFixturePage((url, visit) => {
    if (url.pathname.endsWith("SearchOnboardings")) return { html: `<h1>Search Results</h1><table><tbody>
      ${[["wrong", "11/01/2026", "Campus Forms Pending"], ["older", tie ? "09/01/2026" : "08/01/2026", "Campus Forms Pending"],
        ["latest", "09/01/2026", "Campus Forms Pending"], ["dead", "10/01/2026", "Offer Rescinded"]].map(([id, date, stage]) =>
      `<tr><td><a href="/hr/ONB_ViewOnboarding?id=${id}">Fixture</a></td><td>${date}</td><td></td><td></td><td>${stage}</td></tr>`).join("")}</tbody></table>` };
    const wrong = allWrong || url.searchParams.get("id") === "wrong" || drift && visit > 1;
    return { html: `<table><tbody><tr><th>UCPath Employee ID</th><td>${wrong ? "10000002" : "10000001"}</td></tr>
      <tr><th>UCSD Email Address</th><td>${wrong ? "other@example.test" : "fixture@example.test"}</td></tr>
      <tr><th>Personal Email Address</th><td></td></tr></tbody></table>` };
  });
}

it.each(["eid", "email"] as const)("chooses the latest exact %s record after excluding wrong-person and rescinded offers", async kind => {
  const f = searchFixture();
  const selected = await findCrmDocumentRecordOnPage(() => {}, f.page, { kind, value: kind === "eid" ? "10000001" : "fixture@example.test" });
  assert.equal(selected.recordId, "latest");
  assert.ok(f.navigations.at(-1)?.endsWith("id=latest")); assert.equal(f.navigations.some(url => url.endsWith("id=dead")), false);
});

it("refuses an ambiguous latest offer and identity changes when reopening the selected record", async () => {
  for (const f of [searchFixture(false, true), searchFixture(true)]) {
    await assert.rejects(findCrmDocumentRecordOnPage(() => {}, f.page, subject.subject));
  }
});

it("refuses fuzzy search results that contain no exact displayed identity", async () => {
  const f = searchFixture(false, false, true);
  await assert.rejects(findCrmDocumentRecordOnPage(() => {}, f.page, subject.subject), /no active exact-identity/u);
});

it("verifies displayed identity before fetching the mapped PDFs with the owned browser session", async () => {
  const f = await createCrmIdocsFixturePage();
  const result = await readCrmIdocsOnPage(() => {}, f.page, subject);
  assert.equal(f.navigations.length, 2); assert.ok(f.navigations.at(-1)?.endsWith("id=fixture-record"));
  assert.deepEqual(result.documents.map(doc => [doc.index, doc.fileName]), [[0, "Signed Offer Letter.pdf"], [2, "EE Data Gathering Form.pdf"]]);
  assert.deepEqual(result.identity, { recordId: "fixture-record", eid: "10000001", workEmail: "fixture@example.test", personalEmail: null });
  assert.deepEqual(f.requests.map(request => new URL(request.url).searchParams.get("i")), ["0", "2"]);
  assert.ok(f.requests.every(request => request.maxRedirects === 0 && request.disposed));
  assert.ok(result.documents.every(doc => new TextDecoder().decode(doc.bytes).startsWith("%PDF-")));
});

it("accepts an exact email with a proved blank EID and the verified viewer count element", async () => {
  const f = await createCrmIdocsFixturePage({ eid: "", frameUrls: ["https://crickportal-ext.bfs.ucsd.edu/iDocsForSalesforce/Content/pdfjs/web/PDFjsViewer.aspx?h=fixture-token"] });
  const result = await readCrmIdocsOnPage(() => {}, f.page, { recordId: "fixture-record", subject: { kind: "email", value: "FIXTURE@example.test" } });
  assert.equal(result.identity.eid, null); assert.equal(result.documents.length, 2);
});

it.each([
  ["wrong identity", { eid: "10000002" }],
  ["missing identity selector", { missingField: "UCPath Employee ID" }],
  ["missing viewer", { frameUrls: [] }],
  ["unknown layout", { frameUrls: ["https://crickportal-ext.bfs.ucsd.edu/iDocsForSalesforce/Content/pdfjs/web/PDFjsViewer.aspx?h=fixture-token&c=3"] }],
] as const)("refuses %s before any download", async (_label, options) => {
  const f = await createCrmIdocsFixturePage(options);
  await assert.rejects(readCrmIdocsOnPage(() => {}, f.page, subject)); assert.equal(f.requests.length, 0);
});

it.each([{ body: "<html>Sign in</html>" }, { body: "not a PDF" }, { status: 403 }, { redirect: "https://other.example.test/file" }])("refuses failed or invalid PDF responses and disposes them: %j", async options => {
  const f = await createCrmIdocsFixturePage(options);
  await assert.rejects(readCrmIdocsOnPage(() => {}, f.page, subject));
  assert.equal(f.requests.length, 1); assert.ok(f.requests.every(request => request.disposed));
});

it("refuses a partly out-of-range explicit selection before downloading its first member", async () => {
  const f = await createCrmIdocsFixturePage();
  await assert.rejects(readCrmIdocsOnPage(() => {}, f.page, { ...subject, docIndices: [0, 9] })); assert.equal(f.requests.length, 0);
});
