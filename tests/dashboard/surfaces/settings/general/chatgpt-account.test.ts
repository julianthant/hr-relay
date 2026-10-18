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
    signIn: () => Promise.resolve(), signOut: () => Promise.resolve(), cancelSignIn: () => Promise.resolve(), ...operations };
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
    assert.match(html, /ChatGPT account unavailable.*Account read failed/u);
    assert.doesNotMatch(html, /disabled=""[^>]*>Sign out/u);
    assert.doesNotMatch(html, /Continue with ChatGPT/u);
  });

  it("renders loading, expired, unavailable and usage-limit states distinctly", () => {
    const render = (snapshot: ChatGptAccountSnapshot) => renderToStaticMarkup(createElement(ChatGptAccountSettings, { port: controlledPort(snapshot) }));
    const loading = render({ state: "loading" });
    assert.doesNotMatch(loading, /aria-busy="true"/u);
    assert.doesNotMatch(loading, /Continue with ChatGPT/u);
    assert.match(render({ state: "expired" }), /Your ChatGPT session expired/u);
    assert.match(render({ state: "unavailable", message: "Account read failed" }), /ChatGPT account unavailable.*Account read failed/u);
    const limited = render({ state: "connected", name: "Preview operator", email: "operator@example.com", planUsage: "limit-reached" });
    assert.match(limited, /Usage limit reached/u);
    assert.match(limited, /Manage usage/u);
    assert.doesNotMatch(limited, /Using ChatGPT plan|Continue with ChatGPT/u);
  });
});


it("places a rejected account port action outside the field group with its original failure copy", async () => {
  const port = controlledPort({ state: "signed-out" }, { signIn: async () => { throw new Error("synthetic action failure"); } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountSettings, { port })));
  const action = [...host.querySelectorAll("button")].find(button => button.textContent === "Continue with ChatGPT");
  assert.ok(action); await act(async () => action.click());
  const banner = [...host.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes("ChatGPT connection failed"));
  assert.ok(banner); assert.equal(banner.closest(".ds-form-group"), null);
  assert.match(banner.textContent ?? "", /ChatGPT sign-in could not be completed. Try again./);
});


for (const scenario of ["initial read failure", "unconfirmed remote revocation"] as const) it(`recovers through Continue after ${scenario} without restarting a pending ceremony`, async () => {
  const account = ChatGptAccountStateSchema.parse({ state: "connected", name: "Exact held operator", email: "exact@example.com", expiresAt: "2099-01-01T00:00:00.000Z", planUsage: "enabled" });
  const started = ChatGptSignInStartSchema.parse({ state: "started", attemptId: "00000000-0000-4000-8000-000000000001", authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=synthetic", expiresAt: "2099-01-01T00:05:00.000Z" });
  const completion = Promise.withResolvers<ChatGptSignInCompletion>();
  let starts = 0, reads = 0;
  const queries: ChatGptAccountQueries = {
    chatGptAccount: async () => { reads++; if (scenario === "initial read failure") throw new Error("synthetic failed read"); return account; },
    startChatGptSignIn: async () => { starts++; return started; },
    completeChatGptSignIn: () => completion.promise,
    cancelChatGptSignIn: async () => ({ state: "cancelled", attemptId: started.attemptId }),
    signOutChatGpt: async () => ({ state: "signed-out", remoteRevocation: "unconfirmed" }),
  };
  const port = createServedChatGptAccountPort(queries, { open: () => ({ navigate() {}, close() {} }) });
  const button = (label: string) => { const found = [...host!.querySelectorAll("button")].find(node => node.textContent === label); assert.ok(found); return found; };
  try {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ChatGptAccountSettings, { port })));
    if (scenario === "unconfirmed remote revocation") {
      assert.match(host.textContent ?? "", /Exact held operator.*exact@example.com/u);
      await act(async () => button("Sign out").click());
      assert.deepEqual(port.getResource(), { state: "empty", account: { state: "signed-out" }, warning: "CHATGPT_REVOCATION_UNCONFIRMED" });
      assert.doesNotMatch(host.textContent ?? "", /Exact held operator|exact@example.com/u);
    } else assert.equal(port.getResource().state, "failed");
    const message = ERROR_CATALOG[scenario === "initial read failure" ? "CHATGPT_AUTH_UNAVAILABLE" : "CHATGPT_REVOCATION_UNCONFIRMED"].text;
    assert.ok(host.textContent?.includes(message));
    const recovery = button("Continue with ChatGPT"); assert.equal(recovery.disabled, false);
    await act(async () => { recovery.click(); recovery.click(); });
    assert.equal(starts, 1); assert.equal(button("Cancel").disabled, false);
    assert.match(host.textContent ?? "", /Waiting for you to finish signing in in your browser/u);
    assert.equal(host.textContent?.includes(message), false);
    await act(async () => { await port.signIn({ usePlan: true }); });
    assert.equal(starts, 1);
    await act(async () => { completion.resolve({ state: "completed", attemptId: started.attemptId, account }); });
    assert.match(host.textContent ?? "", /Exact held operator.*exact@example.com/u);
    assert.equal(host.textContent?.includes(message), false); assert.equal(reads, 1); assert.equal(starts, 1);
  } finally { port.dispose(); }
});
