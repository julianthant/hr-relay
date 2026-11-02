import assert from "node:assert/strict";
import type { Page } from "playwright";
import { afterEach, describe, it, vi } from "vitest";
import { downloadSharePointWorkbook, parseSharePointWorkbookLink, SharePointDownloadError } from "../../../../src/backend/systems/sharepoint/download.js";
import { BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { createSystemSessionTestWorld } from "../../../support/helpers/backend/system-session-world.js";

const { CONFIG, contextFor } = createSystemSessionTestWorld();
const ORIGIN = CONFIG.urls.sharepoint.prod.entry;
const SITE = `${ORIGIN}/sites/Personnel`;
const LINK = `${SITE}/Shared%20Documents/Book.xlsx`;
const GUID = "11111111-1111-4111-8111-111111111111";
const SSO = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
const MICROSOFT = "https://login.microsoftonline.com/common/login";
const payload = new Uint8Array([80, 75, 3]);

afterEach(() => { vi.unstubAllGlobals(); });

interface Options {
  cold?: boolean;
  directSso?: boolean;
  ssoUrl?: string;
  identity?: unknown;
  metadata?: unknown;
  chunks?: readonly Uint8Array[];
  media?: string;
  status?: number;
  length?: string;
  signal?: AbortSignal;
  cancelFails?: boolean;
  disposeFails?: boolean;
  onFileRead?: () => void;
  identityAfterMetadata?: unknown;
  formValid?: boolean;
  fileName?: "Book.xlsx" | "Book.csv";
  poison?: "method" | "target" | "button-action" | "button-method" | "button-target" | "duplicate" | "replacement";
  assertCurrent?: () => void;
}

async function world(options: Options = {}) {
  const sso = options.ssoUrl ?? SSO;
  const original = await contextFor({
    url: options.cold ? "about:blank" : SITE,
    navigation: { [SITE]: options.directSso ? sso : MICROSOFT },
    elements: { "sso-username": {}, "sso-password": {}, "sso-submit": { navigatesTo: SITE } },
    settlesTo: options.directSso ? [SITE] : [sso, SITE],
  }, options.signal, "sharepoint");
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const cleanup: string[] = [];
  const chunkCounts: number[] = [];
  let metadataRead = false, scopes = 0, controllerCount = 0;
  const identity = { Id: 7, LoginName: "i:0#.f|membership|fixture-user@ucsd.edu" };
  vi.stubGlobal("location", { get origin() { return URL.parse(original.harness.url())?.origin; },
    get pathname() { return URL.parse(original.harness.url())?.pathname; } });
  const document = {};
  const form = { get action() { return options.formValid === false ? "https://elsewhere.invalid/" : original.harness.url(); },
    method: options.poison === "method" ? "get" : "post", target: options.poison === "target" ? "_blank" : "" };
  class InputElement {
    readonly form = form;
    readonly ownerDocument = document;
    isConnected = true;
    constructor(readonly type: string) {}
  }
  class ButtonElement {
    readonly form = form;
    readonly ownerDocument = document;
    readonly isConnected = true;
    readonly type = "submit";
    readonly formTarget = options.poison === "button-target" ? "_blank" : "";
    readonly formMethod = options.poison === "button-method" ? "get" : "";
    get formAction() { return options.poison === "button-action" ? "https://elsewhere.invalid/" : form.action; }
  }
  const userElement = new InputElement("text"), secretElement = new InputElement("password"), buttonElement = new ButtonElement();
  vi.stubGlobal("document", document); vi.stubGlobal("HTMLInputElement", InputElement); vi.stubGlobal("HTMLButtonElement", ButtonElement);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    const file = url.endsWith("/$value"), metadata = url.includes("GetFileByServerRelativePath");
    const value = metadata ? options.metadata ?? { UniqueId: GUID, Name: options.fileName ?? "Book.xlsx", Length: 3 }
      : metadataRead && options.identityAfterMetadata !== undefined ? options.identityAfterMetadata : options.identity ?? identity;
    if (metadata) metadataRead = true;
    const parts = file ? options.chunks ?? [payload] : [new TextEncoder().encode(JSON.stringify(value))];
    let index = 0;
    return {
      status: file ? options.status ?? 200 : 200, redirected: false, url,
      headers: new Headers({ "content-type": file ? options.media ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json",
        ...(file && options.length !== undefined ? { "content-length": options.length } : {}) }),
      body: { getReader: () => ({
        async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
          if (file) options.onFileRead?.();
          init.signal?.throwIfAborted();
          const part = parts[index++];
          return part === undefined ? { done: true, value: undefined } : { done: false, value: part };
        },
        async cancel() { cleanup.push(file ? "file-cancel" : "json-cancel"); if (options.cancelFails && file) throw new Error("private response body"); },
        releaseLock() { cleanup.push(file ? "file-release" : "json-release"); },
      }) },
    };
  });
  const page = {
    ...original.context.page,
    locator(selector: string) {
      if (selector.startsWith('input[type="password"]')) return { count: async () => original.harness.url() === SITE ? 0 : 1 };
      if (selector === 'input[name="loginfmt"]') return {
        count: async () => 1, fill: async (value: string) => { assert.equal(value, "fixture-user@ucsd.edu"); cleanup.push("realm-fill"); },
      };
      if (selector === '#idSIButton9') return { click: async () => { await original.context.page.goto(sso); } };
      if (selector.includes("ssousername") || selector.includes("ssopassword") || selector.includes("_eventId_proceed")) {
        const underlying = original.context.page.locator(selector);
        const element = selector.includes("ssousername") ? userElement : selector.includes("ssopassword") ? secretElement : buttonElement;
        return { ...underlying, first: () => underlying,
          count: async () => options.poison === "duplicate" && element === userElement ? 2 : 1,
          elementHandle: async () => ({ element, isVisible: async () => true, isEditable: async () => true, isEnabled: async () => true,
            async evaluate(callback: (element: unknown, input: unknown) => unknown,
              input: { other: { element: unknown }; submit: { element: unknown }; path: string }) {
              return callback(element, { other: input.other.element, submit: input.submit.element, path: input.path });
            },
            async fill(value: string) {
              await underlying.fill(value);
              if (options.poison === "replacement" && element === userElement) userElement.isConnected = false;
            },
            click: () => underlying.click(), dispose: async () => { cleanup.push("sso-disposed"); },
          }),
        };
      }
      return original.context.page.locator(selector);
    },
    async evaluateHandle() {
      controllerCount++;
      const controller = new AbortController();
      return { controller,
        async evaluate(callback: (value: AbortController) => void) { callback(controller); await Promise.resolve(); cleanup.push("abort-settled"); },
        async dispose() { cleanup.push("disposed"); if (options.disposeFails) throw new Error("private handle location"); },
      };
    },
    async evaluate(callback: (value: unknown) => unknown, argument?: { controller: { controller: AbortController } }) {
      const result: unknown = await callback(argument === undefined ? undefined : { ...argument, controller: argument.controller.controller });
      if (typeof result === "object" && result !== null && "chunks" in result && Array.isArray(result.chunks)) chunkCounts.push(result.chunks.length);
      return result;
    },
  } as unknown as Page;
  const assertCurrent = options.assertCurrent ?? original.context.assertCurrent;
  return { context: { ...original.context, page, assertCurrent, withDuoSigningScope: async <T>(_token: unknown, run: () => Promise<T>) => { scopes++; return run(); } },
    requests, cleanup, chunkCounts, original, scopes: () => scopes, controllers: () => controllerCount,
    download: () => downloadSharePointWorkbook({ ...original.context, page, assertCurrent,
      withDuoSigningScope: async <T>(_token: unknown, run: () => Promise<T>) => { scopes++; return run(); },
    }, parseSharePointWorkbookLink(options.fileName === "Book.csv" ? LINK.replace("Book.xlsx", "Book.csv") : LINK, ORIGIN)) };
}

