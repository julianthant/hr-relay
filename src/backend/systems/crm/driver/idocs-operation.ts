import type { Page, Frame } from "playwright";
import { z } from "zod";
import { CrmDocumentIdentitySchema, CrmDocumentSubjectSchema, CrmIdocsBytesSchema, CrmIdocsReadInputSchema } from "../../../../models/systems/crm/documents.js";
import { chooseLatestHireRecord, searchCrmOnboardingOfferRows } from "./hire-operation.js";
import { crmDocumentFileName, crmDocumentIndices, matchesCrmDocumentSubject } from "../../../../rules/crm-doc-download/documents.js";

const VIEWER_ORIGIN = "https://crickportal-ext.bfs.ucsd.edu";
const VIEWER_PATH = "/iDocsForSalesforce/Content/pdfjs/web/PDFjsViewer.aspx";
const DOCUMENT_PATH = "/iDocsForSalesforce/iDocsForSalesforceDocumentServer";
const BOUND_MS = 30_000;

function viewer(frame: Frame): boolean {
  if (frame.url() === "") return false;
  const url = new URL(frame.url());
  return url.origin === VIEWER_ORIGIN && url.pathname === VIEWER_PATH && url.username === "" && url.password === "";
}

function assertDocumentRecord(assertCurrent: () => void, page: Page, recordId: string): void {
  assertCurrent();
  const location = new URL(page.url());
  if (location.origin !== "https://act-crm.my.site.com" || location.pathname !== "/hr/ONB_ViewOnboarding"
    || location.username !== "" || location.password !== "" || location.searchParams.get("id") !== recordId) throw new Error("CRM document record location changed");
}

async function readIdentity(assertCurrent: () => void, page: Page, recordId: string) {
  const field = async (label: string) => {
    assertDocumentRecord(assertCurrent, page, recordId);
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const locator = page.locator("th, td").filter({ hasText: new RegExp(`^\\s*${escaped}\\s*:?\\s*$`, "iu") }).locator("xpath=following-sibling::*[1][self::td]");
    await locator.first().waitFor({ state: "visible", timeout: BOUND_MS }); assertDocumentRecord(assertCurrent, page, recordId);
    if (await locator.count() !== 1) throw new Error("CRM document identity field is not unique");
    const text = await locator.textContent(); assertDocumentRecord(assertCurrent, page, recordId);
    if (text === null) throw new Error("CRM document identity field is unavailable");
    return text.trim() === "" ? null : text.trim();
  };
  return CrmDocumentIdentitySchema.parse({ recordId,
    eid: await field("UCPath Employee ID"), workEmail: await field("UCSD Email Address"), personalEmail: await field("Personal Email Address") });
}

export async function findCrmDocumentRecordOnPage(assertCurrent: () => void, page: Page,
  raw: z.input<typeof CrmDocumentSubjectSchema>): Promise<z.infer<typeof CrmDocumentIdentitySchema>> {
  const subject = CrmDocumentSubjectSchema.parse(raw);
  const rows = await searchCrmOnboardingOfferRows(assertCurrent, page, subject.value);
  const exact = [];
  for (const row of rows) {
    if (/rescinded|cancelled|canceled|withdrawn/iu.test(row.processStage)) continue;
    assertCurrent(); await page.goto(row.recordUrl, { waitUntil: "domcontentloaded", timeout: BOUND_MS });
    const identity = await readIdentity(assertCurrent, page, row.recordId);
    if (matchesCrmDocumentSubject(subject, identity)) exact.push({ row, identity });
  }
  if (exact.length === 0) throw new Error("CRM has no active exact-identity document record");
  const selected = chooseLatestHireRecord(exact.map(value => value.row));
  const prior = exact.find(value => value.row.recordId === selected.recordId);
  if (prior === undefined) throw new Error("CRM selected document record has no identity evidence");
  assertCurrent(); await page.goto(selected.recordUrl, { waitUntil: "domcontentloaded", timeout: BOUND_MS });
  const current = await readIdentity(assertCurrent, page, selected.recordId);
  if (JSON.stringify(current) !== JSON.stringify(prior.identity)) throw new Error("CRM document record changed during selection");
  return current;
}

export async function readCrmIdocsOnPage(assertCurrent: () => void, page: Page,
  raw: z.input<typeof CrmIdocsReadInputSchema>): Promise<z.infer<typeof CrmIdocsBytesSchema>> {
  const input = CrmIdocsReadInputSchema.parse(raw);
  const recordUrl = new URL("/hr/ONB_ViewOnboarding", "https://act-crm.my.site.com");
  recordUrl.searchParams.set("id", input.recordId);
  assertCurrent(); await page.goto(recordUrl.href, { waitUntil: "domcontentloaded", timeout: BOUND_MS });
  const assertRecord = () => assertDocumentRecord(assertCurrent, page, input.recordId);
  const identity = await readIdentity(assertCurrent, page, input.recordId);
  if (!matchesCrmDocumentSubject(input.subject, identity)) throw new Error("CRM document identity mismatch");
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
