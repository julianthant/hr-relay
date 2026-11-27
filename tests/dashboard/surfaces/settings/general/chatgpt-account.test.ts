import { chatGptStatusFixture } from "../../../../support/helpers/chatgpt-status-fixture.js";
import { IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach,beforeEach,describe,it,vi } from "vitest";
import { createServedChatGptAccountPort,ChatGptAccountContext,type ChatGptAccountPort,type ChatGptAccountSnapshot } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import type { ChatGptAccountQueries } from "../../../../../src/dashboard/client/queries/chatgpt-account-queries.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { ChatGptAccountStateSchema, ChatGptSignInStartSchema, type ChatGptSignInCompletion } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { ChatGptAccountSettings } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

function controlledPort(snapshot: ChatGptAccountSnapshot, operations: Partial<Pick<ChatGptAccountPort, "signIn" | "signOut">> = {}): ChatGptAccountPort {
  return { mode: "live", getSnapshot: () => snapshot, subscribe: () => () => undefined,
    signIn: () => Promise.resolve(), cancelSignIn: () => Promise.resolve(), signOut: () => Promise.resolve(undefined), ...operations };
}

describe("General ChatGPT account", () => {
  it("accepts the shared account adapter through context without changing the Settings form", () => {
    const port = controlledPort({ state: "connected", name: "Wired operator", email: "wired@example.com", planUsage: "disabled" });
    const html = renderToStaticMarkup(createElement(ChatGptAccountContext.Provider, { value: port, children: createElement(ChatGptAccountSettings) }));
    assert.match(html, /Wired operator.*wired@example\.com/u);
    assert.match(html, /ChatGPT plan access not enabled/u);
    assert.doesNotMatch(html, /Preview|Jordan Lee/u);
  });

  it("retains the exact verified account while a refresh is unavailable without inventing a command lock", () => {
    const port = controlledPort({ state: "unavailable", message: "Account read failed", account: { state: "connected", name: "Held operator", email: "held@example.com", expiresAt: IsoInstantSchema.parse("2099-01-01T00:00:00.000Z"), planUsage: "enabled" } });
    const html = renderToStaticMarkup(createElement(ChatGptAccountSettings, { port }));
    assert.match(html, /Held operator.*held@example\.com/u);
    assert.match(html, /Account read failed/u);
    assert.match(html, />Retry</u);
    assert.doesNotMatch(html, /Disconnect/u);
    assert.doesNotMatch(html, />Connect</u);
  });

  it("renders loading, unavailable and usage-limit states distinctly", () => {
    const render = (snapshot: ChatGptAccountSnapshot) => renderToStaticMarkup(createElement(ChatGptAccountSettings, { port: controlledPort(snapshot) }));
    const loading = render({ state: "loading" });
    assert.match(loading, /aria-label="Loading ChatGPT account" aria-busy="true"[^>]* class="invisible"/u, "the row keeps its place, unseen until the read is slow");
    assert.doesNotMatch(loading, />Connect</u);
    const failed = render({ state: "unavailable", message: "Account read failed" });
    assert.match(failed, /Couldn&#x27;t check ChatGPT\./u);
    assert.match(failed, />Retry</u);
    assert.doesNotMatch(failed, /Not connected|>Connect</u);
    const limited = render({ state: "connected", name: "Preview operator", email: "operator@example.com", planUsage: "limit-reached" });
    assert.match(limited, /Usage limit reached/u);
    assert.match(limited, /Manage usage/u);
    assert.doesNotMatch(limited, /Using ChatGPT plan|>Connect</u);
  });
});


it("shows a rejected account port action in the card with its original failure copy and keeps Connect", async () => {
  const port = controlledPort({ state: "signed-out" }, { signIn: async () => { throw new Error("synthetic action failure"); } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountSettings, { port })));
  const action = [...host.querySelectorAll("button")].find(button => button.textContent === "Connect");
  assert.ok(action); await act(async () => action.click());
  const banner = [...host.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes(ERROR_CATALOG.CHATGPT_CONNECT_FAILED.text));
  assert.ok(banner); assert.ok(banner.closest(".ds-form-group"));
  assert.match(banner.textContent ?? "", /ChatGPT did not connect\. Try again\./);
  assert.equal(banner.querySelectorAll("button").length, 0);
  assert.ok([...host.querySelectorAll("button")].some(button => button.textContent === "Connect"));
});


