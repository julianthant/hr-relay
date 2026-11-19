// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ChatGptAccountContext, type ChatGptAccountPort } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { AssistantSettings } from "../../../../../src/dashboard/surfaces/settings/general/hub-preferences.js";
import { publishAssistantModelChoice } from "../../../../../src/dashboard/surfaces/shell/assistant-approval-model.js";
import type { AssistantModelPreference } from "../../../../../src/models/config/assistant-model-preference.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => { root?.unmount(); publishAssistantModelChoice(undefined); }); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

const snapshot = { state: "connected", name: "Operator", email: "operator@example.com", planUsage: "enabled" } as const;
const port: ChatGptAccountPort = { mode: "live", getSnapshot: () => snapshot, subscribe: () => () => undefined,
  signIn: () => Promise.resolve(), cancelSignIn: () => Promise.resolve(), signOut: () => Promise.resolve(undefined) };
async function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: port, children: createElement(AssistantSettings) })));
  return host;
}
const select = (name: string) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
async function pick(trigger: HTMLButtonElement, value: string) {
  await act(async () => trigger.click());
  const option = document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
  assert.ok(option, `option ${value}`);
  await act(async () => option.click());
}

describe("General Assistant group", () => {
  it("holds the ChatGPT status, Model, Effort and Full access in one group", async () => {
    await mount();
    assert.equal(host!.querySelectorAll("h2").length, 1);
    assert.match(host!.textContent ?? "", /Assistant/u);
    assert.match(host!.textContent ?? "", /operator@example\.com/u);
    assert.ok(select("Model")); assert.ok(select("Effort"));
    assert.ok(host!.querySelector('[data-settings-path="assistant.fullAccess"]'));
  });
  it("shows Model unavailable and disables both selects without a served model", async () => {
    await mount();
    assert.equal(select("Model").disabled, true); assert.equal(select("Effort").disabled, true);
    assert.match(select("Model").textContent ?? "", /Model unavailable/u);
  });
  it("saves a model pick at once, without a chat turn, and keeps the served value", async () => {
    const saved: AssistantModelPreference[] = [];
    publishAssistantModelChoice({ preference: { slug: "gpt-6.1-sol", effort: "medium" }, models: [{ slug: "gpt-6.1-sol" }, { slug: "gpt-6.1-terra" }], choose: async preference => { saved.push(preference); } });
    await mount();
    assert.equal(select("Effort").dataset.value, "medium");
    await pick(select("Effort"), "high");
    assert.deepEqual(saved, [{ slug: "gpt-6.1-sol", effort: "high" }]);
    assert.equal(select("Effort").dataset.value, "medium", "a save the server did not confirm reverts to the served value");
  });
});
