import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { it } from "vitest";

function world() {
  let names = ["alex"], disconnected = false, showTrust = false, clicks = 0, runtimeCalls = 0;
  let mutation: () => void = () => { throw new Error("observer not installed"); };
  let observe: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => void) | undefined;
  let trustDeadline: (() => void) | undefined;
  let options: MutationObserverInit | undefined;
  const document = { documentElement: {}, querySelectorAll: () => showTrust ? [{ disabled: false, innerText: "Yes, this is my device",
    isConnected: true, getClientRects: () => [{}], click: () => { clicks++; } }] : [] };
  const scope: Record<string, unknown> = { document, location: { href: "https://test.duosecurity.com/login", origin: "https://test.duosecurity.com" },
    DuoUsername: { findUsernames: () => [...names] },
    MutationObserver: class {
      constructor(callback: () => void) { mutation = callback; }
      observe(_target: unknown, input: MutationObserverInit) { options = input; }
      disconnect() { disconnected = true; }
    },
    addEventListener() {}, postMessage() {},
    setTimeout: (callback: () => void) => { trustDeadline = callback; },
    chrome: { runtime: { id: "owned", onMessage: { addListener: (listener: typeof observe) => { observe = listener; } },
      sendMessage: async () => { runtimeCalls++; return { success: true, result: { enabled: true, trustClick: true } }; } } },
  };
  scope.window = scope;
  runInNewContext(readFileSync("fast-duo/src/workflow-content.js", "utf8"), scope);
  const snapshot = () => {
    let value: unknown;
    observe?.({ type: "RELAY_OBSERVE" }, { id: "owned" }, reply => { value = reply; });
    assert.ok(value && typeof value === "object" && "accountRevision" in value);
    assert.ok(typeof value.accountRevision === "number");
    return value.accountRevision;
  };
  return { options, snapshot, account(value: string[]) { names = value; if (!disconnected) mutation(); },
    expireTrust() { assert.ok(trustDeadline); trustDeadline(); }, showTrust() { showTrust = true; if (!disconnected) mutation(); },
    clicks: () => clicks, runtimeCalls: () => runtimeCalls };
}

it("keeps account text observation after the unchanged trust-click window and records an account change-and-return", async () => {
  const w = world();
  assert.equal(w.options?.characterData, true);
  const before = w.snapshot(); w.expireTrust();
  w.account(["other"]); w.account(["alex"]);
  assert.equal(w.snapshot(), before + 2);
  w.showTrust(); await Promise.resolve(); await Promise.resolve();
  assert.equal(w.runtimeCalls(), 0); assert.equal(w.clicks(), 0);
});