it("recovers through Continue after an initial read failure without restarting a pending ceremony", async () => {
  const account = ChatGptAccountStateSchema.parse({ state: "connected", name: "Exact held operator", email: "exact@example.com", expiresAt: "2099-01-01T00:00:00.000Z", planUsage: "enabled" });
  const started = ChatGptSignInStartSchema.parse({ state: "started", attemptId: "00000000-0000-4000-8000-000000000001", authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=synthetic", expiresAt: "2099-01-01T00:05:00.000Z" });
  const completion = Promise.withResolvers<ChatGptSignInCompletion>();
  let starts = 0, reads = 0;
  const queries: ChatGptAccountQueries = { chatGptAccount: async () => { reads++; if (reads === 1) throw new Error("synthetic failed read"); return chatGptStatusFixture(reads === 2 ? { state: "signed-out" } : account); },
    checkChatGptAccount: async () => chatGptStatusFixture(account),
    startChatGptSignIn: async () => { starts++; return started; },
    completeChatGptSignIn: () => completion.promise,
    cancelChatGptSignIn: async () => ({ state: "cancelled", attemptId: started.attemptId }),
    signOutChatGpt: async () => ({ state: "signed-out", remoteRevocation: "confirmed" }), testChatGptOcr: async () => ({ state: "completed", model: "Synthetic OCR" }),
  };
  const port = createServedChatGptAccountPort(queries, { open: () => ({ navigate() {}, close() {} }) });
  const button = (label: string) => { const found = [...host!.querySelectorAll("button")].find(node => node.textContent === label); assert.ok(found); return found; };
  try {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ChatGptAccountSettings, { port })));
    assert.equal(port.getResource().state, "failed");
    const message = ERROR_CATALOG.CHATGPT_AUTH_UNAVAILABLE.text;
    assert.equal(host.textContent?.includes("Not connected"), false);
    assert.ok(button("Retry"));
    await act(async () => button("Retry").click());
    assert.equal(port.getResource().state, "empty");
    const recovery = button("Connect"); assert.equal(recovery.disabled, false);
    await act(async () => { recovery.click(); recovery.click(); });
    assert.equal(starts, 1); assert.equal(button("Cancel").disabled, false);
    assert.match(host.textContent ?? "", /Finish signing in to ChatGPT in your browser\./u);
    assert.equal(host.textContent?.includes(message), false);
    await act(async () => { await port.signIn({ usePlan: true }); });
    assert.equal(starts, 1);
    await act(async () => { completion.resolve({ state: "completed", attemptId: started.attemptId, account }); });
    assert.match(host.textContent ?? "", /Exact held operator.*exact@example.com/u);
    assert.equal(host.textContent?.includes(message), false); assert.equal(reads, 3); assert.equal(starts, 1);
  } finally { port.dispose(); }
});


it("offers Retry for an expired account whose check was refused and recovers it without a sign-in", async () => {
  const account = ChatGptAccountStateSchema.parse({ state: "connected", name: "Renewed operator", email: "renewed@example.com", expiresAt: "2099-01-01T00:00:00.000Z", planUsage: "enabled" });
  let checks = 0, starts = 0;
  const unexpected = async (): Promise<never> => { starts++; throw new Error("unexpected account command"); };
  const port = createServedChatGptAccountPort({ chatGptAccount: async () => chatGptStatusFixture({ state: "expired" }),
    checkChatGptAccount: async () => chatGptStatusFixture(++checks === 1 ? { state: "expired" } : account),
    startChatGptSignIn: unexpected, completeChatGptSignIn: unexpected, cancelChatGptSignIn: unexpected, signOutChatGpt: unexpected, testChatGptOcr: unexpected });
  try {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ChatGptAccountSettings, { port })));
    await vi.waitFor(() => { assert.equal(port.getResource().state, "failed"); });
    await act(async () => {});
    const retry = [...host.querySelectorAll("button")].find(node => node.textContent === "Retry"); assert.ok(retry);
    await act(async () => retry.click());
    await vi.waitFor(() => { assert.match(host?.textContent ?? "", /Renewed operator.*renewed@example\.com/u); });
    assert.equal(checks, 2); assert.equal(starts, 0);
  } finally { port.dispose(); }
});

for (const snapshot of [{ state: "signed-out" }, { state: "expired" }] as const)
  it(`shows the one not-connected row for a ${snapshot.state} account`, async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ChatGptAccountSettings, { port: controlledPort(snapshot) })));
    const row = host.querySelector('[data-settings-path="chatgpt.account"]'); assert.ok(row);
    assert.equal(row.textContent, "ChatGPT" + "Not connected" + "Connect");
    assert.deepEqual([...row.querySelectorAll("button")].map(button => button.textContent), ["Connect"]);
  });

it("keeps OCR diagnostics out of the account panel", () => {
  const html = renderToStaticMarkup(createElement(ChatGptAccountSettings, { port: controlledPort({ state: "connected", name: "Operator", email: "operator@example.com", planUsage: "enabled" }) }));
  assert.doesNotMatch(html, /Test OCR|OCR test/u);
});

it("keeps the expired sign-in text and its Sign in button", async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountSettings, { port: controlledPort({ state: "sign-in-expired" }) })));
  const row = host.querySelector('[data-settings-path="chatgpt.account"]'); assert.ok(row);
  assert.match(row.textContent ?? "", /Your sign-in attempt expired\. Sign in to try again\./u);
  assert.deepEqual([...row.querySelectorAll("button")].map(button => button.textContent), ["Sign in"]);
});