describe("canonical SharePoint workbook links", () => {
  it("decodes ResourcePath once, preserving percent, hash, apostrophes and site case", () => {
    const target = parseSharePointWorkbookLink(`${SITE}/Shared%20Documents/100%25%23O'Brien.xlsx`, ORIGIN);
    assert.equal(target.siteUrl, SITE);
    assert.equal(target.serverRelativePath, "/sites/Personnel/Shared Documents/100%#O'Brien.xlsx");
    assert.equal(new URL(target.metadataUrl).searchParams.get("@path"), "'/sites/Personnel/Shared Documents/100%#O''Brien.xlsx'");
    assert.equal(Object.isFrozen(target), true);
    assert.equal(parseSharePointWorkbookLink(`${ORIGIN}/Library/Book.csv`, ORIGIN).siteUrl, ORIGIN);
    assert.equal(parseSharePointWorkbookLink(`${ORIGIN}/teams/Team/Library/Book.xlsx`, ORIGIN).siteUrl, `${ORIGIN}/teams/Team`);
    assert.equal(parseSharePointWorkbookLink(LINK, SITE).siteUrl, SITE);
  });

  it.each([
    "https://other.sharepoint.com/Book.xlsx", "http://ucsdcloud.sharepoint.com/Book.xlsx", `${ORIGIN}:443/Book.xlsx`,
    "https://user:secret@ucsdcloud.sharepoint.com/Book.xlsx", `${LINK}?web=1`, `${LINK}#sheet`,
    `${ORIGIN}/:x:/s/Team/Book.xlsx`, `${ORIGIN}/_layouts/15/Doc.aspx`, `${ORIGIN}/guestaccess/Book.xlsx`,
    `${SITE}/../Library/Book.xlsx`, `${SITE}/%2e%2e/Book.xlsx`, `${SITE}/Library%2fBook.xlsx`, `${SITE}/Bad%zz.xlsx`,
  ])("refuses unsupported URL before browser or secret access: %s", link => {
    assert.throws(() => parseSharePointWorkbookLink(link, ORIGIN), { code: "SHAREPOINT_LINK_UNSUPPORTED" });
  });
});

