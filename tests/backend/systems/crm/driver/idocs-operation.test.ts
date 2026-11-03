// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "vitest";
import { readCrmIdocsOnPage } from "../../../../../src/backend/systems/crm/driver/idocs-operation.js";
import { createCrmIdocsFixturePage } from "../../../../support/helpers/browser/crm-idocs-page.js";
const subject = { recordId: "fixture-record", subject: { kind: "eid", value: "10000001" } } as const;

it("verifies displayed identity before fetching the mapped PDFs with the owned browser session", async () => {
  const f = await createCrmIdocsFixturePage();
  const result = await readCrmIdocsOnPage(() => {}, f.page, subject);
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
