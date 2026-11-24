import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

type Listener = (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => void;
const origin = "https://test.duosecurity.com", url = `${origin}/frame`;
const sender = { id: "owned", url, origin, tab: { id: 7 }, frameId: 0, documentId: "a".repeat(32), documentLifecycle: "active" };

async function broker(copy?: boolean) {
  let listener: Listener | undefined;
  const document = { url, origin, documentActive: true };
  vi.stubGlobal("chrome", {
    runtime: { id: "owned", getURL: (path: string) => `chrome-extension://owned/${path}`, onMessage: { addListener: (handler: Listener) => { listener = handler; } } },
    storage: { session: { setAccessLevel: async () => undefined } },
    windows: { create: async () => ({ id: 1, tabs: [{ id: 2 }] }), onRemoved: { addListener() {} } },
    tabs: { get: async () => ({ id: 7, url }), sendMessage: async () => ({ ...document }), onRemoved: { addListener() {} } },
  });
  vi.resetModules();
  await import(`${pathToFileURL(resolve("fast-duo/src/relay-background.js")).href}?${randomUUID()}`);
  const owner = Reflect.get(globalThis, "relayOnboarding") as { browserInstall(token: string, copy?: boolean): Promise<unknown> };
  await (copy === undefined ? owner.browserInstall(randomUUID()) : owner.browserInstall(randomUUID(), copy));
  if (!listener) throw new Error("broker has no message listener");
  const send = listener;
  return (message: unknown) => new Promise(done => { send(message, sender, done); });
}
const sign = { type: "DUO_AUTOPILOT_SIGN", request: { rpId: "duosecurity.com", origin, requestId: randomUUID(), challenge: "AQ", allowCredentials: [] } };

afterEach(() => { vi.unstubAllGlobals(); });

it("hands an unarmed Duo get back to the browser in ordinary Open Duo", async () => {
  const receive = await broker();
  await expect(receive(sign)).resolves.toEqual({ success: true, result: { passThrough: true } });
});

it("refuses an unarmed Duo get in copy setup instead of handing it to a native prompt", async () => {
  const receive = await broker(true);
  await expect(receive(sign)).resolves.toEqual({ success: true, result: { ok: false } });
});