describe("authenticated SharePoint downloads", () => {
  it("reverifies warm identity and downloads GUID-pinned bytes using only same-origin browser fetch", async () => {
    const f = await world();
    const result = await f.download();
    assert.equal(result.name, "Book.xlsx"); assert.deepEqual(new Uint8Array(result.bytes), payload);
    assert.equal(f.requests.filter(request => request.url.includes("currentuser")).length, 3);
    assert.equal(f.requests.at(-1)?.url, `${SITE}/_api/web/GetFileById('${GUID}')/$value`);
    for (const request of f.requests) {
      assert.equal(request.init.credentials, "same-origin"); assert.equal(request.init.mode, "same-origin");
      assert.equal(request.init.redirect, "error"); assert.equal(request.init.cache, "no-store");
      assert.equal(new URL(request.url).origin, ORIGIN);
    }
    assert.equal(f.scopes(), 0); assert.deepEqual(f.original.harness.filled(), []);
    assert.equal(f.cleanup.filter(value => value === "disposed").length, f.controllers());
    assert.ok(f.cleanup.includes("file-cancel")); assert.ok(f.cleanup.includes("file-release"));
    for (const evidence of f.original.evidence()) {
      assert.equal(evidence.url, ORIGIN); assert.equal(JSON.stringify(evidence).includes("fixture-user"), false);
    }
  });

  it("uses the real opaque Duo gate and shared UCSD helpers after the Microsoft realm step", async () => {
    const f = await world({ cold: true });
    await f.download();
    assert.equal(f.scopes(), 1); assert.ok(f.cleanup.includes("realm-fill"));
    assert.equal(f.original.harness.filled().length, 2);
    assert.ok(f.original.harness.actions().includes("click:sso-submit"));
  });

  it("accepts a plain exact account identity and bounded CSV media", async () => {
    const f = await world({ fileName: "Book.csv", media: "text/plain", identity: { Id: 7, LoginName: "fixture-user@ucsd.edu" },
      chunks: [new TextEncoder().encode("a,b")] });
    const result = await f.download();
    assert.equal(result.name, "Book.csv"); assert.equal(new TextDecoder().decode(result.bytes), "a,b");
  });

  it("refuses a wrong warm identity without navigation or credential effects", async () => {
    const f = await world({ identity: { Id: 7, LoginName: "other@ucsd.edu" } });
    await assert.rejects(f.download(), BrowserLoginError);
    assert.equal(f.scopes(), 0); assert.deepEqual(f.original.harness.actions(), []); assert.deepEqual(f.original.harness.filled(), []);
  });

  it.each(["https://a5.ucsd.edu.evil.test/tritON/profile/SAML2/Redirect/SSO", "https://a5.ucsd.edu/unapproved"])(
    "refuses an unpinned SSO origin/path before password entry: %s", async ssoUrl => {
      const f = await world({ cold: true, directSso: true, ssoUrl });
      await assert.rejects(f.download(), BrowserLoginError);
      assert.deepEqual(f.original.harness.filled(), []);
    },
  );

  it("refuses an unexpected SSO form action before entering credentials", async () => {
    const f = await world({ cold: true, directSso: true, formValid: false });
    await assert.rejects(f.download(), BrowserLoginError);
    assert.deepEqual(f.original.harness.filled(), []);
  });

  it.each(["method", "target", "button-action", "button-method", "button-target", "duplicate", "replacement"] as const)(
    "refuses poisoned pinned SSO controls: %s", async poison => {
      const f = await world({ cold: true, directSso: true, poison });
      await assert.rejects(f.download(), BrowserLoginError);
      assert.equal(f.original.harness.filled().some(value => value.startsWith("sso-password=")), false);
      assert.equal(f.original.harness.actions().includes("click:sso-submit"), false);
      if (poison !== "replacement") assert.deepEqual(f.original.harness.filled(), []);
    },
  );

  it.each([
    { Id: 0, LoginName: "fixture-user@ucsd.edu" }, { Id: 7, LoginName: "other@ucsd.edu" },
    { Id: 7, LoginName: "evil|fixture-user@ucsd.edu" }, { Id: 7, LoginName: "fixture-user@ucsd.edu.evil.test" },
  ])("refuses positive HTTP without exact configured identity: %j", async identity => {
    const f = await world({ identityAfterMetadata: identity });
    await assert.rejects(f.download(), BrowserLoginError);
    assert.equal(f.requests.some(request => request.url.endsWith("/$value")), false);
  });

  it("refuses copied targets and changed tenant configuration before evaluation", async () => {
    const f = await world(), target = parseSharePointWorkbookLink(LINK, ORIGIN);
    await assert.rejects(downloadSharePointWorkbook(f.context, { ...target }), { code: "SHAREPOINT_LINK_UNSUPPORTED" });
    await assert.rejects(downloadSharePointWorkbook({ ...f.context, config: { ...CONFIG,
      urls: { ...CONFIG.urls, sharepoint: { prod: { entry: "https://other.sharepoint.com" } } } } }, target), { code: "SHAREPOINT_LINK_UNSUPPORTED" });
    assert.equal(f.controllers(), 0);
  });
});

