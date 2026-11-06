import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import type { ChatGptAccountPort, ChatGptAccountSnapshot } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { ASSISTANT_VERIFICATION_WINDOW_MS, createServedPreflightAssistantPort } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-assistant-model.js";

afterEach(() => { vi.useRealTimers(); });
const connected = (email: string): ChatGptAccountSnapshot => ({ state: "connected", name: "Operator", email, planUsage: "enabled" });
function harness() {
  let snapshot = connected("a@example.edu"); const listeners = new Set<() => void>();
  const account = { getSnapshot: () => snapshot, subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); }, refresh: async () => {} } as unknown as ChatGptAccountPort;
  const change = (next: ChatGptAccountSnapshot) => { snapshot = next; for (const l of listeners) l(); };
  let release: (value: { state: "answered" }) => void = () => {};
  const client = { assistantRespond: () => new Promise<never>(resolve => { release = resolve as never; }) } as never;
  return { port: createServedPreflightAssistantPort(client, account), change, finish: () => release({ state: "answered" }) };
}
it("drops a late settlement after the account authority changes", async () => {
  const h = harness(); const pending = h.port.testAssistant();
  assert.equal(h.port.getSnapshot().state, "loading");
  h.change({ state: "signed-out" }); h.finish(); await pending;
  assert.equal(h.port.getSnapshot().state, "idle");
});
it("clears a passed result on sign-out and after the 15-minute window", async () => {
  vi.useFakeTimers();
  const h = harness(); const first = h.port.testAssistant(); h.finish(); await first;
  assert.equal(h.port.getSnapshot().state, "passed");
  vi.advanceTimersByTime(ASSISTANT_VERIFICATION_WINDOW_MS);
  assert.equal(h.port.getSnapshot().state, "idle");
  const second = h.port.testAssistant(); h.finish(); await second;
  h.change(connected("b@example.edu"));
  assert.equal(h.port.getSnapshot().state, "idle");
});
it("ignores a settlement that arrives after disposal", async () => {
  const h = harness(); const pending = h.port.testAssistant();
  h.port.dispose(); h.finish(); await pending;
  assert.equal(h.port.getSnapshot().state, "loading");
});
