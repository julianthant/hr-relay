import { createHash, randomUUID } from "node:crypto";
import type { Locator, Page } from "playwright";
import { z } from "zod";
import { OnbaseImportError, OnbaseImportVerdictSchema, OnbaseKeywordsSchema, OnbasePreparedSchema, OnbaseTargetSchema,
  ONBASE_DISPLAYED_EID, ONBASE_DOCUMENT_NAME, ONBASE_DOCUMENT_TYPE, ONBASE_IMPORT_BUTTON, ONBASE_IMPORT_STAGED, onbaseImportKey, type OnbaseTarget } from "../../../../models/systems/onbase/import-document.js";
import type { OnbaseDriver } from "../../../../models/ui/onbase.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { deriveIdempotencyKeyDigest } from "../../../../rules/write-safety/write-safety.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { ONBASE_UI_REGISTRY as ui } from "./ui-registry.js";

const CONTROL_MS = 10_000;
const KEYWORDS = [
  ["ucpathId", "UCPath ID", false], ["lastName", "Last Name", false], ["firstName", "First Name", false], ["documentName", "Document Name", false],
  ["departmentName", "Department Name", true], ["departmentCode", "Department Code", true], ["viceChancellor", "Vice Chancellor", true], ["viceChancellorCode", "Vice Chancellor Code", true],
] as const;
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export function createOnbaseDriver(assertCurrent: () => void, page: Page, clock: Clock): OnbaseDriver {
  let payload: Readonly<{ key: string; bytes: Uint8Array }> | undefined;
  let prepared: Readonly<{ key: string; keywords: z.output<typeof OnbaseKeywordsSchema> }> | undefined;
  let dialogFailure: unknown;
  const current = () => { assertCurrent(); if (dialogFailure !== undefined) throw new OnbaseImportError("dialog-closure-unproved", { cause: dialogFailure }); };
  page.on("dialog", dialog => { void (dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()).catch(error => { dialogFailure = error; }); });
  const run = async <T>(operation: () => Promise<T>): Promise<T> => { current(); try { return await operation(); } finally { current(); } };
  const requireApp = () => {
    current(); const url = new URL(page.url());
    if (url.origin !== "https://ucsd.hylandcloud.com" || url.pathname !== "/251ids/NavPanel.aspx") throw new OnbaseImportError("application-unproved");
    return url;
  };
  const open = async (kind: "import" | "retrieval") => {
    requireApp();
    await run(() => ui.mainMenu(page).click({ timeout: CONTROL_MS }));
    await run(() => (kind === "import" ? ui.importMenu(page) : ui.retrievalMenu(page)).click({ timeout: CONTROL_MS }));
    requireApp(); recordBrowserAction("opened", `onbase.${kind}`);
  };
  const fileName = (target: OnbaseTarget) => `page-${target.pageSha256}.pdf`;
  const selection = async (control: Locator, expected: string) => {
    const selected = (await run(() => ui.selectedLabels(control).allTextContents())).map(value => value.trim());
    if (selected.length !== 1 || selected[0] !== expected) throw new OnbaseImportError("selection-read-back-mismatch");
  };
  const importSelections = async () => {
    const form = ui.form(page);
    await selection(ui.documentType(form), ONBASE_DOCUMENT_TYPE);
    await selection(ui.fileType(form), "PDF (.pdf)");
    await selection(ui.keyset(form), "Employee Lookup");
  };
  const keywords = async () => {
    const fields: Record<string, string> = {};
    for (const [key, label, combo] of KEYWORDS) fields[key] = (await run(() => ui.keyword(ui.form(page), label, combo).inputValue({ timeout: CONTROL_MS }))).trim();
    return OnbaseKeywordsSchema.parse(fields);
  };
  const queue = async (target: OnbaseTarget) => {
    const rows = ui.queueRows(ui.viewer(page));
    await run(() => rows.filter({ hasText: fileName(target) }).waitFor({ state: "visible", timeout: CONTROL_MS }));
    if (await run(() => rows.count()) !== 1 || await run(() => ui.queueRemove(ui.viewer(page)).count()) !== 1) throw new OnbaseImportError("upload-queue-not-single-page");
  };
  const driver: OnbaseDriver = {
    system: "onbase",
    bindSourcePage(input, bytes) {
      current(); const target = OnbaseTargetSchema.parse(input);
      if (digest(bytes) !== target.pageSha256) throw new OnbaseImportError("page-digest-mismatch");
      payload = { key: onbaseImportKey(target), bytes: Uint8Array.from(bytes) }; prepared = undefined;
    },
    async read(id) {
      requireApp();
      if (id !== ONBASE_DISPLAYED_EID) throw new OnbaseImportError("observation-not-supported");
      return run(() => ui.keyword(ui.form(page), "UCPath ID").inputValue({ timeout: CONTROL_MS }));
    },
    async prepareImport(input) {
      const target = OnbaseTargetSchema.parse(input), source = payload;
      prepared = undefined;
      if (source === undefined || source.key !== onbaseImportKey(target) || digest(source.bytes) !== target.pageSha256) throw new OnbaseImportError("page-payload-unavailable");
      await open("import");
      const form = ui.form(page), viewer = ui.viewer(page), remove = ui.queueRemove(viewer);
      const leftovers = await run(() => remove.count());
      for (let index = 0; index < leftovers; index++) {
        await run(() => remove.first().click({ timeout: CONTROL_MS }));
        await run(() => remove.nth(leftovers - index - 1).waitFor({ state: "hidden", timeout: CONTROL_MS }));
      }
      if (await run(() => remove.count()) !== 0) throw new OnbaseImportError("upload-queue-not-empty");
      await run(() => ui.documentType(form).selectOption({ label: ONBASE_DOCUMENT_TYPE }, { timeout: CONTROL_MS }));
      await run(() => ui.fileType(form).selectOption({ label: "PDF (.pdf)" }, { timeout: CONTROL_MS }));
      await run(() => ui.keyset(form).selectOption({ label: "Employee Lookup" }, { timeout: CONTROL_MS }));
      await run(() => ui.clearKeywords(form).click({ timeout: CONTROL_MS }));
      for (const [, label, combo] of KEYWORDS) if ((await run(() => ui.keyword(form, label, combo).inputValue({ timeout: CONTROL_MS }))).trim() !== "") throw new OnbaseImportError("keywords-not-cleared");
      await run(() => ui.fileInput(form).setInputFiles({ name: fileName(target), mimeType: "application/pdf", buffer: Buffer.from(source.bytes) }));
      await queue(target);
      await run(() => ui.lookup(form).click({ timeout: CONTROL_MS }));
      const dialog = ui.lookupDialog(page), lookup = ui.lookupForm(page);
      await run(() => dialog.waitFor({ state: "visible", timeout: CONTROL_MS }));
      await run(() => ui.keyword(lookup, "UCPath ID").fill(target.ucpathId, { timeout: CONTROL_MS }));
      await run(() => ui.findEmployee(lookup).click({ timeout: CONTROL_MS }));
      const select = ui.selectEmployee(page);
      await run(() => select.and(ui.enabled(page)).or(ui.noEmployee(page)).first().waitFor({ state: "visible", timeout: 20_000 }));
      if (await run(() => ui.noEmployee(page).isVisible())) throw new OnbaseImportError("employee-keyset-no-match");
      await run(() => select.click({ timeout: CONTROL_MS }));
      await run(() => dialog.waitFor({ state: "hidden", timeout: CONTROL_MS }));
      const lastName = await run(() => ui.keyword(form, "Last Name").elementHandle());
      if (lastName === null) throw new OnbaseImportError("keyset-autofill-unproved");
      try {
        const frame = await run(() => lastName.ownerFrame());
        if (frame === null) throw new OnbaseImportError("keyset-autofill-unproved");
        await run(() => frame.waitForFunction(element => element instanceof HTMLInputElement && element.value.trim().length > 0, lastName, { timeout: CONTROL_MS }));
      } finally { await lastName.dispose(); }
      await run(() => ui.keyword(form, "Document Name").fill(ONBASE_DOCUMENT_NAME, { timeout: CONTROL_MS }));
      const values = await keywords();
      if (values.ucpathId !== target.ucpathId) throw new OnbaseImportError("selected-employee-mismatch");
      await importSelections();
      await queue(target);
      await run(() => ui.importButton(form).and(ui.enabled(form)).waitFor({ state: "visible", timeout: CONTROL_MS }));
      prepared = { key: onbaseImportKey(target), keywords: values };
      recordBrowserAction("typed", "onbase.import.keywords");
      return OnbasePreparedSchema.parse({ stagedPageState: ONBASE_IMPORT_STAGED, observedEid: values.ucpathId, pageSha256: target.pageSha256, keywords: values });
    },
    async commitImport(input, capability) {
      current(); assertMintedMutationCapability(capability); requireApp();
      const target = OnbaseTargetSchema.parse(input), staging = prepared;
      if (staging === undefined || staging.key !== onbaseImportKey(target) || canonicalJsonStringify(await keywords()) !== canonicalJsonStringify(staging.keywords)) throw new OnbaseImportError("staged-form-changed");
      await importSelections();
      await queue(target);
      prepared = undefined;
      await run(() => ui.importButton(ui.form(page)).click({ timeout: CONTROL_MS }));
      recordBrowserAction("clicked", "onbase.import.save");
      return { elementId: ONBASE_IMPORT_BUTTON, effect: "external-commit", performed: true };
    },
    async readSavedImport(input) {
      const target = OnbaseTargetSchema.parse(input);
      const unknown = (reason: string) => OnbaseImportVerdictSchema.parse({ state: "unknown", reason, observedAt: clock.now().toISOString() });
      const queryDigest = sha256Hex(canonicalJsonStringify({ type: ONBASE_DOCUMENT_TYPE, name: ONBASE_DOCUMENT_NAME, ucpathId: target.ucpathId, pageSha256: target.pageSha256 }));
      await open("retrieval");
      const form = ui.form(page), viewer = ui.viewer(page);
      await run(() => ui.retrievalTypes(form).selectOption({ label: ONBASE_DOCUMENT_TYPE }, { timeout: CONTROL_MS }));
      await run(() => ui.clearKeywords(form).click({ timeout: CONTROL_MS }));
      for (const [, label, combo] of KEYWORDS) if ((await run(() => ui.keyword(form, label, combo).inputValue({ timeout: CONTROL_MS }))).trim() !== "") throw new OnbaseImportError("retrieval-keywords-not-cleared");
      await run(() => ui.keyword(form, "UCPath ID").fill(target.ucpathId, { timeout: CONTROL_MS }));
      await run(() => ui.keyword(form, "Document Name").fill(ONBASE_DOCUMENT_NAME, { timeout: CONTROL_MS }));
      const filters = async () => {
        await selection(ui.retrievalTypes(form), ONBASE_DOCUMENT_TYPE);
        for (const [key, label, combo] of KEYWORDS) {
          const expected = key === "ucpathId" ? target.ucpathId : key === "documentName" ? ONBASE_DOCUMENT_NAME : "";
          if ((await run(() => ui.keyword(form, label, combo).inputValue({ timeout: CONTROL_MS }))).trim() !== expected) throw new OnbaseImportError("retrieval-filter-mismatch");
        }
      };
      await filters();
      await run(() => ui.resultCount(viewer).waitFor({ state: "hidden", timeout: CONTROL_MS }));
      await run(() => ui.search(form).click({ timeout: CONTROL_MS }));
      await run(() => ui.resultCount(viewer).waitFor({ state: "visible", timeout: CONTROL_MS }));
      await filters();
      const status = (await run(() => ui.resultCount(viewer).innerText())).trim();
      const total = /^(\d+) documents? found\.?$/iu.exec(status);
      if (total === null || !Number.isSafeInteger(Number(total[1]))) return unknown("retrieval-completeness-unproved");
      const rows = ui.resultRows(viewer);
      const count = await run(() => rows.count());
      if (count !== Number(total[1])) return unknown("retrieval-incomplete");
      const headers = (await run(() => ui.resultHeaders(viewer).allTextContents())).map(value => value.trim());
      const fields = ["Document ID", "Document Type", "UCPath ID", "Document Name"];
      if (fields.some(field => headers.filter(header => header === field).length !== 1)) return unknown("retrieval-columns-unproved");
      const proofs = [];
      const census: string[][] = [], documentIds = new Set<string>();
      for (let index = 0; index < count; index++) {
        const row = rows.nth(index), cells = (await run(() => ui.resultCells(row).allTextContents())).map(value => value.trim());
        census.push(cells);
        const [documentId, documentType, ucpathId, documentName] = fields.map(field => cells[headers.indexOf(field)]);
        if (ucpathId !== target.ucpathId || documentType !== ONBASE_DOCUMENT_TYPE || documentName !== ONBASE_DOCUMENT_NAME || !/^[1-9]\d*$/u.test(documentId ?? "")) throw new OnbaseImportError("retrieval-subject-mismatch");
        if (documentId === undefined || documentIds.has(documentId)) return unknown("retrieval-document-id-duplicated");
        documentIds.add(documentId);
        const href = await run(() => ui.download(row).getAttribute("href"));
        if (href === null) throw new OnbaseImportError("saved-pdf-link-missing");
        const base = requireApp(), url = new URL(href, base);
        if (url.origin !== base.origin || !url.pathname.startsWith("/251ids/") || url.username !== "" || url.password !== "") throw new OnbaseImportError("saved-pdf-link-foreign");
        const response = await run(() => page.context().request.get(url.href, { maxRedirects: 0, timeout: CONTROL_MS }));
        try {
          if (!response.ok() || response.headers()["content-type"]?.split(";")[0]?.trim() !== "application/pdf") throw new OnbaseImportError("saved-pdf-unreadable");
          const bytes = await run(() => response.body());
          if (digest(bytes) === target.pageSha256) proofs.push({ documentId, documentType, documentName, ucpathId, pageSha256: target.pageSha256, source: "retrieval-pdf-read-back" });
        } finally { await response.dispose(); }
      }
      await filters();
      if (await run(() => rows.count()) !== count || (await run(() => ui.resultCount(viewer).innerText())).trim() !== status
        || canonicalJsonStringify((await run(() => ui.resultHeaders(viewer).allTextContents())).map(value => value.trim())) !== canonicalJsonStringify(headers)) return unknown("retrieval-changed");
      for (let index = 0; index < count; index++) if (canonicalJsonStringify((await run(() => ui.resultCells(rows.nth(index)).allTextContents())).map(value => value.trim())) !== canonicalJsonStringify(census[index])) return unknown("retrieval-changed");
      const observedAt = clock.now().toISOString();
      if (proofs.length > 1) return OnbaseImportVerdictSchema.parse({ state: "ambiguous", matches: proofs.length, observedAt, queryDigest,
        evidence: proofs.map(() => `observation:${randomUUID()}`) });
      if (proofs.length === 1) return OnbaseImportVerdictSchema.parse({ state: "present", proof: proofs[0] });
      recordBrowserAction("read", "onbase.retrieval.pdf");
      return OnbaseImportVerdictSchema.parse({ state: "absent", evidence: { idempotencyKeyDigest: deriveIdempotencyKeyDigest("onbase", onbaseImportKey(target)),
        source: "onbase.retrieval.saved-document", sourceState: "onbase.retrieval.complete", observedAt, queryDigest, evidenceRef: `observation:${randomUUID()}` } });
    },
  };
  return Object.freeze(driver);
}