describe("bounded streaming and cleanup", () => {
  it("packs many tiny incoming chunks into bounded fixed-size return chunks", async () => {
    const f = await world({ chunks: Array.from({ length: 1024 }, () => new Uint8Array([65])),
      metadata: { UniqueId: GUID, Name: "Book.xlsx", Length: 1024 } });
    assert.equal((await f.download()).bytes.byteLength, 1024);
    assert.equal(f.chunkCounts.at(-1), 1);
  });

  it.each([
    { UniqueId: "foreign/file", Name: "Book.xlsx", Length: 3 }, { UniqueId: GUID, Name: "Other.xlsx", Length: 3 },
    { UniqueId: GUID, Name: "Book.xlsx", Length: 0 }, { UniqueId: GUID, Name: "Book.xlsx", Length: "3.5" },
    { UniqueId: GUID, Name: "Book.xlsx", Length: 20 * 1024 * 1024 + 1 },
  ])("refuses unproved file metadata without requesting bytes: %j", async metadata => {
    const f = await world({ metadata });
    await assert.rejects(f.download(), SharePointDownloadError);
    assert.equal(f.requests.some(request => request.url.endsWith("/$value")), false);
  });

  it.each([undefined, "3"])("caps decoded bytes even with absent/dishonest Content-Length %s", async length => {
    const f = await world({ length, chunks: [new Uint8Array(20 * 1024 * 1024), new Uint8Array(1)] });
    await assert.rejects(f.download(), { code: "SHAREPOINT_DOWNLOAD_TOO_LARGE" });
    assert.ok(f.cleanup.includes("file-cancel")); assert.ok(f.cleanup.includes("file-release"));
  });

  it("refuses a huge advertised length before reading and rejects truncated metadata length", async () => {
    const large = await world({ length: String(20 * 1024 * 1024 + 1), onFileRead: () => { throw new Error("must not read"); } });
    await assert.rejects(large.download(), { code: "SHAREPOINT_DOWNLOAD_TOO_LARGE" });
    const truncated = await world({ chunks: [new Uint8Array([80])] });
    await assert.rejects(truncated.download(), { code: "SHAREPOINT_DOWNLOAD_FAILED" });
  });

  it.each([
    { media: "text/html" }, { chunks: [new TextEncoder().encode("<html>sign in</html>")] },
    { status: 302 }, { chunks: [] },
  ])("refuses login HTML, redirects, non-workbook media and empty content: %j", async options => {
    const f = await world(options);
    await assert.rejects(f.download(), SharePointDownloadError);
    assert.ok(f.cleanup.includes("file-cancel")); assert.ok(f.cleanup.includes("file-release"));
  });

  it("bounds JSON probes and never advances a failed identity probe to file bytes", async () => {
    const f = await world({ identity: { Id: 7, LoginName: "x".repeat(64 * 1024) } });
    await assert.rejects(f.download(), BrowserLoginError);
    assert.equal(f.requests.some(request => request.url.endsWith("/$value")), false);
  });

  it("awaits cancellation and handle cleanup before returning failure", async () => {
    const cancellation = new AbortController();
    const f = await world({ signal: cancellation.signal, onFileRead: () => cancellation.abort() });
    await assert.rejects(f.download(), error => error === cancellation.signal.reason);
    assert.ok(f.cleanup.includes("abort-settled")); assert.ok(f.cleanup.includes("file-release"));
    assert.equal(f.cleanup.at(-1), "disposed");
  });

  it("preserves currentness refusal after transfer while completing resource cleanup", async () => {
    let current = true;
    const refusal = new Error("fixture authority revoked");
    const f = await world({ assertCurrent: () => { if (!current) throw refusal; }, onFileRead: () => { current = false; } });
    await assert.rejects(f.download(), error => error === refusal);
    assert.ok(f.cleanup.includes("file-release")); assert.equal(f.cleanup.at(-1), "disposed");
  });

  it("aggregates primary and reader cleanup failures without diagnostic private data", async () => {
    const f = await world({ media: "text/html", cancelFails: true });
    await assert.rejects(f.download(), (error: unknown) => {
      assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 2);
      assert.equal(String(error).includes("private response body"), false);
      assert.equal(JSON.stringify(error).includes("Book.xlsx"), false);
      return true;
    });
    assert.ok(f.cleanup.includes("file-release")); assert.equal(f.cleanup.at(-1), "disposed");
  });

  it("fails loud on handle disposal without retrying login", async () => {
    const f = await world({ disposeFails: true });
    await assert.rejects(f.download(), AggregateError);
    assert.equal(f.controllers(), 1); assert.deepEqual(f.original.harness.actions(), []);
  });
});
