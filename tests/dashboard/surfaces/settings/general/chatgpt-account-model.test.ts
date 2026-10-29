// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,beforeEach,describe,it,vi } from "vitest";
import { CHATGPT_USAGE_URL,createPreviewChatGptAccountPort,type ChatGptAccountPort,type ChatGptAccountSnapshot } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { ChatGptAccountSettings } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

async function mount(port: ChatGptAccountPort) {
  host = document.createElement("div"); document.body.append(host);
  await act(async () => { root = createRoot(host!); root.render(createElement(ChatGptAccountSettings, { port })); });
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(node => node.textContent?.trim() === name);
  if (!found) throw new Error(`missing-account-button:${name}`);
  return found;
}
async function click(name: string) { await act(async () => { button(name).click(); }); }

function controlledPort(snapshot: ChatGptAccountSnapshot, operations: Partial<Pick<ChatGptAccountPort, "signIn" | "signOut">> = {}): ChatGptAccountPort {
  return { mode: "live", getSnapshot: () => snapshot, subscribe: () => () => undefined,
    signIn: () => Promise.resolve(), signOut: () => Promise.resolve(), cancelSignIn: () => Promise.resolve(), testOcr: () => Promise.resolve(), ...operations };
}

describe("General ChatGPT account", () => {
  it("connects the preview account directly without a dialog or collecting credentials", async () => {
    const port = createPreviewChatGptAccountPort();
    const signIn = vi.spyOn(port, "signIn");
    await mount(port);
    button("Connect ChatGPT").focus();
    await click("Connect ChatGPT");
    assert.equal(signIn.mock.calls.length, 1);
    assert.deepEqual(signIn.mock.calls[0], [{ usePlan: true }]);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.querySelectorAll('input[type="password"],input[name="token"],input[name="apiKey"]').length, 0);
    assert.equal(port.getSnapshot().state, "connected");
    assert.match(host?.textContent ?? "", /jordan.lee@example\.com/u);
    assert.doesNotMatch(host?.textContent ?? "", /Using ChatGPT plan|Preview/u);
    assert.equal(document.activeElement, host?.querySelector(`a[href="${CHATGPT_USAGE_URL}"]`));
  });

  it("requests plan access directly for a disabled account, then signs out", async () => {
    const port = createPreviewChatGptAccountPort();
    await port.signIn({ usePlan: false });
    await mount(port);
    const identity = port.getSnapshot();
    assert.equal(identity.state, "connected");
    if (identity.state !== "connected") throw new Error("preview-account-not-connected");
    assert.equal(identity.planUsage, "disabled");
    assert.match(host?.textContent ?? "", /ChatGPT plan access not enabled/u);
    assert.equal(host?.querySelector(`a[href="${CHATGPT_USAGE_URL}"]`), null);
    await click("Connect ChatGPT");
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.match(host?.textContent ?? "", /jordan.lee@example\.com/u);
    assert.doesNotMatch(host?.textContent ?? "", /Using ChatGPT plan|Preview/u);
    const usage = host?.querySelector<HTMLAnchorElement>(`a[href="${CHATGPT_USAGE_URL}"]`);
    assert.ok(usage);
    assert.equal(usage.target, "_blank");
    assert.equal(usage.rel, "noopener noreferrer");
    assert.ok(!window.location.search.includes("jordan.lee"));
    await click("Disconnect");
    assert.equal(port.getSnapshot().state, "signed-out");
    assert.doesNotMatch(host?.textContent ?? "", /jordan\.lee@example\.com/u);
  });

  it("preserves preview connection across Settings remounts without writing credentials to storage", async () => {
    const port = createPreviewChatGptAccountPort();
    const storageBefore = { local: localStorage.length, session: sessionStorage.length };
    await act(async () => { await port.signIn({ usePlan: true }); });
    await mount(port);
    assert.match(host?.textContent ?? "", /jordan.lee@example\.com/u);
    assert.doesNotMatch(host?.textContent ?? "", /Using ChatGPT plan|Preview/u);
    assert.deepEqual({ local: localStorage.length, session: sessionStorage.length }, storageBefore);
    assert.equal(createPreviewChatGptAccountPort().getSnapshot().state, "signed-out");
  });

  it("locks a pending live sign-in and reports refusal without inventing a connected account", async () => {
    let reject!: (error: Error) => void;
    let calls = 0;
    const port = controlledPort({ state: "signed-out" }, { signIn: () => {
      calls += 1; return new Promise<void>((_resolve, refuse) => { reject = refuse; });
    } });
    await mount(port);
    await click("Connect ChatGPT");
    assert.equal(button("Connect ChatGPT").disabled, true);
    await click("Connect ChatGPT");
    assert.equal(calls, 1);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(port.getSnapshot().state, "signed-out");
    await act(async () => reject(new Error("synthetic-refusal")));
    assert.match(host?.textContent ?? "", /ChatGPT sign-in could not be completed/u);
    assert.equal(button("Connect ChatGPT").disabled, false);
    assert.equal(port.getSnapshot().state, "signed-out");
  });

  it("keeps the account visible when sign-out cannot be confirmed", async () => {
    const port = controlledPort({ state: "connected", name: "Preview operator", email: "operator@example.com", planUsage: "enabled" },
      { signOut: () => Promise.reject(new Error("synthetic-lost-response")) });
    await mount(port);
    await click("Disconnect");
    assert.match(host?.textContent ?? "", /Sign-out could not be confirmed/u);
    assert.match(host?.textContent ?? "", /operator@example\.com/u);
    assert.equal(port.getSnapshot().state, "connected");
    assert.equal(button("Disconnect").disabled, false);
  });

  it("allows an in-flight adapter to settle after the card unmounts", async () => {
    let finish!: () => void;
    const port = controlledPort({ state: "signed-out" }, { signIn: () => new Promise<void>(resolve => { finish = resolve; }) });
    await mount(port);
    await click("Connect ChatGPT");
    act(() => root?.unmount()); root = undefined;
    await act(async () => finish());
    assert.equal(port.getSnapshot().state, "signed-out");
  });
});
