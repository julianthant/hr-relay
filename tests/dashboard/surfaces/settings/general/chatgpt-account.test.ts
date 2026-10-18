import { IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach,beforeEach,describe,it,vi } from "vitest";
import { ChatGptAccountContext,type ChatGptAccountPort,type ChatGptAccountSnapshot } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { ChatGptAccountSettings } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

function controlledPort(snapshot: ChatGptAccountSnapshot, operations: Partial<Pick<ChatGptAccountPort, "signIn" | "signOut">> = {}): ChatGptAccountPort {
  return { mode: "live", getSnapshot: () => snapshot, subscribe: () => () => undefined,
    signIn: () => Promise.resolve(), signOut: () => Promise.resolve(), ...operations };
}

describe("General ChatGPT account", () => {
  it("accepts the shared account adapter through context without changing the Settings form", () => {
    const port = controlledPort({ state: "connected", name: "Wired operator", email: "wired@example.com", planUsage: "disabled" });
    const html = renderToStaticMarkup(createElement(ChatGptAccountContext.Provider, { value: port, children: createElement(ChatGptAccountSettings) }));
    assert.match(html, /Wired operator.*wired@example\.com/u);
    assert.match(html, /ChatGPT plan access not enabled/u);
    assert.doesNotMatch(html, /Preview|Jordan Lee/u);
  });

  it("retains the exact verified account while a refresh is unavailable and blocks account commands", () => {
    const port = controlledPort({ state: "unavailable", message: "Account read failed", account: { state: "connected", name: "Held operator", email: "held@example.com", expiresAt: IsoInstantSchema.parse("2099-01-01T00:00:00.000Z"), planUsage: "enabled" } });
    const html = renderToStaticMarkup(createElement(ChatGptAccountSettings, { port }));
    assert.match(html, /Held operator.*held@example\.com/u);
    assert.match(html, /ChatGPT account unavailable.*Account read failed/u);
    assert.match(html, /disabled=""[^>]*>Sign out/u);
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
