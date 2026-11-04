import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { it } from "vitest";

const origin = "https://portal.duosecurity.com";

function world() {
  let headings: { textContent: string; getClientRects: () => object[] }[] = [];
  let mutation: () => void = () => { throw new Error("observer not installed"); };
  let onMessage: ((event: unknown) => Promise<void>) | undefined;
  const accepted: string[] = [];
  const replies: { type: string; success?: boolean }[] = [];
  const scope: Record<string, unknown> = {
    AbortController,
    document: { documentElement: {}, querySelectorAll: () => headings },
    location: { href: `${origin}/frame/device-management/portal`, origin },
    DuoUsername: { findUsernames: () => ["alex"] },
    RelayNative: { create: async () => ({ credentialId: "touch-credential", attachment: "platform" }) },
    MutationObserver: class {
      constructor(callback: () => void) { mutation = callback; }
      observe() {}
    },
    addEventListener(type: string, listener: (event: unknown) => Promise<void>) { if (type === "message") onMessage = listener; },
    postMessage(message: { type: string; success?: boolean }) { replies.push(message); },
    chrome: { runtime: { id: "owned", onMessage: { addListener() {} }, sendMessage: async (message: { type: string; request?: { requestId: string; method?: string } }) => {
      if (message.type === "DUO_AUTOPILOT_ENROLL") {
        return { success: true, result: message.request?.requestId === "touch-request" ? { native: true } : { ok: true } };
      }
      if (message.type === "RELAY_PORTAL_ACCEPTED" && message.request) accepted.push(message.request.requestId);
      return { success: true };
    } } },
  };
  scope.window = scope;
  createContext(scope);
  runInContext(readFileSync("fast-duo/src/relay-content.js", "utf8"), scope);
  const pageWindow: unknown = runInContext("window", scope);
  const settled = () => new Promise(resolve => { setImmediate(resolve); });
  return {
    accepted,
    replies,
    async enroll(requestId: string) {
      assert.ok(onMessage);
      await onMessage({ source: pageWindow, origin, data: { type: "RELAY_DUO_REQUEST", id: requestId, operation: "DUO_AUTOPILOT_ENROLL",
        request: { requestId, rpId: "duosecurity.com" } } });
      await settled();
    },
    async show(text: string | undefined) {
      headings = text === undefined ? [] : [{ textContent: text, getClientRects: () => [{}] }];
      mutation();
      await settled();
    },
  };
}

it("reports Duo's success heading for each method added on the same portal page", async () => {
  const w = world();
  await w.enroll("key-request");
  await w.show("Added security key");
  assert.deepEqual(w.accepted, ["key-request"]);
  await w.show(undefined);

  await w.enroll("touch-request");
  await w.show("Added Touch ID");
  await w.show("Added Touch ID");
  assert.deepEqual(w.accepted, ["key-request", "touch-request"]);
  assert.equal(w.replies.some(reply => reply.type === "RELAY_DUO_UNCERTAIN"), false);
});

it("does not credit a re-rendered old heading to a retry of the same method", async () => {
  const w = world();
  await w.enroll("first-key-request");
  await w.show("Added security key");
  assert.deepEqual(w.accepted, ["first-key-request"]);

  await w.enroll("second-key-request");
  await w.show("Added security key");
  assert.deepEqual(w.accepted, ["first-key-request"]);
  assert.equal(w.replies.some(reply => reply.type === "RELAY_DUO_UNCERTAIN"), false);
});
