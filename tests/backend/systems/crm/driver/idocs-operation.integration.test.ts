import assert from "node:assert/strict";
import { chromium } from "playwright";
import { it, vi } from "vitest";
import { readCrmIdocsOnPage } from "../../../../../src/backend/systems/crm/driver/idocs-operation.js";

const recordUrl = "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=fixture-record";
const viewerRoot = "https://crickportal-ext.bfs.ucsd.edu/iDocsForSalesforce";
const viewerUrl = `${viewerRoot}/Content/pdfjs/web/PDFjsViewer.aspx?h=fixture-token`;
const documentUrl = `${viewerRoot}/iDocsForSalesforceDocumentServer?i=0&h=fixture-token`;

it.each([
  ["a counter that has not mounted", ""],
  ["a counter showing its loading value", '<span id="numDocs">of 0</span>'],
])("reads iDocs after %s becomes ready", async (_state, initialCounter) => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", async route => {
      if (route.request().url() === recordUrl) {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><table><tbody>
          <tr><th>UCPath Employee ID</th><td>10000001</td></tr>
          <tr><th>UCSD Email Address</th><td>fixture@example.test</td></tr>
          <tr><th>Personal Email Address</th><td></td></tr>
          </tbody></table><iframe src="${viewerUrl}"></iframe>` });
      } else if (route.request().url() === viewerUrl) {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><div id="counter">${initialCounter}</div>
          <script>setTimeout(() => document.getElementById("counter").innerHTML = '<span id="numDocs">of 9</span>', 750);</script>` });
      } else {
        await route.abort();
      }
    });
    const pdf = Buffer.from("%PDF-1.7 fixture document");
    const dispose = vi.fn(async () => undefined);
    const unexpected = (): never => { throw new Error("Unexpected iDocs fixture response method"); };
    const download = vi.spyOn(page.context().request, "get").mockImplementation(async target => {
      assert.equal(target, documentUrl);
      return {
        ok: () => true, url: () => documentUrl, body: async () => pdf, dispose,
        headers: () => ({ "content-type": "application/pdf" }), headersArray: unexpected,
        status: unexpected, statusText: unexpected, text: unexpected, json: unexpected,
        securityDetails: unexpected, serverAddr: unexpected, timing: unexpected, [Symbol.asyncDispose]: dispose,
      };
    });

    const result = await readCrmIdocsOnPage(() => undefined, page, {
      recordId: "fixture-record", subject: { kind: "eid", value: "10000001" }, docIndices: [0],
    });
    assert.equal(result.totalDocuments, 9);
    assert.deepEqual(result.documents.map(doc => [doc.index, doc.fileName, Buffer.from(doc.bytes)]), [[0, "Signed Offer Letter.pdf", pdf]]);
    assert.deepEqual(download.mock.calls, [[documentUrl, { timeout: 30_000, maxRedirects: 0 }]]);
    assert.equal(dispose.mock.calls.length, 1);
  } finally {
    await browser.close();
  }
});
