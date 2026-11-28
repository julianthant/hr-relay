// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ChatGptAccountContext, type ChatGptAccountPort } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { AssistantSettings } from "../../../../../src/dashboard/surfaces/settings/general/hub-preferences.js";
import { PersonPreferencesContext } from "../../../../../src/dashboard/lib/person-preferences.js";
import { createPersonPreferences } from "../../../../../src/dashboard/state/person-preferences-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

const snapshot = { state: "connected", name: "Operator", email: "operator@example.com", planUsage: "enabled" } as const;
const port: ChatGptAccountPort = { mode: "live", getSnapshot: () => snapshot, subscribe: () => () => undefined,
  signIn: () => Promise.resolve(), cancelSignIn: () => Promise.resolve(), signOut: () => Promise.resolve(undefined) };
async function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const preferences = createPersonPreferences("preview");
  await act(async () => root?.render(createElement(PersonPreferencesContext.Provider, { value: preferences },
    createElement(ChatGptAccountContext.Provider, { value: port, children: createElement(AssistantSettings) }))));
  return host;
}
describe("General Assistant group", () => {
  it("holds the ChatGPT status and Full access in one group", async () => {
    await mount();
    assert.equal(host!.querySelectorAll("h2").length, 1);
    assert.match(host!.textContent ?? "", /Assistant/u);
    assert.match(host!.textContent ?? "", /operator@example\.com/u);
    assert.ok(host!.querySelector('[data-settings-path="assistant.fullAccess"]'));
  });
  it("has no Model or Effort row", async () => {
    await mount();
    assert.equal(host!.querySelector('[aria-label="Model"]') === null, true);
    assert.equal(host!.querySelector('[aria-label="Effort"]') === null, true);
  });
});
