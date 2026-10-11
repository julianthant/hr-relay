// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { type Root } from "react-dom/client";
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

  it("renders loading, expired, unavailable and usage-limit states distinctly", () => {
    const render = (snapshot: ChatGptAccountSnapshot) => renderToStaticMarkup(createElement(ChatGptAccountSettings, { port: controlledPort(snapshot) }));
    const loading = render({ state: "loading" });
    assert.match(loading, /Loading ChatGPT account/u);
    assert.doesNotMatch(loading, /Continue with ChatGPT/u);
    assert.match(render({ state: "expired" }), /Your ChatGPT session expired/u);
    assert.match(render({ state: "unavailable", message: "Account read failed" }), /ChatGPT account unavailable.*Account read failed/u);
    const limited = render({ state: "connected", name: "Preview operator", email: "operator@example.com", planUsage: "limit-reached" });
    assert.match(limited, /Usage limit reached/u);
    assert.match(limited, /Manage usage/u);
    assert.doesNotMatch(limited, /Using ChatGPT plan|Continue with ChatGPT/u);
  });
});
