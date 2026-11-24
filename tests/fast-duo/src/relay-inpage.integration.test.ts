import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { expect, it, vi } from "vitest";

function bridge(replies: Record<string, unknown> = {}) {
  const origin = "https://test.duosecurity.com";
  const listeners: ((event: unknown) => void)[] = [];
  const nativeGet = vi.fn(async (_options: unknown) => ({ native: true }));
  const nativeCreate = vi.fn(async (_options: unknown) => ({ native: true }));
  const credentials = { get: nativeGet, create: nativeCreate };
  const deadline = vi.fn((_callback: () => void, _delay: number) => 1);
  const sendMessage = vi.fn(async (message: { type: string }) =>
    message.type in replies ? replies[message.type] : { success: true });
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
  return { credentials, nativeGet, nativeCreate, sendMessage, deadline };
}

it("cancels an unanswered setup get and ignores a late pass-through reply", async () => {
  const signing = Promise.withResolvers<unknown>();
  const { credentials, nativeGet, sendMessage, deadline } = bridge({ DUO_AUTOPILOT_SIGN: signing.promise });
  const result = credentials.get({ publicKey: { rpId: "duosecurity.com", challenge: new Uint8Array([1]) } });
  await Promise.resolve();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "DUO_AUTOPILOT_SIGN" }));
  expect(deadline).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 15_000);
  const expire = deadline.mock.calls[0]?.[0];
  if (!expire) throw new Error("Setup request has no deadline");
  expire();
  await expect(result).rejects.toMatchObject({ name: "NotAllowedError" });
  const timedOutRequest: unknown = expect.objectContaining({ reason: "timed-out" });
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "RELAY_ENROLLMENT_FAILED", request: timedOutRequest,
  }));
  signing.resolve({ success: true, result: { passThrough: true } });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(nativeGet).not.toHaveBeenCalled();
});

it("passes an unarmed Duo get to the browser in ordinary Open Duo", async () => {
  const { credentials, nativeGet } = bridge({ DUO_AUTOPILOT_SIGN: { success: true, result: { passThrough: true } } });
  await expect(credentials.get({ publicKey: { rpId: "duosecurity.com", challenge: new Uint8Array([1]) } })).resolves.toEqual({ native: true });
  expect(nativeGet).toHaveBeenCalledOnce();
});

it.each([
  { name: "a Duo get the copy-setup broker refuses", call: (c: Credentials) => c.get({ publicKey: { rpId: "duosecurity.com", challenge: new Uint8Array([1]) } }) },
  { name: "a Duo platform create", call: (c: Credentials) => c.create({ publicKey: { rp: { id: "duosecurity.com" }, challenge: new Uint8Array([1]),
    user: { id: new Uint8Array([2]), name: "person" }, authenticatorSelection: { authenticatorAttachment: "platform" } } }) },
])("refuses $name with no native WebAuthn fallback", async ({ call }) => {
  const { credentials, nativeGet, nativeCreate } = bridge({
    DUO_AUTOPILOT_SIGN: { success: true, result: { ok: false } },
    DUO_AUTOPILOT_ENROLL: { success: false, error: "ONBOARDING_DUO_KEY_REQUIRED" },
  });
  await expect(call(credentials)).rejects.toMatchObject({ name: "NotAllowedError" });
  expect(nativeGet).not.toHaveBeenCalled();
  expect(nativeCreate).not.toHaveBeenCalled();
});

interface Credentials { get(options: unknown): Promise<unknown>; create(options: unknown): Promise<unknown> }
