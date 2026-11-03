import type { Frame } from "playwright";
import { createCrmHireFixturePage } from "./crm-hire-page.js";

export async function createCrmIdocsFixturePage(options: {
  eid?: string; email?: string; frameUrls?: readonly string[]; body?: string; status?: number; redirect?: string; missingField?: string; countText?: string;
} = {}) {
  const eid = options.eid === undefined ? "10000001" : options.eid, email = options.email === undefined ? "fixture@example.test" : options.email;
  const { page } = createCrmHireFixturePage(() => ({ html: `<table><tbody>${[
    ["UCPath Employee ID", eid], ["UCSD Email Address", email], ["Personal Email Address", ""],
  ].filter(([label]) => label !== options.missingField).map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join("")}</tbody></table>` }));
  await page.goto("https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=fixture-record");
  const frameUrls = options.frameUrls === undefined ? ["https://crickportal-ext.bfs.ucsd.edu/iDocsForSalesforce/Content/pdfjs/web/PDFjsViewer.aspx?h=fixture-token&c=9"] : options.frameUrls;
  const requests: Array<{ url: string; maxRedirects: number; disposed: boolean }> = [];
  const frames = frameUrls.map(url => ({ url: () => url, locator: () => ({ count: async () => 1, textContent: async () => options.countText === undefined ? " of 9" : options.countText }) }) as unknown as Frame);
  Object.assign(page, {
    frames: () => frames,
    async waitForEvent() { throw new Error("fixture viewer missing"); },
    context: () => ({ request: { async get(url: string, config: { maxRedirects: number }) {
      const record = { url, maxRedirects: config.maxRedirects, disposed: false }; requests.push(record);
      return { ok: () => options.status === undefined || options.status >= 200 && options.status < 300,
        url: () => options.redirect === undefined ? url : options.redirect,
        body: async () => Buffer.from(options.body === undefined ? "%PDF-1.7 fixture document" : options.body),
        headers: () => ({ "content-type": "application/pdf" }), async dispose() { record.disposed = true; } };
    } } }),
  });
  return { page, requests };
}
