import type { Page, Frame } from "playwright";
import { z } from "zod";
import { CrmDocumentIdentitySchema, CrmIdocsBytesSchema, CrmIdocsReadInputSchema } from "../../../../models/systems/crm/read-idocs.js";
import { crmDocumentFileName, crmDocumentIndices } from "../../../../rules/crm-doc-download/documents.js";

const VIEWER_ORIGIN = "https://crickportal-ext.bfs.ucsd.edu";
const VIEWER_PATH = "/iDocsForSalesforce/Content/pdfjs/web/PDFjsViewer.aspx";
const DOCUMENT_PATH = "/iDocsForSalesforce/iDocsForSalesforceDocumentServer";
const BOUND_MS = 30_000;

function viewer(frame: Frame): boolean {
  if (frame.url() === "") return false;
  const url = new URL(frame.url());
  return url.origin === VIEWER_ORIGIN && url.pathname === VIEWER_PATH && url.username === "" && url.password === "";
}

export async function readCrmIdocsOnPage(assertCurrent: () => void, page: Page,
  raw: z.input<typeof CrmIdocsReadInputSchema>): Promise<z.infer<typeof CrmIdocsBytesSchema>> {
  const input = CrmIdocsReadInputSchema.parse(raw);
  const assertRecord = () => {
    assertCurrent();
    const location = new URL(page.url());
    if (location.origin !== "https://act-crm.my.site.com" || location.pathname !== "/hr/ONB_ViewOnboarding"
      || location.username !== "" || location.password !== "" || location.searchParams.get("id") !== input.recordId) throw new Error("CRM document record location changed");
  };
  const field = async (label: string) => {
    assertRecord();
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const locator = page.locator("th, td").filter({ hasText: new RegExp(`^\\s*${escaped}\\s*:?\\s*$`, "iu") }).locator("xpath=following-sibling::*[1][self::td]");
    await locator.first().waitFor({ state: "visible", timeout: BOUND_MS }); assertRecord();
    if (await locator.count() !== 1) throw new Error("CRM document identity field is not unique");
    const text = await locator.textContent(); assertRecord();
    if (text === null) throw new Error("CRM document identity field is unavailable");
    return text.trim() === "" ? null : text.trim();
  };
  const identity = CrmDocumentIdentitySchema.parse({ recordId: input.recordId,
    eid: await field("UCPath Employee ID"), workEmail: await field("UCSD Email Address"), personalEmail: await field("Personal Email Address") });
  if (input.subject.kind === "eid" ? identity.eid !== input.subject.value
    : ![identity.workEmail, identity.personalEmail].some(email => email !== null && email.toLowerCase() === input.subject.value.toLowerCase())) {
    throw new Error("CRM document identity mismatch");
  }
  assertRecord();
  let frames = page.frames().filter(viewer);
  if (frames.length === 0) {
    await page.waitForEvent("framenavigated", { predicate: viewer, timeout: BOUND_MS }); assertRecord();
    frames = page.frames().filter(viewer);
  }
  const frame = frames[0];
  if (frames.length !== 1 || frame === undefined) throw new Error("CRM iDocs viewer is missing or ambiguous");
  const url = new URL(frame.url()), hash = url.searchParams.get("h"), count = url.searchParams.get("c");
  if (hash === null || hash.trim() === "") throw new Error("CRM iDocs viewer has no document token");
  let total: number;
  if (count === null) {
    const counter = frame.locator("#numDocs");
    if (await counter.count() !== 1) throw new Error("CRM iDocs count is unavailable");
    const text = await counter.textContent({ timeout: BOUND_MS });
    const match = text === null ? null : /^\s*(?:of\s+)?(\d+)\s*$/u.exec(text);
    if (match?.[1] === undefined) throw new Error("CRM iDocs count is invalid");
    total = Number(match[1]);
  } else {
    if (!/^\d+$/u.test(count)) throw new Error("CRM iDocs count is invalid");
    total = Number(count);
  }
  const indices = crmDocumentIndices(total, input.docIndices), documents = [];
  const names = new Set<string>();
  for (const index of indices) {
    assertRecord();
    if (frame.url() !== url.href) throw new Error("CRM iDocs viewer changed");
    const target = new URL(DOCUMENT_PATH, VIEWER_ORIGIN); target.searchParams.set("i", String(index)); target.searchParams.set("h", hash);
    const response = await page.context().request.get(target.href, { timeout: BOUND_MS, maxRedirects: 0 });
    let primary: { error: unknown } | undefined;
    try {
      assertRecord();
      if (!response.ok() || response.url() !== target.href) throw new Error("CRM iDocs download response is not the requested document");
      const body = await response.body(); assertRecord();
      if (body.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("CRM iDocs response is not a PDF");
      const fileName = crmDocumentFileName(index, response.headers()["content-disposition"]), key = fileName.normalize("NFC").toLowerCase();
      if (names.has(key)) throw new Error("CRM iDocs document filenames collide");
      names.add(key); documents.push({ index, fileName, bytes: new Uint8Array(body) });
    } catch (error) { primary = { error }; }
    try { await response.dispose(); }
    catch (error) { throw primary === undefined ? error : new AggregateError([primary.error, error], "CRM document response cleanup failed"); }
    if (primary !== undefined) throw primary.error;
  }
  assertRecord();
  return CrmIdocsBytesSchema.parse({ identity, totalDocuments: total, documents });
}
