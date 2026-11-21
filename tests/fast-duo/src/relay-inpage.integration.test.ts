import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("cancels an unanswered setup get and ignores a late pass-through reply", async () => {
  const origin = "https://test.duosecurity.com";
  const listeners: ((event: unknown) => void)[] = [];
  const nativeGet = vi.fn(async (_options: unknown) => ({ native: true }));
  const credentials = { get: nativeGet, create: vi.fn() };
  const signing = Promise.withResolvers<unknown>();
  const deadline = vi.fn((_callback: () => void, _delay: number) => 1);
  const sendMessage = vi.fn(async (message: { type: string }) =>
    message.type === "DUO_AUTOPILOT_SIGN" ? signing.promise : { success: true });
  const scope = {
    navigator: { credentials }, location: { origin, href: origin, hostname: "test.duosecurity.com" },
    crypto: { randomUUID }, document: { documentElement: {} }, MutationObserver: class { observe() {} },
    DOMException, AbortController, Uint8Array, btoa, atob,
    DuoUsername: { findUsernames: () => [] },
    chrome: { runtime: { id: "owned", onMessage: { addListener() {} }, sendMessage } },
    addEventListener: (type: string, handler: (event: unknown) => void) => { if (type === "message") listeners.push(handler); },
    setTimeout: deadline, clearTimeout: vi.fn(),
    postMessage(data: unknown) {
      queueMicrotask(() => { for (const listener of listeners) listener({ source: window, origin, data }); });
    },
  };
  const context = createContext(scope);
  const window: unknown = runInContext("globalThis.window = globalThis", context);
  for (const file of ["relay-inpage.js", "relay-content.js"]) {
    runInContext(readFileSync(`fast-duo/src/${file}`, "utf8"), context);
  }
  const result = credentials.get({ publicKey: { rpId: "duosecurity.com", challenge: new Uint8Array([1]) } });
  await Promise.resolve();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "DUO_AUTOPILOT_SIGN" }));
  expect(deadline).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 15_000);
  const expire = deadline.mock.calls[0]?.[0];
  if (!expire) throw new Error("Setup request has no deadline");
  expire();
  await expect(result).rejects.toMatchObject({ name: "NotAllowedError" });
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "RELAY_ENROLLMENT_FAILED", request: expect.objectContaining({ reason: "timed-out" }),
  }));
  signing.resolve({ success: true, result: { passThrough: true } });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(nativeGet).not.toHaveBeenCalled();
});
