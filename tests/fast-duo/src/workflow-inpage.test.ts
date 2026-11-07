import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it } from "vitest";

function world() {
  const origin = "https://test.duosecurity.com";
  let receive: ((event: unknown) => void) | undefined;
  const posted: { type: string; id: string }[] = [];
  const timers = new Map<number, () => void>();
  let timer = 0, nativeCalls = 0;
  const credentials = { get: async (_options: unknown): Promise<unknown> => { nativeCalls++; return { native: true }; } };
  const scope: Record<string, unknown> = { navigator: { credentials }, location: { origin, hostname: "test.duosecurity.com" },
    crypto: { randomUUID }, btoa, atob, DOMException, ArrayBuffer, Uint8Array,
    PublicKeyCredential: class {}, AuthenticatorAssertionResponse: class {},
    addEventListener: (_type: string, handler: (event: unknown) => void) => { receive = handler; },
    postMessage: (message: { type: string; id: string }) => { posted.push(message); },
    setTimeout: (callback: () => void) => { timers.set(++timer, callback); return timer; },
    clearTimeout: (id: number) => { timers.delete(id); },
  };
  scope.window = scope;
  const actualWindow: unknown = runInNewContext(`${readFileSync("fast-duo/src/workflow-inpage.js", "utf8")}\n;window;`, scope);
  const options = (signal?: AbortSignal) => ({ publicKey: { rpId: "duosecurity.com", challenge: new Uint8Array([1, 2, 3]) }, ...(signal ? { signal } : {}) });
  const reply = (success: boolean, result?: unknown, replyOrigin = origin) => {
    const request = posted.find(message => message.type === "DUO_WORKFLOW_REQUEST"); assert.ok(request);
    receive?.({ source: actualWindow, origin: replyOrigin, data: { type: "DUO_WORKFLOW_RESPONSE", id: request.id, success, result } });
  };
  return { credentials, options, reply, posted, timers, nativeCalls: () => nativeCalls };
}

describe("workflow WebAuthn adapter", () => {
  it("uses the original method only for non-Duo requests and explicit valid pass-through", async () => {
    const w = world();
    assert.deepEqual(await w.credentials.get({ publicKey: { rpId: "other.invalid" } }), { native: true });
    const result = w.credentials.get(w.options()); w.reply(true, { passThrough: true });
    assert.deepEqual(await result, { native: true }); assert.equal(w.nativeCalls(), 2);
  });
  it("rejects broker refusal and malformed signing replies without native retry", async () => {
    for (const success of [false, true]) {
      const w = world(); const result = w.credentials.get(w.options()); const rejected = assert.rejects(result, DOMException);
      w.reply(success, { ok: false }); await rejected; assert.equal(w.nativeCalls(), 0);
    }
  });
  it("aborts pending work and ignores a late pass-through assertion", async () => {
    const w = world(), controller = new AbortController();
    const result = w.credentials.get(w.options(controller.signal)); const rejected = assert.rejects(result, { name: "AbortError" });
    controller.abort(); await rejected; w.reply(true, { passThrough: true });
    assert.equal(w.nativeCalls(), 0); assert.equal(w.timers.size, 0);
    assert.equal(w.posted.at(-1)?.type, "DUO_WORKFLOW_ABORT");
  });
  it("rejects timeout and ignores late replies and a foreign response origin", async () => {
    const w = world(); const result = w.credentials.get(w.options()); const rejected = assert.rejects(result, { name: "NotAllowedError" });
    w.reply(true, { passThrough: true }, "https://evil.invalid");
    assert.equal(w.nativeCalls(), 0);
    const expire = w.timers.values().next().value; assert.ok(expire); expire(); await rejected;
    w.reply(true, { passThrough: true }); assert.equal(w.nativeCalls(), 0);
  });
  it("refuses an already-aborted request before posting anything", async () => {
    const w = world(), controller = new AbortController(); controller.abort();
    await assert.rejects(w.credentials.get(w.options(controller.signal)), { name: "AbortError" });
    assert.deepEqual(w.posted, []); assert.equal(w.nativeCalls(), 0);
  });
});