describe("Disconnecting the ChatGPT account", () => {
  const connected = { state: "connected", name: "Operator", email: "operator@example.com", planUsage: "enabled" } as const;
  const button = (label: string) => [...document.body.querySelectorAll("button")].find(node => node.textContent === label);
  it("offers Disconnect only when connected", () => {
    const render = (snapshot: ChatGptAccountSnapshot) => renderToStaticMarkup(createElement(ChatGptAccountSettings, { port: controlledPort(snapshot) }));
    assert.match(render(connected), /Disconnect/u);
    assert.doesNotMatch(render({ state: "signed-out" }), /Disconnect/u);
    assert.doesNotMatch(render({ state: "expired" }), /Disconnect/u);
  });

  it("asks once, then forgets the account and offers Connect again", async () => {
    let snapshot: ChatGptAccountSnapshot = connected, calls = 0;
    const listeners = new Set<() => void>();
    const port = controlledPort(connected, { signOut: async () => { calls++; snapshot = { state: "signed-out" }; listeners.forEach(listener => listener()); return undefined; } });
    const live: ChatGptAccountPort = { ...port, getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ChatGptAccountSettings, { port: live })));
    await act(async () => button("Disconnect")?.click());
    assert.match(document.body.textContent ?? "", /Disconnect ChatGPT\?.*Assistant and OCR stop until you sign in\./u);
    assert.equal(calls, 0);
    const confirm = [...document.body.querySelectorAll("button")].filter(node => node.textContent === "Disconnect").at(-1);
    assert.ok(confirm); await act(async () => confirm.click());
    assert.equal(calls, 1);
    assert.ok(button("Connect")); assert.equal(button("Disconnect") === undefined, true);
  });

  it("cancelling the question leaves the account connected", async () => {
    let calls = 0;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ChatGptAccountSettings, { port: controlledPort(connected, { signOut: async () => { calls++; return undefined; } }) })));
    await act(async () => button("Disconnect")?.click());
    await act(async () => button("Cancel")?.click());
    assert.equal(calls, 0); assert.ok(button("Disconnect"));
  });

  it("shows the catalog text in a notice and leaves the row connected when the disconnect fails", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ChatGptAccountSettings, { port: controlledPort(connected, { signOut: async () => "CHATGPT_CREDENTIAL_CONFLICT" }) })));
    await act(async () => button("Disconnect")?.click());
    const confirm = [...document.body.querySelectorAll("button")].filter(node => node.textContent === "Disconnect").at(-1);
    assert.ok(confirm); await act(async () => confirm.click());
    assert.ok(document.body.textContent?.includes(ERROR_CATALOG.CHATGPT_CREDENTIAL_CONFLICT.text));
    assert.ok(button("Disconnect")); assert.equal(button("Connect") === undefined, true);
  });
});

describe("ChatGPT card states", () => {
  const connected = { state: "connected", name: "N".repeat(80), email: `${"e".repeat(80)}@example.com`, planUsage: "enabled" } as const;
  it("truncates a long name and email with titles inside a width-bound control", () => {
    const html = renderToStaticMarkup(createElement(ChatGptAccountSettings, { port: controlledPort(connected) }));
    assert.ok(html.includes(`title="${connected.name}"`));
    assert.ok(html.includes(`title="${connected.email}"`));
    assert.match(html, /min-w-0 max-w-full items-center/u);
  });

  it("shows a one-letter name and a missing email without a gap", () => {
    const html = renderToStaticMarkup(createElement(ChatGptAccountSettings, { port: controlledPort({ ...connected, name: "J", email: "" }) }));
    assert.match(html, />J</u);
    assert.doesNotMatch(html, /<span class="min-w-0 truncate/u);
  });

  it("uses the disconnect sentence in the card for a failed disconnect and keeps Disconnect as the retry", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ChatGptAccountSettings, { port: controlledPort(connected, { signOut: async () => "CHATGPT_AUTH_UNAVAILABLE" }) })));
    await act(async () => [...document.body.querySelectorAll("button")].find(node => node.textContent === "Disconnect")?.click());
    const confirm = [...document.body.querySelectorAll("button")].filter(node => node.textContent === "Disconnect").at(-1);
    assert.ok(confirm); await act(async () => confirm.click());
    const text = document.body.textContent ?? "";
    assert.ok(text.includes(ERROR_CATALOG.CHATGPT_DISCONNECT_FAILED.text));
    assert.equal(text.includes("sign-in"), false);
    assert.ok([...document.body.querySelectorAll("button")].some(node => node.textContent === "Disconnect"));
  });

  it("sizes the loading skeleton as the one status row", () => {
    vi.useFakeTimers();
    try {
      host = document.createElement("div"); document.body.append(host); root = createRoot(host);
      act(() => root?.render(createElement(ChatGptAccountSettings, { port: controlledPort({ state: "loading" }) })));
      act(() => { vi.advanceTimersByTime(2000); });
      assert.equal(host.querySelectorAll(".ds-result-row").length, 1);
    } finally { vi.useRealTimers(); }
  });
});
