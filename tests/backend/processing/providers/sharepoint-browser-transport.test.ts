import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { it } from "vitest";
import { sharePointBrowserTransport } from "../../../../src/backend/processing/providers/sharepoint-browser-transport.js";
import type { SharePointBrowserTransferInput, SharePointBrowserTransferResult } from "../../../../src/models/systems/sharepoint/workbook-download.js";

const origin = "https://tenant.sharepoint.com";

function isTransferResult(value: unknown): value is SharePointBrowserTransferResult {
  return typeof value === "object" && value !== null && "chunks" in value && Array.isArray(value.chunks)
    && value.chunks.every((chunk: unknown) => typeof chunk === "string")
    && "failed" in value && typeof value.failed === "boolean" && "tooLarge" in value && typeof value.tooLarge === "boolean"
    && "cleanupFailed" in value && typeof value.cleanupFailed === "boolean";
}

async function serializedTransfer(kind: SharePointBrowserTransferInput["kind"], parts: readonly Uint8Array[], limit: number) {
  let index = 0, cancelled = 0, released = 0, requested = 0;
  const input: SharePointBrowserTransferInput = { origin, url: `${origin}/_api/web/file`, controller: new AbortController(), kind, limit };
  const result: unknown = await runInNewContext(`(${sharePointBrowserTransport.toString()})(input)`, {
    input, location: { origin }, URL, Uint8Array, TextDecoder, btoa,
    fetch: async (url: string, options: RequestInit) => {
      requested++;
      assert.equal(url, input.url);
      assert.equal(options.credentials, "same-origin"); assert.equal(options.mode, "same-origin");
      assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
      return { status: 200, redirected: false, url,
        headers: new Headers({ "content-type": kind === "json" ? "application/json" : "application/octet-stream" }),
        body: { getReader: () => ({
          read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
            const value = parts[index++];
            return value === undefined ? { done: true, value: undefined } : { done: false, value };
          },
          cancel: async () => { cancelled++; }, releaseLock: () => { released++; },
        }) },
      };
    },
  });
  assert.ok(isTransferResult(result));
  return { result, requested, cancelled, released };
}

it("executes JSON proof transport after serialization with only browser globals", async () => {
  const bytes = new TextEncoder().encode('{"Id":7}');
  const transfer = await serializedTransfer("json", [bytes], 64 * 1024);
  assert.equal(transfer.result.failed, false); assert.equal(transfer.result.cleanupFailed, false);
  assert.equal(Buffer.from(transfer.result.chunks[0], "base64").toString("utf8"), '{"Id":7}');
  assert.equal(transfer.requested, 1); assert.equal(transfer.cancelled, 1); assert.equal(transfer.released, 1);
});

it("executes binary packing after serialization and refuses the decoded cap without losing reader cleanup", async () => {
  const parts = Array.from({ length: 1024 }, () => new Uint8Array([80]));
  const bounded = await serializedTransfer("xlsx", parts, 1024);
  assert.equal(bounded.result.failed, false); assert.equal(bounded.result.chunks.length, 1);
  assert.equal(Buffer.from(bounded.result.chunks[0], "base64").byteLength, 1024);
  const overflow = await serializedTransfer("xlsx", parts, 1023);
  assert.equal(overflow.result.failed, true); assert.equal(overflow.result.tooLarge, true);
  assert.equal(overflow.result.chunks.length, 0); assert.equal(overflow.cancelled, 1); assert.equal(overflow.released, 1);
});
