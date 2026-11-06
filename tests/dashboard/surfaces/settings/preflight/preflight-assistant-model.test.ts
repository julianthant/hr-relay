import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import type { ChatGptAccountPort, ChatGptAccountSnapshot } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { ASSISTANT_VERIFICATION_WINDOW_MS, createServedPreflightAssistantPort } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-assistant-model.js";

afterEach(() => { vi.useRealTimers(); });
const connected = (email: string, planUsage: "enabled" | "disabled" | "limit-reached" = "enabled"): ChatGptAccountSnapshot => ({ state: "connected", name: "Operator", email, planUsage });
function harness() {
  let snapshot = connected("a@example.edu"); const listeners = new Set<() => void>();
  const account = { getSnapshot: () => snapshot, subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); }, refresh: async () => {} } as unknown as ChatGptAccountPort;
  const change = (next: ChatGptAccountSnapshot) => { snapshot = next; for (const l of listeners) l(); };
  let release: (value: { state: "answered" }) => void = () => {};
  const signals: (AbortSignal | undefined)[] = [];
  const client = { assistantRespond: (_input: unknown, signal?: AbortSignal) => { signals.push(signal); return new Promise<never>(resolve => { release = resolve as never; }); } } as never;
  const setRefresh = (fn: () => Promise<void>) => { (account as { refresh: () => Promise<void> }).refresh = fn; };
  return { port: createServedPreflightAssistantPort(client, account), change, signals, setRefresh, finish: () => release({ state: "answered" }) };
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
  assert.equal(h.port.getSnapshot().state, "idle");
});

it("a same-email plan change retires a passed result and a pending request", async () => {
  const h = harness(); const first = h.port.testAssistant(); h.finish(); await first;
  assert.equal(h.port.getSnapshot().state, "passed");
  h.change(connected("a@example.edu", "limit-reached"));
  assert.equal(h.port.getSnapshot().state, "idle");
  const pending = h.port.testAssistant(); h.change(connected("a@example.edu", "disabled")); h.finish(); await pending;
  assert.equal(h.signals.at(-1)?.aborted, true);
  assert.equal(h.port.getSnapshot().state, "idle");
});
it("keeps its own valid result across its account refresh but not a refresh that reveals a change", async () => {
  const h = harness(); h.setRefresh(async () => { h.change({ state: "loading" }); h.change(connected("a@example.edu")); });
  const first = h.port.testAssistant(); h.finish(); await first;
  assert.equal(h.port.getSnapshot().state, "passed");
  h.setRefresh(async () => { h.change(connected("a@example.edu", "disabled")); });
  const second = h.port.testAssistant(); h.finish(); await second;
  assert.equal(h.port.getSnapshot().state, "idle");
});
it("aborts on model change and disposal and refuses calls after disposal", async () => {
  const h = harness(); const pending = h.port.testAssistant();
  h.port.invalidate?.(); assert.equal(h.signals[0]?.aborted, true); h.finish(); await pending;
  assert.equal(h.port.getSnapshot().state, "idle");
  const again = h.port.testAssistant(); h.port.dispose(); assert.equal(h.signals[1]?.aborted, true); h.finish(); await again;
  const before = h.signals.length; await h.port.testAssistant();
  assert.equal(h.signals.length, before);
});
